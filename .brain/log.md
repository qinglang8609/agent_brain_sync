# 🗒 操作日志
## [2026-09-10 16:09] dev | 更新经验: 新增概念页 deploy-artifact-copies(产物三份: 仓库/宿主落点/进程内存 + 全局npm副本; 删文件对已加载进程无效必须重启); file-write-lockin
## [2026-09-10 16:04] dev | 沉淀静默丢数据排查方法论: 新增概念页 silent-data-loss-diagnosis(串行能否复现→组件级压测→临界区 trace 看 orig→write 序列; 证据到手前不给结论)。记录
## [2026-09-10 16:03] note | "并发下才复现"不一定是并发 bug: 先单独压测被怀疑的组件(本次锁单独压 20/20 全对), 再换单线程串行复现。
## [2026-09-10 16:03] note | id/键定位一律全等比对, 禁用 includes/子串: 'T11'.includes('T1') 为真 → T1 误
## [2026-09-10 16:03] note | 定位"丢数据"类 bug 必须看写入序列而非猜机制: 往临界区加 trace(记录每次锁内的 orig→write 指纹
## [2026-09-10 16:02] dev | 修 id 子串匹配丢任务 bug: includes(id) → 行首 id token 全等比对(三处同源: findTaskLine/upsertTask/markDone); 零并发可复现(T1
## [2026-09-10 15:30] dev | 完成 6 项待办 + 3 个真 bug 修复 + 经验沉淀: ①版本对齐误判澄清(本地已 1.1.0) ②git 收尾(7 commits) ③loggedToday 裸日期 substring 守卫
## [2026-09-10 15:28] note | 类型签名/返回码推不出运行时语义: promptAsync 返回 204 void 被推断为"fire-and-forg
## [2026-09-10 15:28] note | 改 hook/插件的部署产物必须同时刷新"仓库 + 全局安装"两份副本, 并删掉已运行进程的旧插件(删文件对已加载进程无
## [2026-09-10 15:28] note | 排查"某行为没发生"先证明上游 gate 满足, 再怀疑下游通道。顺序错了会白花一轮: 本次零 nudge 先怀疑注入通
## [2026-09-10 15:28] note | 守卫(guard)的工具白名单必须按宿主实际用法穷举, 漏一个就把功能静默关掉。opencode 侧 wroteFile
## [2026-09-10 15:28] note | 主动推类 hook(回 decision:block/注入新 turn)必须自带死循环防护: 注入会触发新一轮, 新一轮
## [2026-09-10 15:02] note | 实验中发现: ~/.config/opencode/plugins/probe-oc.ts (上个会话留的探针, ses
## [2026-09-10 15:00] dev | 完成 OC-INJECT-CHANNEL 判定: 实测四通道(prompt_async 204/prompt 200/command 200 均能唤醒 idle session; tui.* 200 
## [2026-09-10 14:59] note | OC-INJECT-CHANNEL 判定实验结论: promptAsync 对 idle(终结态) session 确实
## [2026-09-10 13:21] note | opencode 插件 abs.ts 的导出形状确认: @opencode-ai/plugin 要求 PluginMod
## [2026-09-10 12:05] note | 命令报'看不到新版本'先分两类: 实现不存在 vs 数据/网络不对。本次'abs update 看不到新版本'根因是命令
## [2026-09-10 12:05] dev | 补 abs update + abs --version: 用户报'update 看不到新版本'根因是命令从未实现(不是缓存/网络); update 走 npm 升级后自动刷新四宿主 hook/ski
## [2026-09-10 11:58] dev | 发布正式版 1.0.0: 从 npm 包真机冒烟(四宿主安装+init/task/note/log/load/query/lint/MCP 9工具+插件加载)全通过; 全局升级 1.0.0 并刷新四宿
## [2026-09-10 11:47] dev | 真机验证通过: pi 真实会话首次跑通 agent_end→seen→teardown-nudge 完整链路; seen 痕补记 cwd+brain 使异常可归因; 146测试绿, 发布0.5.1
## [2026-09-10 11:38] dev | 补插件 seen 痕可观测性: 首次 agent_end/session.idle 无条件留痕, 使'未触发/被拦下/已注入'三态可从日志区分; 146测试绿, 发布0.5.0
## [2026-09-10 11:38] note | 可观测性缺口: 插件只在真正注入(nudge)时写日志, 于是查日志时无法区分三种状态 —— ①事件根本没触发 ②触发了
## [2026-09-10 11:35] dev | 补插件行为级测试(9例)+ZWSP守卫(2例): 真import生成产物驱动真实事件+断言日志落痕; 顺带修掉日志前缀里的零宽字符; 144测试绿, 发布0.4.0
## [2026-09-10 11:35] note | 插件验证必须行为级, 字符串断言会漏掉导出方式错误: install.test.js 只 grep 源码文本, 于是 (
## [2026-09-10 11:28] dev | op​encode 插件第二个静默失效: 命名导出→default(export default {id,server}), 修完签名仍 0 触发因插件根本没被加载; 133测试绿, 发布0.3.1
## [2026-09-10 11:28] note | op​encode 插件加载器取 default 导出, 用 export const 命名导出会被静默忽略(mod.d
## [2026-09-10 11:17] dev | op​encode 插件从未触发过(第二半): event 回调签名错({name}→{event})+事件名错(session.start→session.idle) 导致静默失效0条日志; 据官方
## [2026-09-10 11:16] note | op​encode 收尾自动化落地: session.idle 是每轮结束信号(对应 pi 的 agent_end / 
## [2026-09-10 11:16] note | 宿主插件 API 必须按官方类型定义实核, 不能凭印象写: op​encode 插件曾把 event 回调入参写成 ({
## [2026-09-10 11:10] dev | 补 lint 反向死引用检查(INDEX-DEAD-LINK): 原来只查 page→index, 不查 index→page, 归档 source 后 index 残留死引用静默留存; 130测试绿
## [2026-09-10 11:08] dev | 修 Co​dex 安装崩溃 + 补收尾自动化: hooks.json 改对象形态(兼容迁移/卸载双侧), pi 扩展挂 agent_end 注入收尾指令(真改过文件+今日未收尾才推, 每会话一次); 
## [2026-09-10 11:08] note | 收尾自动化的缺口不在'记日志'而在'没人提醒': pi 扩展原来只挂 session_start/session_shu
## [2026-09-10 11:08] note | Co​dex hooks.json 真实形态是对象 {hooks:{EventName:[{matcher?,hooks
## [2026-09-09 12:43] dev | 发布到npm+沉淀发布经验: @fanchao8609/agent_brain_sync@0.1.0成功发布并全局安装(清旧link); 提炼concept npm-publish-flow(2FA/
## [2026-09-09 12:21] dev | 修 pi/opencode 插件生命周期事件灌图谱 log.md: 模板改直写技术日志 hooks.log(与 event.sh 同纪律, ABS_LOG_DIR 可覆盖), 真机 Pi extens
## [2026-09-09 12:02] dev | Done按日期分组: ### date新在前, 老平铺惰性迁移兼容, markDone归组顶部, 125测试绿
## [2026-09-09 11:56] dev | 方案②+wrapup对账落地: skill加跨会话任务只用abs task/原生todo仅会话内草稿规则(全宿主同步), 118测试绿
## [2026-09-09 11:56] note | 方案②落定: 跨会话任务只用 abs task(.brain/todo.md唯一真源), 宿主原生todo(CC/co​
## [2026-09-09 11:52] dev | wrapup收尾保险(A+B): abs wrapup快照滞留进wrapup.log+load顶出上会话滞留(交叉核对自清理)+pi扩展/event.sh Stop触发+skill开场强制对账. 11
## [2026-09-09 00:35] dev | README 更新 + readme 任务归位: README 重写(112行)反映产品模式npm安装(agent_brain_sync)/lock并发写保护/brainio统一读写/moshi共存/
## [2026-09-09 00:20] dev | 收尾: TASK-DEEP-TEST + MD-STANDARD-RW 归位 Done. TASK-DEEP-TEST=四层(CLI/install/MCP/hook)测试110绿+真实冒烟+lock
## [2026-09-08 23:57] note | lock.js并发丢根因: 非锁失效(临界区重叠=0完美互斥), 而是 LOCK_MAX_WAIT_MS=3s太短, 高
## [2026-09-08 23:33] note | 并发写安全审计心法: 别对'所有写入'一律加锁, 先按风险分类——①读改写(读旧覆盖别人新行)才需锁; ②append日
## [2026-09-08 23:31] note | hook测试脆弱点: event.sh 幂等 mark 硬编码 /tmp/abs-hook-<cksum>-<分钟>.m
## [2026-09-08 23:29] note | hooks/event.sh幂等mark文件用date分钟粒度写共享/tmp/abs-hook-*.mark, 跨测试运
## [2026-09-08 23:28] note | abs markdown并发写冲突: 所有读-改-全写回文件操作都应经共享editFile锁(open wx原子锁文件+
## [2026-09-08 23:27] dev | TASK-DEEP-TEST 真实冒烟 + INSTALL-COEXIST: CLI/MCP/hook 三层真机通过; install.js 覆盖式改共存合并(追加保留moshi), 4新测试12/1
## [2026-09-08 23:27] note | 解决 abs 与 moshi-hook 共存: installClaudeCode 从覆盖式 settings.hook
## [2026-09-08 23:14] note | 真实冒烟: CLI/MCP/hook 三层全通过(CLI沙盒项目全链路、MCP独立进程9/9、真实abs-Stop.sh
## [2026-09-08 22:58] dev | 收尾提醒(不越界)落地: Stop hook 在 ~/.abs/log/wrapup.log 留一行 wrapup-remind(session_id); 非 Stop 事件不写; 已重装 4 hoo
## [2026-09-08 22:40] dev | 收尾自动化测试: Stop hook 机械层触发验证通过(hooks.log 落痕/stdout {} /幂等); skill/SKILL.md v2(185行) 同步装到 ~/.claude/ski
## [2026-09-08 22:33] note | 测试 Stop hook 机械层触发通过: 模拟宿主事件 stdin → 落 ~/.abs/log/hooks.log 
## [2026-09-08 22:25] dev | 整合版 skill 重写完成(174行): 以原版为骨架+图谱定位节+每轮结束收尾循环, 清 bootstrap/.sh 旧方法, 分工具/手工边界; 沉淀 concept skill-rewrite-residual-old-methods
## [2026-09-08 22:20] note | skill 重写陷阱: 以旧文档为主时, 旧方法引用(bootstrap.sh/.sh/手工建图)会残留成悬空引用; 必
## [2026-09-08 21:40] dev | 修 log.md 定位: 只记工作成果沉淀, 去掉 task 过程自动刷; 时间戳改本地(原 UTC 差8h)
## [2026-09-08 21:30] dev | 修 done 归位断点残留 bug(markDone trimStart), 50测试绿
## [2026-09-08 21:20] dev | lint 对 sources/ 豁免孤立页检查(abs note 暂存页不再误报 ORPHAN)
## [2026-09-08 20:30] dev | 目录重构: abs/* 上移仓库根做根 npm 包, install.js ABS_DIR 自动适配, 47测试绿
## [2026-09-08 12:24] dev | 整批变更已提交 5 commits (gitignore/PLAN/abs核心/SKILL/brain)
## [2026-09-08 11:15] dev | 补分工节: hook机械记log + task/note实时落盘 + skill自觉深提炼; 37测试绿
## [2026-09-08 10:45] dev | 全局安装 npm link + hook 经 node 调起修复(不依赖 exec 位)
## [2026-09-08 10:00] dev | D1补全: query/lint CLI+MCP, task幂等, done归位Done, hook sh兼容, 29测试绿
