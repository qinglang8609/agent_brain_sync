# 📋 Todo Board

## Todo
- [ ] [进行中] db-search-no-rules-mcp [[fanchao]] — db search 加 --no-rules，并发到 MCP 暴露 abs_search (认领 2026-11-05 01a1a9c6-6907-71)

## Done

### 2026-11-05
- [x] audit-fixes [[fanchao]] — 修审查发现：ingest md5 空串、capture L5 产出坏页、L7 死代码、两 hook 重复函数 — 修 md5 空串/L5 坏页/L7 死代码；hook 公共模块方案经核实会崩（单文件安装）已撤回；765 全绿 【落地】 (完成 2026-11-05 01a1a9c6-6907-71)
- [x] load-unfilled-session-pages [[fanchao]] — abs load 顶部加「未填会话页」段（只数条数+页名），并真机验证 hook 接线 — load 顶部加未填会话页段（只数条数+页名）；真机验证查出 hook 指向全局包缺 ingest，重装后端到端跑通 【落地】 (完成 2026-11-05 01a1a9c6-6907-71)
- [x] trim-abs-commands [[fanchao]] — 精简：capture --layer 7 改拒、MCP 删 abs_board 与 abs_wrapup — capture --layer 7 改拒指向 note；MCP 删 abs_board/abs_wrapup（13→11，握手验证）；758 全绿 【落地】 (完成 2026-11-05 01a1a9c6-6907-71)
- [x] ingest-auto-trigger [[fanchao]] — 把 ingest 接到 session_shutdown 机械触发（--last --auto），不往对话插话 — ingest 接进 session_shutdown（--last --auto），机械触发不靠 LLM 想起来；758 测试全绿 【落地】 (完成 2026-11-05 01a1a9c6-6907-71)
- [x] optimize-session-summary [[fanchao]] — 调研现有会话总结提炼实现与 7 层思考机制，再做优化 — abs ingest 落地：会话落成结构化页（技术/业务/讨论三种形状，按改过文件机械判），frontmatter 记 session-id 双向回溯；会话页检索亮度乘 0.5；lint NO-TAIL 按 kind 分档。753 测试全绿 【落地】 (完成 2026-11-05 01a1a9c6-6907-71)

### 2026-11-04
- [x] panel-demo [[fanchao]] — 看面板渲染效果用，看完删 — 看面板渲染效果，看完删除 【落地】 (完成 2026-11-04 01a1a566-2588-75)
- [x] todo-panel-title-icon [[fanchao]] — todo 面板标题的 📋 换成新图标 【落地】 (完成 2026-11-04 01a1a566-2588-75)
- [x] pi-editor-polish-3 [[fanchao]] — 输入框三改：working 改为框上单个运行图标；去左右边距；右侧显示模型名 【落地】 (完成 2026-11-04 01a1a566-2588-75)
- [x] pi-inputbox-rounded-border [[fanchao]] — pi 输入框改成左右两侧都有边线 + 圆角 【落地】 (完成 2026-11-04 01a1a566-2588-75)
- [x] pi-todo-panel-border [[fanchao]] — 去掉 pi todo 面板上边框（两副本同步） 【落地】 (完成 2026-11-04 01a1a566-2588-75)

### 2026-11-03
- [x] query-flow-draft-filter [[fanchao]] — 修 query 流水页降权力度不足 + 补 draft 草稿过滤，对齐 db search 【落地】 (完成 2026-11-03 01a19be2-af1d-76)
- [x] review-fix-p1 [[fanchao]] — 全项目审查后修复 4 个 P1 缺陷 【落地】 (完成 2026-11-03 01a19be2-af1d-76)
- [x] abs-recall-command [[fanchao]] — 新增 abs recall：卡住时按处境主动取相关页 【落地】 (完成 2026-11-03 01a19be2-af1d-76)
- [x] query-flow-page-downrank [[fanchao]] — 检索结果里给 sessions/log-* 与 sources/ 降权，不让流水页压过内容页 【落地】 (完成 2026-11-03 01a19be2-af1d-76)

### Archived
- [[log-2026-11-02]] 完成任务 9 条
- [[log-2026-11-01]] 完成任务 11 条
- [[log-2026-10-22]] 完成任务 4 条
- [[log-2026-10-20]] 完成任务 1 条
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
