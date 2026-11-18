# Skills-Manager —— 项目级技能开关插件

## 实现状态（0.1.0）

已建立可构建、可测试的首版。包名统一为 `dsh-project-skills-manager`；原生 Node ESM，支持 Node >=22。

```bash
npm ci --ignore-scripts
npm test
npm run build
npm pack
```

- 已实现：项目策略、原子存储和跨进程锁、全局技能只读扫描、项目 provider、工具守卫、设置侧栏 UI、lazy-CJS 构建及自动化测试。
- **未完成实机验收**：当前 DSH GUI 的导航挂载、多 provider 同名过滤、A/B 会话模型目录验收。没有安装插件到用户 profile 或修改用户配置。
- **关键纠正**：新增 provider 不会删除其他 provider 条目。首版仅过滤自己提供的技能，其他来源可能仍广告同名技能。低 rank invocation overlay 是待验证的改进方向。
- token 显示为正文字符粗估，不代表模型目录实际消耗。发现、回收站和导入导出未实现。

详见 [实现与安装说明](<docs/implementation.md>)、[官方接口研究](<docs/dsh-integration-research.md>)、[领域术语](<GLOSSARY.md>)。

---

# 原始设计初稿（历史资料，以下路径和机制以实现说明为准）

> 目标：做一个能出现在 **设置 → 左侧导航** 里的 DSH 插件，界面仿照现有的「设置 → 技能」，
> 但核心能力是：**全局安装的技能，默认在所有项目里关闭，由你在每个项目里逐个打开。**
>
> 本文是开工前的设计与资料索引，后续代码都写在本目录下。

---

## 1. 要解决的问题

现状（已实测确认）：

| 事实 | 含义 |
| --- | --- |
| DSH 的技能目录按**来源根**扫描（rank 100/200/300/400/500） | 没有"工作区 × 技能"的维度 |
| `@michengai/dsh-skills-manager` 的开关存在 `~/.dsh/skills-manager/state.json`，结构是 `disabledSkills[rootKey]` | 只能"全局开/关某个来源里的技能"，不能按项目 |
| 技能一旦在目录里，就会随每轮 system prompt 注入（面板显示 `≈319 token`） | 不用也会占 context |

我们要的是第三种作用域：**同一个全局技能，在 A 项目可见、在 B 项目不可见**。

预期交互：

```
设置 → 项目技能
  项目下拉：[E:\Dsh_Prj\Skills ▾]
  全局技能（未在本项目启用）   [开关关] office-xlsx  …
  本项目已启用                 [开关开] find-skills …
```

---

## 2. 关键机制（都已核对过源码/文档）

### 2.1 技能目录是怎么来的

`@deepseek-ai/dsh-skill-filesystem` 扫描这些根：

| Rank | 来源 | 路径 |
| --- | --- | --- |
| 100 | project-dsh | `<projectRoot>/.dsh/skills` |
| 200 | project-agents | `<projectRoot>/.agents/skills` |
| 300 | custom | `Config.customSkillDirs` |
| 400 | user-dsh | `<dshHome>/skills` = `~/.dsh/skills` |
| 500 | user-agents | `<agentsHome>/skills` = `~/.agents/skills` |
| 600 | bundled | `bundledSkillDir` |

`projectRoot` = 最近的含 `.git` 的祖先目录；没有则用 cwd。
配置项：`includeDefaultRoots` / `dshHome` / `agentsHome` / `customSkillDirs` / `bundledSkillDir` / `watch*`。

### 2.2 插件可以注册自己的技能提供方

参考实现 `@michengai/dsh-skills-manager` 的 `lib/index.js` 里：

```js
ctx.skills.registerProvider((control) => ({
  name: "my-provider",
  list: async (options) => [...],          // 返回候选（catalog 条目）
  get:  async (candidate, options) => ...,  // 按需返回正文
}))
// control.invalidate() 让目录失效重扫
```

按 agent 注册（每个会话一份）：

```js
ctx.on("agent/created", ({ agent }) => {
  const skills = agent.ctx.get("skills");
  skills.registerProvider(...)
})
ctx.on("agent/disposed", ({ agent }) => dispose())
```

> 这条路径是**本插件的核心**：我们自己当 provider，就能决定"这个会话里哪些技能存在"。

### 2.3 可以拦截工具调用

```js
ctx.on("tools/pre-execute", (exec, next) => {
  if (exec.name === "skill" && blocked(exec.args.name)) return { kind: "ask", reason: "..." } // 或直接拒绝
  return next()
})
```

