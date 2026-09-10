# 📋 Todo 看板
## Backlog
## Today / In Progress
## Blocked
## Done（只留近期，旧的迁 log.md/快照）
### 2026-09-10

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

### 2026-09-09

- [x] 制作为产品模式，打包成可执行文件安装到系统内，给我一个安装步骤 类似 npm install xxx -g  (完成 2026-09-09)
  ↳ 断点: npm包产品化完成(fc172ba/220a99a): 发布名abs→agent_brain_sync(abs被占用), files白名单13文件30.7kB, prepack chmod, 代理192.168.0.114:7890连通registry. README已写npm install -g agent_brain_sync安装步骤(6ab355a). 已于2026-09-09完成发布
- [x] DONE-GROUP — todo Done 按日期分组(### date,新在前)+老格式惰性迁移兼容  (完成 2026-09-09)
- [x] WRAPUP-A — wrapup 快照(B)+load滞留展示(A)+hook接入+skill开场强制对账  (完成 2026-09-09)
- [x] 更新readme.md  (完成 2026-09-09)
- [x] MD-STANDARD-RW — 统一 .brain 文档读写为单一方法(所有需读写 .brain 文档的地方都走它): 读=readBrain, 写=editBrain 内部自动套 lock 防重复/防并发(继承已做的 lock.js), 调用方不用各自拼 editFile+锁. 各页(todo/log/index/source)统一收口  (完成 2026-09-09)
- [x] TASK-DEEP-TEST — 深度测试四层CLI/install/MCP/hook, 产出可回归单测+真实冒烟  (完成 2026-09-09)
  ↳ 断点: 四层真实冒烟全部完成: CLI/MCP/hook 真机通过; install 层 moshi-hook 共存冲突已解决(INSTALL-COEXIST done, 真实settings 4事件 moshi+abs 共存, 备份~/.claude/settings.json.abs-bak-20260908-232634)。剩收尾: 提炼 concept + 全量测试确认 + 归位

### 2026-09-08

- [x] 本轮反馈处理: log.md只记工作沉淀(去task自动刷+重写) + 时间戳本地化 + codebuddy todo迁移B4 + cmdShow走readTodo触发迁移 (完成 2026-09-08)
- [x] TASK-01 — 修 .gitignore 缺 node_modules（提交前必须）  (完成 2026-09-08)
- [x] TASK-ABS-PI-TEST — 测试 pi opencode 的 abs 功能是否正常、触发是否稳定（MCP 调用链、触发时机）  (完成 2026-09-08)
  ↳ 断点: 全项目写文件审计完成(不止.brain): 分类=①读改写丢失更新(.brain todo/index/log全锁了; install.js的settings/hooks.json readJson→atomicWrite, atomic保证无半写, 且install是离散单用户动作不加锁) ②append日志(hooks.log/wrapup.log/mcp.log)多宿主并发, 实测短行O_APPEND单write原子不撕裂≤200字符行 ③新文件原子写(tmp+rename源页/install全部atomicWrite) ④init/repair仅建缺失文件由requireBrain门控安全。结论:唯一丢失更新类已全锁; append与原子写天然安全不需锁(锁反而拖慢fire-forget热路径)
- [x] INSTALL-COEXIST — installClaudeCode 覆盖式写 settings.hooks[ev] 会顶掉同事件的 moshi-hook 等其它 hook; 改成分区合并追加(去掉旧abs条目幂等 + push新条目, 保留moshi), 沙盒验证后备份应用真实配置  (完成 2026-09-08)
  ↳ 断点: install.js 共存改造完成+4新测试(12/12绿): installClaudeCode 覆盖式→分区合并追加(entryHasAbs去重幂等,保留moshi), uninstallClaudeCode 整删→只删abs条目。剩: 待claude-code-guide确认多hook条目并存官方支持后, 备份并应用真实~/.claude/settings.json
- [x] 每轮结束收尾自动化: Stop hook 读todo→判未登记完成→沉淀经验→更新 index/log/todo  (完成 2026-09-08)
  ↳ 断点: 本会话测试: Stop hook 机械层触发验证通过(hooks.log落痕/stdout {} 合法/非阻塞/60s幂等); v2 skill(收尾循环节)已同步装到 ~/.claude/skills/abs-agent-brain-sync; 收尾循环走通(对账/落log); 剩 agent 收尾循环的自动化触发 + TASK-DEEP-TEST
- [x] TASK-SKILL-V2 以原版完整SKILL为骨架+新增「每轮结束收尾循环」节, 整合abs工具命令, 重写skill/SKILL.md并重装  (完成 2026-09-08)
  ↳ 断点: skill已重写(174行)含图谱定位节/收尾循环, 清了bootstrap等旧方法, 手工/工具边界说清; 剩装到~/.claude/skills + 删旧agent_brain_sync
- [x] TASK-BP-BUG — task note 在目标任务不存在/已完成时, 断点错挂到同区第一条任务下; 应找不到即报错不落盘  (完成 2026-09-08)
- [x] TASK-LINT-SOURCE — abs note 产出的 source 暂存页被判 ORPHAN: lint 应对 sources/ 豁免孤立检查(暂存页天然无链接, 提炼后才挂链)  (完成 2026-09-08)
- [x] TASK-FIX — 测试反馈: hook请求流水移出log.md→技术日志; MCP请求跟踪日志; todo格式归一; task操作自动记log  (完成 2026-09-08)
- [x] TEST-RT — 更新后的note  (完成 2026-09-08)
- [x] TASK-02 — 实现 abs query + abs lint（PLAN D1 验收缺项）  (完成 2026-09-08)
- [x] TASK-03 — task start 幂等（同 id 不重复写行）  (完成 2026-09-08)
- [x] TASK-04 — event.sh shebang #!/bin/sh 但用 bash 语法 ${PAYLOAD:0:120}，dash 下静默失败  (完成 2026-09-08)
- [x] TASK-05 — second  (完成 2026-09-08)
- [x] TASK-D2 — 多项目隔离实测: 两个项目各自 CLI/MCP 读写不串 (PLAN D2 验收)  (完成 2026-09-08)
- [x] TASK-D3 — CC hook端到端: 装机已完(settings.json 4事件+MCP+skill), 验证 hook→log 落盘  (完成 2026-09-08)
- [x] TASK-RT — 实时化: task blocked/note 断点命令 + abs note 经验暂存通道(CLI+MCP+测试)  (完成 2026-09-08)
- [x] TASK-SKILL — 补分工节: hook机械记log + task/note实时落盘 + skill自觉深提炼; 两份SKILL.md同步  (完成 2026-09-08)
- [x] TASK-LOG — 写详细操作日志到 .brain/sessions/ 供用户测试追溯  (完成 2026-09-08)
- [x] TASK-GLOBAL — npm link 全局命令 + 安装形态概念页  (完成 2026-09-08)
- [x] TASK-CLI — board→todo改名 + index/log 查看命令 (log无参看带参写)  (完成 2026-09-08)
- [x] TASK-COMMIT — 整批变更提交 git (分 conventional commits)  (完成 2026-09-08)
