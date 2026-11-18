import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { apply } from '../src/index.mjs';

test('plugin lifecycle installs provider, guard and routes; policy invalidates; disposal cleans up',async t=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'skm-plugin-'));t.after(()=>rm(tmp,{recursive:true,force:true}));
 const project=path.join(tmp,'project'),library=path.join(tmp,'library');
 await mkdir(project);await mkdir(path.join(library,'sample'),{recursive:true});
 await writeFile(path.join(library,'sample','SKILL.md'),'---\nname: sample\ndescription: Test\n---\nbody');
 let invalidated=0,disposed=0;const providers=[],routes=[],events={},effects=[];
 const service={registerProvider(factory){providers.push(factory({invalidate(){invalidated++;}}));return ()=>{disposed++;};}};
 const agent={ctx:{get:key=>key==='skills'?service:undefined}};
 const ctx={agents:{list:()=>[agent]},workingDirectory:{ensure:async()=>project},get:()=>undefined,
 on(name,fn){events[name]=fn;},effect(fn){effects.push(fn());},
 inject(keys,fn){fn({get:()=>({register(route){routes.push(route);return ()=>{};}}),effect:fn=>effects.push(fn())});}};
 apply(ctx,{roots:[{path:library,source:'library',rank:450}],stateFile:path.join(tmp,'state.json')});
 assert.equal(providers.length,1);assert.equal(routes.length,3);
 assert.equal((await providers[0].list({cwd:project})).length,0);
 const next=()=>({kind:'allow'});
 assert.equal((await events['tools/pre-execute']({name:'skill',args:{name:'sample'},agent},next)).kind,'deny');
 const action=routes.find(r=>r.path.endsWith('/action'));
 const req=Object.assign(Readable.from([JSON.stringify({type:'toggle',project,name:'sample',enabled:true})]),{method:'POST',url:action.path,headers:{host:'localhost','content-type':'application/json'}});
 let status;await action.handler(req,{writeHead(s){status=s;},end(){}});assert.equal(status,200);assert.equal(invalidated,1);
 const [candidate]=await providers[0].list({cwd:project});
 const definition=await providers[0].get(candidate,{cwd:project});
 assert.equal(definition.source,'library');assert.equal(definition.provider,'project-skills-manager');
 assert.equal((await events['tools/pre-execute']({name:'skill',args:{name:'sample'},agent},next)).kind,'allow');
 events['agent/created']({agent});assert.equal(providers.length,1);
 events['agent/disposed']({agent});assert.equal(disposed,1);
 for(const dispose of effects.reverse()) dispose?.();assert.equal(disposed,1);
});
