import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { mountSettings, filterSkills } from '../src/client/page.mjs';
import { buildClient } from '../scripts/build.mjs';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const snapshot = () => ({ project: '/project a', projects: ['/project a', '/project b'], defaults: { globalSkills: 'off' }, warnings: ['注意策略作用域'], enforcement: { mode: 'guard', verified: false }, skills: [
  { id: 'x&1', name: '<img src=x onerror=alert(1)>', description: '<script>bad()</script>', source: 'user-dsh', root: '/skills', enabled: false, tokens: 12 },
  { id: 'b', name: 'office', description: '办公', source: 'library', root: '/library', enabled: true, tokens: 45 },
] });
function harness(handler) {
  const dom = new JSDOM('<main></main>'); const calls = [];
  const mount = mountSettings(dom.window.document.querySelector('main'), { fetch: async (url, options) => { calls.push({ url, options }); return handler(url, options); } });
  return { dom, doc: dom.window.document, mount, calls, change(node, value, type = 'change') { node.value = value; node.dispatchEvent(new dom.window.Event(type)); } };
}
const response = data => ({ ok: true, status: 200, json: async () => data });
test('filters search, source and enabled state together', () => {
  assert.equal(filterSkills(snapshot().skills, { search: 'OFF', source: 'library', status: 'on' }).length, 1);
  assert.equal(filterSkills(snapshot().skills, { status: 'off' }).length, 1);
});
test('renders real state safely, groups, stats and filters', async () => {
  const h = harness(() => response(snapshot())); await h.mount.ready;
  assert.equal(h.doc.querySelectorAll('.skm-group').length, 2);
  assert.equal(h.doc.querySelectorAll('img, script').length, 0);
  assert.match(h.doc.querySelector('.skm-stats').textContent, /2 个技能.*1 已启用.*正文估算 ≈45 tokens/);
  assert.match(h.doc.querySelector('.skm-page').textContent, /尚未验证/);
  h.change(h.doc.querySelector('[aria-label="搜索技能"]'), 'office', 'input');
  assert.equal(h.doc.querySelectorAll('.skm-row').length, 1);
  h.change(h.doc.querySelector('[aria-label="来源筛选"]'), 'user-dsh');
  assert.match(h.doc.querySelector('.skm-empty').textContent, /没有匹配/);
  h.mount.dispose(); assert.equal(h.doc.querySelector('.skm-page'), null);
});
test('toggle, defaults and refresh post exact payload then reload state', async () => {
  let state = snapshot();
  const h = harness((url, options) => {
    if (url.endsWith('/action')) { const payload = JSON.parse(options.body); if (payload.type === 'toggle') state.skills[0].enabled = payload.enabled; return response({ ok: true }); }
    return response(state);
  }); await h.mount.ready;
  h.doc.querySelector('[role=switch]').click(); await tick();
  assert.deepEqual(JSON.parse(h.calls[1].options.body), { type: 'toggle', project: '/project a', name: state.skills[0].name, enabled: true });
  assert.match(h.calls[2].url, /state\?project=%2Fproject%20a/);
  h.change(h.doc.querySelector('[aria-label="全局技能默认策略"]'), 'on'); await tick();
  assert.deepEqual(JSON.parse(h.calls[3].options.body), { type: 'default', value: 'on' });
  h.doc.querySelector('.skm-header button').click(); await tick();
  assert.deepEqual(JSON.parse(h.calls[5].options.body), { type: 'refresh' });
  h.change(h.doc.querySelector('[aria-label="项目"]'), '/project b'); await tick();
  assert.match(h.calls.at(-1).url, /project=%2Fproject%20b/); h.mount.dispose();
});
test('detail is encoded, pure text and closable', async () => {
  const h = harness(url => response(url.includes('/skill?') ? { name: '详情', path: '/x/SKILL.md', content: '<script>alert(1)</script>' } : snapshot())); await h.mount.ready;
  h.doc.querySelector('.skm-name').click(); await tick();
  assert.match(h.calls.at(-1).url, /id=x%261&project=%2Fproject%20a/);
  assert.equal(h.doc.querySelector('pre').textContent, '<script>alert(1)</script>');
  assert.equal(h.doc.querySelectorAll('script').length, 0);
  h.doc.querySelector('dialog button').click(); assert.equal(h.doc.querySelector('dialog').open, false); h.mount.dispose();
});
test('initial load failure, empty state, action failure and loading are visible', async () => {
  let fail = true;
  const h = harness(url => { if (fail) throw Error('离线'); if (url.endsWith('/action')) throw Error('不可写'); const state = snapshot(); state.skills = []; return response(state); });
  assert.match(h.doc.querySelector('.skm-page').textContent, /正在加载/); await h.mount.ready;
  assert.match(h.doc.querySelector('[role=alert]').textContent, /离线/); fail = false; h.doc.querySelector('.skm-header button').click(); await tick(); assert.equal(h.calls.at(-1).url, '/api/skills-manager/state');
  assert.match(h.doc.querySelector('.skm-empty').textContent, /未发现/);
  h.change(h.doc.querySelector('[aria-label="全局技能默认策略"]'), 'on'); await tick();
  assert.match(h.doc.querySelector('[role=alert]').textContent, /不可写/);
  assert.equal(h.doc.querySelector('[aria-label="全局技能默认策略"]').value, 'off'); h.mount.dispose();
});
test('loading locks existing switches and disposal ignores late responses', async () => {
  let resolveState; let pending = false;
  const h = harness(() => pending ? new Promise(resolve => { resolveState = resolve; }) : response(snapshot())); await h.mount.ready;
  pending = true; const loading = h.mount.reload();
  assert.equal(h.doc.querySelector('[role=switch]').disabled, true);
  h.mount.dispose(); resolveState(response(snapshot())); await loading;
  assert.equal(h.doc.querySelector('.skm-page'), null);
});
test('project selection remains usable when server has not chosen a project', async () => {
  const state = snapshot(); state.project = '';
  const h = harness(() => response(state)); await h.mount.ready;
  assert.equal(h.doc.querySelector('[aria-label="项目"]').disabled, false);
  assert.equal(h.doc.querySelector('[role=switch]').disabled, true); h.mount.dispose();
});
test('can enter an absolute project after initial ambiguous-project HTTP error', async () => {
  const h = harness(url => url.endsWith('/state') ? { ok: false, status: 400, json: async () => ({ error: '请选择项目' }) } : response(snapshot()));
  await h.mount.ready; assert.match(h.doc.querySelector('[role=alert]').textContent, /请选择项目/);
  h.change(h.doc.querySelector('[aria-label="项目绝对路径"]'), 'E:/work');
  [...h.doc.querySelectorAll('button')].find(node => node.textContent === '加载项目').click(); await tick();
  assert.match(h.calls.at(-1).url, /state\?project=E%3A%2Fwork/);
  assert.equal(h.doc.querySelectorAll('.skm-row').length, 2); h.mount.dispose();
});
test('built artifact is lazy CJS, exact slot metadata and host React only', async () => {
  const result = await buildClient({ write: false });
  const source = result.outputFiles[0].text;
  let registration; const fakeReact = { createElement: (...args) => args };
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { registration = value; } } } });
  assert.equal(registration.id, 'dsh-project-skills-manager');
  const required = [];
  const plugin = registration.factory(name => { required.push(name); assert.equal(name, 'react'); return fakeReact; });
  assert.deepEqual(required, ['react']); assert.equal(plugin.inject[0], 'slots');
  const slots = []; let cleanup;
  plugin.apply({ slots: { inject(name, callback) { callback(); }, register(meta, component) { slots.push({ meta, component }); return () => {}; } }, effect(callback) { cleanup = callback(); } });
  assert.equal(slots[0].meta.name, 'settings.section'); assert.equal(slots[0].meta.label(), '项目技能');
  assert.equal(slots[1].meta.name, 'settings.section.icon'); assert.equal(slots[0].meta.id, slots[1].meta.id); cleanup();
});
