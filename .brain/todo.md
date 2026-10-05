# 📋 Todo Board

## Todo
- [ ] [讨论中] verify-board-align [[fanchao]] — 验证 hook 每轮把看板摆给 LLM 后，是否真能让登记与干活对齐（本会话实测） (认领 2026-10-05)
  ↳ 断点: 已装到本地+四场景验证通过；待真实使用验证（本会话已漏两次：查 index 未登记、忘了标记本条进展）
- [ ] [进行中] commit-todo-gate [[fanchao]] — pre-commit 里加对比：改了 src/bin/hooks 但没动 todo.md → 要求显式决定 (认领 2026-10-05)
## Done

### 2026-10-05
- [x] rule-preflight [[fanchao]] — 把「动手前先停」三问加进 Rules 第一位，让 abs_load 每次强制读到 — lint 两侧同标准已修（对偶测试+破坏验证），首条 Rule 已上 load。附结论：Rule 文字拦不住 LLM（当晚即被本人违反） 【落地】 (完成 2026-10-05)
  ↳ 断点: 改到 src/lint.js 的 Rules 区检查，加单条 42 字校验；再想拦截机制
- [x] add-test-density [[fanchao]] — 提升测试密度（现 0.92，人家 1.72）：重点补 lint/install/relevant 的边界用例 — 密度 0.93→1.00（529 测试），四文件补到 100% 覆盖。结论：密度指标对我们意义有限，该看函数覆盖率 【落地】 (完成 2026-10-05)
  ↳ 断点: 密度 0.93到0.99
- [x] archive-vs-oversize [[fanchao]] — ROOT-OVER-SIZE(看板>60行) 与 archive『保留近3天』打架：密集工作日 Done 区必超（今天 33 条=58 行），而 archive 拒绝动近 3 天的。改法：超限时允许提前归档（或把 Done 折叠计数做得更早生效） — archive 超限时放宽到含当天（cutoff 推到明天）；修两个调用点漏传 maxLines（真 bug：只写 sessions 不动 todo.md）；补破坏验证过的测试 【落地】 (完成 2026-10-05)

### Archived
- [[log-2026-10-05]] 完成任务 26 条
- [[log-2026-10-03]] 完成任务 7 条
- [[log-2026-09-18]] 完成任务 2 条
- [[log-2026-09-17]] 完成任务 8 条
- [[log-2026-09-16]] 完成任务 14 条
- [[log-2026-09-15]] 完成任务 11 条
- [[log-2026-09-13]] 完成任务 5 条
- [[2026-09-12-todo归档]] 完成任务 13 条

