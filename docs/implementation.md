# 首版实现与验证边界

## 当前范围

包名统一为 `dsh-project-skills-manager`，不沿用设计稿 Manger 拼写。Node >=22，原生 ESM JavaScript；无需 TypeScript 编译链。

- 独立项目策略：默认关闭，显式停用 > 显式启用 > 默认策略。
- 状态原子替换、跨进程锁、保留未知字段、损坏文件拒写并默认关闭。
- 只读扫描用户 DSH、用户 agents、custom 以及 skills-library；不扫描插件自带技能或项目本地技能。
- 每个 agent 注册 provider，使用 workingDirectory.ensure 获取动态 cwd；list/get 共用策略，get 加载时再次核验。
- skill 工具守卫拒绝受管目录中已停用的名称；失败时拒绝加载。不是文件系统安全隔离，不能阻止其他工具直接读取文件。
- 设置侧栏：项目选择、路径输入、搜索/筛选、来源分组、开关、默认策略、正文估算、纯文本详情。
- 不含发现、安装、删除、回收站、导入导出和 junction 迁移。

## 关键限制：M3 尚未验收

DSH 多 provider 合并，空 list 无法隐藏其他 provider 的技能。当前首版仅对本插件提供的条目保证过滤；工具守卫对受管同名技能兜底，但其他 provider 中的条目可能仍出现在模型目录中。UI 明确展示未验证状态，不把保存成功冒充过滤成功。

如果技能仅放在默认 filesystem provider 不扫描的 skills-library，启用后由本插件提供，关闭后本插件不返回它；必须确认该路径没有被其他 custom provider 扫描。现有全局目录不会自动迁移、修改或清空。

参考插件另有低 rank 同名 overlay + 双 invocation false 路线，可在模型目录消费层过滤，值得下一步单独验证真实 registry/scope；neutral registry.list 仍有条目。见 [研究报告](<dsh-integration-research.md>)。首版不通过私有 hook 或全局配置覆盖冒充可靠隔离。

项目本地和 bundled 技能不作为扫描对象，但守卫按名称判定；与受管全局技能同名时，本地技能调用也可能受影响。扫描或策略读取失败时，守卫保守拒绝，可能暂时影响未受管技能。

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
4. 设置左侧应出现“项目技能”；多个活动项目时须明确选择路径。
5. A/B 验证：A 启用测试技能、B 关闭；在各自会话确认模型目录和 skill 加载行为，再关闭 A，检查下一轮刷新。

本轮不安装到用户 profile、不改其他插件配置、不迁移技能、不重启当前会话。自动化 DOM/契约测试不是当前 GUI 实机验收。

## 数据与配置

状态默认位置：DSH_HOME（未设置则用户目录 .dsh）下 project-skills-manager/state.json，与其他插件隔离。config 支持 dshHome、agentsHome、libraryDir、customSkillDirs、stateFile。roots 为测试/高级显式扫描覆盖，条目 {path,source,rank}。

锁目录 state.json.lock 不会被自动抢占；异常退出若遗留锁，先确认没有运行中的写入进程，再人工清理。策略变化由本插件写入后 invalidate；外部手工编辑需要点击刷新。

正文 token = 字符数 / 4 向上取整，仅粗估，不是 tokenizer 结果，也不是 system 技能目录实际上下文消耗。
