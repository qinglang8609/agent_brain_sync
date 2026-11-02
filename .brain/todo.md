# 📋 Todo Board

## Todo

## Done

### 2026-11-02
- [x] db-as-truth [[fanchao]] — 方向反转：库为真相、markdown 为导出产物（覆盖不检测）；旧项目一次性入库 — 评估后否决：库为真相会废掉人工直编 md 的能力与「人工内容一律不覆盖」铁律，单机场景只加复杂度不加能力。维持 markdown 为真相、库为查询索引 【否决】 (完成 2026-11-02 01a19752-29b2-70)
- [x] self-evolving-brain [[fanchao]] — 知识自我进化：库里存推翻关系（superseded_by），做进化分析——哪些被推翻、哪些主题在堆积、哪些该合并 — abs db evolve：推翻关系进库，四条进化信号（推翻/断链/堆积/僵化）；修 3 个判据错误；7 个测试 【落地】 (完成 2026-11-02 01a19752-29b2-70)
- [x] deep-test-search [[fanchao]] — 深度测试检索层 — 深度测试发现并修 4 个检索缺陷：单字 gram 误连、归一化分母取反（曾输出 165 万亮度）、高频虚词凑门槛、解构吃掉 g 字段；35 个测试钉住 【落地】 (完成 2026-11-02 01a19752-29b2-70)

### 2026-11-01
- [x] summon-on-log [[fanchao]] — abs log 落盘时顺手扇出会话：增 size+mtime 预筛避开全读，然后把未总结/有更新的会话提给人 — abs log 落盘时深读会话，带出未总结/有更新的；加 size+mtime 与账本 day 双层预筛，避免全读 【落地】 (完成 2026-11-01 01a19752-29b2-70)
- [x] summarize-pi-sessions [[fanchao]] — 扫 pi 会话目录，把琐碎会话内容总结成知识（L5→L4 提炼）；补上「混沌层没有正常总结」这一环 — abs summon：扫 pi 会话目录，md5 账本判重 + 有快照跳过 + 活跃会话跳过；接进 teardown 提示给条数；6 个测试钉住 【落地】 (完成 2026-11-01 01a19752-29b2-70)
- [x] lint-cleanup [[fanchao]] — 清 lint 报错 — capture 模板补验证尾巴（NO-TAIL 根治）；4 页碎片并入 memory-box-seven-layers 后删除；lint 13→7，剩余全是存量 sources 未提炼 【落地】 (完成 2026-11-01 01a19752-29b2-70)
- [x] l3-migration [[fanchao]] — 存量页标 L3 — 12 页按判据转 L3（具体工具的用法/坑）；5 页通用设计规律留 L4；L3 3→15 页，L4 57→45 【落地】 (完成 2026-11-01 01a19752-29b2-70)
- [x] official-db-setup [[fanchao]] — 建正式库并修 projects.json 路径 — 正式库 ~/.abs/graph.db 已建；修 projects.json 落到家目录的路径 bug（dirname(dbPath) 不是 dbPath） 【落地】 (完成 2026-11-01 01a19752-29b2-70)
- [x] auto-index-on-write [[fanchao]] — capture/note/concept 写后自动入库 — 写后自动全量重建（0.07s）；库未建时不自动建；流水页排除出检索；老库自动迁移 【落地】 (完成 2026-11-01 01a19752-29b2-70)
- [x] seven-layer-capture [[fanchao]] — 按七层判定落点的 capture 命令 — abs capture --layer 1-7 落地：L3/L4 落 concepts 带 layer 字段，L7 落 sources，L1 走铁律门槛，L6 拒手写；8 个测试钉住，679 全绿 【落地】 (完成 2026-11-01 01a19752-29b2-70)
- [x] memory-box-design [[fanchao]] — 设计记忆盒子：七层知识分层 + 双链图谱 + 亮度衰减式联想检索，替代当前关键词 query — 七层规格落成 layers.js，双链与亮度已实现 【落地】 (完成 2026-11-01 01a19752-29b2-70)
- [x] luminance-engine [[fanchao]] — 独立亮度程序：只读 .brain 的 markdown，现场扩散算每页亮度，输出排序。不存储、不改 abs、不加依赖。 — 亮度扩散做进 db.js 的 illuminate：按层衰减 + 枢纽惩罚 + HOPS=1 压制 【落地】 (完成 2026-11-01 01a19752-29b2-70)
- [x] sqlite-brain-graph [[fanchao]] — 图数据库落地：todo/index/log 写库打项目标记后生成 markdown；搜索走 SQLite 亮度；老项目迁库；双链含跨项目链接重建。 — 七层规格 + SQLite 图库 + 亮度搜索 + 跨项目双链落地，671 测试全绿 【落地】 (完成 2026-11-01 01a19752-29b2-70)
- [x] herdr-abs-sidebar [[fanchao]] — 在 herdr-app 顶栏加按钮，点击侧边栏以卡片展示 abs 的 index/todo/log — 用户取消。范围跑偏：先复制了 herdr_app_abs 整个项目、又反复重写 abs 解析；前端侧边栏界面未动，Rust 代码一次未编译。已停手。 【否决】 (完成 2026-11-01 01a19622-7711-75)

### Archived
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
