# 📋 Todo Board

## Todo
## Done

### 2026-10-05
- [x] hook-tbd-placeholder [[fanchao]] — 自动登记的名字不可用：机器从用户话里抽词，抽到「我已经重启测试一下」「本轮有改动」这种开场白/系统文本（后者是拿机器自己生成的文本当前缀，更荒唐）。改成 hook 只开 TBD-<会话> 占位，由理解任务的我改名为 fix-xxx 风格 — hook 只开 auto-TBD-<会话> 占位 + 新增 abs todo rename 给占位起真名；不再抽用户话（实报抽出『我已经重启测试一下』开场白、『本轮有改动』hook 自己的文本）。修复过程中单测抓到：改固定占位后丢了「必须有 note」守门，导致纯寒暄也开条目 【落地】 (完成 2026-10-05)
- [x] auto-我已经重启测试一下 [[fanchao]] — 我已经重启测试一下 (自动登记 01a10b96-372d-71) — 实测产物：验证 hook 自动登记已生效 【落地】 (完成 2026-10-05)
  ↳ 断点: 开始改文件
- [x] auto-频繁的意思是我说一句话可 [[fanchao]] — 频繁的意思是我说一句话可 (自动登记 01a10b96-372d-71) — 自动登记未接管，收尾清理 【仅方案】 (完成 2026-10-05)
  ↳ 断点: 本轮有改动
- [x] fix-autotask-timing [[fanchao]] — 自动登记时机太早：一按回车就登记，用户还在说/聊、需求没成型就开出了任务。改法：从 before_agent_start 挪到第一次真改文件时（tool_call 写类工具）。光说/问/讨论都不登记 — 登记时机从 before_agent_start（一按回车）挪到第一次真改文件（tool_call）。光说/问/讨论都不登记；抽不出用户关键词时用断点里的文件名兜底（改 store / 改 abs.pi）。测试 17+10 全绿 【落地】 (完成 2026-10-05)
- [x] auto-先更新本地 [[fanchao]] — 先更新本地 (自动登记 01a10b96-372d-71) — 自动登记未接管，收尾清理 【仅方案】 (完成 2026-10-05)
  ↳ 断点: 本轮有改动
- [x] fix-autotask-id [[fanchao]] — 自动登记两个缺陷: ①疑问句被当任务（'为什么任务是这个啊'被登了）②id 用会话 uuid 人认不出。改法: 疑问句不登记 + id 换成指令关键词, 会话 id 退为隐藏幂等键 — 疑问句过滤 + id 改关键词（会话 id 退为标记里的隐藏幂等键）；sweep 改按标记认领防误杀；测试 +疑问句用例 【落地】 (完成 2026-10-05)
- [x] auto-01a10b96-372d-71 [[fanchao]] — 为什么任务是这个啊 (自动登记待命名) — 设计缺陷产物：疑问句被误登记 + id 用会话 uuid 认不出。已修为疑问句不登记 + id 用关键词 【否决】 (完成 2026-10-05)
- [x] auto-01a10b96-372d-71 [[fanchao]] — 好的发版沉淀 (自动登记待命名) — 自动登记未接管，收尾清理 【仅方案】 (完成 2026-10-05)
- [x] auto-task-register [[fanchao]] — pi 里 todo 总是不自动登记，导致中途换会话断点丢失。现有 promptGuidelines 指引已注入(414次有痕)但行为没变——指引假设 agent 已决定'要开一个任务'，而排查类工作没有清晰起点。改成 hook 自动登记：一会话一条 + 从用户指令抽 id + wrapup 自动收尾，默认开(ABS_AUTO_TASK=0 关) — 自动登记未接管，收尾清理 【仅方案】 (完成 2026-10-05)
- [x] fix-skill-trigger [[fanchao]] — skill 不自动触发: 两个杀手 —— description 是主题描述没写触发词(匹配不上), 且 ~/.agents 陈旧副本被 symlink 绕过 install 管理(读到的永远是旧文件); 另补 SKILL.md 总则的 abs 明确例外 — skill 触发修复完成: description 加触发词 + 总则加 abs 例外, 清除 symlink 指向的陈旧副本, 四宿主落点重装验证均新描述 【落地】 (完成 2026-10-05)
  ↳ 断点: SKILL.md description 加 USE FOR abs 触发词 + 总则加 abs 明确例外; 删 .agents 孤儿副本 + 拆 pi symlink; 四宿主落点重装验证均新描述; lint 0
- [x] fix-opencode-v2-plugin [[fanchao]] — opencode v2 插件契约 {id,server}→{id,setup}: 插件报 'Plugin failed' 加载失败。改 hooks/abs.opencode.ts 模板 + 全局副本 + 宿主落点三处(改一份不算改, install 会覆盖); test 里 v1 契约断言同步迁移 — opencode v2 契约迁移完成: setup(api)+api.event.subscribe, 三处同步改(模板/全局副本/落点), 重启后加载失败 0 条, 448/448 全绿 【落地】 (完成 2026-10-05)
  ↳ 断点: 改了 hooks/abs.opencode.ts + 全局副本 + 宿主落点(三处); test 两文件 v1 断言迁 v2; 验证: 重启后 failed to load 0 条 + 448/448 全绿
- [x] verify-todo-guide [[fanchao]] — 验证 promptGuidelines 能否治 todo 不及时: 装扩展加静态 system prompt 指引(非插话), 重启后看 hooks.log 有无 before_agent_start todo_guide=on, 再观察动手前是否主动 abs_task start — pi 扩展用 before_agent_start 的 promptGuidelines 注入常驻指引（非插话），已装并验证 hooks.log 落痕 【落地】 (完成 2026-10-05)
  ↳ 断点: tool_call 置标记 + tool_execution_end 刷新 验证
