import { PROVIDER } from './host.mjs';

/** Read the actual merged registry outside provider.list (never recurse into list). */
export async function verifyRegistry(candidates, bindings) {
  if (!bindings.length) return {mode:'invocation-overlay',verified:false,status:'no-session',message:'此工作区尚无活动会话；目录过滤将在会话加载后核验。',sessions:0};
  const conflicts=[]; let checked=0;
  for (const {agent,skills,cwd} of bindings) {
    if (typeof skills?.list!=='function') {conflicts.push('宿主技能注册表不支持核验');continue;}
    try {
      const merged=await skills.list({scope:agent,cwd});
      if (!Array.isArray(merged)) throw new Error('宿主目录格式不受支持');
      const byName=new Map(merged.map(s=>[s.name,s]));
      for (const expected of candidates) {
        const actual=byName.get(expected.name);
        const invocation=expected.enabled ? expected.invocation : {modelInvocable:false,userInvocable:false};
        if (!actual || actual.provider!==PROVIDER || actual.invocation?.modelInvocable!==invocation.modelInvocable || actual.invocation?.userInvocable!==invocation.userInvocable) conflicts.push(expected.name+' 的目录覆盖未获胜');
      }
      checked++;
    } catch(error) {conflicts.push('读取会话技能目录失败：'+error.message);}
  }
  const verified=checked===bindings.length && conflicts.length===0;
  return {mode:'invocation-overlay',verified,status:verified?'verified':'conflict',sessions:checked,
    checkedSkills:candidates.length,checkedAt:Date.now(),conflicts:[...new Set(conflicts)],
    message:verified?'已核验 '+checked+' 个活动会话的受管技能目录：停用项不向模型或用户技能入口开放。':'部分会话目录覆盖未通过核验；工具守卫仍作兜底。'};
}
