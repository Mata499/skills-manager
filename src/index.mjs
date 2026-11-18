import { createManager } from './manager.mjs';
import { createRoutes } from './api/routes.mjs';
import { createSkillProvider, guardSkill } from './host.mjs';

export const name='dsh-project-skills-manager';
export const inject=['agents','workingDirectory'];
export function apply(ctx,config={}) {
  const manager=createManager(config);
  const registrations=new Map();
  const invalidators=new Set();
  const cwd=(agent,signal)=>ctx.workingDirectory.ensure(agent,signal);
  function install(agent) {
    if (registrations.has(agent)) return;
    const skills=agent.ctx.get('skills');
    if (!skills?.registerProvider) return;
    let invalidate;
    const dispose=skills.registerProvider(control=>{
      invalidate=()=>control.invalidate();
      invalidators.add(invalidate);
      return createSkillProvider(manager,control,()=>cwd(agent));
    });
    registrations.set(agent,()=>{invalidators.delete(invalidate);dispose?.();});
    // Track actual session cwd without falling back to the desktop process directory.
    cwd(agent).then(root=>manager.projectRoot(root)).catch(error=>ctx.get('logger')?.warn?.(error.message));
  }
  ctx.on('agent/created',({agent})=>install(agent));
  ctx.on('agent/disposed',({agent})=>{registrations.get(agent)?.();registrations.delete(agent);});
  for (const agent of ctx.agents.list()) install(agent);
  const unsubscribe=manager.onChange(()=>{for (const fn of invalidators) fn();});
  ctx.on('tools/pre-execute',(exec,next)=>guardSkill(manager,exec,next,agent=>cwd(agent,exec.signal)));
  manager.setEnforcement({mode:'provider-and-tool-guard',verified:false});
  ctx.inject(['webServer'],web=>{
    const routes=createRoutes(manager,{defaultProject:async()=>{
      const agents=ctx.agents.list();
      // A settings page has no authoritative active session. Never silently pick between projects.
      const roots=[...new Set(await Promise.all(agents.map(async agent=>{
        try {return await manager.projectRoot(await cwd(agent));} catch {return null;}
      })))].filter(Boolean);
      if (roots.length===1) return roots[0];
      throw new Error(roots.length ? '存在多个项目，请明确选择项目路径' : '没有活动项目，请输入项目绝对路径');
    }});
    web.effect(()=>{
      const disposers=routes.map(route=>web.get('webServer').register(route));
      return ()=>{for(const dispose of disposers) dispose?.();};
    });
  });
  ctx.effect(()=>()=>{unsubscribe();for(const dispose of registrations.values()) dispose();registrations.clear();invalidators.clear();});
}
export default {name,inject,apply};
