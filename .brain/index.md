# 🗂 Graph Index

本文件唯一入口。每新建/大改一个知识页，同步在此分类下加一行 `[[页面名]] — 一句话`。

## Rules
- 未经用户核对，不准发版、不准推送。
- 只写做过、跑过、测过的事实。
- 已存在的人工内容一律不覆盖。
- 绝不通读 `.brain/`。
- 读取侧输出不得随规模增长。
- 记录属内容决策，工具只报不改。
- 判「等价」必须真跑到，且跑破坏验证。
- 证据到手前不给结论。
- 写入侧收口，别在下游救。
- 加守卫前先问谁在非交互地调我。
- 改一份不算改，多副本全要改。
- 靠提醒才能工作的功能，该删不该补。
- 先列≥2假设+反证条件；自造输入测出的结果不算证据。
- 结论要明确：给结论+依据+下一步；不定位要说清缺什么。

## Concepts
- [[abs-install-layout]] — 全局安装形态: npm link 单一真源 + hook/MCP 烧绝对路径 + skill 布局须与代码同版本（半升级两头都坑）
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
- [[hook-throttle-alignment]] — hook 节流三种静默失效: 状态跨会话不重置 / 判据用代理信号(note 也写 log) / 素材不清空; 测试必须成对跑
- [[read-side-output-must-not-scale]] — 读状态的入口不得打印无上限增长的数据: 同一根因连续踩三次(Done区 68.8% / log条目 / index清单 64%); 只给计数+逃生口, 判据是"会不会随规模增长"而非"现在是不是最大"
- [[file-shape-check-on-load]] — load 顺手核对 index/log/todo 形状: 缺分区→自动补建(机械可判定); 无头(H1不符)→只提醒不自动改(结构可能整体脱轨, 机器猜错等于毁数据); 多分区→不管; 正常时零字节
- [[agents-skills-not-ownerless]] — ~/.agents/skills/ 属 skills CLI(lockfile 所有者), 宿主 skills/ 只是其扇出目标; 判残留副本要三证据齐; 只读检测+告警, 绝不代写代删
- [[mcp-stale-paths-multi-store]] — MCP 陈旧路径: 适配器把 9 个外部 store 当权威读, 任一处的旧条目会盖过自己写对的那份; 校正须挂 runInstall/runUninstall 层, 并逐处核对宿主实际读到的值

- [[self-authored-evidence]] — 自造证据: 单假设逼你造假(编输入→真实验→真404); 多假设+反证条件才治得住

## Entities
- [[AgentBrainSync]] — 本项目实体页：三层架构、代码入口、开发命令
- [[fanchao]] — 使用者；技术栈 / 特点·工作习惯 / 名下踩过的坑

## Sources
- [[2026-09-10-todo归档]] — Todo 归档：2026-09-10，共 30 条已完成任务
- [[2026-09-13-sources-堆积收口-4-条无入链]] — sources 堆积收口：4 条无入链 source 全清——2 条成规律页(agents-skills-not-ownerless /…
- [[2026-09-13-git-配了失效代理-192-168-0]] — git 配了失效代理(192.168.0.114:7890) → push 报 Failed to connect port 7890，但直连本就通。绕过:…
- [[2026-09-13-话题树失效根因是触发频率而非ai偷懒-abs]] — 话题树失效根因是触发频率而非AI偷懒：abs 只有 agent_end 一个触发器(且被 loggedToday 整天闸死)…
- [[2026-09-13-web-版方案评估结论-不开发]] — web 版方案评估结论：不开发。理由=价值不足——abs 的核心是 hook 自动触发+CLI 快，浏览器手动打开一个只读/编辑器页面，比直接编辑 .md…
- [[2026-09-13-话题树-topics-整个删除-做错了一]] — 话题树(## Topics)整个删除——做错了一个抽象，药方是删不是补。①失败模式:…
- [[2026-09-14-本地部署用-npm-link]] — 本地部署用 npm link 把全局包指向源码仓：改源码立即生效（四个宿主跟着走），代价是没有「已发布版本」这个回退点，且 npm i -g / abs…
- [[2026-09-15-opencontext-0xranx]] — OpenContext(0xranx) 对比结论：它的读取协议值得抄——manifest 先给「路径+一行desc+计数」让 Agent 自己挑，而非吐全文…
- [[2026-09-12-todo归档]] — Todo 归档：2026-09-12，共 13 条已完成任务
- [[2026-09-15-抄来的三项改进已落地并验证-mcp]] — 抄来的三项改进已落地并验证：①MCP 错误带逃生口（err(msg,{code,fallback}) → 输出 '[CODE] 原因' + '→ 下一步'…
- [[2026-09-15-abs-pages-删掉了-从别人架构图推出]] — abs pages 删掉了——「从别人架构图推出来的功能」不是需求。①它复制 abs index（38 页全列，上限 40 一次没触发）；②违反自己已定的…
- [[2026-09-15-经验需要生命周期而不是只写不删-abs-原来]] — 经验需要生命周期而不是只写不删：abs 原来 9 条 source 全部没提炼、零回退能力——推翻一条经验只能 rm 文件，而 skill…
- [[2026-09-15-写文件即任务开始-todo]] — 写文件即任务开始——todo 自动登记的正解是换触发时机而不是加提醒：旧设计只在 agent_end 提醒收尾，但那时用户已想结束、AI 只想收尾不想登记…
- [[2026-09-15-git-push-撞-ssl_error_sys]] — git push 撞 SSL_ERROR_SYSCALL 时先降级 HTTP/1.1，不是清代理：本次发布实测——①.ipconfig…
- [[2026-09-15-每次写文件就弹-follow-up]] — 每次写文件就弹 Follow-up 的功能整个删掉了——触发频率是设计错误不是实现错误。①症状：pi 里满屏 Follow-up，用户第一反应就是「去掉」…
- [[2026-09-15-自造证据的识别与防治-用户2026-09-15提]] — 自造证据的识别与防治（用户2026-09-15提出）：单假设是造假的动机——只有一个假设时它必须被证实否则思路断，于是自己编输入去测（app…
## Syntheses

## Sessions
- [[log-2026-09-10]] — 修 Co​dex 安装崩溃(对象 vs 扁平数组) + 补收尾自动化(pi agent_end 注入) + lint 反向死引用检查; 含自动化形同虚设的根因剖析
- [[2026-09-08-todo归档]] — Todo 归档：2026-09-08，共 22 条已完成任务
- [[2026-09-09-todo归档]] — Todo 归档：2026-09-09，共 6 条已完成任务
- [[log-2026-09-08]] — 本轮开发全记录+测试清单（D1收尾→D2→D3→实时化→全局安装）
