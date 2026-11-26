export const PROVIDER = 'project-skills-manager';
// Lower than normal filesystem ranks (100..600); winning scope is checked at runtime.
export const OVERLAY_RANK = -1_000_000_000;
export function createSkillProvider(manager, control, cwd) {
  return {
    name:PROVIDER,
    async list(options={}) {
      options.signal?.throwIfAborted();
      const entries=await manager.candidates(options.cwd || await cwd());
      options.signal?.throwIfAborted();
      control.signal?.throwIfAborted();
      return entries.map(entry=>({name:entry.name,description:entry.description || entry.name,whenToUse:entry.whenToUse,
        invocation:entry.enabled ? entry.invocation : {modelInvocable:false,userInvocable:false},
        provider:PROVIDER,source:entry.source,rank:OVERLAY_RANK,
        locator:{id:entry.id},resourceBase:{kind:'directory',path:entry.path}}));
    },
    async get(candidate,options={}) {
      options.signal?.throwIfAborted();
      if (candidate.provider!==PROVIDER) return undefined;
      const project=options.cwd || await cwd();
      const entries=await manager.visible(project);
      const entry=entries.find(s=>s.id===candidate.locator?.id && s.name===candidate.name);
      if (!entry) return undefined;
      const loaded=await manager.catalog.load(entry.id);
      options.signal?.throwIfAborted();
      control.signal?.throwIfAborted();
      return {name:loaded.name,description:loaded.description || loaded.name,source:entry.source,provider:PROVIDER,whenToUse:loaded.whenToUse,invocation:loaded.invocation,
        content:loaded.content,resourceBase:loaded.resourceBase};
    },
  };
}
export async function agentCwd(agent, signal) {
  const directory=agent?.ctx?.get('workingDirectory');
  if (typeof directory?.ensure==='function') return directory.ensure(agent, signal);
  throw new Error('无法取得会话当前工作目录；请使用显式项目选择');
}
export async function guardSkill(manager,exec,next,cwd=agentCwd) {
  if (exec.name!=='skill' || typeof exec.args?.name!=='string') return next();
  try {
    if (await manager.allowed(exec.args.name,await cwd(exec.agent))) return next();
    return {kind:'deny',reason:'此技能已在当前项目停用',info:{name:'ProjectSkillPolicyError',code:'PROJECT_SKILL_DISABLED'}};
  } catch(error) {
    return {kind:'deny',reason:'无法安全核验项目技能策略：'+error.message,info:{name:'ProjectSkillPolicyError',code:'PROJECT_POLICY_UNAVAILABLE'}};
  }
}
