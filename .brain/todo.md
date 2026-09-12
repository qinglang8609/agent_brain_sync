# 📋 Todo 看板
## Backlog
## Today / In Progress
## Blocked
## Done（只留近期，旧的迁 log.md/快照）
### 2026-09-12

- [x] LOG-BACKFILL-34 — 【已决定不修】log.md 34 条历史残句。事实认定: 完整原文在文件/git 全历史/归档 session 页均不存在(逐 commit 核对), 截断发生在写入时且原文已销毁 → 属不可恢复, 只能推断重写。风险实证: 本次试写批量脚本即把'修 Pi 缺失 MCP 注册：'整段开头吃掉(已回滚并逐字节校验)。已向用户确认: 旧的不管。保留此条仅为记录认定结论, 避免后续会话重复调查。新写入自 1.5.4 起不再截断。 【否决】 (完成 2026-09-12)
- [x] NOTE-TAGS-BOOL — abs note --tags 被解析成布尔 true → frontmatter 写成 tags: [source, true], 且 'abs,摘要' 还粘进了正文。复现: abs note '测试' --tags abs,摘要 → 页头 tags:[source,true]。根因疑在 bin/abs.js 的 parseArgv: --tags 被当成无值开关(与 --note 同类形态), 或值与下一位置参数错位。验证: 断言 tags 行含传入的各标签且正文不含标签串。非本次 LOG-TRUNC-100 引入(旧版同样复现, 已对 pristine 版验证) 【落地】 (完成 2026-09-12)
- [x] INSTALL-HELP-FOOTGUN — abs install --help 会静默执行全量安装而非打印帮助。根因: bin/abs.js 把 --help 只当顶层命令处理(case 'help': case '--help'), 跟在 install 后面时落到 parseArgv 的通用分支 o['help']=true, 而 install 分支根本不读它 → 走安装路径。危害: 用户想看帮助却改了四宿主配置(幂等所以不炸, 但是意外副作用)。修法: ①install/uninstall 分支开头检查 opts.help 则打印该命令用法并 return ②或在 parseArgv 里遇 --help 直接短路。验证: abs install --help 不产生任何文件写入(沙盒断言), 且输出用法 【落地】 (完成 2026-09-12)
- [x] LOG-TRUNC-100 — log.md/index.md 写入口硬切 100 字符，34/85 条 log 断在词中间(revert-c/file-write-lockin/~/.cl​aude/ski)，且 abs load 开机读的就是这份残句 → 用户/AI 看到的'最近动作'天然是半句。根因: src/store.js:355 cmdLog 的 .slice(0,100) + index 描述复用同一段截断文本(store.js:~519) + slugify 后标题也截断造成死链标题([[2026-09-10-主动推类-hook-回-decision-blo]])。修法候选: A 删截断(最省, log 本为人类摘要) B 切句读边界 C 支持 ↳ 续行。验证: 断言写 200 字 log 后落盘完整 + index 描述非截断拼接 + 页面标题不被切。修完后需重新生成/修正 index 里已生成的截断标题  【落地】 (完成 2026-09-12)
  ↳ 断点: 已定位扩大: 同一段文字在 cmdNote 里被截 6 次(store.js:355 log / 490 query / 520 slug=文件名 / 529 H1 / 546 index描述 / 557+558 转发与回显), 截断值还各不相同(24/40/60/100)。所以 note 落盘是 slug、标题、index 描述三重残句 —— 例: 文件名 ...-decision-blo, index 描述 'promptAsync 对 '。修法建议: 只在一处收口(引入 clip(text, n, boundary) 按标点/词边界收尾), slug 从完整文本取前 24 字后仍保留完整 TITLE 字段。落点见 src/store.js。