- [x] LINT-DEDUP [[fanchao]] — lint 同类问题折叠计数：102 条 LOG-ENTRY(存量旧 log 缺作者) 淹没其它 12 条真问题，体检退化成不可读。改法：lint 输出按问题类型折叠，同类超阈值(如 >10)只报「N 条同类 + 前 3 条样例 + 提示批量查看方式」 — lint 输出按错误码折叠：同类>10 只报前3条+计数，全量留 --all；真机 114行→14行 【落地】 (完成 2026-10-05)
  ↳ 断点: 断点: src/lint.js 的 cmdLint 汇总处(issues 数组拼输出前)；同族约束见 read-side-output-must-not-scale（Done 区已按日期折叠计数，同一思路）。待用户确认是否开工

### 2026-10-03
- [x] prompt-guidelines-todo [[fanchao]] — 给 abs 的 todo 加 pi 扩展层常驻指引(治不及时): 在 before_agent_start 往 system prompt 的 Guidelines 段注入 3 条静态指引(动手前 start/完成立刻 done/断点及时 note), 判定条件=项目有 .brain/, 关掉用 ABS_TODO_GUIDE=0 — 3 条静态指引(动手前 start/完成立刻 done/断点及时 note)经 before_agent_start 注入 system prompt 的 Guidelines 段, 判定条件=项目有 .brain/, ABS_TODO_GUIDE=0 可关。实测 hooks.log: todo_guide=on cwd=<项目>; 破坏验证+7 单测。已随 1.10.1 发版(npm+git tag), 官方包含全部代码 → 之前的『手工补丁』风险已消除。注: 指引的**有效性**另由 verify-todo-guide 观察期判定, 与本条(实现完成)分开 【落地】 (完成 2026-10-03)
  ↳ 断点: ⚠ 本机现处「官方1.9.9 + 手工同步的 hooks/abs.pi.ts」状态: 指引代码不在 npm 包里。验证通过后必须发新版(1.9.10)并 npm install -g 覆盖 + abs install 重装, 否则下次升级/装包会静默丢掉 todo 指引
- [x] anim-demo [[fanchao]] — 看动画用 —— 这条是进行中，面板上它的三点应该在循环闪动 — 三点循环动画已上线并实测可见: [进行中] 行后缀 ○○○→●○○→●●○→●●● 每 250ms 一帧, 只有进行中的行有, 宽度固定 3 列不抖, 无进行中任务时不跑定时器 【落地】 (完成 2026-10-03)
- [x] todo-state-blocked-on-user [[fanchao]] — todo 缺「等外部输入」状态: 现在只有 进行中/讨论中/滞留中, 导致'等用户反馈'的任务与被 agent 干着的任务混在一起(实例: verify-todo-guide 等用户日常观察)。候选: 加 [待确认] 或复用 滞留中+断点说明。不着急改——会干扰 todo 及时性验证的观察期 — 评估后不做: 只是状态标签, 不改任何功能; 且 [滞留中] + 断点说明已能表达'等外部输入'(verify-todo-guide 就是这么用的)。加新状态要改 4 处代码 + 测试, 收益不抵成本。用户 2026-10-03 确认不做 【否决】 (完成 2026-10-03)
- [x] todo-panel [[fanchao]] — pi 编辑器上方显示 .brain/todo.md 未完成任务面板: setWidget(aboveEditor) + session_start/turn_end 刷新, 按当前 user 过滤(含无作者的), 上线 10 行截断 — setWidget(aboveEditor) 显示 .brain/todo.md 未完成项, session_start(startup/reload)+turn_end 刷新, 按当前 user 过滤(含无作者的), 10 行截断 +N more, 无任务/无 .brain 自动隐藏, ABS_TODO_PANEL=0 关。实测用户重启后看到面板(hooks.log: panel drawn reason=reload); 与 rpiv-todo 区别: 不建第二套状态机(数据源在磁盘, 跨会话可续接), 代码 ~50 行 vs ~1800 行 【落地】 (完成 2026-10-03)
- [x] release-1.9.9 [[fanchao]] — 发版 1.9.9: 3 commit + tag, git 与 npm 均发布 — 踩坑: git/npm 配的代理 127.0.0.1:1082 端口没开, 直连反而通; npm 本地缓存 stale 导致 view 连续 6 次报旧版本+404, 差点误判发布失败重发(实际首次已成功)。实机验收: 从 registry 装全新副本, tester/foo 被拒 【落地】 (完成 2026-10-03)
- [x] clean-tester-graph [[fanchao]] — 清理图谱 tester 作者残留: entities/tester.md 删, index 合并, log/sessions/concepts/sources 21 处改回 fanchao — 保留『讲述 tester 故障本身』的正文不动(改掉即篡改证据) 【落地】 (完成 2026-10-03)
- [x] placeholder-author-guard [[fanchao]] — 拒绝占位名作者: setUser 加 PLACEHOLDER_NAMES + assertRealName, load 加 placeholderWarn 警告历史脏配置 — 根因: setUser 只校验字符合法性不校验是不是人 → 一次 config set user tester 因 {user} 是单一全局值污染所有项目。取舍: ABS_USER 环境变量不过校验(测试套件 7 文件靠它)。破坏验证两轮可抓, 394 测试全绿。发 1.9.9, registry shasum 核对一致 【落地】 (完成 2026-10-03)

### Archived
- [[log-2026-09-18]] 完成任务 2 条
- [[log-2026-09-17]] 完成任务 8 条
- [[log-2026-09-16]] 完成任务 14 条
- [[log-2026-09-15]] 完成任务 11 条
- [[log-2026-09-13]] 完成任务 5 条
- [[2026-09-12-todo归档]] 完成任务 13 条
