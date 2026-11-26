const PREFIX = '/api/skills-manager';
function json(res,status,value) {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new Error('需要 application/json');
  const chunks=[]; let size=0;
  for await (const chunk of req) {
    size+=Buffer.byteLength(chunk);
    if (size>65536) throw new Error('请求内容过大');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function sameOrigin(req) {
  const origin=req.headers.origin;
  if (!origin) return req.headers['sec-fetch-site'] !== 'cross-site';
  try { const u=new URL(origin); return ['http:','https:'].includes(u.protocol) && u.host===req.headers.host; } catch { return false; }
}
export function createRoutes(manager, { defaultProject=()=>process.cwd(), sessionWorkspace }={}) {
  function route(endpoint, method, run) {
    return {kind:'exact',path:PREFIX+endpoint,handler:async(req,res)=>{
      if (!sameOrigin(req)) return json(res,403,{error:'拒绝跨域访问'});
      if (req.method!==method) {res.setHeader('allow',method); return json(res,405,{error:'不支持的请求方法'});}
      try {
        const url=new URL(req.url,'http://localhost');
        json(res,200,await run(req,url));
      } catch(error) { json(res,400,{error:error.message || '操作失败'}); }
    }};
  }
  return [
    route('/state','GET',async(req,url)=>{
      const sessionId = url.searchParams.get('sessionId');
      if (sessionId === null) return manager.snapshot(url.searchParams.get('project') || await defaultProject(req));
      if (!sessionId) throw new Error('未能识别当前会话');
      const workspace = await sessionWorkspace?.(sessionId);
      if (!workspace) throw new Error('未找到当前会话所属的工作区');
      return { ...await manager.snapshot(workspace.path), sessionWorkspace: workspace };
    }),
    route('/skill','GET',async(req,url)=>manager.detail(url.searchParams.get('id'),url.searchParams.get('project') || await defaultProject(req))),
    route('/action','POST',async(req)=>manager.action(await body(req))),
  ];
}
