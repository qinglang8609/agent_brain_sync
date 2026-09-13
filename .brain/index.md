# 🗂 Graph Index

本文件唯一入口。每新建/大改一个知识页，同步在此分类下加一行 `[[页面名]] — 一句话`。

## Roadmap
> **版本号与测试数不在此复述** —— 以 `abs --version` / npm registry 为准。
> （曾写死过版本号与测试数，结果长期与实际不符 —— 复述第三方状态必然漂移。）
> 本页只写**方向**。

**已落地**：四宿主安装器 + hook→MCP→CLI 三层 + 收尾自动化（含 Stop hook 主动推）；
日志增长治理（hooks.log / wrapup.log 轮转）；Done 区归档（`abs todo archive`，每天一文件、会话结束自动跑）；
lint 兜底（SOURCES-PILED-UP / DONE-PILED-UP，均带测试）。

**下一阶段候选**：
- 图谱长期维护（sources 归档节奏、concepts 拆分时机）；
- 收尾注入的"只推一次"是否会漏掉长会话中的多次阶段性收尾；
- 若 `.brain` 涨到 MB 级或需要结构化查询，再评估索引层（见 [[perf-fixed-overhead]]；候选不是 SQLite）。

## Rules
> 本项目已沉淀经验的硬摘要。违反过的代价各记在对应概念页，细节点进去看。

- **未经用户核对不准发版/推送** —— `git push`、`npm publish`、`npm version`、
  改 package.json 版本号、刷新四宿主，**一律先给用户看 diff + 测试结果 + 影响范围，等确认**。
  用户说「收尾」/「修复」不等于授权发布。尤其 npm publish **不可覆盖**，发错只能再发一版补。
- 绝不通读 `.brain/` —— 全读塞满窗口；要状态用 `abs load`，要主题用 `abs query`。
- 读取侧输出不得随规模增长 —— 只给计数/摘要 + 逃生口。[[read-side-output-must-not-scale]]
- 多文件汇总在沙箱里处理后只打印结论，别把原文拉进上下文。
- 改记录属内容决策，工具只报不改。[[todo-rewrite-not-map]]
- 已存在的人工内容一律不覆盖，机器只补空位。
- 并发锁只给「读改写」；append / 原子写不妄加锁。[[file-write-locking]]
- 判「等价」/ 引用新符号/ 新测试，必须真跑到，且跑破坏验证。[[symbol-reference-needs-real-run]]
- 证据到手前不给结论。[[silent-data-loss-diagnosis]]
- 写入侧收口，别在下游救。[[summary-truncation-hidden-cause]]
- 只写做过/跑过/测过的事实，禁止脑补。
- Done 必须带结语 + 完成日期（缺日期会永远迁不出）。
- 加前置守卫前先问「谁在非交互地调我」。[[guard-blocks-noninteractive-callers]]
- 改一份不算改 —— 多副本要全改，已加载进程要重启。[[deploy-artifact-copies]]
- 不在子目录/非项目根跑（不向上搜索）。
- 坏链 = 掰断接力棒；`abs lint` 必须 0 problem。
- index 行不承载归因。[[index-row-not-attribution]]

