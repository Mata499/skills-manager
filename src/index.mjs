import { createManager } from './manager.mjs';
import { createRoutes } from './api/routes.mjs';
import { createSkillProvider, guardSkill } from './host.mjs';
import { verifyRegistry } from './verification.mjs';

export const name = 'dsh-project-skills-manager';
export const inject = ['agents', 'workingDirectory'];

export function apply(ctx, config = {}) {
  const manager = createManager(config);
  const registrations = new Map();
  const invalidators = new Set();
  const cwd = (agent, signal) => ctx.workingDirectory.ensure(agent, signal);

  /** Durable workspaces (the sidebar project list). Optional host capability. */
  function listWorkspaces() {
    try {
      const registry = ctx.get('workspaceRegistry');
      if (!registry || typeof registry.list !== 'function') return [];
      const rows = registry.list();
      if (!Array.isArray(rows)) return [];
      return manager.noteWorkspaces(rows.map(row => ({
        path: row?.path,
        title: typeof row?.title === 'string' ? row.title : '',
      })));
    } catch (error) {
      ctx.get('logger')?.warn?.('读取工作区列表失败：' + error.message);
      return [];
    }
  }

  function sessionWorkspace(sessionId) {
    const rows = ctx.get('workspaceRegistry')?.list();
    if (!Array.isArray(rows)) return;
    const matches = rows.filter(row => typeof row?.path === 'string' && row.path && row.sessionIds?.includes(sessionId));
    if (matches.length !== 1) return;
    const { path, title } = matches[0];
    return { path, title: typeof title === 'string' ? title : '' };
  }

  async function agentRoots() {
    const roots = await Promise.all(ctx.agents.list().map(async agent => {
      try { return await manager.projectRoot(await cwd(agent)); } catch { return null; }
    }));
    return [...new Set(roots.filter(Boolean))];
  }

  function install(agent) {
    if (registrations.has(agent)) return;
    const skills = agent.ctx.get('skills');
    if (!skills?.registerProvider) return;
    let invalidate;
    const dispose = skills.registerProvider(control => {
      invalidate = () => control.invalidate();
      invalidators.add(invalidate);
      return createSkillProvider(manager, control, () => cwd(agent));
    });
    registrations.set(agent, () => { invalidators.delete(invalidate); dispose?.(); });
    cwd(agent).then(root => manager.projectRoot(root)).catch(error => ctx.get('logger')?.warn?.(error.message));
  }

  ctx.on('agent/created', ({ agent }) => install(agent));
  ctx.on('agent/disposed', ({ agent }) => { registrations.get(agent)?.(); registrations.delete(agent); });
  for (const agent of ctx.agents.list()) install(agent);
  const unsubscribe = manager.onChange(() => { for (const fn of invalidators) fn(); });
  ctx.on('tools/pre-execute', (exec, next) => guardSkill(manager, exec, next, agent => cwd(agent, exec.signal)));
  manager.setEnforcement({ mode:'invocation-overlay',verified:false,status:'unselected',message:'选择工作区后核验会话技能目录。' });
  manager.setVerifier(async (root,candidates)=>{
    const bindings=[];
    for (const agent of ctx.agents.list()) {
      try {
        const directory=await cwd(agent);
        if (await manager.projectRoot(directory)===root) bindings.push({agent,cwd:directory,skills:agent.ctx.get('skills')});
      } catch {}
    }
    return verifyRegistry(candidates,bindings);
  });
  listWorkspaces();

  ctx.inject(['webServer'], web => {
    const routes = createRoutes(manager, {
      defaultProject: async () => {
        const workspaces = listWorkspaces().map(row => row.path);
        const roots = await agentRoots();
        // Prefer the workspace that running sessions actually work in.
        const preferred = roots.find(root => workspaces.includes(root)) ?? (roots.length === 1 ? roots[0] : '');
        if (preferred) return preferred;
        if (workspaces.length === 1) return workspaces[0];
        // Ambiguity is a normal selection state: the page lists every workspace and asks.
        return '';
      },
      sessionWorkspace,
    });
    web.effect(() => {
      const disposers = routes.map(route => web.get('webServer').register(route));
      return () => { for (const dispose of disposers) dispose?.(); };
    });
  });

  ctx.effect(() => () => {
    unsubscribe();
    for (const dispose of registrations.values()) dispose();
    registrations.clear();
    invalidators.clear();
  });
}
export default { name, inject, apply };
