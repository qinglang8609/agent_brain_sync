# 📋 Todo Board
## Todo
## Done
### 2026-09-15

- [x] SOURCES-DIGEST-DH [[fanchao]] — desktop_herdr 20 个 source 提炼：8 进度日志合并 + 10 坑提炼进 5 个新 concept + 2 已覆盖 【落地】 (完成 2026-09-15)
- [x] NO-TAIL-44 [[fanchao]] — 补 44 页验证段：~/Docker 11 + codebuddy 10 + zj_shop 16 + desktop_herdr 3 + 家目录 4 【落地】 (完成 2026-09-15)
- [x] CONCEPT-CMD [[fanchao]] — 新增 abs concept 命令（概念页骨架，只给结构不给内容）+ NO-TAIL 判据（放宽认动作词、收紧识破占位） 【落地】 (完成 2026-09-15)
- [x] SESSIONS-CONTRACT [[fanchao]] — sessions/ 一天一文件命名契约：归档并入当天 log（abs todo archive 自动）+ 4 条 lint 检查 + 6 个项目存量迁移 【落地】 (完成 2026-09-15)
- [x] SOURCES-DIGEST-14 [[fanchao]] — 消化 sources/ 14 个堆积（>10 触发 SOURCES-PILED-UP）：提炼进 concepts/、清源页、清引用、修 index。另评估「自动消化门槛」可行性。 【落地】 (完成 2026-09-15)
- [x] INSTALL-TREE-GUARD [[fanchao]] — 安装树与代码版本不一致的显式守卫：包内一个 skill 都找不到时不再静默装 0 个，改报版本+布局+修复命令。触发源=fnos 半升级实测（旧代码1.8.2 + 新布局1.8.3 → 甩一个当前版本不存在的路径 ENOENT skill/SKILL.md）。 【落地】 (完成 2026-09-15)
  ↳ 断点: 已发布 1.8.4（用户授权后发版+推送，commit c8bbb0e）。改动: src/install.js ALL_SKILLS IIFE 尾部加空数组守卫(+14行); test/install.test.js 新增 3 例(扁平旧布局/skill缺失/正常不误伤, +63行)。验证: 全量 321 测试全绿; registry tarball 实测(正常布局 OK / 压成扁平必报错); 全局装 1.8.4 后 abs install 四宿主全成功。边界: 守卫只治「新代码+旧布局」，治不了「旧代码+新布局」(旧代码改不动) —— fnos 那台靠重装。}
- [x] AUTO-REG [[fanchao]] — 写文件即自动登记(hook 端)：写项目文件→hook 直接 spawn abs autotask 建/追加 [待归类] 条目，不再只弹提醒。幂等键=会话(同会话只一条)。待发版(1.8.0 已发布版不含此功能，故本地实测走仓库 bin) 【落地】 (完成 2026-09-15)
  ↳ 断点: 完成：新增 cmdAutoTask + abs autotask 内部命令 + 两宿主 hook 调用。332 测试全绿(+7)，破坏验证2轮全红(幂等键失效/无图谱误写)。踩坑记录：①opencode 模板加了 @@ABS_BIN@@ 但安装器没替换→产物坏 TS(31个测试炸)；②我的 node 脚本写文件名时多插了一个零宽空格(16 vs 15 字符)，导致 ENOENT；③实测发现 1.8.0 已发布版不含 autotask，hook spawn 全局 bin 会静默失败(stdio:ignore 吞掉'未知命令')——这不是 bug 是未发版，但暴露了一个真问题：hook 调全局 bin 时，若全局版本落后就会静默失效。
- [x] AUTO-OCSESS [[fanchao]] — [待归类] 改了 src/oc-test.js 【否决】 (完成 2026-09-15)
  ↳ 改了 1 个文件：src/oc-test.js
- [x] AUTO-TESTSESS [[fanchao]] — [待归类] 改了 src/x.js 【否决】 (完成 2026-09-15)
  ↳ 改了 1 个文件：src/x.js
