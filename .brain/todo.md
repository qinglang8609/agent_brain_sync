# 📋 Todo Board

## Todo

## Done

### 2026-10-22
- [x] fix-review-3-issues [[fanchao]] — 修审查发现的前三条：fuzz 虚跑的 bp-done、spec.js 重复注释、pi hook 临时取证日志 — fuzz 改名 child-done/undone（原 bp-done 已不存在，跨界线全空转）；删 spec.js 重复注释；删 pi hook 临时取证日志。654 测试过，fuzz 200 轮过，子项边界命令行实测有正确报错。 【落地】 (完成 2026-10-22 01a1624d-b32d-71)
- [x] review-agent-brain-sync [[fanchao]] — 审查 agent_brain_sync 项目本身：代码、结构、测试、文档一致性 — 审查完成：5 处问题已报，前三条开始修 【落地】 (完成 2026-10-22 01a1624d-b32d-71)
  - [x] 已跑 check/lint/test/fuzz/pack；发现 5 处问题（fuzz 虚跑、spec 重复注释、临时取证日志、双 hook 重复、死代码注释）
- [x] abs-hard-rule-slim [[fanchao]] — 把文档精简 9 条固定进 abs：生成 todo/知识库文档时强制遵守 — 文档精简 9 条已写进 SKILL.md「文档精简」硬规则节，并成为 pi/omp hook 的常驻指引第 7 条；v1.20.1 已重装四处宿主，654 项测试全过。 【落地】 (完成 2026-10-22 01a1624d-b32d-71)
  - [x] 锚点已查：SKILL.md 两处渲染（写、更新）＋ hooks/abs.pi.ts 常驻 TODO_GUIDELINES
- [x] slim-skills [[fanchao]] — 按文档精简 9 条规则精简技能 SKILL.md — 精简 abs SKILL.md 183→174 行（去掉重复段落、唠叨的禁令理由、错乱编号），并修正一处与代码相反的说明（note 实为追加式，原文写覆盖式）；654 项测试全过，五处宿主已重装同源。 【落地】 (完成 2026-10-22 01a1624d-b32d-71)
  - [x] 范围定案：只精简 abs 主技能 SKILL.md；改包内源 → abs install → 清 ~/.agents 过期副本

### 2026-10-20
- [x] remove-legacy-child-syntax [[fanchao]] — 彻底移除旧箭头子项写法及相关命令，统一到标准 md 嵌套列表 — 旧箭头写法全删；存量由 migrateLegacyChild 自动迁移（实测三种变体零丢失）；命令改名为 child-done/child-undone 【落地】 (完成 2026-10-20 01a15394-cd03-70)

### Archived
- [[log-2026-10-18]] 完成任务 10 条
- [[log-2026-10-16]] 完成任务 3 条
- [[log-2026-10-11]] 完成任务 2 条
- [[log-2026-10-09]] 完成任务 12 条
- [[log-2026-10-07]] 完成任务 7 条
- [[log-2026-10-06]] 完成任务 9 条
- [[log-2026-10-05]] 完成任务 35 条
- [[log-2026-10-03]] 完成任务 7 条
- [[log-2026-09-18]] 完成任务 2 条
- [[log-2026-09-17]] 完成任务 8 条
- [[log-2026-09-16]] 完成任务 14 条
- [[log-2026-09-15]] 完成任务 11 条
- [[log-2026-09-13]] 完成任务 5 条
- [[2026-09-12-todo归档]] 完成任务 13 条