用来做兜底：即使某个技能漏进了目录，也不允许 `skill` 工具加载它。

### 2.4 设置页怎么挂到左侧导航

`@deepseek-ai/dsh-client-ui-settings` 定义了 slot：

- 页面本体：`ctx.slots.inject('settings.section', ...)` —— 注册一个分区，出现在「设置」左侧导航
- 导航图标：`ctx.slots.inject('settings.section.icon', ...)`，**id 必须与 settings.section 的 id 一致**，否则不渲染
- 外壳（导航列表、移动端横条、标题栏）在 `ui-settings-general` 里，我们不用管

浏览器半侧通过 `exports["./client"]` 提供，格式是客户端模块系统的 **lazy-CJS factory**：
`factory(require)` 向页面模块加载器登记包名。仓库内用 `packages/client/tsdown.client.ts` 的
`clientBundle` 预设构建；**仓库外的包要自己复刻这一步**。

### 2.5 现有参考实现（可直接抄结构）

`C:\Users\Xiangwen\.dsh\profiles\desktop\node_modules\@michengai\dsh-skills-manager\`

| 文件 | 作用 |
| --- | --- |
| `package.json` | `dsh.manifestVersion: 1`、`dsh.bundle.patch`、`dsh.client.inject/platform`、`exports ./client` |
| `cordis.patch.yml` | `- insert: [{ id: skills-manager, name: '@michengai/dsh-skills-manager' }]` |
| `lib/index.js` | 宿主侧：provider 注册、HTTP API（`/api/michengai/dsh-skills-manager`）、工具守卫 |
| `lib/core.js` | 状态文件、策略计算（`effectiveSkillPolicy`）、根解析 |
| `lib/client.js` | 浏览器侧：设置页 UI（就是截图那套） |

---

## 3. 推荐架构

### 方案 A（推荐）：自建 provider + 策略过滤

```
            ┌─────────────────────────────────────────┐
  宿主侧     │  skill-policy（本插件）                   │
            │  1. 读策略 state.json                    │
            │  2. 自己扫 ~/.dsh/skills 等根            │
            │  3. 按 projectRoot 过滤后 list() 给 DSH  │
            │  4. tools/pre-execute 兜底               │
            └─────────────────────────────────────────┘
                        ▲                    ▲
              HTTP /api/skills-manger    settings.section
                        │                    │
            ┌───────────┴────────────────────┴────────┐
  浏览器侧  │  client.js：设置页 UI（仿截图）           │
            └─────────────────────────────────────────┘
```

要点：

1. 把内置 provider 关掉或让出：`dsh-skill-filesystem` 有 `includeDefaultRoots: false`，
   但我们不能改别人的配置 —— 实际做法是 **不改**，而是让我们的 provider 只负责"额外的过滤层"不成立……
   ⚠️ 见下方「开放问题 Q1」，这是开工第一个要验证的点。
2. 策略判定函数只有一个入口：
   ```ts
   isSkillVisible(skill: SkillEntry, projectRoot: string): boolean
   ```
   所有路径（list / get / 工具守卫）都调它，避免规则漂移。

### 方案 B（零插件，已跑通）：目录 + 链接

已验证过的土办法，可作为"没有插件也能用"的兜底：

```
~/.dsh/skills/                ← 空（默认全关）
~/.dsh/skills-library/        ← 仓库，装一次
    └─ find-skills/
<项目>/.dsh/skills/           ← 项目里接一根 junction = 打开
    └─ find-skills -> ~/.dsh/skills-library/find-skills
