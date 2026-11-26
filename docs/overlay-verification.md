# 同名 invocation overlay 核验

查证日期：2026-11-18。结论分为固定官方源码静态证据、真实 npm 服务执行、GUI 宿主验收三个层级；本次完成前两项，**没有完成正在运行的 Electron/GUI 宿主验收**，没有读取/解包 app.asar，也未修改用户 profile 或项目 manifest。

## 1. 可复现实验与结果

从项目根目录执行：

~~~sh
npm install --prefix .scratch/registry-verification --no-save --package-lock=false @deepseek-ai/dsh-skill@0.0.1-rc.1
node tests/fixtures/dsh/verify.mjs
~~~

真实发布包入口为 ESM named/default SkillService；真实 Cordis Context、真实 createScope、真实 isModelInvocable/isUserInvocable 均来自该隔离安装。不是仿写 registry 排序的 mock。依赖解析结果：dsh-skill/dsh-scope 0.0.1-rc.1、cordis 4.1.0、schemastery 3.19.0。npm 安装不写根 manifest；npm 将这些无 manifest 声明的隔离依赖标为 extraneous 是预期。最初尝试不存在的 dsh-core 包得到404，随后仅安装实际 dsh-skill 成功。

可执行 [verify.mjs](<../tests/fixtures/dsh/verify.mjs>) 于本次执行 exit 0，输出 passed:14 / hostVerified:false。前9项测试真实 registry 的服务合同，后5项直接 import 项目的 [manager](<../src/manager.mjs>)、[provider](<../src/host.mjs>)、[verifier](<../src/verification.mjs>)：

1. 同层 rank=-1e9 overlay 胜出。
2. neutral list/get 仍保留 disabled；真实 invocation helpers 返回 false；空 content 合法。
3. 更近 scope 的 rank=999 原生项压过 global rank=-1e9。
4. agent scope overlay 压过同 scope 原生项与祖先项。
5. 子 scope 注册不泄漏到父/global。
6. dispose 后 scoped 缓存失效。
7. -Number.MAX_VALUE 有效。
8. winning provider.get 返回 undefined 不会 fallback。
9. definition.provider 只要求 string，不要求与 candidate.provider 相等。
10. **真实插件** library 技能 A 开/B 默认关；A 模型目录包含，B 模型目录不包含；B get undefined，nativeLoads=0。
11. **真实插件** 已开启 manual-only 技能仍为 model=false/user=true，不擅自开放模型入口。
12. **真实插件** action → onChange → control.invalidate 后，已缓存 A 目录变为 disabled。
13. **真实插件 verifier** 报告同 scope 更低 rank=-2e9 竞争为 conflict。
14. **真实插件 verifier** 报告更近 scope 同名 shadow 为 conflict。

测试数据只在 tests/fixtures/dsh/.runtime 创建并在成功后删除。初次 A/B 集成失败是夹具 roots 字符串默认 source=custom（当前策略 custom 默认开），随后明确 source=library；这不是 registry 的 cwd 缓存串线。实际 npm collectCacheKey（lib/index.js:395–400）为 JSON.stringify({cwd,scopes:chain.map(scopeId),revision})；同一个 scope 的 A/B cwd 也独立缓存，不需要仅为切换 cwd 失效，策略修改才需 control.invalidate。源码副本来源与 MIT 版权见 [夹具说明](<../tests/fixtures/dsh/README.md>)。

## 2. 固定官方源码及版本差异

固定 commit：ca33fd6843b205e279c7ccb6cb73a472c78f5760。

