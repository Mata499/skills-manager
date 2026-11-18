import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createStateStore, defaultState } from '../src/core/state.mjs';
import { isVisible } from '../src/core/policy.mjs';
import { normalizeRoot, canonicalPath, resolveProjectRoot, globalSkillRoots } from '../src/core/roots.mjs';
import { createCatalog, parseSkill } from '../src/core/catalog.mjs';

async function temp(t) { const dir = await mkdtemp(path.join(os.tmpdir(), 'skills-manager-core-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
async function skill(root, folder, yaml, body = 'Skill body') { const dir = path.join(root, folder); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'SKILL.md'), '---\n' + yaml + '\n---\n' + body); return dir; }

test('state starts off, persists changes, preserves unknown fields at every level', async t => {
  const dir = await temp(t); const file = path.join(dir, 'state.json'); const store = createStateStore(file);
  assert.deepEqual(await store.read(), defaultState());
  await store.update(s => { s.future = { yes: true }; s.defaults.extra = 3; s.projects[normalizeRoot(dir)] = { enabled: [], disabled: [], future: 7 }; });
  await store.setSkill(dir, 'alpha', true); await store.setNote('__proto__', 'safe'); await store.setDefault('on');
  const state = await store.read(); assert.equal(state.future.yes, true); assert.equal(state.defaults.extra, 3); assert.equal(state.projects[normalizeRoot(dir)].future, 7);
  assert.equal(state.skillNotes.__proto__, 'safe'); assert.equal(isVisible('alpha', dir, state), true);
  assert.deepEqual(await readdir(dir), ['state.json']);
});

test('malformed/unsupported state fails closed and cannot be overwritten', async t => {
  const dir = await temp(t); const file = path.join(dir, 'state.json'); const store = createStateStore(file);
  for (const text of ['{broken', '{"version":2}', '{"version":1,"defaults":{"globalSkills":"on"},"projects":{"x":{"enabled":true}}}']) {
    await writeFile(file, text); const state = await store.read(); assert.equal(isVisible('anything', dir, state), false); assert.ok(state.error.message);
    await assert.rejects(store.setDefault('on'), { code: 'INVALID_STATE' }); assert.equal(await readFile(file, 'utf8'), text);
  }
  await writeFile(file, JSON.stringify(defaultState())); await store.setDefault('on'); assert.equal((await store.read()).defaults.globalSkills, 'on');
});

test('concurrent stores serialize read-modify-write without lost updates', async t => {
  const dir = await temp(t); const file = path.join(dir, 'state.json');
  const stores = Array.from({ length: 4 }, () => createStateStore(file));
  await Promise.all(Array.from({ length: 40 }, (_, i) => stores[i % 4].setSkill(dir, 'skill-' + i, true)));
  assert.equal((await stores[0].read()).projects[normalizeRoot(dir)].enabled.length, 40);
});

test('independent processes share the state lock', async t => {
  const dir = await temp(t); const file = path.join(dir, 'state.json'); const moduleUrl = pathToFileURL(path.resolve('src/core/state.mjs')).href;
  const run = index => new Promise((resolve, reject) => {
    const code = 'import {createStateStore} from ' + JSON.stringify(moduleUrl) + '; const s=createStateStore(' + JSON.stringify(file) + '); for(let i=0;i<8;i++) await s.setNote(' + JSON.stringify('child-' + index + '-') + '+i,"ok");';
    const child = spawn(process.execPath, ['--input-type=module', '-e', code]); let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  await Promise.all([run(1), run(2), run(3)]); assert.equal(Object.keys((await createStateStore(file).read()).skillNotes).length, 24);
});

test('lock timeout never steals locks and rejected mutations leave original intact', async t => {
  const dir = await temp(t); const file = path.join(dir, 'state.json'); const store = createStateStore(file, { lockTimeoutMs: 25, retryMs: 5 });
  await mkdir(file + '.lock'); await assert.rejects(store.setDefault('on'), { code: 'STATE_LOCK_TIMEOUT' }); await rm(file + '.lock', { recursive: true });
  await store.setDefault('on'); const original = await readFile(file, 'utf8');
  await assert.rejects(store.update(s => { s.version = 99; })); assert.equal(await readFile(file, 'utf8'), original);
});

test('single visibility predicate gives disabled > enabled > default', async t => {
  const dir = await temp(t); const s = defaultState(); const root = normalizeRoot(dir);
  assert.equal(isVisible('a', root, s), false); s.defaults.globalSkills = 'on'; assert.equal(isVisible('a', root, s), true);
  s.projects[root] = { enabled: ['a'], disabled: ['a'] }; assert.equal(isVisible('a', root, s), false);
  s.defaults.globalSkills = 'off'; s.projects[root].disabled = []; assert.equal(isVisible('a', root, s), true); assert.equal(isVisible('a', root, {}), false);
});

test('roots use nearest git file/directory, canonical paths, and Windows casing', async t => {
  const dir = await temp(t); const nested = path.join(dir, 'repo', 'nested', 'deep'); await mkdir(nested, { recursive: true });
  assert.equal(await resolveProjectRoot(nested), await canonicalPath(nested));
  await mkdir(path.join(dir, '.git')); assert.equal(await resolveProjectRoot(nested), await canonicalPath(dir));
  await writeFile(path.join(dir, 'repo', '.git'), 'gitdir: elsewhere'); assert.equal(await resolveProjectRoot(nested), await canonicalPath(path.join(dir, 'repo')));
  assert.equal(normalizeRoot('C:\\Work\\Repo\\..\\Project\\'), 'c:\\work\\project');
  assert.equal(globalSkillRoots({ dshHome: dir, agentsHome: dir }).find(r => r.source === 'library').rank, 450);
});

test('YAML parser supports multiline strings and rejects unsafe/malformed metadata', () => {
  const parsed = parseSkill('---\nname: demo\ndescription: |\n  One line\n  Two lines\ndisable-model-invocation: true\nwhen-to-use: manual\n---\n# Body', 'ignored');
  assert.equal(parsed.description, 'One line\nTwo lines\n'); assert.deepEqual(parsed.invocation, { modelInvocable: false, userInvocable: true });
  assert.deepEqual(parseSkill('---\nname: hidden\nuser-invocable: false\n---\nbody', 'x').invocation, { modelInvocable: true, userInvocable: false }); assert.equal(parsed.whenToUse, 'manual'); assert.equal(parsed.content, '# Body');
  assert.throws(() => parseSkill('---\nname: a\nname: b\n---\nbody', 'x'));
  assert.throws(() => parseSkill('---\nname: ../bad\n---\nbody', 'x'));
});

test('catalog deterministic collisions, source IDs, library/custom/global roots and safe load', async t => {
  const dir = await temp(t); const custom = path.join(dir, 'custom'); const dsh = path.join(dir, 'dsh'); const agents = path.join(dir, 'agents');
  await skill(custom, 'z', 'name: shared\ndescription: custom'); await skill(path.join(dsh, 'skills'), 'a', 'name: shared\ndescription: global');
  await skill(path.join(dsh, 'skills-library'), 'manual', 'name: manual\ndisable-model-invocation: true'); await skill(path.join(agents, 'skills'), 'other', 'name: other');
  const catalog = createCatalog({ dshHome: dsh, agentsHome: agents, customSkillDirs: [custom] });
  const first = await catalog.scan(); assert.equal(first.length, 4); const shared = first.filter(e => e.name === 'shared'); assert.equal(shared[0].source, 'custom'); assert.equal(shared[0].shadowed, false); assert.equal(shared[1].shadowed, true); assert.notEqual(shared[0].id, shared[1].id);
  assert.deepEqual(await catalog.scan(), first); const loaded = await catalog.load(shared[0].id); assert.equal(loaded.content, 'Skill body'); assert.equal(loaded.resourceBase.path, shared[0].path);
  await assert.rejects(catalog.load('../SKILL.md')); await writeFile(shared[0].skillFile, '---\nname: changed\n---\nbody'); await assert.rejects(catalog.load(shared[0].id), /identity changed/);
});

test('junction targets deduplicate and cycles terminate; bundled roots are ignored', async t => {
  const dir = await temp(t); const root = path.join(dir, 'root'); const outside = path.join(dir, 'outside'); await mkdir(root); await skill(outside, 'linked', 'name: linked');
  await symlink(outside, path.join(root, 'alias-a'), 'junction'); await symlink(outside, path.join(root, 'alias-b'), 'junction'); await symlink(root, path.join(outside, 'loop'), 'junction');
  const catalog = createCatalog({ roots: [{ path: root, source: 'custom', rank: 300 }, { path: outside, source: 'bundled', rank: 600 }] }); const entries = await catalog.scan(); assert.equal(entries.length, 1); assert.equal(entries[0].name, 'linked');
});

test('catalog rejects SKILL.md symlink escapes and reports invalid YAML', async t => {
  const dir = await temp(t); const root = path.join(dir, 'root'); await mkdir(path.join(root, 'escape'), { recursive: true }); const target = path.join(dir, 'outside.md'); await writeFile(target, '---\nname: outside\n---\nbody');
  let linked = true;
  try { await symlink(target, path.join(root, 'escape', 'SKILL.md'), 'file'); } catch (error) { if (error.code !== 'EPERM') throw error; linked = false; t.diagnostic('SKILL.md escape test unavailable: file symlinks require Windows privilege'); }
  await skill(root, 'bad', 'name: ['); const catalog = createCatalog({ roots: [root] }); assert.deepEqual(await catalog.scan(), []); assert.equal(catalog.errors.length, linked ? 2 : 1);
});