- [x] PI-MCP-NOOP — 已修并发布 1.5.3。installPi 的 withMcp 分支只打印「MCP → Pi 走 extension 内桥接」却无任何桥接代码 —— 生成的 abs.ts 只 spawn abs wrapup + 挂 3 个 pi.on()，从不碰 bin/mcp.js。本机靠 mcp-adapter 的 hostConfigDiscovery=on 间接读到 ~/.claude/settings.json 的注册才侥幸可用，无 claude 宿主的机器上 abs MCP 完全缺失（用户在另一台机器复现）。修法：真写 ~/.pi/agent/mcp.json 的 mcpServers.abs={type:stdio,command:node,args:[mcpEntryPath()]}，路径走 mcpEntryPath 解析包稳定安装位置而非 ABS_DIR；uninstallPi 同步只删 abs 条目不误删他人 MCP。验证：+4 回归测试（真注册 / 幂等重装保留既有 mcpServers+settings+imports / 卸载只删自己），全量 193 pass；npm pack 解包产物在干净沙盒（无 claude/codex/opencode）直跑装 pi 成功注册；端到端拉起 serverInfo abs 1.5.3 + 9 tools；已发 registry latest + 本机全局升级 + 四宿主刷新。  【落地】 (完成 2026-09-12)

### 2026-09-10

- [x] LOAD-RECENT-ORDER — abs load 的「最近动作」贴的是最旧 5 条而不是最新：log.md 是新在上（头=今天23:18，尾=2026-09-08），而 cmdLoad 用 tailLines(log,5)=lines.slice(-5) 取尾部=最旧。实测 load 输出里最近动作全是 09-08 的旧条目，今天的最新记录从未显示。修法: 取前 N 条（或抽前 5 个 '## [' 条目），标签改「最新 5 条」。影响: abs load 是开机读状态入口，这一节目前无用。验证: 断言输出含今天最新条目、不含 09-08 最旧条目  【落地】 (完成 2026-09-10)
- [x] ROADMAP-STALE — index.md 的路线图停在「v1.2.2 已发布，166 测试绿」，实际已到 1.5.1 / 189 测试（滞后 3 个版本）。这已在路线图自己的「下一阶段候选」里写着（"index 路线图随版本更新"）却没人做——无机制则必漂移。可选修法: ①发版时在 abs update/release 流程里同步写路线图版本 ②直接删掉路线图里的版本号（只留方向，避免这类失真） ③加 lint 检查 README/index 里的版本号与 package.json 一致  【落地】 (完成 2026-09-10)
- [x] OVERSIZE-THRESHOLD-8K — OVER-SIZE 阈值放宽 5120B → 8192B（行数 150 不变），并提成常量 PAGE_MAX_BYTES/PAGE_MAX_LINES（原来检查条件与提示文本各写一份 150/5120，会漂移）。依据：跨 4 项目 68 页仅 2 页超限且都只超一点（codebuddy 5463B / faxuehui 5440B）；早先为满足它还把一页从 5319B 压到 4972B。放宽后两者归零。已加边界测试（6KB 放行 / 9KB 报）+ revert-check  【落地】 (完成 2026-09-10)
- [x] LINT-PATH-PREFIX — lint 提示里的路径省略了 .brain/ 前缀，用户按报的路径去项目里找找不到（codebuddy 的 concepts/fnos-native-release-deploy.md 实际在 .brain/concepts/ 下，项目根没有 concepts/ 目录）。根因: listPages 里 rel=`${d}/${f}` 是 vault 相对；7 处提示(NO-FRONTMATTER/TEMPLATE-LINK/DEAD-LINK/ORPHAN-PAGE/UNRESOLVED-CONFLICT/OVER-SIZE/INDEX-MISSING)全用它。改法: rel 改 `.brain/${d}/${f}`。影响面: 只 lint 文本，无程序消费；但 test/store.test.js 两处正则（ORPHAN-PAGE/INDEX-MISSING 带 sessions\/ 的）需同步  【落地】 (完成 2026-09-10)
- [x] LINT-TOPLEVEL-PAGE — lint 误报 [[todo]] 死链：names 集合只含子目录页(concepts/entities/sources/syntheses/sessions)，.brain 顶层文件 index.md/log.md/todo.md 不被当作可链接页 → [[todo]] 被判 DEAD-LINK + INDEX-DEAD-LINK。实测 codebuddy 报 5 条、faxuehui 报 7 条，均属误报（todo.md 真实存在）。已修：names 补充 .brain 顶层 *.md 的 slug（仅用于链接目标存在性判定，不影响 ORPHAN/INDEX-MISSING）。验证：codebuddy 5 条消失、[[log]]/[[index]] 同样放行、真不存在的页仍报；新增回归测试，187 测试绿。待办：commit + 发版  【落地】 (完成 2026-09-10)
- [x] SKILL-TRIAGE-PROTOCOL — 在 skill 加「新需求受理协议」：用户报 bug 或要求加功能时，agent 不得直接动手 —— ①先总结方案(问题复述/根因或做法/改哪些文件/怎么验证) ②abs todo add 登记 ③明确问用户是否开工，等确认再改代码。例外：用户已说"开工/直接做"、一行级修字/纯查询/纯沉淀、同一需求已登记且确认过。落点: skill/SKILL.md 新增节（紧随「触发总入口」）；需重装四宿主 skill 才生效  【落地】 (完成 2026-09-10)
- [x] TODO-ARCHIVE-CMD — Done 区归档做成真流程: ①只保留近3天(可配) ②任一天内有未完成(- [ ])则整天不归档 ③归档为单个文件+在 todo 的 ### 归档 段留 [[<slug>]] 完成任务 N 条。含定时/触发规划 + lint 兜底  【落地】 (完成 2026-09-10)
- [x] MCP-PATH-UNSTABLE — 四宿主 abs MCP 注册路径不一致: codex 指向仓库(/Users/fanchao/Code/skills/.../bin/mcp.js), CC/opencode/pi 指向全局(lib/node_modules/...)。根因两处: ①install.js 三处都用 join(ABS_DIR,'bin','mcp.js'), 而 ABS_DIR 取决于'install.js 自己住哪' —— 从仓库跑 abs install 就写仓库路径 ②codex 分支 if(!text.includes('[mcp_servers.abs]')) 才写, 已存在即跳过 → 一旦写错永不修正。危害: 改了仓库但没装全局时, 真机跑的可能是另一份; 卸载全局后路径直接失效。修法: 路径应固定为该包的稳定安装位置(优先全局), 且已存在时也应更新为当前正确路径  【落地】 (完成 2026-09-10)
  ↳ 断点: 已修: install.js 新增 mcpEntryPath() 优先解析全局 node_modules 位置, 取不到才回退 ABS_DIR; codex 分支由"已存在即跳过"改为"校对并校正路径"。真实配置已校正(四宿主现一致指向全局)。新增 2 测试 + revert-check(首版测试太弱抓不到, 改为断言"存在全局包时必须写全局路径"后通过)
