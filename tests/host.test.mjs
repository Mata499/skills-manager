import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkillProvider,guardSkill } from '../src/host.mjs';
test('provider uses per-call cwd; get rechecks visibility after toggle',async()=>{
  let enabled=true; const seen=[];
  const entry={id:'one',name:'sample',description:'Test',path:'/library/sample',source:'library',rank:450,invocation:{modelInvocable:true,userInvocable:true}};
  const manager={candidates:async cwd=>{seen.push(cwd);return [{...entry,enabled}];},visible:async cwd=>{seen.push(cwd);return enabled?[entry]:[];},catalog:{load:async()=>({...entry,content:'body',resourceBase:{kind:'directory',path:entry.path}})}};
  const provider=createSkillProvider(manager,{},()=>'/fallback');
  const [candidate]=await provider.list({cwd:'/project-a'});
  assert.equal(candidate.invocation.modelInvocable,true);
  assert.equal((await provider.get(candidate,{cwd:'/project-a'})).content,'body');
  enabled=false;
  assert.equal(await provider.get(candidate,{cwd:'/project-b'}),undefined);
  assert.deepEqual(seen,['/project-a','/project-a','/project-b']);
  const controller=new AbortController();controller.abort();
  await assert.rejects(provider.list({signal:controller.signal}));
});
test('tool guard denies disabled skills and fails closed on missing cwd',async()=>{
  let next=0; const pass=()=>{next++;return {kind:'allow'};};
  const manager={allowed:async name=>name!=='blocked'};
  assert.equal((await guardSkill(manager,{name:'read'},pass)).kind,'allow');
  assert.equal((await guardSkill(manager,{name:'skill',args:{name:'blocked'}},pass,()=>'/a')).kind,'deny');
  assert.equal((await guardSkill(manager,{name:'skill',args:{name:'allowed'}},pass,()=>'/a')).kind,'allow');
  assert.equal((await guardSkill(manager,{name:'skill',args:{name:'allowed'}},pass,()=>{throw Error('cwd');})).kind,'deny');
  assert.equal(next,2);
});