```

实测：`skill("find-skills")` 返回 `resourceBase = E:\Dsh_Prj\Skills\.dsh\skills\find-skills`，
即 junction 被当作正常技能目录加载。C: → E: 跨盘可用，`mklink /J` 不需要管理员。

优缺点：零代码、立即生效；但"开关"是文件操作，面板里看不到，也不好在 UI 里管理。

---

## 4. 数据模型

`~/.dsh/skills-manger/state.json`（注意目录名，与项目名一致，避免和参考插件打架）：

```jsonc
{
  "version": 1,
  "defaults": {
    "globalSkills": "off"        // off | on —— 新项目默认全部关闭
  },
  "projects": {
    "E:\\Dsh_Prj\\Skills": {    // key = 项目根绝对路径（规范化后）
      "enabled": ["find-skills"], // 显式打开
      "disabled": [],             // 显式关闭（覆盖 defaults）
      "updatedAt": 1795000000000
    }
  },
  "skillNotes": { "find-skills": "找技能用" }
}
```

规则（务必只此一处实现）：

```ts
function isVisible(name, projectRoot, state) {
  const p = state.projects[projectRoot];
  if (p?.disabled?.includes(name)) return false;
  if (p?.enabled?.includes(name)) return true;
  return state.defaults.globalSkills === "on";
}
```

写入用「读-改-写 + 原子替换」，并且**只写自己拥有的条目**（不要整份覆盖别人的文件）。

---

## 5. 界面（仿截图）

### 5.1 布局

```
┌ 设置 ────────────────────────────────────────┐
│ 设置                    [打开配置文件]  ✕    │
│ ┌ 技能  (标题 + GitHub / 问题反馈 按钮) ──┐ │
│ │ 统一加载和管理本机 Agent Skills          │ │
│ └──────────────────────────────────────────┘ │
│ [ 全局技能 ][ 项目技能 ][ 发现技能 ][ 回收站 ]│  ← 分段控件
│ ┌ 统计条：N 个技能 | N 已启用 | N 已停用 ┐   │
│ └──────────────────────────────────────────┘ │
│ [全部来源 ▾] [全部状态 ▾] [搜索……]  ⟳  ＋   │
│ ┌ 来源分组（可折叠） ─────────────────────┐  │
│ │ ⌄ DSH   0 个技能      C:\Users\…\skills  ＋ [开关]│
│ │   ├ 技能行：名称  ≈token  描述   ⋯ [开关] │  │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

### 5.2 与截图的关键差异

| 截图里的 | 我们要的 |
| --- | --- |
| 全局技能 / 项目技能 = 两个**来源**视图 | 「项目技能」= **当前项目对全局技能的开关面板** |
| 开关写全局黑名单 | 开关写 `projects[<root>].enabled` |
| 项目页显示"这个工作区还没有技能" | 显示**全部全局技能**，附本项目开关状态 |
| token 合计 | 保留，改成"本项目可见技能的 token 合计" |

### 5.3 组件拆解（可直接对应到工程结构）

```
Section tabs       <> Tabs（全局 / 项目 / 发现 / 回收站）
Stat strip         <> StatBar
Filter row         <> Select + Select + Input + IconButton(刷新) + IconButton(＋)
SourceGroup        <> 可折叠分组，右侧 ＋ 与来源级开关
SkillRow           <> 名称 + token 徽标 + 描述（单行省略）+ ⋯ + Switch
SkillDetail        <> 760px 弹窗，左侧正文、右侧元信息
```

样式：参考插件的 `client.js` 里注入了整套 `.dssm-*` CSS，**换前缀改名**即可（避免与它冲突）。
建议前缀 `.skm-`。

---

## 6. 工程结构建议

```
E:\Dsh_Prj\Skills-Manger\
├─ package.json           # name: dsh-skills-manger（暂定），type: module
├─ cordis.patch.yml       # bundle 补丁（insert 条目）
├─ tsconfig.json
├─ src\
│  ├─ index.ts            # 宿主侧：provider、HTTP API、工具守卫
│  ├─ core\
│  │  ├─ state.ts         # state.json 读写（原子替换）
│  │  ├─ policy.ts        # isVisible() 唯一判定入口
│  │  ├─ roots.ts         # 项目根解析 / 技能根扫描
│  │  └─ catalog.ts       # SKILL.md frontmatter 解析
│  ├─ api\
│  │  └─ routes.ts        # GET /state, POST /action
│  └─ client\
│     ├─ index.tsx        # settings.section 注册
│     ├─ SettingsPage.tsx
│     ├─ components\*.tsx
│     └─ styles.css
├─ lib\                   # 构建产物（发包用）
├─ scripts\build.mjs      # 打包 client 为 lazy-CJS factory
└─ docs\
   └─ decisions.md        # 每个关键取舍写一条（ADR 风格）
```

### package.json 关键字段

```jsonc
{
  "name": "dsh-skills-manger",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js"
  },
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-primitives"
      ]
    }
  }
}
```

### cordis.patch.yml

```yaml
- insert:
    - id: skills-manger
      name: 'dsh-skills-manger'
```

---

## 7. 里程碑

