# 📋 Todo Board

## Todo

## Done

### 2026-11-04
- [x] todo-panel-title-icon [[fanchao]] — todo 面板标题的 📋 换成新图标 【落地】 (完成 2026-11-04 01a1a566-2588-75)
- [x] pi-editor-polish-3 [[fanchao]] — 输入框三改：working 改为框上单个运行图标；去左右边距；右侧显示模型名 【落地】 (完成 2026-11-04 01a1a566-2588-75)
- [x] pi-inputbox-rounded-border [[fanchao]] — pi 输入框改成左右两侧都有边线 + 圆角 【落地】 (完成 2026-11-04 01a1a566-2588-75)
- [x] pi-todo-panel-border [[fanchao]] — 去掉 pi todo 面板上边框（两副本同步） 【落地】 (完成 2026-11-04 01a1a566-2588-75)

### 2026-11-03
- [x] query-flow-draft-filter [[fanchao]] — 修 query 流水页降权力度不足 + 补 draft 草稿过滤，对齐 db search 【落地】 (完成 2026-11-03 01a19be2-af1d-76)
- [x] review-fix-p1 [[fanchao]] — 全项目审查后修复 4 个 P1 缺陷 【落地】 (完成 2026-11-03 01a19be2-af1d-76)
- [x] abs-recall-command [[fanchao]] — 新增 abs recall：卡住时按处境主动取相关页 【落地】 (完成 2026-11-03 01a19be2-af1d-76)
- [x] query-flow-page-downrank [[fanchao]] — 检索结果里给 sessions/log-* 与 sources/ 降权，不让流水页压过内容页 【落地】 (完成 2026-11-03 01a19be2-af1d-76)

### 2026-11-02
- [x] capture-herdr-clipboard-gotcha [[fanchao]] — 沉淀 herdr+pi 远程复制失败的根因与解法 【落地】 (完成 2026-11-02 01a19be2-af1d-76)
- [x] release-and-local-install [[fanchao]] — 提交 git、发布版本、本地安装 【落地】 (完成 2026-11-02 01a19be2-af1d-76)
- [x] index-first-plus-kinds [[fanchao]] — 索引优先（摘要+token 成本+--full）+ 观察类型分档（gotcha/decision/tradeoff） — 索引优先（摘要+token 成本+--full）+ kind 分档（gotcha/decision/tradeoff/howto，capture --kind）；23 页标 gotcha，其余留空不猜 【落地】 (完成 2026-11-02 01a19752-29b2-70)
- [x] fix-retired-vs-replaced [[fanchao]] — evolve 区分单纯弃用与被取代 — 原来没写 superseded-by 一律报断链，误报「需求已否决」的存档页；现分 replaced/retired，只有写了 by 但目标不存在才是断链 【落地】 (完成 2026-11-02 01a19752-29b2-70)
- [x] fix-dangling-links [[fanchao]] — 清 4 条悬挂链接 — 加了占位符形状判据（省略号/大写冒号）与 wiki 排除；PPT-CONVERSION-FORMULAS 改纯文本说明（原文档已不在仓库）；悬挂 4→0 【落地】 (完成 2026-11-02 01a19752-29b2-70)
- [x] load-with-search [[fanchao]] — 把 db search 接进 abs load，开机带出最亮的几页正文 — load 首屏带出最亮 3 页（页名+摘要不贴正文）；抽出 contextKeywords 共用；首屏按纯亮度排不按层权重 【落地】 (完成 2026-11-02 01a19752-29b2-70)
- [x] db-as-truth [[fanchao]] — 方向反转：库为真相、markdown 为导出产物（覆盖不检测）；旧项目一次性入库 — 评估后否决：库为真相会废掉人工直编 md 的能力与「人工内容一律不覆盖」铁律，单机场景只加复杂度不加能力。维持 markdown 为真相、库为查询索引 【否决】 (完成 2026-11-02 01a19752-29b2-70)
- [x] self-evolving-brain [[fanchao]] — 知识自我进化：库里存推翻关系（superseded_by），做进化分析——哪些被推翻、哪些主题在堆积、哪些该合并 — abs db evolve：推翻关系进库，四条进化信号（推翻/断链/堆积/僵化）；修 3 个判据错误；7 个测试 【落地】 (完成 2026-11-02 01a19752-29b2-70)
- [x] deep-test-search [[fanchao]] — 深度测试检索层 — 深度测试发现并修 4 个检索缺陷：单字 gram 误连、归一化分母取反（曾输出 165 万亮度）、高频虚词凑门槛、解构吃掉 g 字段；35 个测试钉住 【落地】 (完成 2026-11-02 01a19752-29b2-70)

### Archived
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