- [x] MCP-LIVE-VERIFY — 重启后 MCP 写通道 + mcp.log 双验证  【落地】 (完成 2026-09-10)
- [x] MCP-TRACE-DEAD — withTrace 定义了但 9 处工具都没包它 → mcp.log 从不生成(可观测性静默缺失,无任何症状)。已修: 统一经 tool() 注册,内部总是包 withTrace,遗漏不再可能; 新增 2 测试 + revert-check  【落地】 (完成 2026-09-10)
- [x] MCP-SMOKE-TEST — 验证 MCP 写通道（走 abs_abs_task 的 add action）  【落地】 (完成 2026-09-10)
- [x] FIX-SILENT-NOOP — 已修: abs todo 统一读写(add/start/note/blocked/done), 旧 task/board 报错提示, 只读命令拒绝多余参数, wrapup/teardown-check 移出 help。同步改 skill/README/MCP + 9 处代码内旧命令名  【落地】 (完成 2026-09-10)
- [x] DAEMON-IPC — 方案A: CLI/MCP 共用常驻 daemon (Unix socket), 消除 22ms node 启动开销 + 统一锁. 要点: ①daemon 自拉起+心跳 ②CLI 连不上时退化本地直读(安全网,必须可测) ③ABS_NO_DAEMON=1 开关 ④MCP server 也走同一 daemon 保证一致. 实测依据: 独立起进程 28.8ms vs 单进程内 0.2ms, 进程启动占99%  【否决】 (完成 2026-09-10)
  ↳ 断点: 已撤销(方案A被否)。实现并跑通后实测收益仅 27→22ms: node启动20ms逃不掉(CLI必然起进程), daemon只省了读写的5ms。决定不加常驻进程, 改走规则约束(写操作只走MCP, ~2ms)。决策依据已留档概念页 perf-fixed-overhead 避免重提。3个新文件已删, bin/abs.js 已还原, 164测试绿
