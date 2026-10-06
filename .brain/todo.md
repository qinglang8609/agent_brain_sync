# 📋 Todo Board

## Todo

## Done

### 2026-10-06
- [x] index-blank-lost [[fanchao]] — index.md 空分区前置空行被归一吃掉：rebuildStructure 对空分区不补空行 — rebuildStructure 对空分区不补前导空行，致「有内容区→空区」接缝塌掉；已改为分区标题前恒补空行。真库验证 + 新增回归用例破坏验证通过，545 全绿。 【落地】 (完成 2026-10-06)
- [x] panel-empty-visible-and-opening-rules [[fanchao]] — 空看板也显示面板 + 首轮3条硬规则 + 无图谱自动init + abs update 方向判断；544全通过、破坏验证过、已commit 65224fa — 空看板说清事实（面板+对齐段）、首轮3条硬规则、无图谱自动init、abs update 方向判断修静默降级；544全通过+三处破坏验证；commit 65224fa 【落地】 (完成 2026-10-06)
- [x] oversize-exempt [[fanchao]] — 方案已落 docs/plans/20261006-oversize-exempt.md，等拍板后改 src/lint.js（1处+1纯函数） — 超限豁免（keep-oversize 标记）user 2026-10-06 决定不做了 【否决】 (完成 2026-10-06)
- [x] opening-rules-first-round [[fanchao]] — 已改 hooks/abs.pi.ts 三处；544 全通过、破坏验证过、已 install；待真机新窗口验证 — 首轮3条硬规则（先登记/名字说清/不攒）+ 空看板说清事实 + 无.brain自动init；544全通过、破坏验证过、已install 【落地】 (完成 2026-10-06)
  ↳ 断点: 改到 hooks/abs.pi.ts：OPENING_RULES 三条（先登记/名字说清/不攒）挂首轮；空看板改成说清「有图谱零任务」；无 .brain 时自动 abs init。544 全通过、破坏验证过、已 install
- [x] load-reinject-after-abort [[fanchao]] — 方案已落 docs/plans/20261006-load-guide-reinject.md，等拍板后改 hooks/abs.pi.ts — 两个 bug 修完：送达确认移到 agent_end（中断则下轮补）、标记改成按 cwd 集合（切目录不被别的目录烧）；544 全通过、破坏验证过、已 install 【落地】 (完成 2026-10-06)
  ↳ 断点: 两个 bug 都修好了：送达确认移到 agent_end，标记改成按 cwd 的集合；540 全通过、破坏验证过、已装到 ~/.pi；待真机切目录验证
- [x] fix-update-downgrade [[fanchao]] — 修 abs update 缺方向判断导致的静默降级（本地版本高于 registry 时被 npm i -g @latest 覆盖）：bin/abs.js 加 cmpVersion 三元组比较 + cmdUpdate 三态分支。改到：bin/abs.js 已完成，三层验证通过（单元自检10例 + 场景1超前拦截 + 场景2相等跳过 + 场景3落后升级）；断点：3文件未 commit（bin/abs.js/src/text.js/.npmignore），1.16.3 未发版（待用户批准） — cmpVersion 三元组比较 + cmdUpdate 三态分支已实现，三层验证通过（单元10例/超前拦截/相等跳过/落后升级）。代码待 commit，1.16.3 未发版 【落地】 (完成 2026-10-06)
  ↳ 断点: 代码已改+三层验证通过；断点：等用户批准 commit（现共5文件待提交：bin/abs.js / src/text.js / hooks/abs.pi.ts / test/plugin-behavior.test.js / .npmignore），1.16.3 未发版
