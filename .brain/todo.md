# 📋 Todo Board

## Todo
- [ ] [进行中] release-131 [[fanchao]] — 发 1.31.0：把子项四态 + 输入框配色改动提交、发版、重装全局与 pi 宿主 (认领 2026-11-09)

## Done

### 2026-11-09
- [x] status-label-hold-orange [[fanchao]] — 输入框右下角状态文字改搁置橙 #F59E0B — 右下角状态文字用 holdAnsi（#F59E0B，256 色退 214）经 roundBorder 的 labelFg 只染那一段；色模式在 session_start 取一次；772+ 测试与 check 绿，副本已同步 【落地】 (完成 2026-11-09)
- [x] panel-task-title-graywhite [[fanchao]] — 任务标题（id+描述）改固定灰白 #E2E8F0 — 任务 id 与描述改固定灰白（原误改的是面板大标题）；档位色只管树线/复选框/子项；772 测试 + check 绿，abs.ts 已同步 【落地】 (完成 2026-11-09)
- [x] panel-title-graywhite [[fanchao]] — 面板标题改固定灰白，不跟档位色 — 标题固定 #E2E8F0 灰白，不跟档位色也不回橙色；772 测试 + check 绿，abs.ts 已同步 【落地】 (完成 2026-11-09)
- [x] panel-text-effort-color [[fanchao]] — 面板文字（标题/树线/id/描述/子项）改用档位色 — 除四个状态标签外，面板文字与树线全走档位色（含已勾子项：只留删除线不再降灰）；C 表删掉 title/tree/done 三项；772 测试 + check 绿，abs.ts 已同步 【落地】 (完成 2026-11-09)
- [x] working-in-border [[fanchao]] — working 状态放回输入框上边框，颜色跟框线一致 — 恢复 embedWorkingStatus: true：working 回到上边框、颜色随整行走框线色（= pi 档位色） 【落地】 (完成 2026-11-09)
- [x] panel-think-colors [[fanchao]] — todo 面板主色改用主题的 thinking 档位色，与输入框一致 — 面板主色改为向主题取 thinking<档位>（与输入框同一来源），off 也用 thinkingOff；删掉面板自配的 EFFORT_COLOR/effortAnsi；补一条接线实测用例；772 测试 + check 绿 【落地】 (完成 2026-11-09)
- [x] align-stock-colors [[fanchao]] — 输入框边框色改用 pi 的 editor.borderColor（七档 thinking），文字不上色 — 边框色改用 pi 给的 editor.borderColor（原版七档 thinking 色，含 off 暗灰）、框内文字不再上色；自配六档灰蓝从输入框停用（format.ts 保留备用）；去掉不再需要的 themeGetter/effortLevel/thinking_level_select 订阅；771 测试 + check 绿 【落地】 (完成 2026-11-09)
- [x] try-stock-editor [[fanchao]] — 临时停用圆角输入框扩展，对照 pi 原版效果，看完恢复 — working 还原为 pi 原版：去掉 embedWorkingStatus（回到 pi 自己的 status 行），leadSpanOf/leadFg/holdAnsi 一并删；扩展已从 disabled-extensions 放回 extensions/；771 测试 + check 绿 【落地】 (完成 2026-11-09 01a1bbd5-b32f-73)
- [x] inputbox-reasoning-color [[fanchao]] — 调整输入框按推理强度变色的配色 — 状态文字去黄、搬右下角；working 段上搁置橙；六档推理色定为偏蓝的灰（暗档提亮版，中性灰那版被用户否掉）；775 测试 + check 绿；~/.pi 三份副本已同步，等 /reload 看效果 【落地】 (完成 2026-11-09 01a1bbd5-b32f-73)
  - [x] 右上角状态文字去掉搁置橙，跟框线同色；删掉 format.ts 的 HOLD_COLOR/holdAnsi 与对应测试；765 测试 + check 绿；已同步 ~/.pi 副本，等用户 /reload 看效果并定推理变色要不要一起改
  - [x] 暗档提亮：medium/low/minimal 三档只提亮度，输入框与 todo 面板两份同时改（明细见 abs log），765 测试+check 绿，已同步 ~/.pi 两份副本，等用户 /reload 看效果
  - [x] 状态文字从右上角搬到右下角；六档改中性灰（去蓝调）max #D1D1D1 → minimal #858585；765 测试 + check 绿，~/.pi 三份副本已同步，等 /reload 定效果
- [x] child-task-state [[fanchao]] — 给子项加 进行中/讨论中/滞留中/搁置 四态 — 子项加四态：parseChild/renderChild 带 state，CLI state --n N，MCP action=state 带 n，面板画 [状态]；child-done 不再抹标记；775 测试 + check 绿 【落地】 (完成 2026-11-09 01a1bbd5-b32f-73)

### 2026-11-08
- [x] drop-sqlite-graph [[fanchao]] — 拆掉 SQLite 图库与检索那套 — SQLite 图库整套拆掉：代码/命令/MCP/写后自动重建/文档/库文件，只留扫 .md 页的 abs query 与 resolve；766 测试绿、lint 0、check 0，宿主已同源 【落地】 (完成 2026-11-08 01a1ba13-c015-70)
  - [x] 代码已拆完（db/db-cmd/evolve 删除、命令与 MCP 摘除、autoIndex/hotPages/recall/queryHint 清掉、769 测试绿）；剩 文档/删库/宿主同步
  - [x] 全部拆完：代码+文档+删库+宿主同步；766 测试绿、lint 0
- [x] drop-todo-anim [[fanchao]] — todo 面板去掉进行中动画 — todo 面板的进行中 spinner 整块拆掉（帧表/定时器/相位参数），刷新改由每次主动 requestRender；pi 与 omp 两份同步；766 测试绿 【落地】 (完成 2026-11-08 01a1ba13-c015-70)
- [x] wip-keep-line-color [[fanchao]] — working 状态还回框线色不上橙 — working 状态还回框线色（不再上搁置橙），右上角状态文字仍上橙；删掉已无用的 leadFg/leadSpanOf；840 测试绿，宿主已同源 【落地】 (完成 2026-11-08 01a1ba13-c015-70)
- [x] panel-title-color [[fanchao]] — todo 面板标题改搁置橙 — todo 面板标题从纯金 #FFD700 换成搁置橙 #F59E0B（C.title）；843 测试绿，宿主已同源 【落地】 (完成 2026-11-08 01a1ba13-c015-70)
- [x] inputbox-orange [[fanchao]] — 输入框百分比/模型名/Working 改橙色 — 输入框上边框的 working 状态与右上角状态文字改成搁置橙 #F59E0B（= C.hold）；虚线/圆角仍走正文色；843 测试绿，宿主已同源 【落地】 (完成 2026-11-08 01a1ba13-c015-70)
- [x] link-tag-standard [[fanchao]] — 统一生成的文件双链标签标准并加闸 — 生成的文件双链名一律逐字等于磁盘文件名，lint 加闸；sessions/ 只收 log-<日期>，摘要并进当天页的 ## 会话 段；slugOf 不再切半句，3 个截断名改名回填；837 测试 + lint 绿 【落地】 (完成 2026-11-08 01a1ba13-c015-70)

### Archived
- [[log-2026-11-08]] 完成任务 4 条
- [[log-2026-11-07]] 完成任务 10 条
- [[log-2026-11-06]] 完成任务 4 条
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
- [[log-2026-09-12]] 完成任务 13 条
