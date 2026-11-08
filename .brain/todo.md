# 📋 Todo Board

## Todo

## Done

### 2026-11-08
- [x] panel-hierarchy-readability [[fanchao]] — 面板恢复层次：标题/状态亮色，描述/子项灰阶；文字提亮，边框压暗 — 文字提亮/边框压暗/面板恢复层次；821 绿，宿主已同源 【落地】 (完成 2026-11-08 01a1b50b-9994-71)
- [x] slim-skill-load-cmd [[fanchao]] — skill/load/命令 精简 — 四件全落地：英文skill/load 1603B/格式闸/命令折叠；821 绿；全局+pi 已同源 【落地】 (完成 2026-11-08 01a1b50b-9994-71)
  - [x] 四件事：skill 改英文路由风、load 砍到未完成todo+用法+近日志、清废弃代码、命令去重折叠
- [x] abs-sleep-design [[fanchao]] — 设计在 docs/sleep-design.md：补空/压缩阶梯/提炼/墓碑，四条不碰的红线，M1-M4 分期，保留期数字等用户拍板 【仅方案】 (完成 2026-11-08 01a1b50b-9994-71)
- [x] index-session-row-desc [[fanchao]] — 归档 index 行带任务首段描述；本仓库 16 条旧机器行已回填；821 测试 + lint 绿 【落地】 (完成 2026-11-08 01a1b50b-9994-71)

### 2026-11-07
- [x] release-effort-color [[fanchao]] — 1.28.6 已提交+打标+推送+npm publish；全局包与 ~/.pi 宿主副本已更新到新码（--prefer-online 绕过元数据缓存） 【落地】 (完成 2026-11-07 01a1b50b-9994-71)
- [x] release-1.28.5 [[fanchao]] — 提交待提交改动、bump 版本、npm publish、本地安装验证 — 820 测试与 check 全绿；3 个 commit（48aeaee feat、964419d docs、fcfd4fd 1.28.5）推 main 并打 tag v1.28.5；npm publish 1.28.5；本地 npm pack 后 npm i -g 真实安装（95 依赖），abs --version=1.28.5，pi 与 omp 宿主扩展重装且与 repo 副本一致。registry 传播延迟，npm view 此刻仍返回 1.28.4 【落地】 (完成 2026-11-07 01a1b538-e9cd-74)
- [x] pi-reasoning-color-palette [[fanchao]] — 推理色从绿色阶换成用户逐档给的六档灰蓝 hex（max #ACB8CD … minimal #505867）；pi 版注释说色相是用户挑的，换色只许按用户给的值改 — 六档灰蓝色值落在 hooks/abs.pi.ts 与 abs-rounded-editor/format.ts，测试 820 全绿；终端实际观感未在本轮重看 【落地】 (完成 2026-11-07)
- [x] pi-reasoning-color-green [[fanchao]] — 推理色改绿色阶（max 纯绿 00ff00 → minimal 006300 逐档变暗），todo 面板主色元素 + 输入框文字与边框同色；off 保持灰阶；进行中动画换四帧圆圈 ◐◓◑◒（200ms）。821 测试 + check 绿，已装到 ~/.pi。 【落地】 (完成 2026-11-07 01a1b50b-9994-71)
- [x] release-1.28.4 [[fanchao]] — 落库并发布 1.28.4：先跑测试，再 bump、提交推送、npm publish、本地全局安装与 pi 扩展重装 — 测试 817 全绿；提交 2 个 commit 并推 main 与 tag v1.28.4；npm publish 1.28.4；npm i -g 到 1.28.4 并 grep 验证新代码；宿主扩展与 skill 副本一致 【落地】 (完成 2026-11-07 01a1b500-de50-72)
- [x] revert-corner-nickname [[fanchao]] — 去掉输入框左下角 fanchao·昵称，还原到 todo 面板 (认领 2026-11-07 01a1b4e1-7408-74) 【落地】 (完成 2026-11-07 01a1b4f1-5d83-74)
- [x] model-label-refresh [[fanchao]] — 排查：pi 切换模型后输入框上的模型名未及时刷新 — 事件名改对（model_changed→model_select），用户重启后切模型实测正常 【落地】 (完成 2026-11-07 01a1b4e1-7408-74)
  - [x] 根因：pi 事件名是 model_select，扩展监听的 model_changed 不存在；两副本（repo hooks/ 与 ~/.pi/agent/extensions/）都已改。待用户重启 pi 切模型实测
- [x] release-1.28.0 [[fanchao]] — 推送 8 commit、发版 1.28.0、本地全局更新与宿主重装 【落地】 (完成 2026-11-07 01a1b105-5425-71)
- [x] author-in-editor-corner [[fanchao]] — 作者名+昵称放输入框底部左上角 【落地】 (完成 2026-11-07 01a1b105-5425-71)
- [x] hide-empty-panel [[fanchao]] — 无任务时不显示 todo 面板 【落地】 (完成 2026-11-07 01a1b105-5425-71)

### 2026-11-06
- [x] todo-panel-off-gray [[fanchao]] — 推理关闭时 todo 面板改成灰阶 【落地】 (完成 2026-11-06 01a1b105-5425-71)
- [x] todo-panel-color-by-effort [[fanchao]] — todo 面板文字色 + 输入框文字色跟随推理强度 【落地】 (完成 2026-11-06 01a1b105-5425-71)
- [x] release-publish-local [[fanchao]] — 提交未提交改动、推送、npm 发布、本地全局更新 【落地】 (完成 2026-11-06 01a1b105-5425-71)
- [x] command-surface-cleanup [[fanchao]] — 命令面 27→14（保留别名）、SKILL 303→~120 行分层、单一入口表；代码结构不动 — help 按意图分六组；index/log/status→show、db search→search、summon→ingest --list（旧名保留别名）；SKILL 303→107 行，长尾移两页；capture/concept 实测非重复保留。801 全绿 【落地】 (完成 2026-11-06 01a1a9c6-6907-71)

### Archived
- [[log-2026-11-05]] 完成任务 7 条
- [[log-2026-11-04]] 完成任务 5 条
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
