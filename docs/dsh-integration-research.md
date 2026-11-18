# DSH 集成接口查证

查证日期：2026-11-18。项目 README 是设计初稿，不作为已证事实。未修改用户配置、未安装插件到 profile。

## 证据范围

官方仓库默认分支为 master（不是 main）；本次 commit 为 ca33fd6843b205e279c7ccb6cb73a472c78f5760，提交时间 2026-11-17T14:17:01Z。以下官方链接固定 commit。Electron ASAR 是虚拟路径；未据此声称实际安装版本已经运行验收。用户提供的 profile 参考插件路径读取为 not found，故使用同版本 npm 发布源码，不能证明本机正在执行完全相同字节。

参考包 @michengai/dsh-skills-manager@1.4.11，只 npm pack/解包到 .scratch/research，shasum 9014a2faef3e134e2f89cf24373845b98c61dcb3。[发布 tarball](https://registry.npmjs.org/@michengai/dsh-skills-manager/-/dsh-skills-manager-1.4.11.tgz)；[manifest](<../.scratch/research/package/package.json>)、[宿主源码](<../.scratch/research/package/lib/index.js>)、[核心源码](<../.scratch/research/package/lib/core.js>)、[客户端源码](<../.scratch/research/package/lib/client.js>)。参考包 Apache-2.0；本文示例仅说明接口。

## 1. Provider 合并与过滤：核心结论

[官方 SkillRegistry 完整实现](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/skill/skill/src/index.ts) 的 collectFresh/collectLayer：

- global → 祖先 scope → 最近 scope 合并，最近层同名项覆盖远层；rank 只在同一层内比较。
- 同层按 rank 升序、provider 注册顺序、provider 内顺序决定同名赢家。
- provider.list 返回 [] 只是不贡献自己的候选，不能删除其他 provider 的条目。
- 该公开服务只有 skills/change 失效通知（不可 veto），未发现 skills/filter、pre-list 或 registerFilter 合同。结论限定上述版本，不外推所有未来版本。
- list/snapshot 是 invocation-neutral 元数据。registry 中存在与模型可见/可调用不是同一事实。

### 重要补充：同名 invocation overlay 可抑制模型目录

参考包并非简单忽略 disabled 候选。[core:3682–3753](<../.scratch/research/package/lib/core.js#L3682-L3753>) 扫描 native 同名副本，以更低 rank 输出同名候选，设置 invocation.modelInvocable/userInvocable 为策略值。

[官方 tool-skill 消费方](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/skill/tool-skill/src/index.ts) 对 prompt 目录过滤 isModelInvocable，并在加载边界验证调用许可。因此**同层获胜的同名 overlay 可以在不改配置的情况下让模型目录隐藏技能并禁止加载**；但 neutral registry.list 仍含条目，不是删除 hook。更近 scope 的同名技能仍能覆盖 global overlay。采用前应测试 scope、同名优先级、两个 invocation 字段和缓存失效。

如果首版只返回本插件允许的 library 候选，能力只能保证本插件来源；其他 filesystem/插件来源仍可能广告同名技能。UI 应警告，不能仅因工具 guard 生效就宣称 prompt token 已省。也不应 patch registry 私有结构。

## 2. Provider 精确签名

同上官方源码：

~~~ts
interface SkillLookupOptions { cwd?: string; signal?: AbortSignal }
interface SkillViewOptions extends SkillLookupOptions { scope?: ScopeKey }
interface SkillProviderControl { signal: AbortSignal; invalidate(): void }
interface SkillProvider {
  name: string
  list(options: SkillLookupOptions): Promise<readonly SkillCandidate[] | {
    candidates: readonly SkillCandidate[]; complete: boolean
  }>
  get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined>
}
registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void
~~~

**registerProvider 没有第二个 scope 参数。**注册层来自调用 service 的 Cordis context；agent.ctx.get("skills") 经调用方 context 追踪在 agent scope 注册。读取时消费者另传 scope:agent，不能假设注册第二参数可用。

~~~js
const dispose = agent.ctx.get("skills").registerProvider(control => ({
  name: "example-project-skills",
  async list({cwd, signal}) {
    signal?.throwIfAborted();
    return [{
      name:"example-skill", description:"Example routing description",
      invocation:{modelInvocable:true,userInvocable:true},
      source:"custom", provider:"example-project-skills", rank:300,
      locator:{id:"opaque-provider-handle"},
      resourceBase:{kind:"directory",path:"/absolute/example-skill"},
    }];
  },
  async get(candidate, {cwd, signal}) {
    signal?.throwIfAborted();
    return {
      name:candidate.name, description:candidate.description,
      invocation:candidate.invocation, source:candidate.source,
      provider:candidate.provider, resourceBase:candidate.resourceBase,
      content:"Current Markdown instructions",
    };
  },
}));
~~~

get 的定义必须包含 name、非空 description、source:string、provider:string、content:string，以及合同声明的 invocation。候选另需 rank（有限数）、locator，且 candidate.provider 必须等于注册 provider.name。缺 source/provider 的 get 返回会被 validateDefinition 拒绝。control.invalidate 在精确注册仍有效时清缓存并通知；control.signal 注册失败/dispose 时 abort。策略写成功后必须 invalidate，不应把 UI 刷新当目录刷新。

## 3. Agent 生命周期与动态 cwd

[AgentRegistry](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/core/agent/src/index.ts) 以 serial 发 agent/created，payload 含 agent、source、可选 signal；disposed payload 为 {agent}。创建 listener 失败可能回滚，需成对清理。

~~~js
ctx.on("agent/created", ({agent}) => install(agent));
ctx.on("agent/disposed", ({agent}) => uninstall(agent));
for (const agent of ctx.get("agents").list()) install(agent);
const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
const lookup = {cwd, signal:exec.signal, scope:exec.agent};
~~~

动态 cwd 真实调用由官方 [tool-skill](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/skill/tool-skill/src/index.ts) 多处证明，该包 inject 为 agents/tools/skills/workingDirectory。provider 已收到 options.cwd 时优先它。不要用 process.cwd 或 session.header.cwd 当动态真源。参考 [index:173–179](<../.scratch/research/package/lib/index.js#L173-L179>) 的 session.header.cwd 是 UI session 初始目录选择；[index:237–268](<../.scratch/research/package/lib/index.js#L237-L268>) 展示 agent.ctx.get("skills").registerProvider(factory) 与既有 agent 遍历。插件卸载也要 dispose，不只等 agent/disposed。

## 4. 工具守卫

官方 [events.ts](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/core/tools/src/events.ts) / [contracts.ts](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/core/tools/src/contracts.ts)：

~~~ts
"tools/pre-execute"(exec: ToolExecution,
  next: () => Promise<PreToolDecision>): Promise<PreToolDecision>
~~~

~~~js
ctx.on("tools/pre-execute", async (exec,next) => {
  if (exec.name !== "skill" || typeof exec.args?.name !== "string") return next();
  const cwd = await ctx.workingDirectory.ensure(exec.agent,exec.signal);
  if (!await allowed(exec.args.name,cwd)) return {
    kind:"deny", reason:"此技能已在当前项目停用",
    info:{name:"ProjectSkillPolicyError",code:"PROJECT_SKILL_DISABLED"},
  };
  return next();
});
~~~

exec 有工具名、解析参数、caller agent 和 signal。事件是 waterfall；agent-scoped listener 只接收该 agent 的调用。PreToolDecision 包含 allow/deny/cancel/ask；策略禁用用 deny，不是 ask（审批不等于禁止；无审批支持时 ask 转 deny）。异步 gate 应观察 signal。该工具 guard 不自动涵盖用户显式 slash 注入，后者同样应在 provider invocation 边界实施策略。参考 [index:370–383](<../.scratch/research/package/lib/index.js#L370-L383>) guard 的是 create_skill，不能称为现成的 skill 禁用守卫。

## 5. HTTP server：两种不同 seam

[官方 web-server 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/docs/subsystems/web-server.zh.md)：

~~~ts
interface WebRoute {
  kind:"exact" | "prefix"
  path:string // absolute pathname, no trailing slash
  handler:(req:IncomingMessage,res:ServerResponse,peer?:PeerScope)=>void|Promise<void>
  auth?:WebAuthenticationRule // default required
}
register(route:WebRoute|WebResourceRoute):()=>void
~~~

~~~js
ctx.inject(["webServer"],web => {
  web.effect(() => web.webServer.register({
    kind:"exact",path:"/api/project-skills/state",
    async handler(req,res,peer) {
      res.setHeader("content-type","application/json");
      res.end(JSON.stringify({ok:true}));
    },
  }));
});
~~~

WebResourceRoute 用 resource:(Request,peer?)=>Promise<Response>，仅 GET/HEAD，不能用于 POST action。默认 required 由 Connection 准入认证；仍需 method、输入、content-type、大小、写操作来源检查，不因 loopback 就免认证。

参考包选另一 seam [index:830–852](<../.scratch/research/package/lib/index.js#L830-L852>)：

~~~js
ctx.connection.fetch.register({
  path:"/api/example/action",methods:["POST"],requestBody:"buffered",
  fetch:async request => new Response(JSON.stringify({ok:true}),{
    headers:{"content-type":"application/json"},
  }),
});
~~~

此处是 Fetch Request/Response，不能把 fetch 属性直接搬到 WebRoute。两种都清理 disposer；webServer 可选服务建议在 inject/effect 内随生命周期重绑。没有启动替代服务器。

## 6. Client slots 与 lazy CJS

[官方槽合同](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/client/ui-settings/src/client/contract/slots.ts)：settings.section 为 root list，owner props 为 {close:()=>void}；settings.section.icon 为 root inline list，owner props {size:number,active:boolean}，id 必须同 section 匹配，图标 label 不显示。settings.section.view 是外壳的 Component Factory，不需插件另造外壳。

参考 [client:47](<../.scratch/research/package/lib/client.js#L47>)（压缩行）中的真实形式：

~~~js
ctx.slots.inject("settings.section",()=>ctx.slots.register({
  name:"settings.section",id:"project-skills",order:25,label:()=>"项目技能",
},SettingsComponent));
ctx.slots.inject("settings.section.icon",()=>ctx.slots.register({
  name:"settings.section.icon",id:"project-skills",
},IconComponent));
~~~

inject 等待槽存在；register 才贡献组件并返回 disposer。不要误写 inject(slot,Component) 当直接注册。未验证直接返回 HTMLElement 合同；DOM UI 建议用 React 薄 mount/unmount 桥接，React 走平台 require，不内联第二份。

[官方 modules](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/client/modules/README.zh.md) 和 [构建 preset](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/client/tsdown.client.ts)：执行 bundle 只注册 factory，首次 import/require 才物化并缓存 exports；外部模块用注入 require，不用 window.React。参考 [client:1–4](<../.scratch/research/package/lib/client.js#L1-L4>)：

~~~js
window.__ModuleLoader__.load({id:"dsh-project-skills-manager",factory:require=>{
  var module={exports:{}};
  var exports=module.exports;
  // esbuild format:cjs bundle，react external
  // exports.inject=["slots"]; exports.apply=apply;
  return module.exports;
}});
~~~

manifest 导出 ./client，dsh.manifestVersion:1，dsh.client.platform:"web"，dsh.client.inject 声明 slots 等服务的提供包名；不同于客户端 exports.inject 服务名。非基座运行时 module requests 需列 dsh.client.external。[参考 manifest:20–58](<../.scratch/research/package/package.json#L20-L58>)。factory id 应与包名一致；bundle 顶层不提前操作 DOM/require/apply。只有同 checkout dev:web watcher 正运行并构建时才可承诺自动重建+HMR，否则构建后刷新现有 GUI。

## 7. filesystem roots 与 opt-in 限制

[官方 skill-filesystem](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/skill/skill-filesystem/README.zh.md)：project-dsh rank100、project-agents 200、custom 300、user-dsh 400、user-agents 500、bundledSkillDir 600。项目根为最近 .git 祖先，无则 lookup cwd。扫描仅根下 name/SKILL.md 或 name.md，不递归任意深度。

includeDefaultRoots:false **同时省略 project/user roots 与 DSH_BUNDLED_SKILL_DIR 默认值**，不是只关闭全局；显式 customSkillDirs、bundledSkillDir 保留。未发现 excludeUserRoots 类独立配置。若用户明确 opt-in，需要另行补回项目 roots；固定 custom 绝对目录不适合多 cwd，cwd-aware provider 补扫可行但须测试。此次未写此配置。bundled 不属于本项目管理范围。

## 8. 验收与未证范围

1. provider 空数组不能删除别家的测试；同层 rank/注册顺序、scope 最近覆盖测试。
2. get 返回字段完整性（尤其 source/provider）与策略写后 invalidation。
3. 若采用 overlay，分别断言 neutral list、model catalog、skill 工具和 slash 用户注入；不能用 guard 代替 prompt 过滤验收。
4. 多会话 cwd 切换、卸载 disposer、service 重绑、factory 执行前零 DOM 副作用。
5. 官方 commit/npm 包代码证据不等于实际 Electron build/GUI 验收；当前仍需真实宿主集成验证。
