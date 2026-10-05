# 📋 Todo Board

## Todo
## Done

### 2026-10-05
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
