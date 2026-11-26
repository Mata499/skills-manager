import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createManager } from '../src/manager.mjs';

test('project A enable does not leak into project B; state survives recreation',async t=>{
  const tmp=await mkdtemp(path.join(os.tmpdir(),'skm-manager-'));
  t.after(()=>rm(tmp,{recursive:true,force:true}));
  const root=path.join(tmp,'library');
  const a=path.join(tmp,'a'),b=path.join(tmp,'b');
  await Promise.all([mkdir(path.join(root,'sample'),{recursive:true}),mkdir(a),mkdir(b)]);
  await writeFile(path.join(root,'sample','SKILL.md'),'---\nname: sample\ndescription: Test skill\n---\nHello');
  const config={stateFile:path.join(tmp,'state.json'),roots:[{path:root,source:'library',rank:450}]};
  const manager=createManager(config); let changed=0;
  manager.onChange(()=>{changed++;});
  assert.equal((await manager.snapshot(a)).skills[0].enabled,false);
  await manager.action({type:'toggle',project:a,name:'sample',enabled:true});
  assert.equal((await manager.visible(a)).length,1);
  assert.equal((await manager.visible(b)).length,0);
  assert.equal(await manager.allowed('sample',b),false);
  assert.equal(await manager.allowed('bundled-unmanaged',b),true);
  assert.equal((await createManager(config).snapshot(a)).skills[0].enabled,true);
  const detail=await manager.detail((await manager.snapshot(a)).skills[0].id,a);
  assert.match(detail.content,/Hello/);
  await manager.action({type:'toggle',project:a,name:'sample',enabled:false});
  await manager.action({type:'default',value:'on'});
  assert.equal((await manager.visible(a)).length,0);
  assert.equal((await manager.visible(b)).length,0);
  assert.equal(changed,3);
  await assert.rejects(manager.action({type:'toggle',project:a,name:'missing',enabled:true}));
  await assert.rejects(manager.detail('../../escape',a));
  assert.equal((await manager.snapshot(a)).enforcement.verified,false);
  await writeFile(path.join(root,'sample','SKILL.md'),'---\nname: [\n---\nbroken');
  assert.equal(await manager.allowed('sample',a),false);
  assert.equal(await createManager(config).allowed('sample',a),false);
  await rm(path.join(root,'sample'),{recursive:true});
  assert.equal(await manager.allowed('sample',a),false);
  await writeFile(config.stateFile,'{broken');
  assert.equal(await manager.allowed('sample',a),false);
});

test('library defaults off, globals default on despite legacy defaults; all consumers agree',async t=>{
  const tmp=await mkdtemp(path.join(os.tmpdir(),'skm-source-'));t.after(()=>rm(tmp,{recursive:true,force:true}));
  const workspace=path.join(tmp,'workspace');await mkdir(workspace);
  const roots=[];
  for(const [source,rank] of [['library',450],['user-dsh',400],['user-agents',500],['custom',300]]){
    const root=path.join(tmp,source);await mkdir(path.join(root,source),{recursive:true});
    await writeFile(path.join(root,source,'SKILL.md'),'---\nname: '+source+'\ndescription: Test\n---\nbody');
    roots.push({path:root,source,rank});
  }
  const config={roots,stateFile:path.join(tmp,'state.json')};const manager=createManager(config);
  for(const legacy of ['off','on']){
    await manager.store.setDefault(legacy);
    const state=await manager.snapshot(workspace);
    for(const skill of state.skills){assert.equal(skill.enabled,skill.source!=='library');assert.equal(await manager.allowed(skill.name,workspace),skill.enabled);}
    assert.equal((await manager.visible(workspace)).length,3);
  }
  await manager.action({type:'toggle',project:workspace,name:'library',enabled:true});
  await manager.action({type:'toggle',project:workspace,name:'user-dsh',enabled:false});
  const restored=createManager(config);const snapshot=await restored.snapshot(workspace);
  assert.equal(snapshot.skills.find(s=>s.name==='library').enabled,true);
  assert.equal(snapshot.skills.find(s=>s.name==='user-dsh').enabled,false);
  assert.equal(await restored.allowed('library',workspace),true);
  assert.equal(await restored.allowed('user-dsh',workspace),false);
  restored.setVerifier(async (root,candidates)=>({verified:true,mode:'invocation-overlay',message:'checked',checkedSkills:candidates.length}));
  assert.equal((await restored.snapshot(workspace)).enforcement.verified,true);
  await writeFile(config.stateFile,'{broken');
  assert.equal((await restored.snapshot(workspace)).enforcement.verified,false);
});