- [x] ID-SUBSTRING-MATCH — 任务 id 用 includes() 子串匹配定位 → 前缀相同的 id 互相覆盖, 静默丢任务。复现(零并发): 先 task start T11, 再 task start T1 → T11 被 T1 原地改写并消失, 只剩 1 条。三处同源: src/todo.js:219(upsertTask, 会静默改写已有任务+新任务不出现), src/todo.js:250(findTaskLine), src/store.js:325(markDone, 会误标完成别的任务)。改法: 按行首标识符精确比对(取 '- [ ] <id>' 后的 id token 做 ===), 不用 includes。影响: T-1/T-10、ABS-1/ABS-10、fix-hook/fix-hook-2 等任何前缀相同命名  【落地】 (完成 2026-09-10)
  ↳ 断点: 已修(src/todo.js findTaskLine 全等比对 + 新增 idOfTaskLine; store.js markDone 同改)。原复现: 先 T11 再 T1 → 修前只剩1条, 修后两条都在。新增3个回归测试 + revert-check(旧代码3例全失败)。顺带修掉 TASK-SKILL-V2: 的尾部冒号脏 id
- [x] OC-REAL-VERIFY — opencode 真机验证: 通道修完后真会话要看到 teardown-nudge 痕(当前 session.idle:seen 有痕但零 nudge)  【落地】 (完成 2026-09-10)
  ↳ 断点: 依赖已解除: OC-INJECT-CHANNEL 判定=通道本就正常(promptAsync 真能唤醒 idle session), 无需改 src/install.js. 真机已直接看到 teardown-nudge 痕(14:58:36)+注入的 [abs 收尾提醒] 作为 user 消息落地+新 assistant turn 回应. 真机验证的失败条件修正为: 需满足 abs 插件 gate(wroteFiles=true 即本会话真调过 write/edit 工具 + brain 存在 + log.md 今日无记录), 纯文本 turn 不会触发 nudge(设计如此). 可解除 Blocked, 转 Today.
- [x] CC-CODEX-PUSH — CC/Codex 补主动推: Stop hook 回 decision:block 注入收尾指令(守卫抄 pi 插件四条件)，替代只写 wrapup.log  【落地】 (完成 2026-09-10)
  ↳ 断点: 已实现(6b3466f): Stop hook 回 stdout {"decision":"block","reason":<收尾指令>} 把 agent 拉回一轮; 判定收进新命令 abs teardown-check(守卫同 pi 四条件, 异常一律放行 {}); 坏 payload 不阻塞。真机冒烟: Stop 输出合法 JSON + 四守卫逐个拦截验证通过。注意: 全局安装的 abs 是独立副本(1.1.0), 仓库新命令需重新安装才在真会话生效
- [x] OC-INJECT-CHANNEL — opencode 注入通道修复: promptAsync 是 fire-and-forget(204 void)，对终结态 idle session 只入队不重启 turn → 改 src/install.js opencodePluginSource() 用 session.command(同步200) 或把注入点提前到 turn 内(tool.execute.after/message.updated)  【落地】 (完成 2026-09-10)
  ↳ 断点: 判定完成: 结论表=prompt_async/HTTP204/唤醒✓ (2s内新assistant, 真机插件注入 [abs收尾提醒] 作为user消息落地后新turn回应) ; session.prompt/HTTP200/唤醒✓ (同步返回assistant body finish=stop) ; session.command/HTTP200/唤醒✓ ; tui.append-prompt & tui.execute-command/HTTP200 body=true/唤醒✗(无TUI挂载,只入buffer). 真因澄清: 旧测零nudge不是通道故障, 是 wroteFiles gate(纯文本turn不触发write工具); gate满足后真机落痕 teardown-nudge 14:58:36 且注入生效. 建议: 保持 idle 注入点即可, promptAsync 无需改; 若要去掉 fire-and-forget 的不确定性可换 session.prompt(同步可拿到结果/错误). 第四候选(挪到 turn 内 tool.execute.after) 实测也可唤醒(注入while busy会排队为下一turn), 但非必要.