| 阶段 | 产出 | 验收标准 |
| --- | --- | --- |
| M0 探针 | 一个最小插件，能出现在设置左侧导航 | 重启后导航里能看到「技能（项目）」 |
| M1 只读 | 页面列出全局技能 + 各项目开关状态 | 数据准，UI 与截图对齐 |
| M2 写策略 | 开关能落盘 `state.json` | 刷新页面状态不丢 |
| M3 生效 | 关闭的技能**真的**从该项目的技能目录消失 | 在 A 项目关掉 `office-xlsx`，A 会话里 `skill("office-xlsx")` 报 unknown；B 项目仍可用 |
| M4 兜底 | `tools/pre-execute` 拦截 | 即使目录有残留也无法加载 |
| M5 打磨 | token 统计、搜索、分组、导入导出 | 与参考插件体验对齐 |

**M3 是整个项目的生死线**：如果 provider 过滤这条路走不通，退回方案 B（目录 + junction），
由插件负责"在项目目录里建/删链接"，UI 不变。

---

## 8. 开放问题（开工先验证）

**Q1（最重要）内置 filesystem provider 能不能被替换/抑制？**
它没有"只看我的 provider"的开关。需要实测三条路：
1. 我们的 provider 只做过滤、两份目录合并（可能重复列出）；
2. 用 `includeDefaultRoots: false` 覆盖它的配置（改 `cordis.patch.yml` 里该插件的 config，需确认 id）；
3. 干脆不碰它，只做 junction 管理器（方案 B）。

**Q2 项目根怎么拿？**
宿主侧从 `ctx.agents` / session 的 cwd 推，规则要与 DSH 一致（最近 `.git` 祖先，否则 cwd）。
参考插件里 `activeSessionCwds(ctx, sessionId)` 和 `projectRoots(projectCwds)` 可借鉴。

**Q3 状态变化怎么让目录刷新？**
provider 的 `control.invalidate()` 已经在参考实现里用了；写盘后必须调用，否则要等下一轮。

**Q4 和现有 `dsh-skills-manager` 共存会不会打架？**
两个插件都注册 provider，技能可能重复出现。要么明确只用其中一个，要么在 UI 里提示冲突。

**Q5 客户端半侧的构建**
仓库外要自己实现 lazy-CJS factory 打包（`clientBundle` 预设不在发布包里）。这一步先在 M0 打通。

---

## 9. 本机环境备忘

| 项 | 值 |
| --- | --- |
| DSH 安装目录 | `D:\Tools\DeepSeek Harness` |
| 应用版本文件 | `D:\Tools\DeepSeek Harness\version` → `44.7.0`（Electron 版本，非 DSH 版本） |
| profile | `C:\Users\Xiangwen\.dsh\profiles\desktop`（bundles 见其 `package.json`） |
| 用户技能根 | `C:\Users\Xiangwen\.dsh\skills`（当前 0 个） |
| 技能仓库（方案 B 用） | `C:\Users\Xiangwen\.dsh\skills-library`（当前有 `find-skills`） |
| 已装的同类插件 | `@michengai/dsh-skills-manager@1.4.11` |
| Web GUI | `http://127.0.0.1:61447` |
| 现成参考源码 | `~/.dsh/profiles/desktop/node_modules/@michengai/dsh-skills-manager/` |

### 官方文档（GitHub: deepseek-ai/deepseek-harness）

- `docs/cookbook/adding-a-settings-card.zh.md` —— 设置卡片 + client 半侧挂载 + `dsh.client` 字段
- `packages/client/ui-settings/README.zh.md` —— `settings.section` / `settings.section.icon` / `settings.section.view`
- `packages/client/ui-settings-general/README.zh.md` —— 导航外壳、移动端横条
- `packages/client/ui-plugin-manager/README.zh.md` —— 配置页与 `plugins.*` slot
- `packages/client/modules/README.zh.md` —— 客户端模块系统 / lazy-CJS factory
- `packages/skill/skill-filesystem/README.zh.md` —— 技能根与 rank 表
- `docs/config-catalog.zh.md` —— 各包 Config 字段全表

---

## 10. 下一步

1. 建脚手架：`package.json` + `cordis.patch.yml` + 最小 `src/index.ts` + 最简 client，验证 **M0**。
2. 立刻做 **Q1 实验**（它决定整个架构）。
3. 通过后按 M1→M5 推进；不通就用方案 B，UI 不变。

> 备注：目录名 `Skills-Manger` 与包名 `dsh-skills-manger` 沿用当前拼写（Manger），
> 若要改成 `Skills-Manager` 请在开工前一次性改掉，避免后面包名/路径不一致。