- [官方 registry](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/skill/skill/src/index.ts)；[原样证据副本](<../tests/fixtures/dsh/registry.ca33fd6.ts>)。
- [官方 tool-skill consumer](https://github.com/deepseek-ai/deepseek-harness/blob/ca33fd6843b205e279c7ccb6cb73a472c78f5760/packages/skill/tool-skill/src/index.ts)；[原样证据副本](<../tests/fixtures/dsh/tool-skill.ca33fd6.ts>)。
- [真实 npm 发布信息](https://registry.npmjs.org/@deepseek-ai/dsh-skill/0.0.1-rc.1)。

npm rc.1 **不是上述 commit 的逐字构建证明**：例如该固定源码使用 SkillError 与错误码，而已执行 npm 包有普通 Error/TypeError；固定源码 summary 含可选 path，rc.1 toSummary 尚不带 path。实验结论限定真实 npm 版本；关键排名、scope、get、不调用 fallback、校验规则另与固定源码逐项核对。本文未声称本机宿主安装版本与这两者一致。

## 3. 精确接口、scope 与 rank

注册只有一个参数：registerProvider(create)，**没有第二个 scope 参数**。注册层由 calling Cordis context 决定；通过 agent.ctx.get('skills').registerProvider(factory) 注册进入 agent scope。实验通过真实 createScope(ctx,key,{parent}) 构造父子层，未 patch 私有 layers。

registry read：

~~~ts
list(options?: SkillViewOptions): Promise<SkillSummary[]>
get(name: string, options?: SkillViewOptions): Promise<SkillDefinition | undefined>
// options: { cwd?: string, signal?: AbortSignal, scope?: ScopeKey }
// provider callback不同：get(candidate: SkillCandidate, options: SkillLookupOptions)
~~~

[固定 get:503–521](<../tests/fixtures/dsh/registry.ca33fd6.ts#L503-L521>) 仅加载 winner 一次；undefined 直接返回，不尝试次名 provider；definition.name 不等于 candidate.name 时使该 entry 失效并返回 undefined。get 本身 **不执行 invocation 授权**。

rank 是有限 number，不要求非负/整数/safe integer。-1e9 合法；JS 可表示最小有限值 **-Number.MAX_VALUE = -1.7976931348623157e308** 合法；NaN、±Infinity 非法。没有应用层负数下限。但 rank 仅在同层排序，不能用任何低 rank 压过更近 scope；同 rank 先注册 provider 胜出，再按 provider 内顺序。-1e9 也不能保证压过第三方 -2e9，故需读取实际 winner 并报告冲突。

## 4. 全部 candidate / definition 运行时校验

证据：[validateCandidate:710–742](<../tests/fixtures/dsh/registry.ca33fd6.ts#L710-L742>)、[validateDefinition:751–770](<../tests/fixtures/dsh/registry.ca33fd6.ts#L751-L770>)、[validateInvocation:786–798](<../tests/fixtures/dsh/registry.ca33fd6.ts#L786-L798>)。

| 字段 | candidate | provider.get 返回 definition |
|---|---|---|
| name | string 且 /^[a-z0-9]+(?:-[a-z0-9]+)*$/ | 同左；另须与 winner candidate.name 相等才返回 |
| description | string 且 length>0 | 同左；空白串并未 trim 禁止 |
| invocation | undefined 实际放行；否则非null对象、非数组，两个属性均boolean | 同左 |
| whenToUse | undefined 或 string | 同左 |
| source | string，无枚举/非空检查 | 同左 |
| provider | string 且等于注册 provider.name | 仅 string，不检查与注册名一致 |
| rank | number 且 Number.isFinite | 不校验/不需要 |
| content | 不校验/不需要 | string；**空串合法** |
| path | undefined 或 string；不做绝对路径判定 | 同左 |
| locator | 接口要求 unknown；runtime 未校验存在性或结构 | 不需要 |
| resourceBase / metadata | 此 validator 不校验 | 此 validator 不校验 |

接口 SkillSummary 声明 invocation 必填，实际 validator 放行 undefined 是实现宽松点，不意味着可省略：两个 helper 直接取 invocation.modelInvocable / userInvocable，省略会抛错。实现应总是输出显式双 bool。source/provider 的 string 运行时检查也不代表空值是好合同。resourceBase 仍应满足类型 union directory/path、url/url、opaque/description，不能依赖未校验漏洞。

官方 name grammar 不允许大写、下划线、点号；当前项目 parser 较宽这一兼容风险已反馈 lead。固定源码对坏 candidate 的 provider observation 有 containment，不能把扫描到的文件等同于成功注册目录。

## 5. invocation 实际消费者

- [模型工具边界:134–153](<../tests/fixtures/dsh/tool-skill.ca33fd6.ts#L134-L153>)：list({cwd,signal,scope:exec.agent}) 查 summary；isModelInvocable(summary) 为 false 抛 SKILL_NOT_MODEL_INVOCABLE；再 get(name,lookup)，再次检查 definition 的 isModelInvocable。缺失则 SKILL_NOT_FOUND。
- [用户显式入口:187–201](<../tests/fixtures/dsh/tool-skill.ca33fd6.ts#L187-L201>)：可信 user 消息 /name 手势在 pre-step 调用 get(name,lookup)，undefined 或 !isUserInvocable(skill) 直接 continue，不注入正文。
- [模型目录:227–230](<../tests/fixtures/dsh/tool-skill.ca33fd6.ts#L227-L230>)：真实 snapshot 后 filter(isModelInvocable)。registry neutral list 不减少条目，consumer 过滤后模型目录才减少。

因此 disabled 的两种安全 get 实现为返回 undefined（当前插件行为），或返回 content:'' 且双 invocation=false 的有效定义（源码与真实包都接受）。后者可保留“被禁用”语义，前者用户显式入口视为普通文本；二者都不会由 registry 自动 fallback 泄露原生正文。**不能把任意第三方直接调用 neutral get 当成已授权模型 consumer。**

## 6. 未完成的验收与边界

没有使用 app.asar 拒绝的绕过手段；没有改用户 profile；没有启动替代 GUI server；未证明实时 GUI 已加载插件、提示目录实际更新、历史 catalog 消息如何被重写，亦未测所有第三方消费者。运行时 winner 检查只证明当前读取的 neutral 目录 winner 与 invocation 符合预期；不等于完整宿主 E2E，也不能消除第三方更近 scope / 更低 rank 冲突。实际宿主验收仍由 lead 单独安排。
