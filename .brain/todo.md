# 📋 Todo Board
## Todo
- [ ] [进行中] verify-todo-guide [[fanchao]] — 验证 promptGuidelines 能否治 todo 不及时: 装扩展加静态 system prompt 指引(非插话), 重启后看 hooks.log 有无 before_agent_start todo_guide=on, 再观察动手前是否主动 abs_task start (认领 2026-10-03)
  ↳ 断点: hooks/abs.pi.ts: before_agent_start handler 已生效(hooks.log 实测 todo_guide=on), 判定条件改为 hasBrain(ctx.cwd) 查 .brain 目录
- [ ] [进行中] prompt-guidelines-todo [[fanchao]] — 给 abs 的 todo 加 pi 扩展层常驻指引(治不及时): 在 before_agent_start 往 system prompt 的 Guidelines 段注入 3 条静态指引(动手前 start/完成立刻 done/断点及时 note), 判定条件=项目有 .brain/, 关掉用 ABS_TODO_GUIDE=0 (认领 2026-10-03)
## Done
### 2026-10-03

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