- [x] SMALL-FIXES — 小件: loggedToday 守卫收紧、日志轮转、测试计数 146→实测 144 对平  【落地】 (完成 2026-09-10)
  ↳ 断点: loggedToday 守卫已收紧(10b64de): 裸日期 substring includes() → 正则匹配 log.md 条目头 '## [YYYY-MM-DD HH:MM]'。发现 install.js 双层转义坑(生成代码外层模板 vs 真实 TS), 两处分别验证生成产物正则 source 正确。新回归测试 + revert-check(旧守卫注入0次/新守卫1次), 149 测试全绿。剩: 日志轮转未做(低优先, hooks.log 增长无上限)
- [x] GIT-WRAPUP — git 收尾: 25 文件未提交(今天整个 session log、teardown-automation + host-plugin-silent-failure 概念页、7 个 source 删除)  【落地】 (完成 2026-09-10)
  ↳ 断点: 已提交 2 个 commit: 1f45bf0(代码: abs update/--version + seen 痕 + plugin-behavior.test.js + .gitignore 忽略 .omo/) 和 60bebde(.brain: 2 个新概念页 + 归档 7 源页 + todo 登记)。工作树干净, 测试 148 全绿, lint 0 problem
- [x] VERSION-ALIGN — 版本对齐: 本地 package.json 0.3.0 vs npm 已发布 1.1.0  【落地】 (完成 2026-09-10)
  ↳ 断点: 误判澄清: 本地 package.json 已是 1.1.0 且与 package-lock 一致; npm view @fanchao8609/agent_brain_sync version = 1.1.0 已发布对齐。0.3.0 是旧会话残留读数。npm 直连失败仅因代理 192.168.0.114:7890 未启动, 非版本问题
- [x] ABS-UPDATE-CMD — 补 abs update + abs --version: 用户报'abs update 看不到新版本'实为命令不存在  【落地】 (完成 2026-09-10)
- [x] REALTIME-HOST-VERIFY — 真机验证: pi 会话首次触发 agent_end→seen→nudge 完整链路(11:43:23)  【落地】 (完成 2026-09-10)
- [x] SEEN-TRACE-CWD — seen 痕补记 cwd+brain, 使 nudge 异常可事后解释(曾出现 nudge 但 log.md 有今天, 无法归因)  【落地】 (完成 2026-09-10)
- [x] PLUGIN-SEEN-TRACE — 补 seen 痕可观测性: 首次 agent_end/session.idle 无条件留痕, 否则分不清'事件没触发'与'被守卫拦下'  【落地】 (完成 2026-09-10)
- [x] PLUGIN-BEHAVIOR-TEST — 补插件行为级测试(非字符串断言): 真 import 生成产物 + 驱动真实事件 + 断言日志落痕; 含 ZWSP 守卫  【落地】 (完成 2026-09-10)
- [x] OPENCODE-EXPORT-FIX — op​encode 插件用命名导出(export const)但加载器取 default → 插件被忽略, 改 export default {id, server}  【落地】 (完成 2026-09-10)
- [x] OPENCODE-TEARDOWN — op​encode 补收尾自动化: session.idle + promptAsync 注入(与 pi agent_end 同策略)  【落地】 (完成 2026-09-10)
- [x] OPENCODE-HOOK-DEAD — op​encode 插件 event 回调签名错({name}→{event})+事件名错(session.start→session.created/idle): 插件从未触发过  【落地】 (完成 2026-09-10)
- [x] TEARDOWN-AUTO — 收尾自动化: pi 扩展 agent_end 注入收尾指令(被动记日志→主动推)  【落地】 (完成 2026-09-10)
- [x] CO​DEX-HOOKS-FIX — 修 Co​dex hooks.json 形态错写导致安装崩溃(对象 vs 扁平数组)  【落地】 (完成 2026-09-10)

### 归档
- [[2026-09-08-todo归档]] 完成任务 22 条
- [[2026-09-09-todo归档]] 完成任务 6 条
