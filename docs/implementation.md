# 首版实现与验证边界

## 当前范围

包名统一为 `dsh-project-skills-manager`，不沿用设计稿 Manger 拼写。Node >=22，原生 ESM JavaScript；无需 TypeScript 编译链。

- 来源默认策略（0.1.3）：library 仓库技能默认关闭；user-dsh / user-agents / custom 全局技能默认开启。工作区显式停用 > 显式启用 > 来源默认。旧版 defaults.globalSkills 字段仍保留用于兼容，但不再影响上述已知来源。不会把旧版默认关闭自动当作用户显式停用，也不清除用户实际设置的开关。
- 状态原子替换、跨进程锁、保留未知字段、损坏文件拒写并默认关闭。
- 只读扫描用户 DSH、用户 agents、custom 以及 skills-library；不扫描插件自带技能或项目本地技能。
- 每个 agent 注册 provider，使用 workingDirectory.ensure 获取动态 cwd；list/get 共用策略，get 加载时再次核验。
- skill 工具守卫拒绝受管目录中已停用的名称；失败时拒绝加载。不是文件系统安全隔离，不能阻止其他工具直接读取文件。
- 设置侧栏“技能”：紧凑工作区选择（仅名称，约200px）、搜索/筛选、来源分组、开关、正文估算、纯文本详情。不再提供其他目录输入或统一默认策略控件。
- 不含发现、安装、删除、回收站、导入导出和 junction 迁移。

## 目录过滤（0.1.4）

停用技能现在仍以同名候选进入中立注册表，但使用低 rank（-1e9）及 invocation.modelInvocable=false / userInvocable=false 覆盖常规来源。官方消费者据此不向模型广告该技能，也不允许从用户技能入口注入。中立 registry.list() 仍含条目，这是正常行为，不等于模型可见。

provider.get 每次重新核验策略，停用时返回 undefined 且不读取正文；已核对官方 registry 不回退到其他 provider。工具守卫仍保留。启用时保留技能原始 invocation，不能把 manual-only 技能变成模型可调用。

设置页每次读取/刷新/保存后，对所选工作区每个活动会话调用真实 skills.list({scope:agent,cwd})，检查受管名称的赢家 provider 和两个 invocation 字段。成功才显示“已核验”；无会话显示待核验；更低 rank/更近 scope 覆盖、宿主读取失败、策略/扫描错误会明确提示。核验仅对本次扫描到的受管技能有效，不宣称所有第三方来源均已覆盖。

没有修改 filesystem provider 配置，没有迁移或删除用户技能。其他工具直接读取文件、已经加载进历史的技能正文以及正在进行的回合不在过滤保证内；下一轮目录构建生效。外部手工改策略后应刷新以失效缓存。

同名项目本地或 bundled 技能可能被受管全局同名 overlay 覆盖；不同名的本地/bundled 不受管理。此兼容性限制已知。

真实官方发布包与 Cordis 的离线集成测试见 [覆盖验证报告](<overlay-verification.md>)；安装到用户当前 DSH 后，以页面运行时核验结果判断当前会话，不把离线通过冒充当前 GUI 已升级。

## 本地开发

```bash
npm ci --ignore-scripts
npm test
npm run build
npm pack
```

构建输出 host ESM 与浏览器 lazy-CJS 两个入口。浏览器使用宿主 React 仅作 slots 薄桥接，不内联另一份 React。yaml 由包管理器安装。

## 安装到 DSH（待确认）

1. 执行 build 和 pack，得到本地 tgz。
2. 在 DSH 插件管理中按当前版本支持的本地包安装流程操作；不要猜测修改 profile 文件。
3. 确认 bundle 已启用，重启当前 DSH 并刷新原 GUI，不启动另一个 Vite 页面替代验证。
4. 设置左侧应出现“技能”。从宿主工作区注册表读取侧栏工作区列表，下拉框只显示标题（无标题时显示目录末段），选中值内部仍是路径。没有工作区时先在 DSH 添加工作区再刷新。
5. A/B 验证：A 启用测试技能、B 关闭；在各自会话确认模型目录和 skill 加载行为，再关闭 A，检查下一轮刷新。

本轮不安装到用户 profile、不改其他插件配置、不迁移技能、不重启当前会话。自动化 DOM/契约测试不是当前 GUI 实机验收。

## 数据与配置

状态默认位置：DSH_HOME（未设置则用户目录 .dsh）下 project-skills-manager/state.json，与其他插件隔离。config 支持 dshHome、agentsHome、libraryDir、customSkillDirs、stateFile。roots 为测试/高级显式扫描覆盖，条目 {path,source,rank}。

锁目录 state.json.lock 不会被自动抢占；异常退出若遗留锁，先确认没有运行中的写入进程，再人工清理。策略变化由本插件写入后 invalidate；外部手工编辑需要点击刷新。

正文 token = 字符数 / 4 向上取整，仅粗估，不是 tokenizer 结果，也不是 system 技能目录实际上下文消耗。
