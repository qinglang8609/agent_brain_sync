# 📋 Todo Board

## Todo
- [ ] [进行中] todo-panel-color-by-effort [[fanchao]] — todo 面板文字色 + 输入框文字色跟随推理强度 (认领 2026-11-06 01a1b105-5425-71)

## Done

### 2026-11-06
- [x] release-publish-local [[fanchao]] — 提交未提交改动、推送、npm 发布、本地全局更新 【落地】 (完成 2026-11-06 01a1b105-5425-71)
- [x] command-surface-cleanup [[fanchao]] — 命令面 27→14（保留别名）、SKILL 303→~120 行分层、单一入口表；代码结构不动 — help 按意图分六组；index/log/status→show、db search→search、summon→ingest --list（旧名保留别名）；SKILL 303→107 行，长尾移两页；capture/concept 实测非重复保留。801 全绿 【落地】 (完成 2026-11-06 01a1a9c6-6907-71)

### 2026-11-05
- [x] wrapup-push-release [[fanchao]] — 收尾沉淀 → 推送 git → 发版 1.26.0 → 本地安装验证 — 收尾沉淀+11commit推送（pre-push 796全绿）+npm发布1.26.0（直查registry确认）+本地安装重装hook/skill/MCP+安装版端到端验证全通 【落地】 (完成 2026-11-05 01a1a9c6-6907-71)
- [x] db-search-no-rules-mcp [[fanchao]] — db search 加 --no-rules，并发到 MCP 暴露 abs_search — db search 加 --no-rules（43→22 行）+ MCP 暴露 abs_search（12 工具）；推翻「query/db search 重复」的原判断——实测是详略两档；796 全绿连跑三次 【落地】 (完成 2026-11-05 01a1a9c6-6907-71)
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

### Archived
- [[log-2026-11-03]] 完成任务 4 条
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
