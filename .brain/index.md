# 🗂 图谱索引

本文件唯一入口。每新建/大改一个知识页，同步在此分类下加一行 `[[页面名]] — 一句话`。

## 当前路线 (Roadmap)
> **v1.0.0 已发布**（2026-09-10，npm `@fanchao8609/agent_brain_sync`）。
> 四宿主（cl​aude-code / co​dex / op​encode / pi）安装器 + hook→MCP→CLI 三层 + 收尾自动化均已落地，146 测试绿。
>
> **下一阶段候选**：
> - op​encode / cl​aude-code / co​dex 的收尾注入**真机观察**（pi 已贯通）；
> - 收尾注入的“只推一次”节流是否会漏掉长会话中的多次阶段性收尾；
> - 图谱长期维护（sources 归档节奏、concepts 拆分时机）。

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
## Entities
- [[AgentBrainSync]] — 本项目实体页：三层架构、代码入口、开发命令
## Sources
- [[2026-09-10-opencode-插件-abs-ts-的导出形状]] — opencode 插件 abs.ts 的导出形状确认: @opencode-ai
- [[2026-09-10-oc-inject-channel-判定实验结论]] — OC-INJECT-CHANNEL 判定实验结论: promptAsync 对 
- [[2026-09-10-主动推类-hook-回-decision-blo]] — 主动推类 hook(回 decision:block/注入新 turn)必须自带
- [[2026-09-10-守卫-guard-的工具白名单必须按宿主实际用法]] — 守卫(guard)的工具白名单必须按宿主实际用法穷举, 漏一个就把功能静默关掉。
- [[2026-09-10-排查-某行为没发生-先证明上游-gate-满足]] — 排查"某行为没发生"先证明上游 gate 满足, 再怀疑下游通道。顺序错了会白花
- [[2026-09-10-类型签名-返回码推不出运行时语义-prompt]] — 类型签名/返回码推不出运行时语义: promptAsync 返回 204 voi
## Syntheses
## Sessions
- [[log-2026-09-10]] — 修 Co​dex 安装崩溃(对象 vs 扁平数组) + 补收尾自动化(pi agent_end 注入) + lint 反向死引用检查; 含自动化形同虚设的根因剖析
- [[log-2026-09-08]] — 本轮开发全记录+测试清单（D1收尾→D2→D3→实时化→全局安装）
