# 📋 Todo Board

## Todo
- [ ] [进行中] flaky-rules-injection [[fanchao]] — 查清 plugin-behavior「★ 只首轮送一次」在并发负载下低频偶发失败：单跑 5+12 次、6 进程并发 24 次、定向压测 300 次均不复现；已确认是已有 load 注入逻辑，非本次 sid 改动。缺口：未抓到断言细节（不知是首轮≠1 还是二次≠0） (认领 2026-10-09)

## Done

### 2026-10-09
- [x] release-session-sid [[fanchao]] — 发版：提交推送（项目整理 + 会话 sid 功能）→ npm version → publish → 本地重装验证 — 1.17.0 已发布：直查 registry 确认收录（latest→1.17.0）。推送 be4b7d8..65b0c31（pre-push 576 全过）；本地全局软链读 1.17.0 + 插件已重装；冒烟实测带 session 登记/看板归属/done 双 sid 均正常 【落地】 (完成 2026-10-09)
- [x] verify-live-sid [[fanchao]] — 验证 hook 注入的 sid 真能被用上 — 重启后实测：hook 注入生效（日志 session_guide=on sid=01a11ea9-8a37-74）；但查出真缺口——看板解析把整个 (认领 …) 剥掉，sid 到不了 LLM。已修：Row 加 sid 字段 + 看板标 [本会话]/[会话 xxx]。途中又抓到正则宽松导致公海任务被误标 [会话 日期]，也修了并做破坏验证。576 测试全过 【落地】 (完成 2026-10-09 01a11ea9-8a37-74)
  ↳ 断点: 查出真缺口：看板解析把 (认领 …) 整段剥掉了，sid 到不了 LLM。Row 类型里没 sid 字段，需补
- [x] other-session-task [[fanchao]] — B 会话在做的事 — 测试造的数据，清掉 【否决】 (完成 2026-10-09 01a11f2a)
- [x] test-todo-owner [[fanchao]] — 测试：生成一个 todo，验证看板能识别归属 — 测试通过：abs_task 带 session=01a11fc2-769e-72 写入后，todo 行尾记成 (认领 2026-10-09 01a11fc2-769e-72)，sid 可读可比对。据此能区分这条属于本会话、另两条 (01a11ea9-8a37-74 / 01a11f2a) 属于其他会话 【落地】 (完成 2026-10-09 01a11fc2-769e-72)
- [x] reinstall-pi-plugin [[fanchao]] — 重装 pi 插件让会话 sid 功能生效：已装插件是拷贝的旧版（10-07），缺 injectSessionGuideline 与看板正则修正 — 重装 pi 插件生效：查出三层里只 hook 层断（插件是拷贝不是软链）。重装后实测三项通过：已装插件能加载 + injectSessionGuideline 注入含 sid + 看板正则已改通配。CLI/MCP 层本就走全局软链早已生效。574 测试全过 【落地】 (完成 2026-10-09)
- [x] session-scoped-tasks [[fanchao]] — 多会话并发时任务串了：两个 pi/opencode 读同一份 .brain/todo.md，A 在做的任务 B 也会拿来执行。要区分「谁在做什么 / 哪些是自己的 / 哪些进行中 / 哪些等执行」 — todo 行标会话 id 落地：复用了已有的 (认领 日期) 字段塞 sid（不新增字段）→ 归档整行搬运自动跟着走。CLI --session + MCP abs_task session 双通路（LLM 平时走 MCP，prompt 注入 [会话] 段让它自己填）。认领≠完成时两个 sid 都留。574 测试全过、eslint 0、图谱健康；破坏验证两处变红。其他文档未标 sid（用户拍定只做 todo） 【落地】 (完成 2026-10-09)
  ↳ 断点: docs/plans/20261009-session-scoped-tasks.md：认领≠完成已处理（两个 sid 都留）。遗留：其他文档标 sid、opencode 侧未验
