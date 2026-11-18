import path from 'node:path';
import os from 'node:os';
import { realpath, stat } from 'node:fs/promises';

/** Stable project keys; Windows paths are case insensitive, including UNC paths. */
export function normalizeRoot(value, { platform = process.platform } = {}) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('A non-empty path is required');
  const windows = platform === 'win32' || /^[a-z]:[\\/]/i.test(value) || value.startsWith('\\\\');
  const api = windows ? path.win32 : path;
  let result = api.resolve(value);
  if (windows) result = result.toLowerCase();
  return result;
}

export async function canonicalPath(value) {
  return normalizeRoot(await realpath(path.resolve(value)));
}

export async function resolveProjectRoot(cwd = process.cwd()) {
  const start = await canonicalPath(cwd);
  if (!(await stat(start)).isDirectory()) throw new TypeError('cwd must be a directory');
  for (let current = start; ; current = path.dirname(current)) {
    try { await stat(path.join(current, '.git')); return current; }
    catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    const parent = path.dirname(current);
    if (parent === current) return start;
  }
}

/** Only global/custom/library roots are managed. Bundled and project roots stay with DSH. */
export function globalSkillRoots(options = {}) {
  const dshHome = options.dshHome ?? path.join(os.homedir(), '.dsh');
  const agentsHome = options.agentsHome ?? path.join(os.homedir(), '.agents');
  return [
    ...(options.customSkillDirs ?? []).map((root, index) => ({ path: root, source: 'custom', rank: 300, order: index })),
    { path: path.join(dshHome, 'skills'), source: 'user-dsh', rank: 400 },
    { path: options.libraryDir ?? path.join(dshHome, 'skills-library'), source: 'library', rank: 450 },
    { path: path.join(agentsHome, 'skills'), source: 'user-agents', rank: 500 },
  ];
}