- [x] hook-autoload-first-round [[fanchao]] — 开工第一轮自动 abs load（用户 2026-10-06 定：第一轮会话 abs load 自带 todo，其他轮只 todo）：hooks/abs.pi.ts 新增 readLoadForGuide（走 ABS_BIN 跑子进程，2s 超时保护）+ injectLoadGuideline（[开工] 前缀）+ loadInjected flag（session_start 重置）。验证：3轮实测 load段=1/0/0，新会话重置生效，load段自带 Todo Board，534 全量通过 — 真机验证通过：新 pi 窗口 load_guide=on，第二句起 skip；新窗口 agent 主动报出三条滞留任务含断点 【落地】 (完成 2026-10-06)
- [x] board-empty-align [[fanchao]] — 看板为空时对齐段静默不注入（开工那一刻最该对齐却什么都没摆）：hooks/abs.pi.ts boardGuideline 去掉『空→return null』，改为摆出「（空）」这个事实；并区分两种过滤后为空（真空白 vs 全是别人的任务→仍静默别误导）。测试：拆出作者过滤单独一条 + 破坏验证过；534 全量通过 — 看板空时不再静默：boardGuideline 摆出「（空）」这个事实（以前 return null，开工那刻最该对齐却什么都不摆）。并区分两种过滤后为空——真空白摆（空），全是别人的任务仍静默（别误导）。测试拆出作者过滤单独一条 + 破坏验证过；534 全量通过 【落地】 (完成 2026-10-06)
- [x] release-1.16.2 [[fanchao]] — 发布 1.16.2 到 registry（源码有而 registry 没有的版本，导致 abs update 把全局从 1.16.2 降级回 1.16.1） — 已发布：清理 skill/.DS_Store（新增 .npmignore）+ 补 src/text.js 尾换行 → npm publish 成功 → registry latest 追平 1.16.2 → abs update 回归验证 1.16.1→1.16.2 正常 + 四宿主 hook/skill 已刷新 【落地】 (完成 2026-10-06)

### 2026-10-05
- [x] gate-real-test [[fanchao]] — 制造真实触发：改代码不登记→提交→门禁弹提示→我是否去补记 — 用户判定不必留在看板：门禁机制已实测会弹（83654c2），行为层观察无需挂着一条任务盯 【否决】 (完成 2026-10-05)
- [x] align-4points [[fanchao]] — 对齐补三个缺口：②③下轮带上轮动过的文件、④收尾 wrapup 带看板快照、⑤load 带上会话痕迹 — 越界了：wrapup存痕迹+touchedFor+load显示判断，都是替LLM发现问题。已撤回，只保留纯对齐（摆事实） 【否决】 (完成 2026-10-05)
  ↳ 断点: 改到 hooks/abs.pi.ts（上轮改动痕迹）+ src/wrapup.js（快照带内容）
- [x] board-align [[fanchao]] — 每轮把看板摆给 LLM（已装、四场景通过）。是否让我主动登记：待观察，不下结论 — 每轮对齐看板已装并在用：用户一提就能接上、回答基于真实状态而非回忆。之前用「会不会主动登记」评判它是拿错尺子 【落地】 (完成 2026-10-05)
  ↳ 断点: 观察判据：下次真实提交时门禁弹提示→我是否去登记了。成了标落地，没成标否决
- [x] add-shelved-state [[fanchao]] — 加状态「搁置」：用户改方向/不做了，与「滞留中」（还要做只是卡住）区分 — 加状态「搁置」+ 转状态提示具体到三种情形；反复对齐铁律写进代码并修一处对齐撒谎（看板清空后旧快照残留） 【落地】 (完成 2026-10-05)
- [x] commit-todo-gate [[fanchao]] — pre-commit 里加对比：改了 src/bin/hooks 但没动 todo.md → 要求显式决定 — 门禁已装并四场景双向验证通过（改代码+不动todo→提示；动了todo/只改文档/ABS_NO_TODO→不提示）。能否真改变行为待真实提交验证 【落地】 (完成 2026-10-05)
- [x] verify-board-align [[fanchao]] — 验证 hook 每轮把看板摆给 LLM 后，是否真能让登记与干活对齐（本会话实测） — 结语纠正：机制本身在跑且验证通过（四场景）；仅「靠它让我主动登记」未达成 【仅方案】 (完成 2026-10-05)
  ↳ 断点: 已装到本地+四场景验证通过；待真实使用验证（本会话已漏两次：查 index 未登记、忘了标记本条进展）
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