- [x] project-cleanup [[fanchao]] — 全项目结构化+工程化整理：目录结构、死代码（无引用函数/方法/文件）、无用文件清理、知识沉淀归位。先出体检报告再动手 — 全项目整理落地：删 12 处真死代码；src/todo.js 1305行→6模块（55导出零丢失、无环、barrel保留）；ESLint 75问题→0；加 CI（node18/22）。验证：556测试全过 + 语法/eslint 全绿 + 图谱lint 0 + 打包产物空项目实跑 init/todo/lint/load 全正常。方案 docs/plans/20261009-project-cleanup.md，经验落 .brain/concepts/dead-code-vs-over-export.md 【落地】 (完成 2026-10-09)
  ↳ 断点: docs/plans/20261009-project-cleanup.md：一二阶段已完并过测（556/0，55 导出零丢失，无环）；下一步 ESLint+Prettier + CI

### 2026-10-07
- [x] fix-no-todo-flag [[fanchao]] — pre-commit 注释/提示说可加 --no-todo，但代码只认 ABS_NO_TODO 环境变量，用户照提示敲 git commit --no-todo 会失败。文档与实现必须一致 — pre-commit 逃生口对齐（--no-todo 根本做不到，git 先拒；改为说明只能走 ABS_NO_TODO）+ 查出并修复 pi 侧 hooks.log 无轮转（1.22MB）+ 并发竞态吞旧日志。556 测试全过，破坏验证过，已重装并真实验证轮转生效，已推送 be4b7d8 【落地】 (完成 2026-10-07)
- [x] release-1-16-4 [[fanchao]] — 发版：提交两批修复（pre-push 门禁 + load 性能）→ 推送 → npm version → publish → 本地重装验证。发布前过全量测试 + npm pack 解包直跑关键路径 — 1.16.4 已发布：两 commit（pre-push 门禁 + load 性能）已推送(f2cccc2)，registry 确认收录，产物冒烟全过。本机保持 npm link 未动 【落地】 (完成 2026-10-07)
- [x] investigate-abs-lag [[fanchao]] — 排查：改了 .brain/todo.md 之后 pi 运行卡顿。只查不动代码，找根因+证据 — 根因定位：queryHint→topicStrength 每个词×每页重算整页 n-gram（17词×63页=156ms，CPU profile 占 load 82%）。已加页 gram 两级缓存：同规模 156→23ms，load 端到端 191→80ms。23 个 relevant 测试全绿，3 种破坏全被抓，全量 552 通过 【落地】 (完成 2026-10-07)
- [x] bench-probe-2 [[fanchao]] — bench — bench cleanup 【仅方案】 (完成 2026-10-07)
- [x] bench-probe-tmp [[fanchao]] — bench — bench cleanup 【仅方案】 (完成 2026-10-07)
- [x] fix-pre-push-gate [[fanchao]] — pre-push 门禁静默失效：npm test | tail -20 管道取了 tail 的退出码，测试失败也放行。改为不接管道，并补测试守住 — pre-push 管道吞退出码已修（改临时文件取码）；新增 test/hooks-gate.test.js 直接跑真实脚本断言拦截，破坏验证过（注入原 bug→2 红，还原→4 绿）；全量 549 通过 【落地】 (完成 2026-10-07)
- [x] audit-project-health [[fanchao]] — 全项目代码审查：结构、测试、实现完整度、文档一致性 — 审查出 1 个严重 bug（pre-push 门禁静默失效，测试失败也放行）+ 2 个次要项（--no-todo 未实现、check-syntax 降级路径没写）；545 测试全通过、lint 健康、打包正常 【落地】 (完成 2026-10-07)

### Archived
- [[log-2026-10-06]] 完成任务 9 条
- [[log-2026-10-05]] 完成任务 35 条
- [[log-2026-10-03]] 完成任务 7 条
- [[log-2026-09-18]] 完成任务 2 条
- [[log-2026-09-17]] 完成任务 8 条
- [[log-2026-09-16]] 完成任务 14 条
- [[log-2026-09-15]] 完成任务 11 条
- [[log-2026-09-13]] 完成任务 5 条
- [[2026-09-12-todo归档]] 完成任务 13 条
