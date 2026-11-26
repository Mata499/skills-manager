import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {apply} from '../src/index.mjs';
import {normalizeRoot} from '../src/core/roots.mjs';

async function harness(t,{workspaces,agentCwds=[]}){
  const tmp=await mkdtemp(path.join(os.tmpdir(),'skm-ws-'));t.after(()=>rm(tmp,{recursive:true,force:true}));
  const alpha=path.join(tmp,'Alpha'),beta=path.join(tmp,'Beta');
  await mkdir(alpha);await mkdir(beta);
  const all={Alpha:alpha,Beta:beta};
  const routes=[],effects=[];
  const agents=agentCwds.map(name=>({cwd:all[name],ctx:{get:()=>({registerProvider:()=>()=>{}})}}));
  const registry={list:()=>workspaces.map(name=>({path:all[name],title:name}))};
  const ctx={
    agents:{list:()=>agents},
    workingDirectory:{ensure:async agent=>agent.cwd},
    get:key=>key==='workspaceRegistry'?registry:undefined,
    on(){},effect(fn){effects.push(fn());},
    inject(keys,fn){fn({get:()=>({register(route){routes.push(route);return ()=>{};}}),effect(fn){effects.push(fn());}});},
  };
  apply(ctx,{roots:[],stateFile:path.join(tmp,'state.json')});
  t.after(()=>{for(const dispose of effects.reverse())dispose?.();});
  const state=routes.find(r=>r.path.endsWith('/state'));
  const call=async (url='/api/skills-manager/state')=>{
    let status,data;
    await state.handler({method:'GET',url,headers:{host:'localhost'}},{writeHead(s){status=s;},end(t){data=JSON.parse(t);}});
    return {status,data,all};
  };
  return call;
}

test('workspace registry supplies the project list, not agent cwd',async t=>{
  const call=await harness(t,{workspaces:['Alpha','Beta']});
  const {status,data,all}=await call();
  assert.equal(status,200);
  assert.deepEqual(data.workspaces.map(w=>w.title).sort(),['Alpha','Beta']);
  assert.equal(data.workspaces.find(w=>w.title==='Alpha').path,normalizeRoot(all.Alpha));
  // Two workspaces and no running session: wait for an explicit choice.
  assert.equal(data.project,'');
});

test('a running session selects its workspace without hiding the others',async t=>{
  const call=await harness(t,{workspaces:['Alpha','Beta'],agentCwds:['Alpha']});
  const {data,all}=await call();
  assert.equal(data.project,normalizeRoot(all.Alpha));
  assert.deepEqual(data.workspaces.map(w=>w.title).sort(),['Alpha','Beta']);
});

test('single workspace is selected automatically',async t=>{
  const call=await harness(t,{workspaces:['Alpha']});
  const {data,all}=await call();
  assert.equal(data.project,normalizeRoot(all.Alpha));
});
