import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {JSDOM} from 'jsdom';
import {apply} from '../src/index.mjs';
import {mountSettings} from '../src/client/page.mjs';

test('multiple active projects populate selector without a failing initial request',async t=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'skm-discovery-'));t.after(()=>rm(tmp,{recursive:true,force:true}));
 const projects=[path.join(tmp,'a'),path.join(tmp,'b')];await Promise.all(projects.map(p=>mkdir(p)));
 const agents=projects.map(cwd=>({cwd,ctx:{get:()=>({registerProvider:()=>()=>{}})}}));
 const routes=[],effects=[];
 const ctx={agents:{list:()=>agents},workingDirectory:{ensure:async agent=>agent.cwd},get:()=>undefined,on(){},effect(fn){effects.push(fn());},inject(keys,fn){fn({get:()=>({register(route){routes.push(route);return ()=>{};}}),effect(fn){effects.push(fn());}});}};
 apply(ctx,{roots:[],stateFile:path.join(tmp,'state.json')});t.after(()=>{for(const dispose of effects.reverse())dispose?.();});
 const dom=new JSDOM('<main></main>');t.after(()=>dom.window.close());
 const calls=[];
 const page=mountSettings(dom.window.document.querySelector('main'),{fetch:async url=>{
 const u=new URL(url,'http://localhost');const route=routes.find(r=>r.path===u.pathname);let status,data;
 await route.handler({method:'GET',url,headers:{host:'localhost'}},{writeHead(s){status=s;},end(text){data=JSON.parse(text);}});
 calls.push({status,data});return {ok:status===200,status,json:async()=>data};
 }});t.after(()=>page.dispose());await page.ready;
 assert.equal(calls[0].status,200,'initial multi-project request must return choices, not HTTP 400');
 const select=dom.window.document.querySelector('[aria-label=工作区]');
 assert.equal(select.disabled,false);assert.equal(select.options.length,3);assert.equal(select.value,'');
 assert.equal(dom.window.document.querySelector('[role=alert]'),null);
 select.value=select.options[1].value;select.dispatchEvent(new dom.window.Event('change'));
 for(let i=0;i<30 && calls.length<2;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(calls.at(-1).status,200);assert.ok(calls.at(-1).data.project);
});
