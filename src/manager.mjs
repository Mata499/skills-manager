import path from 'node:path';
import os from 'node:os';
import { stat } from 'node:fs/promises';
import { createStateStore } from './core/state.mjs';
import { createCatalog } from './core/catalog.mjs';
import { isVisible } from './core/policy.mjs';
import { resolveProjectRoot, normalizeRoot } from './core/roots.mjs';

export function createManager(config = {}) {
  const dshHome = config.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const store = createStateStore(config.stateFile || path.join(dshHome, 'project-skills-manager', 'state.json'));
  const rawCatalog = createCatalog({ ...config, dshHome });
  const managedNames = new Map();
  const catalog = { ...rawCatalog, async scan() {
    const entries = await rawCatalog.scan();
    for (const entry of entries) if (!entry.shadowed) managedNames.set(entry.name, entry.source);
    return entries;
  }};
  const listeners = new Set();
  const knownProjects = new Set();
  // Only rows reported by the host workspace registry are shown as workspaces.
  const workspaceTitles = new Map();
  const registryPaths = new Set();
  // Workspace paths come from the host registry; they are already canonical.
  function noteProjects(paths = []) {
    for (const value of paths) {
      try { if (typeof value === 'string' && value) knownProjects.add(normalizeRoot(value)); } catch {}
    }
  }
  /** Record the host's durable workspaces (the sidebar project list). */
  function noteWorkspaces(rows = []) {
    const out = [];
    for (const row of rows) {
      try {
        if (!row || typeof row.path !== 'string' || !row.path) continue;
        const key = normalizeRoot(row.path);
        knownProjects.add(key);
        registryPaths.add(key);
        const title = typeof row.title === 'string' ? row.title : '';
        if (title) workspaceTitles.set(key, title);
        out.push({ path: key, title });
      } catch {}
    }
    return out;
  }
  let enforcement = { mode: 'provider-only', verified: false };
  let verifier;
  async function projectRoot(project) {
    if (typeof project !== 'string' || !path.isAbsolute(project)) throw new Error('项目必须是绝对路径');
    if (!(await stat(project)).isDirectory()) throw new Error('项目路径不是目录');
    const root = await resolveProjectRoot(project);
    knownProjects.add(root);
    return root;
  }
  async function snapshot(project) {
    const root = project ? await projectRoot(project) : '';
    const [state, entries] = await Promise.all([store.read(), catalog.scan()]);
    const warnings = [];
    for (const issue of catalog.errors) warnings.push(issue.path + '：' + issue.message);
    if (state.error) warnings.push('策略文件无法读取，已按默认关闭处理：' + state.error.message);
    let checked = {...enforcement};
    if (verifier && root) {
      try { checked = await verifier(root, entries.filter(s=>!s.shadowed).map(s=>({...s,enabled:isVisible(s.name,root,state,s.source)}))); }
      catch(error) { checked={mode:'invocation-overlay',verified:false,status:'error',message:'核验失败：'+error.message}; }
    }
    if (state.error || catalog.errors.length) checked={...checked,verified:false,status:'error',message:'策略或技能扫描存在错误，无法完整核验目录过滤。'};
    for (const conflict of checked.conflicts ?? []) warnings.push(conflict);
    if (entries.some(s => s.shadowed)) warnings.push('存在同名技能；策略按名称生效，目录显示优先级最高的来源。');
    return {
      project: root, projects: [...new Set([...knownProjects, ...Object.keys(state.projects)])].sort(),
      workspaces: [...new Set([...registryPaths, ...Object.keys(state.projects)])].sort()
        .map(path => ({ path, title: workspaceTitles.get(path) ?? '', saved: Object.hasOwn(state.projects, path) })),
      defaults: state.defaults, enforcement: checked, warnings,
      skills: entries.filter(s => !s.shadowed).map(s => ({...s, tokens:s.tokenEstimate, enabled:Boolean(root) && isVisible(s.name,root,state,s.source)})),
    };
  }
  async function notify() { for (const fn of listeners) await fn(); }
  return {
    store, catalog, projectRoot, snapshot, noteProjects, noteWorkspaces,
    setEnforcement(value) { enforcement = { ...value }; },
    setVerifier(fn) { verifier = fn; },
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
    async candidates(project) {
      const root = await projectRoot(project);
      const [state, entries] = await Promise.all([store.read(), catalog.scan()]);
      return entries.filter(s => !s.shadowed).map(s => ({...s, enabled:isVisible(s.name,root,state,s.source)}));
    },
    async visible(project) {
      const root = await projectRoot(project);
      const [state, entries] = await Promise.all([store.read(),catalog.scan()]);
      return entries.filter(s => !s.shadowed && isVisible(s.name,root,state,s.source));
    },
    async allowed(name, project) {
      const root = await projectRoot(project);
      const [state, entries] = await Promise.all([store.read(),catalog.scan()]);
      if (state.error) return false;
      const policy = state.projects[root];
      const explicit = policy?.disabled?.includes(name) || policy?.enabled?.includes(name);
      if (managedNames.has(name) || explicit) return isVisible(name,root,state,managedNames.get(name));
      if (catalog.errors.length) return false;
      return true;
    },
  };
}
