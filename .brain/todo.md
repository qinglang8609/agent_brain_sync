# 📋 Todo 看板
## Backlog
## Today / In Progress
## Blocked
## Done（只留近期，旧的迁 log.md/快照）
### 2026-09-10

- [x] TODO-ARCHIVE-CMD — Done 区归档做成真流程: ①只保留近3天(可配) ②任一天内有未完成(- [ ])则整天不归档 ③归档为单个文件+在 todo 的 ### 归档 段留 [[<slug>]] 完成任务 N 条。含定时/触发规划 + lint 兜底  (完成 2026-09-10)
- [x] MCP-PATH-UNSTABLE — 四宿主 abs MCP 注册路径不一致: codex 指向仓库(/Users/fanchao/Code/skills/.../bin/mcp.js), CC/opencode/pi 指向全局(lib/node_modules/...)。根因两处: ①install.js 三处都用 join(ABS_DIR,'bin','mcp.js'), 而 ABS_DIR 取决于'install.js 自己住哪' —— 从仓库跑 abs install 就写仓库路径 ②codex 分支 if(!text.includes('[mcp_servers.abs]')) 才写, 已存在即跳过 → 一旦写错永不修正。危害: 改了仓库但没装全局时, 真机跑的可能是另一份; 卸载全局后路径直接失效。修法: 路径应固定为该包的稳定安装位置(优先全局), 且已存在时也应更新为当前正确路径  (完成 2026-09-10)
  ↳ 断点: 已修: install.js 新增 mcpEntryPath() 优先解析全局 node_modules 位置, 取不到才回退 ABS_DIR; codex 分支由"已存在即跳过"改为"校对并校正路径"。真实配置已校正(四宿主现一致指向全局)。新增 2 测试 + revert-check(首版测试太弱抓不到, 改为断言"存在全局包时必须写全局路径"后通过)
- [x] MCP-LIVE-VERIFY — 重启后 MCP 写通道 + mcp.log 双验证  (完成 2026-09-10)
- [x] MCP-TRACE-DEAD — withTrace 定义了但 9 处工具都没包它 → mcp.log 从不生成(可观测性静默缺失,无任何症状)。已修: 统一经 tool() 注册,内部总是包 withTrace,遗漏不再可能; 新增 2 测试 + revert-check  (完成 2026-09-10)
- [x] MCP-SMOKE-TEST — 验证 MCP 写通道（走 abs_abs_task 的 add action）  (完成 2026-09-10)
- [x] FIX-SILENT-NOOP — 已修: abs todo 统一读写(add/start/note/blocked/done), 旧 task/board 报错提示, 只读命令拒绝多余参数, wrapup/teardown-check 移出 help。同步改 skill/README/MCP + 9 处代码内旧命令名  (完成 2026-09-10)
- [x] DAEMON-IPC — 方案A: CLI/MCP 共用常驻 daemon (Unix socket), 消除 22ms node 启动开销 + 统一锁. 要点: ①daemon 自拉起+心跳 ②CLI 连不上时退化本地直读(安全网,必须可测) ③ABS_NO_DAEMON=1 开关 ④MCP server 也走同一 daemon 保证一致. 实测依据: 独立起进程 28.8ms vs 单进程内 0.2ms, 进程启动占99%  (完成 2026-09-10)
  ↳ 断点: 已撤销(方案A被否)。实现并跑通后实测收益仅 27→22ms: node启动20ms逃不掉(CLI必然起进程), daemon只省了读写的5ms。决定不加常驻进程, 改走规则约束(写操作只走MCP, ~2ms)。决策依据已留档概念页 perf-fixed-overhead 避免重提。3个新文件已删, bin/abs.js 已还原, 164测试绿
- [x] ID-SUBSTRING-MATCH — 任务 id 用 includes() 子串匹配定位 → 前缀相同的 id 互相覆盖, 静默丢任务。复现(零并发): 先 task start T11, 再 task start T1 → T11 被 T1 原地改写并消失, 只剩 1 条。三处同源: src/todo.js:219(upsertTask, 会静默改写已有任务+新任务不出现), src/todo.js:250(findTaskLine), src/store.js:325(markDone, 会误标完成别的任务)。改法: 按行首标识符精确比对(取 '- [ ] <id>' 后的 id token 做 ===), 不用 includes。影响: T-1/T-10、ABS-1/ABS-10、fix-hook/fix-hook-2 等任何前缀相同命名  (完成 2026-09-10)
  ↳ 断点: 已修(src/todo.js findTaskLine 全等比对 + 新增 idOfTaskLine; store.js markDone 同改)。原复现: 先 T11 再 T1 → 修前只剩1条, 修后两条都在。新增3个回归测试 + revert-check(旧代码3例全失败)。顺带修掉 TASK-SKILL-V2: 的尾部冒号脏 id
- [x] OC-REAL-VERIFY — opencode 真机验证: 通道修完后真会话要看到 teardown-nudge 痕(当前 session.idle:seen 有痕但零 nudge)  (完成 2026-09-10)
  ↳ 断点: 依赖已解除: OC-INJECT-CHANNEL 判定=通道本就正常(promptAsync 真能唤醒 idle session), 无需改 src/install.js. 真机已直接看到 teardown-nudge 痕(14:58:36)+注入的 [abs 收尾提醒] 作为 user 消息落地+新 assistant turn 回应. 真机验证的失败条件修正为: 需满足 abs 插件 gate(wroteFiles=true 即本会话真调过 write/edit 工具 + brain 存在 + log.md 今日无记录), 纯文本 turn 不会触发 nudge(设计如此). 可解除 Blocked, 转 Today.
