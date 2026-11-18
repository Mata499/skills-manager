import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createRoutes } from '../src/api/routes.mjs';
function request(method,headers={},value='') {
  return Object.assign(Readable.from([value]),{method,url:'/api/skills-manager/action',headers:{host:'127.0.0.1:62853',...headers}});
}
async function invoke(route,req) {
  let status,body; const headers={};
  await route.handler(req,{setHeader(k,v){headers[k]=v;},writeHead(s,h){status=s;Object.assign(headers,h);},end(b){body=JSON.parse(b);}});
  return {status,body,headers};
}
test('routes reject cross-origin writes, wrong methods and malformed input',async()=>{
  let calls=0;
  const route=createRoutes({action:async()=>{calls++;return {ok:true};}})[2];
  assert.equal((await invoke(route,request('POST',{origin:'http://evil.test','content-type':'application/json'},'{}'))).status,403);
  assert.equal((await invoke(route,request('GET'))).status,405);
  assert.equal((await invoke(route,request('POST',{},'{}'))).status,400);
  assert.equal((await invoke(route,request('POST',{'content-type':'application/json'},'{'))).status,400);
  assert.equal((await invoke(route,request('POST',{'content-type':'application/json'},'x'.repeat(65537)))).status,400);
  assert.equal(calls,0);
  const result=await invoke(route,request('POST',{origin:'http://127.0.0.1:62853','content-type':'application/json'},'{}'));
  assert.equal(result.status,200);assert.equal(calls,1);
  assert.equal(result.headers['cache-control'],'no-store');
});
test('state uses explicitly selected project, otherwise default',async()=>{
  const route=createRoutes({snapshot:async project=>({project})},{defaultProject:()=>'/default'})[0];
  const req=request('GET'); req.url='/api/skills-manager/state?project=%2Fchosen';
  assert.equal((await invoke(route,req)).body.project,'/chosen');
  req.url='/api/skills-manager/state';
  assert.equal((await invoke(route,req)).body.project,'/default');
});
