import path from 'node:path';
import os from 'node:os';
import { stat } from 'node:fs/promises';
import { createStateStore } from './core/state.mjs';
import { createCatalog } from './core/catalog.mjs';
import { isVisible } from './core/policy.mjs';
import { resolveProjectRoot } from './core/roots.mjs';

export function createManager(config = {}) {
  const dshHome = config.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const store = createStateStore(config.stateFile || path.join(dshHome, 'project-skills-manager', 'state.json'));
  const rawCatalog = createCatalog({ ...config, dshHome });
  const managedNames = new Set();
  const catalog = { ...rawCatalog, async scan() {
    const entries = await rawCatalog.scan();
    for (const entry of entries) managedNames.add(entry.name);
    return entries;
  }};
  const listeners = new Set();
  const knownProjects = new Set();
  let enforcement = { mode: 'provider-only', verified: false };
  async function projectRoot(project) {
    if (typeof project !== 'string' || !path.isAbsolute(project)) throw new Error('项目必须是绝对路径');
    if (!(await stat(project)).isDirectory()) throw new Error('项目路径不是目录');
    const root = await resolveProjectRoot(project);
    knownProjects.add(root);
    return root;
  }
  async function snapshot(project) {
    const root = await projectRoot(project);
    const [state, entries] = await Promise.all([store.read(), catalog.scan()]);
    const warnings = [];
    for (const issue of catalog.errors) warnings.push(issue.path + '：' + issue.message);
    if (state.error) warnings.push('策略文件无法读取，已按默认关闭处理：' + state.error.message);
    if (!enforcement.verified) warnings.push('尚未验证宿主目录过滤；其他 provider 中的同名技能可能仍然可见。');
    if (entries.some(s => s.shadowed)) warnings.push('存在同名技能；策略按名称生效，目录显示优先级最高的来源。');
    return {
      project: root, projects: [...new Set([...knownProjects, ...Object.keys(state.projects)])].sort(),
      defaults: state.defaults, enforcement: { ...enforcement }, warnings,
      skills: entries.filter(s => !s.shadowed).map(s => ({...s, tokens:s.tokenEstimate, enabled:isVisible(s.name,root,state)})),
    };
  }
  async function notify() { for (const fn of listeners) await fn(); }
  return {
    store, catalog, projectRoot, snapshot,
    setEnforcement(value) { enforcement = { ...value }; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async action(action) {
      if (!action || typeof action !== 'object') throw new Error('缺少操作');
      if (action.type === 'toggle') {
        const root = await projectRoot(action.project);
        if (typeof action.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
        const entries = await catalog.scan();
        if (!entries.some(s => s.name === action.name)) throw new Error('技能不在受管目录中');
        await store.setSkill(root,action.name,action.enabled);
      } else if (action.type === 'default') {
        if (!['on','off'].includes(action.value)) throw new Error('默认值必须是 on 或 off');
        await store.setDefault(action.value);
      } else if (action.type !== 'refresh') throw new Error('未知操作');
      await notify();
      return { ok:true };
    },
    async detail(id, project) {
      await projectRoot(project);
      await catalog.scan();
      const skill = await catalog.load(id);
      return {name:skill.name,content:skill.rawContent ?? skill.content,path:skill.skillFile};
    },
    async visible(project) {
      const root = await projectRoot(project);
      const [state, entries] = await Promise.all([store.read(),catalog.scan()]);
      return entries.filter(s => !s.shadowed && isVisible(s.name,root,state));
    },
    async allowed(name, project) {
      const root = await projectRoot(project);
      const [state, entries] = await Promise.all([store.read(),catalog.scan()]);
      if (state.error) return false;
      const policy = state.projects[root];
      const explicit = policy?.disabled?.includes(name) || policy?.enabled?.includes(name);
      if (managedNames.has(name) || explicit) return isVisible(name,root,state);
      if (catalog.errors.length) return false;
      return true;
    },
  };
}
