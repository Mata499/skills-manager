// Runs published official registry and Cordis, NOT the installed GUI host.
import assert from 'node:assert/strict';
import { Context } from '../../../.scratch/registry-verification/node_modules/@deepseek-ai/cordis/lib/index.js';
import SkillService, { isModelInvocable, isUserInvocable } from '../../../.scratch/registry-verification/node_modules/@deepseek-ai/dsh-skill/lib/index.js';
import { createScope } from '../../../.scratch/registry-verification/node_modules/@deepseek-ai/dsh-scope/lib/index.js';
const ctx = new Context();
new SkillService(ctx);
const skills = ctx.get('skills');
const yes = { modelInvocable:true, userInvocable:true };
const no = { modelInvocable:false, userInvocable:false };
const candidate = (provider, rank, invocation=yes) => ({name:'example-skill',description:'Example',source:'custom',provider,rank,locator:{},invocation});
const checks=[];
function provider(context,name,rank,invocation=yes,get) {
  let control;
  const dispose=context.get('skills').registerProvider(c => {
    control=c;
    return {name,async list(){return [candidate(name,rank,invocation)]},async get(c,o){return get ? get(c,o) : {...c,content:invocation.modelInvocable ? 'instructions' : ''}}};
  });
  return {dispose,invalidate:()=>control.invalidate()};
}
const base=provider(ctx,'native',300);
const overlay=provider(ctx,'overlay',-1e9,no);
assert.equal((await skills.list())[0].provider,'overlay'); checks.push('same-layer -1e9 overlay wins');
const disabled=await skills.get('example-skill');
assert.equal(disabled.content,''); assert.equal(isModelInvocable(disabled),false); assert.equal(isUserInvocable(disabled),false);
assert.equal((await skills.list()).length,1); checks.push('neutral list/get retains disabled; real invocation helpers false; empty content valid');
const parent={}, child={};
const parentMount=createScope(ctx,parent);
const childMount=createScope(ctx,child,{parent});
provider(parentMount.ctx,'parent-native',999);
assert.equal((await skills.list({scope:parent}))[0].provider,'parent-native'); checks.push('nearer scope beats global lower rank');
provider(childMount.ctx,'child-native',9999);
const childOverlay=provider(childMount.ctx,'overlay',-1e9,no);
assert.equal((await skills.list({scope:child}))[0].provider,'overlay'); checks.push('agent scope overlay beats agent native and ancestors');
assert.equal((await skills.list({scope:parent}))[0].provider,'parent-native'); checks.push('child registration does not leak to parent/global');
childOverlay.dispose();
assert.equal((await skills.list({scope:child}))[0].provider,'child-native'); checks.push('dispose invalidates scoped cache');
const min=provider(childMount.ctx,'minimum',-Number.MAX_VALUE,no);
assert.equal((await skills.list({scope:child}))[0].provider,'minimum'); checks.push('-Number.MAX_VALUE accepted');
min.dispose();
let nativeGets=0;
provider(childMount.ctx,'fallback-observer',4000,yes,()=>{nativeGets++;return undefined});
const missing=provider(childMount.ctx,'missing-winner',-1e9,no,()=>undefined);
assert.equal(await skills.get('example-skill',{scope:child}),undefined);assert.equal(nativeGets,0); checks.push('winner undefined does not fallback'); missing.dispose();
const changing=provider(childMount.ctx,'changing',-1e9,no,c=>({...c,content:'',provider:'different-provider'}));
assert.equal((await skills.get('example-skill',{scope:child})).provider,'different-provider');checks.push('definition provider string not required to match candidate provider');changing.dispose();
await childMount.dispose(); await parentMount.dispose(); overlay.dispose(); base.dispose();
// Exercise this repository's actual manager/provider/verifier, with isolated test data.
const { mkdir, writeFile, rm } = await import('node:fs/promises');
const path = await import('node:path');
const { createManager } = await import('../../../src/manager.mjs');
const { createSkillProvider } = await import('../../../src/host.mjs');
const { verifyRegistry } = await import('../../../src/verification.mjs');
const data=path.resolve('tests/fixtures/dsh/.runtime');
await rm(data,{recursive:true,force:true});
await mkdir(path.join(data,'library','example-skill'),{recursive:true});
await mkdir(path.join(data,'library','manual-only'),{recursive:true});
await mkdir(path.join(data,'project-a','.git'),{recursive:true});
await mkdir(path.join(data,'project-b','.git'),{recursive:true});
await writeFile(path.join(data,'library','example-skill','SKILL.md'),`---
name: example-skill
description: Example
---
real body`);
await writeFile(path.join(data,'library','manual-only','SKILL.md'),`---
name: manual-only
description: Manual only
disable-model-invocation: true
---
manual body`);
const a=path.join(data,'project-a'), b=path.join(data,'project-b');
const manager=createManager({dshHome:path.join(data,'home'),stateFile:path.join(data,'state.json'),roots:[{path:path.join(data,'library'),source:'library'}]});
const liveCtx=new Context(); new SkillService(liveCtx); const live=liveCtx.get('skills');
let nativeLoads=0;
live.registerProvider(()=>({name:'native',async list(){return [candidate('native',300)]},async get(c){nativeLoads++;return {...c,content:'native body'}}}));
const agent={}; const mount=createScope(liveCtx,agent); let invalidator;
mount.ctx.get('skills').registerProvider(control=>{invalidator=control.invalidate;return createSkillProvider(manager,control,()=>a)});
const off=manager.onChange(()=>invalidator());
await manager.action({type:'toggle',project:a,name:'example-skill',enabled:true});
await manager.action({type:'toggle',project:a,name:'manual-only',enabled:true});
const lookup=cwd=>({scope:agent,cwd});
assert.deepEqual((await live.list(lookup(a))).filter(isModelInvocable).map(s=>s.name),['example-skill']);
assert.deepEqual((await live.list(lookup(b))).filter(isModelInvocable),[]);
assert.equal((await live.get('example-skill',lookup(a))).content,'real body');
assert.equal(await live.get('example-skill',lookup(b)),undefined);assert.equal(nativeLoads,0);
checks.push('ACTUAL plugin A on / B off; real model helper filters; get B undefined without native fallback');
const manual=await live.get('manual-only',lookup(a));assert.equal(isModelInvocable(manual),false);assert.equal(isUserInvocable(manual),true);
checks.push('ACTUAL enabled manual-only preserves false/true invocation');
await manager.action({type:'toggle',project:a,name:'example-skill',enabled:false});
assert.equal((await live.list(lookup(a))).find(s=>s.name==='example-skill').invocation.modelInvocable,false);
checks.push('ACTUAL action/onChange/control.invalidate refreshes cached A catalog');
let expected=await manager.candidates(a);let report=await verifyRegistry(expected,[{agent,skills:live,cwd:a}]);assert.equal(report.verified,true);
const conflict=provider(mount.ctx,'lower-rank-conflict',-2e9);
report=await verifyRegistry(expected,[{agent,skills:live,cwd:a}]);assert.equal(report.verified,false);assert.equal(report.status,'conflict');conflict.dispose();
checks.push('ACTUAL verifier detects same-scope even-lower rank conflict');
const nearer={};const nearerMount=createScope(liveCtx,nearer,{parent:agent});provider(nearerMount.ctx,'nearer-native',600);
report=await verifyRegistry(expected,[{agent:nearer,skills:live,cwd:a}]);assert.equal(report.verified,false);assert.equal(report.status,'conflict');
checks.push('ACTUAL verifier detects closer-scope shadow');
off();await nearerMount.dispose();await mount.dispose();await rm(data,{recursive:true,force:true});
console.log(JSON.stringify({package:'@deepseek-ai/dsh-skill@0.0.1-rc.1',hostVerified:false,checks,passed:checks.length},null,2));