- [x] CC-CODEX-PUSH — CC/Codex 补主动推: Stop hook 回 decision:block 注入收尾指令(守卫抄 pi 插件四条件)，替代只写 wrapup.log  (完成 2026-09-10)
  ↳ 断点: 已实现(6b3466f): Stop hook 回 stdout {"decision":"block","reason":<收尾指令>} 把 agent 拉回一轮; 判定收进新命令 abs teardown-check(守卫同 pi 四条件, 异常一律放行 {}); 坏 payload 不阻塞。真机冒烟: Stop 输出合法 JSON + 四守卫逐个拦截验证通过。注意: 全局安装的 abs 是独立副本(1.1.0), 仓库新命令需重新安装才在真会话生效
- [x] OC-INJECT-CHANNEL — opencode 注入通道修复: promptAsync 是 fire-and-forget(204 void)，对终结态 idle session 只入队不重启 turn → 改 src/install.js opencodePluginSource() 用 session.command(同步200) 或把注入点提前到 turn 内(tool.execute.after/message.updated)  (完成 2026-09-10)
  ↳ 断点: 判定完成: 结论表=prompt_async/HTTP204/唤醒✓ (2s内新assistant, 真机插件注入 [abs收尾提醒] 作为user消息落地后新turn回应) ; session.prompt/HTTP200/唤醒✓ (同步返回assistant body finish=stop) ; session.command/HTTP200/唤醒✓ ; tui.append-prompt & tui.execute-command/HTTP200 body=true/唤醒✗(无TUI挂载,只入buffer). 真因澄清: 旧测零nudge不是通道故障, 是 wroteFiles gate(纯文本turn不触发write工具); gate满足后真机落痕 teardown-nudge 14:58:36 且注入生效. 建议: 保持 idle 注入点即可, promptAsync 无需改; 若要去掉 fire-and-forget 的不确定性可换 session.prompt(同步可拿到结果/错误). 第四候选(挪到 turn 内 tool.execute.after) 实测也可唤醒(注入while busy会排队为下一turn), 但非必要.
- [x] SMALL-FIXES — 小件: loggedToday 守卫收紧、日志轮转、测试计数 146→实测 144 对平  (完成 2026-09-10)
  ↳ 断点: loggedToday 守卫已收紧(10b64de): 裸日期 substring includes() → 正则匹配 log.md 条目头 '## [YYYY-MM-DD HH:MM]'。发现 install.js 双层转义坑(生成代码外层模板 vs 真实 TS), 两处分别验证生成产物正则 source 正确。新回归测试 + revert-check(旧守卫注入0次/新守卫1次), 149 测试全绿。剩: 日志轮转未做(低优先, hooks.log 增长无上限)
- [x] GIT-WRAPUP — git 收尾: 25 文件未提交(今天整个 session log、teardown-automation + host-plugin-silent-failure 概念页、7 个 source 删除)  (完成 2026-09-10)
  ↳ 断点: 已提交 2 个 commit: 1f45bf0(代码: abs update/--version + seen 痕 + plugin-behavior.test.js + .gitignore 忽略 .omo/) 和 60bebde(.brain: 2 个新概念页 + 归档 7 源页 + todo 登记)。工作树干净, 测试 148 全绿, lint 0 problem
- [x] VERSION-ALIGN — 版本对齐: 本地 package.json 0.3.0 vs npm 已发布 1.1.0  (完成 2026-09-10)
  ↳ 断点: 误判澄清: 本地 package.json 已是 1.1.0 且与 package-lock 一致; npm view @fanchao8609/agent_brain_sync version = 1.1.0 已发布对齐。0.3.0 是旧会话残留读数。npm 直连失败仅因代理 192.168.0.114:7890 未启动, 非版本问题
- [x] ABS-UPDATE-CMD — 补 abs update + abs --version: 用户报'abs update 看不到新版本'实为命令不存在  (完成 2026-09-10)
- [x] REALTIME-HOST-VERIFY — 真机验证: pi 会话首次触发 agent_end→seen→nudge 完整链路(11:43:23)  (完成 2026-09-10)
- [x] SEEN-TRACE-CWD — seen 痕补记 cwd+brain, 使 nudge 异常可事后解释(曾出现 nudge 但 log.md 有今天, 无法归因)  (完成 2026-09-10)
- [x] PLUGIN-SEEN-TRACE — 补 seen 痕可观测性: 首次 agent_end/session.idle 无条件留痕, 否则分不清'事件没触发'与'被守卫拦下'  (完成 2026-09-10)
- [x] PLUGIN-BEHAVIOR-TEST — 补插件行为级测试(非字符串断言): 真 import 生成产物 + 驱动真实事件 + 断言日志落痕; 含 ZWSP 守卫  (完成 2026-09-10)
- [x] OPENCODE-EXPORT-FIX — op​encode 插件用命名导出(export const)但加载器取 default → 插件被忽略, 改 export default {id, server}  (完成 2026-09-10)
- [x] OPENCODE-TEARDOWN — op​encode 补收尾自动化: session.idle + promptAsync 注入(与 pi agent_end 同策略)  (完成 2026-09-10)
- [x] OPENCODE-HOOK-DEAD — op​encode 插件 event 回调签名错({name}→{event})+事件名错(session.start→session.created/idle): 插件从未触发过  (完成 2026-09-10)
- [x] TEARDOWN-AUTO — 收尾自动化: pi 扩展 agent_end 注入收尾指令(被动记日志→主动推)  (完成 2026-09-10)
- [x] CO​DEX-HOOKS-FIX — 修 Co​dex hooks.json 形态错写导致安装崩溃(对象 vs 扁平数组)  (完成 2026-09-10)

### 归档
- [[2026-09-10-todo归档]] 完成任务 28 条
