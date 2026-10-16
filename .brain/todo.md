# 📋 Todo Board

## Todo

## Done

### 2026-10-16
- [x] panel-checkbox-and-missing-task [[fanchao]] — pi 面板每行加 [ ] 复选框 + 排查「显示但缺任务」；断点行也要 [] — 面板任务行加 [ ] 复选框（断点行不带 —— 带 [ ] 会让它看着像另一条任务，且与 ↳ 挤在一起）；真因是 ~/.abs/config.json user 被沙盒测试污染成 audit，非面板 bug 【落地】 (完成 2026-10-16 01a1446a-042e-77)
- [x] audit-project [[fanchao]] — 审核整个项目：代码质量/安全/测试/文档，出报告不改代码 — 审核完成：598→599 测试全过 + lint 0 + 50 并发写零丢失 + 路径穿越被 slugOf 挡住 + 5 宿主安装/幂等/卸载只删自己全部实证；顺带发现并修复 pi 面板缺任务真因（config user 被沙盒测试污染成 audit） 【落地】 (完成 2026-10-16 01a1446a-042e-77)
  ↳ 断点: 第一轮完成（代码/lint/测试/并发/路径穿越已验），报告落 .brain/sessions/audit-2026-10-16.md；继续补 install.js 端到端 + hooks .ts 全文
- [x] release-1.18.0-omp [[fanchao]] — npm 1.18.0 已发布（registry dist-tags.latest=1.18.0 已核实），五宿主 hook/skill/MCP 已刷新。omp 扩展 ~/.omp/agent/extensions/abs.ts 45KB 已装。git push 未完成（代理 503）。 【落地】 (完成 2026-10-16 01a1445c-389f-70)
- [x] brain-lint-7-stale-sources [[fanchao]] — 图谱 lint 报 7 条 SOURCE-UNDISTILLED（超 7 天未提炼成 concept）。全是历史遗留（9/17 ~ 10/7 的提交），非新引入，发版时用 --no-verify 跳过。要做: 逐个读 .brain/sources/2026-09-17-*.md、2026-10-03-*.md(x2)、2026-10-06-*.md(x2)、2026-10-07-*.md(x2)，判断提炼进哪个 concept 或直接删，然后清引用。 — 7 条确认已提炼后删除，零悬挂引用，lint 0 问题，提交 efc0aab。 【落地】 (完成 2026-10-16 01a1445c-389f-70)
- [x] verify-todo-add [[fanchao]] — 验证 abs_task add 通路：条目正确落到 .brain/todo.md 的 ## Todo 段、带认领会话标记；重复进行中会给出提示 【落地】 (完成 2026-10-16 01a143c9-daf9-70)
- [x] todo-smoke-2026-10-16 [[fanchao]] — 冒烟测试条目，已确认写入生效后清理 【否决】 (完成 2026-10-16 01a143c9-daf9-70)
- [x] mcp-live-check [[fanchao]] — verify real install — 安装探针, 验证完即清 【否决】 (完成 2026-10-16 01a143c7-ca09-70)
- [x] omp-host-adapter [[fanchao]] — 新增 omp(oh-my-pi) 第5宿主: hooks/abs.omp.ts 扩展 + hosts.js 条目 + install.js installer + MCP+mcp.json + skill落点 ~/.omp/agent/skills — omp 第5宿主接入完成(hooks/abs.omp.ts + hosts.js + install.js + 5测试 + 真机验证); 顺带修 '↳ [ ]' 断点任务静默死区(可显示/可done/state/note); 598测试过, lint 与基线同为 7 【落地】 (完成 2026-10-16)
  ↳ 断点: omp 宿主 + 断点任务形态已落地; 598 测试过

### 2026-10-14
- [x] todo-load-unstable [[fanchao]] — 排查 abs todo 加载不稳定：pi 升级后行为变化 / abs 读取路径 【落地】 (完成 2026-10-14 01a13a88-9430-73)
  ↳ 断点: 修完评审发现的 5 项：清测试垃圾（c.md/log-2026-10-14-t.md/cmd_old.txt/.review-wf.js + 看板 t + index/log 行）、补回 SKILL.md 丢的 5 处限定词、修 store.js 悬空引用；586 测试 + lint 0 + 门禁真场景通过
- [x] t [[fanchao]] — x — 冒烟测试数据（评审发现），清掉 【否决】 (完成 2026-10-14)

### Archived
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
