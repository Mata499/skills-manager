import path from 'node:path';
import { mkdir, readFile, open, rename, unlink, rmdir, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { normalizeRoot } from './roots.mjs';

export class StateError extends Error {
  constructor(message, options) { super(message, options); this.name = 'StateError'; this.code = 'INVALID_STATE'; }
}
export function defaultState() { return { version: 1, defaults: { globalSkills: 'off' }, projects: {}, skillNotes: {} }; }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const names = value => Array.isArray(value) && value.every(item => typeof item === 'string');
export function validateState(value) {
  if (!record(value) || value.version !== 1 || !record(value.defaults) || !['on', 'off'].includes(value.defaults.globalSkills) || !record(value.projects)) throw new StateError('Malformed or unsupported state');
  for (const project of Object.values(value.projects)) {
    if (!record(project) || (project.enabled !== undefined && !names(project.enabled)) || (project.disabled !== undefined && !names(project.disabled))) throw new StateError('Malformed project policy');
  }
  if (value.skillNotes !== undefined && (!record(value.skillNotes) || Object.values(value.skillNotes).some(note => typeof note !== 'string'))) throw new StateError('Malformed skill notes');
  return value;
}
async function readStrict(file) {
  let text;
  try { text = await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return defaultState(); throw error; }
  try { return validateState(JSON.parse(text)); }
  catch (cause) { throw new StateError('State is malformed; refusing to overwrite it', { cause }); }
}

/** A mkdir lock serializes independent stores/processes. Never steal an apparently stale lock. */
export function createStateStore(filePath, { lockTimeoutMs = 5000, retryMs = 20 } = {}) {
  const absolute = path.resolve(filePath);
  let queue = Promise.resolve();
  async function location() {
    await mkdir(path.dirname(absolute), { recursive: true });
    return path.join(await realpath(path.dirname(absolute)), path.basename(absolute));
  }
  async function read() {
    try { return await readStrict(absolute); }
    catch (error) { const state = defaultState(); Object.defineProperty(state, 'error', { value: error }); return state; }
  }
  async function transact(mutator) {
    const file = await location();
    const lock = file + '.lock';
    const deadline = Date.now() + lockTimeoutMs;
    for (;;) {
      try { await mkdir(lock); break; }
      catch (error) {
        // Windows may report EPERM while the previous owner's directory deletion completes.
        const pendingRemoval = process.platform === 'win32' && error.code === 'EPERM';
        if (error.code !== 'EEXIST' && !pendingRemoval) throw error;
        if (Date.now() >= deadline) {
          if (pendingRemoval) throw error;
          const failure = new Error('State lock timeout'); failure.code = 'STATE_LOCK_TIMEOUT'; throw failure;
        }
        await delay(retryMs);
      }
    }
    let temp;
    try {
      const state = await readStrict(file);
      await mutator(state);
      validateState(state);
      temp = file + '.' + randomUUID() + '.tmp';
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(state, null, 2) + '\n', 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temp, file);
      temp = undefined;
      return state;
    } finally {
      try { if (temp) await unlink(temp); } finally { await rmdir(lock); }
    }
  }
  function update(mutator) {
    if (typeof mutator !== 'function') return Promise.reject(new TypeError('A state mutator is required'));
    const next = queue.then(() => transact(mutator));
    queue = next.catch(() => {});
    return next;
  }
  return {
    read, update,
    setSkill(root, name, enabled) {
      if (typeof name !== 'string' || !name || typeof enabled !== 'boolean') return Promise.reject(new TypeError('Skill name and boolean are required'));
      const key = normalizeRoot(root);
      return update(state => {
        let project = Object.hasOwn(state.projects, key) ? state.projects[key] : undefined;
        if (!project) { project = { enabled: [], disabled: [] }; Object.defineProperty(state.projects, key, { value: project, enumerable: true, configurable: true, writable: true }); }
        project.enabled = (project.enabled ?? []).filter(item => item !== name);
        project.disabled = (project.disabled ?? []).filter(item => item !== name);
        project[enabled ? 'enabled' : 'disabled'].push(name);
        project.updatedAt = Date.now();
      });
    },
    setDefault(value) {
      if (!['on', 'off'].includes(value)) return Promise.reject(new TypeError('Default must be on or off'));
      return update(state => { state.defaults.globalSkills = value; });
    },
    setNote(name, note) {
      if (typeof name !== 'string' || !name || typeof note !== 'string') return Promise.reject(new TypeError('Name and note must be strings'));
      return update(state => { state.skillNotes ??= {}; Object.defineProperty(state.skillNotes, name, { value: note, enumerable: true, configurable: true, writable: true }); });
    },
  };
}
