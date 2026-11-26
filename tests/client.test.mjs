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
function harness(handler, sessionId) {
  const dom = new JSDOM('<main></main>'); const calls = [];
  const mount = mountSettings(dom.window.document.querySelector('main'), { sessionId, fetch: async (url, options) => { calls.push({ url, options }); return handler(url, options); } });
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
  const statsText = h.doc.querySelector('.skm-stats').textContent;
  assert.match(statsText, /2 个技能/); assert.match(statsText, /1 个已启用/); assert.match(statsText, /1 个已停用/);
  assert.match(h.doc.querySelector('.skm-stats').title, /≈45 tokens/);
  assert.match(h.doc.querySelector('.skm-page').textContent, /尚未核验/);
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
  h.doc.querySelector('.skm-header button').click(); await tick();
  assert.deepEqual(JSON.parse(h.calls[3].options.body), { type: 'refresh' });
  h.change(h.doc.querySelector('[aria-label="工作区"]'), '/project b'); await tick();
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
  h.doc.querySelector('.skm-header button').click(); await tick();
  assert.match(h.doc.querySelector('[role=alert]').textContent, /不可写/);
  assert.equal(h.doc.querySelector('[aria-label="全局技能默认策略"]'), null); h.mount.dispose();
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
  assert.equal(h.doc.querySelector('[aria-label="工作区"]').disabled, false);
  assert.equal(h.doc.querySelector('[role=switch]').disabled, true); h.mount.dispose();
});
test('compact workspace UI shows titles only and omits legacy controls', async () => {
  const data=snapshot(); data.workspaces=[{path:'/project a',title:'foot'},{path:'/project b',title:''}];
  const h=harness(()=>response(data));await h.mount.ready;
  assert.equal(h.doc.querySelector('h2').textContent,'技能');
  assert.equal(h.doc.querySelector('.skm-header p'),null);
  assert.equal(h.doc.querySelector('input[type=text]'),null);
  assert.equal(h.doc.querySelector('[aria-label="全局技能默认策略"]'),null);
  const select=h.doc.querySelector('[aria-label="工作区"]');
  assert.deepEqual([...select.options].map(o=>o.textContent),['foot','project b']);
  assert.equal(select.value,'/project a');
  h.change(select,'/project b');await tick();assert.match(h.calls.at(-1).url,/project=%2Fproject%20b/);
  h.mount.dispose();
});
test('live verification status replaces the duplicate unconditional warnings',async()=>{
  const data=snapshot();data.warnings=[];data.enforcement={verified:true,message:'已核验 2 个活动会话的受管技能目录'};
  const h=harness(()=>response(data));await h.mount.ready;
  assert.match(h.doc.querySelector('.skm-page').textContent,/已核验 2 个/);
  assert.doesNotMatch(h.doc.querySelector('.skm-page').textContent,/尚未验证|尚未核验/);
  data.enforcement={verified:false,status:'conflict',message:'部分会话目录覆盖未通过核验'};
  data.warnings=['sample 的目录覆盖未获胜'];await h.mount.reload();
  assert.match(h.doc.querySelector('.skm-page').textContent,/覆盖未获胜/);h.mount.dispose();
});
test('conversation shows its workspace title and refreshes against the same session', async () => {
  const data = { ...snapshot(), sessionWorkspace: { path: '/project a/sub', title: '当前工作区' } };
  const h = harness(() => response(data), 'session & A');
  await h.mount.ready;
  const select = h.doc.querySelector('[aria-label="工作区"]');
  assert.equal(select.disabled, true);
  assert.equal(select.value, '/project a/sub');
  assert.deepEqual([...select.options].map(o => o.textContent), ['当前工作区']);
  h.doc.querySelector('[role=switch]').click(); await tick();
  assert.equal(JSON.parse(h.calls[1].options.body).project, '/project a');
  h.doc.querySelector('.skm-header button').click(); await tick();
  assert.deepEqual(h.calls.filter(c => c.url.includes('/state')).map(c => c.url), Array(3).fill('/api/skills-manager/state?sessionId=session%20%26%20A'));
  h.mount.dispose();
});
test('conversation without a workspace never loads or edits default-project skills', async () => {
  const unresolved = harness(() => response(snapshot()), 'unknown');
  await unresolved.mount.ready;
  assert.match(unresolved.doc.querySelector('[role=alert]').textContent, /未找到当前会话所属的工作区/);
  assert.equal(unresolved.doc.querySelector('[role=switch]'), null);
  unresolved.mount.dispose();
  const missing = harness(() => response(snapshot()), '');
  await missing.mount.ready;
  assert.equal(missing.calls.length, 0);
  assert.match(missing.doc.querySelector('[role=alert]').textContent, /未能识别当前会话/);
  missing.mount.dispose();
});
test('built artifact is lazy CJS, exact slot metadata and host React only', async () => {
  const result = await buildClient({ write: false });
  const source = result.outputFiles[0].text;
  let registration; const fakeReact = { createElement: (...args) => args, useRef: () => ({ current: null }), useEffect: () => {} };
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { registration = value; } } } });
  assert.equal(registration.id, 'dsh-project-skills-manager');
  const required = [];
  const plugin = registration.factory(name => { required.push(name); assert.equal(name, 'react'); return fakeReact; });
  assert.deepEqual(required, ['react']); assert.equal(plugin.inject[0], 'slots');
  const slots = []; let cleanup;
  plugin.apply({ slots: { inject(name, callback) { callback(); }, register(meta, component) { slots.push({ meta, component }); return () => {}; } }, effect(callback) { cleanup = callback(); } });
  assert.equal(slots[0].meta.name, 'settings.section'); assert.equal(slots[0].meta.label(), '技能');
  assert.equal(slots[1].meta.name, 'settings.section.icon'); assert.equal(slots[0].meta.id, slots[1].meta.id);
  // session view tab sits directly right of the context tab (order 30) and reuses the same mount adapter
  assert.equal(slots[2].meta.name, 'conversation.view'); assert.equal(slots[2].meta.order, 31);
  assert.equal(slots[2].meta.label(), '技能'); assert.equal(slots[2].meta.id, slots[0].meta.id);
  const view = slots[2].component({ sessionId: 'a' });
  assert.equal(view[1].key, 'a');
  assert.equal(slots[2].component({ sessionId: 'b' })[1].key, 'b');
  assert.equal(view.length, 2); assert.equal(view[1].className, 'skm-embed');
  assert.equal(view[1].style.height, '100%'); cleanup();
});
