import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRegistry} from '../src/verification.mjs';
import {PROVIDER} from '../src/host.mjs';
const entry={name:'sample',enabled:false,invocation:{modelInvocable:true,userInvocable:true}};
test('verification reads actual winners and never reports success on conflicts or missing registry',async()=>{
 const bindings=[{agent:{id:'a'},cwd:'/a',skills:{list:async options=>{assert.equal(options.cwd,'/a');return [{name:'sample',provider:PROVIDER,invocation:{modelInvocable:false,userInvocable:false}}];}}}];
 assert.equal((await verifyRegistry([entry],bindings)).verified,true);
 bindings[0].skills.list=async()=>[{name:'sample',provider:'competitor',invocation:{modelInvocable:true,userInvocable:true}}];
 assert.equal((await verifyRegistry([entry],bindings)).status,'conflict');
 assert.equal((await verifyRegistry([entry],[])).status,'no-session');
 assert.equal((await verifyRegistry([entry],[{agent:{},skills:{}}])).verified,false);
 bindings[0].skills.list=async()=>{throw Error('broken');};
 assert.equal((await verifyRegistry([entry],bindings)).verified,false);
});