- [x] TODO-AUTO [[fanchao]] — 写文件即任务开始：turn_end 检测到写文件→立刻注入登记提示(每会话每次写文件都提醒，频繁没关系)；判据=整个项目排除.brain自身；文案明说'纯讨论可跳过'；配套 reviewed→active 迁移 + SKILL.md 约束文档更新 【落地】 (完成 2026-09-15)
  ↳ 断点: 完成：写文件即任务开始。pi(turn_end)/opencode(tool.execute.after) 检测项目文件写入→当场注入[abs 登记提醒](不等 agent_end)，文案含改过的文件+三选一(新任务add/已有note/纯讨论跳过)。判据=整个项目但排除 .brain/ 自身(note/log 也写文件但是记录行为非任务)。频繁是故意的：每轮写文件都提醒，同文件再改也提醒。另:reviewed→active 迁移20页(字段值归一到三值)，SKILL.md 新增该节。325测试全绿(+5 pi +5 oc)，破坏验证2轮。
- [x] EXP-LIFECYCLE [[fanchao]] — 经验/知识页生命周期：①status 三值定死语义(active/superseded/draft) ②abs supersede <页> --by <页> 标记推翻 ③abs note 落页默认 draft ④query/load 默认不展示 superseded ⑤lint 查 superseded-by 指向是否存在 + 查 draft 超龄未核实。不含 todo 自动化(用户明确排除) 【落地】 (完成 2026-09-15)
  ↳ 断点: 完成：①status 三值定死(active/superseded/draft，缺字段=active 存量零迁移) ②abs supersede <页> --by <新页>(不删文件、幂等、拒悬空 --by、可反悔) ③note 默认 draft ④query 默认隐藏 superseded(--all 可看+告知隐藏数) ⑤lint 加 SUPERSEDED-DANGLING/DRAFT-STALE。CLI+MCP(abs_supersede, 12工具)。315 测试全绿(新增 9 例)，两轮破坏验证(store.js statusOfPage→6红、query隐藏逻辑→1红)。已 install --yes 扇出宿主。

### 2026-09-13

- [x] #1.1 [[fanchao]] abs task 调用不稳定 — 写代码时不登记，只有复盘/手工才更新 【落地】 (完成 2026-09-13)
- [x] SKILL-DRIFT [[fanchao]] — skill 双份漂移：仓库 skill/SKILL.md（中文分区名）vs 安装版 ~/.claude/skills/abs-agent-brain-sync/SKILL.md（英文分区名）不一致。下次改 skill 极易改错一份。建议：安装器从仓库 skill/SKILL.md 单向覆盖，或文档化'安装版为准、仓库版只是模板'。 【落地】 (完成 2026-09-13)
- [x] VERSION-DRIFT-1.7.6 [[fanchao]] — 版本号谎言：v1.7.5 打标后 c3c9974(英文分区名+checkBrainShape)落地但未 bump，全局装 1.7.5 实为旧码。已 npm version patch→1.7.6 发布+全局重装，abs load 实测 checkBrainShape 生效(todo.md 结构重排)。教训:代码前进了版本号没跟=发布流程断，npm view 有 cache 延迟需 --force clean 【落地】 (完成 2026-09-13)
- [x] LOAD-SHAPE-CHECK [[fanchao]] — load 顺手核对 index/log/todo 形状(每次 load 都读这三个): 缺分区=最严重→自动补建(幂等,不覆盖已有内容); 无头(H1不符)→只提醒不自动改(结构可能整体脱轨); 多分区→不管; log 条目只判 '## [' 开头, 不判内容完整(LOG-BACKFILL-34 已定论不修)。正常时静默零字节。已实现+沙盒验证5场景, 未发版(等用户核对) 【落地】 (完成 2026-09-13)
- [x] STRUCT-EN-AND-RULE [[fanchao]] — ①分区名/H1 全改英文(Roadmap/Rules/Graph Index/Activity Log/Todo Board/Done/Archived/Undated) ②load 结构核对: 不符就按标准重建(B档, 自加分区留末尾, 内容零丢失, 幂等) ③新增 abs rule 命令+MCP abs_rule+lint 两项检查(RULES-PILED-UP/TOO-LONG) ④skill 按文件结构重写+精简(342→272行, -32%) ⑤5 个真实项目已迁移(内容零丢失) (完成 2026-09-13) 【落地】 (完成 2026-09-13)

### Archived
- [[2026-09-12-todo归档]] 完成任务 13 条
