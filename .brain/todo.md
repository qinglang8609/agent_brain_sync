# 📋 Todo Board

## Todo
- [ ] [搁置] pgl-review [[fanchao]] — 调研 pi-goal-list-loop-audit 的实现方式并向用户说明 (认领 2026-11-10 01a1c4c2-a69f-70)
- [ ] [进行中] release-1313 [[fanchao]] — 提交本次审查修复，npm version patch 发 1.31.3，本地全局安装并重扇出宿主 hook (认领 2026-11-10 01a1c4c6-c75c-70)

## Done

### 2026-11-10
- [x] audit-fix [[fanchao]] — 修审查发现的 1-12 项：memo 路径穿越、原子写、id 校验、install 帮助文案、闸门 basename、卸载备份、gitignore、PID 锁、测试等 — 修完 1-10、12：id 校验拒路径字符、lock 原子写+PID 锁、install 帮助对齐代码、闸门 basename、卸载前备份、gitignore 忽略锁/tmp、ingest 子串限长、event.sh 收 64KB。11 (query 跳过 sessions) 与既有「流水页隐藏要告知」契约冲突，已回退。13 (pi/omp 合并) 按审查结论不做。777 测试全绿。 【落地】 (完成 2026-11-10 01a1c4c6-c75c-70)
- [x] repo-audit [[fanchao]] — 对 agent_brain_sync 本仓库做整体质量审查（bug、安全、负载、测试缺口、可删项）并向用户说明 — 整体审查完成，774 测试全绿。两个必须修：① setMemo 用未滤 `/` `..` 的 id 拼文件名，实测可写出 .brain 外；② lock.js 对 index/todo/log 用非原子 writeFile，崩溃可截断图谱。其余：id 注释说拒方括号但代码没拒、install --help 说 --yes 装全部而代码只装 pi、闸门用 split('/') 在 Windows 失效、卸载不备份。只出报告未改码。 【落地】 (完成 2026-11-10 01a1c4c6-c75c-70)

### 2026-11-09
- [x] release-131-2 [[fanchao]] — 发 1.31.2：参数规矩前置 + 修过时命令 — 1.31.2 已发：tag+push、npm publish（registry 延迟约 2 分 40 秒）、全局装 1.31.2、宿主重装；新会话 system prompt 实测第 9 条在、旧命令已消失 【落地】 (完成 2026-11-09)
- [x] task-params-upfront [[fanchao]] — 把 abs_task 参数规矩提前写进常驻指引 — 常驻指引加第 9 条：cwd 必填、id 一个词、start/add 需 note、child_done/child_undone/state 带 n、done 给结语+as、子项 note ≤200 字；顺手把已删的 abs recall 改成 abs query（指引与 load 用法行两处）；774 测试 + check 绿，abs.ts 已同步 【落地】 (完成 2026-11-09)
- [x] release-131-1 [[fanchao]] — 发 1.31.1：输入框文字档位色 + 右下角档位字母 — 1.31.1 已发：提交+tag+push、npm publish（registry 延迟约 60s）、全局装 1.31.1、宿主四处重装；三处新码一致 【落地】 (完成 2026-11-09)
- [x] inputbox-text-effort-color [[fanchao]] — 输入框文字也上推理档位色 — 正文行先剥 pi 原生文字色再包 wrap（= editor.borderColor 档位色）；772 测试 + check 绿，副本已同步 【落地】 (完成 2026-11-09)
- [x] status-show-effort-letter [[fanchao]] — 右下角状态文字末尾加推理档位一个大写字母 — buildStatus 加第三段档位字母（LEVEL_LETTER：O/N/L/M/H/X/A 无重）；index.ts 重新跟踪 thinkingLevel 并订 thinking_level_select；22 条 format 用例 + 772 全量 + check 绿，副本已同步 【落地】 (完成 2026-11-09)
- [x] working-back-topleft [[fanchao]] — working 还原为 pi 嵌的左上角 动画+Working — 上边框恢复整行透传（pi 嵌的 左上角 `⠇ Working` + 动画，颜色随框线）；删掉 extractWorking 与其 4 条用例；21 条 format 用例 + 772 全量 + check 绿，副本已同步 【落地】 (完成 2026-11-09)

### Archived
- [[log-2026-11-09]] 完成任务 14 条
- [[log-2026-11-08]] 完成任务 10 条
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