## Concepts
- [[abs-install-layout]] — 全局安装形态: npm link 单一真源 + hook/MCP 烧绝对路径
- [[todo-rewrite-not-map]] — todo 行操作必须整文件重写保序，map 改不了分区结构
- [[hook-sh-not-bash]] — hook 脚本 shebang 与语法必须同方言（POSIX sh 无子串扩展）
- [[skill-rewrite-residual-old-methods]] — skill 以旧文档为基底重写时, 旧方法(bootstrap/.sh)残留成悬空引用; 须对照实际工具清单逐条核对
- [[file-write-locking]] — 并发写保护: 读改写才需 editFile 锁; append/原子写/单用户动作天然安全不妄加锁
- [[npm-publish-flow]] — npm 发布全流程: 2FA发布限制/scoped改名绕相似名/发布后registry读延迟/全局link清理/宿主install零宽字符坑
- [[teardown-automation]] — 收尾自动化: hook 必须主动推(注入指令)而非被动记日志; 各宿主 idle/Stop 事件 + 触发条件收窄
- [[host-plugin-silent-failure]] — 宿主插件"静默失效"三坑: 可观测性(缺无条件 seen 痕)/回调签名错/导出方式错; 装上了≠加载了≠触发了
- [[deploy-artifact-copies]] — hook/插件产物有三份(仓库/宿主落点/进程内存)+全局 npm 副本; 改一份不算改, 删文件对已加载进程无效必须重启宿主
- [[perf-fixed-overhead]] — 性能优化先分解固定开销: 实测 abs 27ms 中 node启动占20ms(读写仅3ms); 逐段追问"这段能否拿掉"; daemon 方案为此被否(仅省5ms)
- [[silent-data-loss-diagnosis]] — 静默丢数据排查顺序: 串行能否复现→组件级压测→临界区 trace 看 orig→write 序列; 证据到手前不给结论(先猜机制会连续翻车)
- [[self-triggering-hook-loop]] — 自触发 hook 死循环: 主动推会触发下一轮→ 必须双保险(宿主防重入字段 + 己方节流), 且节流器不允许有"跳过"分支
- [[opencode-inject-channel-verdict]] — op​encode 注入通道判定: promptAsync(204)/prompt(200)/command(200) 均能唤醒 idle session; tui.* 假成功不唤醒; "零 nudge"真因是 gate 非通道
- [[summary-truncation-hidden-cause]] — 散文截断是「摘要读起来抽象」的隐形根因且自我掩盖: 先查写入侧(硬切率 34/85 即确诊), 别去调 prompt; 修法须收口在一处
- [[symbol-reference-needs-real-run]] — 引用新符号/判"等价"/新功能测试, 验证必须真跑到: node --check 查不出未导入标识符; 判等价只测恒真式不算验证(删 resolveProjectDir 回退分支即此坑); 新测试要跑破坏验证, 不红=没盖到
- [[guard-blocks-noninteractive-callers]] — 加前置守卫前先问「谁在非交互地调我」: hook/CI 调的内部命令一律放行, 否则守卫失效是静默的(报错被吞); 必配一条「hook 路径不被拦」的测试
- [[index-row-not-attribution]] — index 行是指针不是记录: 塞作者名会从"创建者"漂成"最后改的人"; 归因只写页 frontmatter, 要在读取侧展示
- [[read-side-output-must-not-scale]] — 读状态的入口不得打印无上限增长的数据: 同一根因连续踩三次(Done区 68.8% / log条目 / index清单 64%); 只给计数+逃生口, 判据是"会不会随规模增长"而非"现在是不是最大"
- [[file-shape-check-on-load]] — load 顺手核对 index/log/todo 形状: 缺分区→自动补建(机械可判定); 无头(H1不符)→只提醒不自动改(结构可能整体脱轨, 机器猜错等于毁数据); 多分区→不管; 正常时零字节

## Entities
- [[AgentBrainSync]] — 本项目实体页：三层架构、代码入口、开发命令
- [[fanchao]] — 使用者；技术栈 / 特点·工作习惯 / 名下踩过的坑

## Sources
- [[2026-09-12-mcp-陈旧路径不只在一个文件]] — MCP 陈旧路径不只在一个文件: pi-mcp-adapter 的 hostConfigDiscovery 把 9 个外部 store…
- [[2026-09-12-agents-skills]] — ~/.agents/skills/ 不是无主目录, 是 skills CLI(npx skills, ~/.agents/.skill-lock.json…
- [[2026-09-10-todo归档]] — Todo 归档：2026-09-10，共 30 条已完成任务
## Syntheses

## Sessions
- [[log-2026-09-10]] — 修 Co​dex 安装崩溃(对象 vs 扁平数组) + 补收尾自动化(pi agent_end 注入) + lint 反向死引用检查; 含自动化形同虚设的根因剖析
- [[2026-09-08-todo归档]] — Todo 归档：2026-09-08，共 22 条已完成任务
- [[2026-09-09-todo归档]] — Todo 归档：2026-09-09，共 6 条已完成任务
- [[log-2026-09-08]] — 本轮开发全记录+测试清单（D1收尾→D2→D3→实时化→全局安装）
