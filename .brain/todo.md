# 📋 Todo Board

## Todo
- [ ] [进行中] load-dirties-index [[tester]] — abs load 每次都会修改 .brain/index.md（无条件写入）: checkBrainShape 的 rebuildStructure 在 ## Entities 前插一个空行，生成结果与磁盘不同 → 每次 load 都把 index.md 弄脏。可复现（git checkout 后跑一次 load，diff 立即出现）。危害: 干净的 git 树被判脏、可能被误提交 (认领 2026-09-17)
## Done
### 2026-09-17

- [x] queryhint-noise [[tester]] — 修 queryHint/rankPage 噪音：英文 2-gram 模糊兜底使 ratio 恒为 1（实测 relevant 30 命中全 fuzzy score10、页面 0 命中）；拟只在中文用模糊。尺子=tag/页名级强命中（hook 6/todo 4/lock 2 vs relevant 0） — 两处缺陷均修复且实测验证：①rankPage 的 2-gram 模糊兜底对英文恒真（ratio 恒=1）→ 加 hasCJK 门，relevant 30→0；②queryHint 取词无质量信号 → 新增 topicStrength 按 tag/页名排序 + 剔0 + 剥掉任务行记号，load 提示 queryhint-noise tester 进行 → hook todo 实测。391 测试全绿、lint 0、三处破坏验证均能抓。提交 415008d 【落地】 (完成 2026-09-17)
  ↳ 断点: 第2项（hint 取词）已完成。新增 topicStrength（tag/页名级命中数=尺子）+ queryHint 按它排序、强度0剔除、分词前剥掉任务行的 <id>/[[作者]] 记号。实测 load 提示从 queryhint-noise tester 进行 → hook todo 实测（全是 [tag:] 级真命中）。391 测试全绿 + lint 0 + 三处破坏验证均确认能抓（去排序→tester,hook；去剥记号→[[作者]] 泄漏）。遗留新发现: abs load 每次都会脏化 .brain/index.md（checkBrainShape 的 rebuildStructure 在 ## Entities 前插空行），可复现，已单独登记
- [x] EXP-BLANK-DIR [[fanchao]] — 对照实验:空白目录测 .brain/ 是否真提升准确度。设计:同任务两轮(带/不带图谱)。关键约束:坑必须只在 .brain/ 里,代码里不能有答案 — 四轮对照实验完成: 未测出 .brain/ 的提升 —— 三轮因题面泄题失效(明写环境/提示陷阱/提示验证入口), 第四轮 abs ab 测出 B组3/4 vs A组2/4 但 n=1。唯一稳定发现: 乙组3/3主动引用 .brain/, 甲组0/3。实验过程暴露 abs ab 工具5个bug(已修) + 一个真缺口(test/hook.test.js未锁时间戳, 已修)。结论: 该实验设计无法证明 abs 有效性, 要真验证需另设计 【仅方案】 (完成 2026-09-17)
  ↳ 断点: 第三轮+实验B进行中。前三轮结论: 题面必泄题(3/3), 两组均避开。改用方案B: 测「读vs不读」而非「正确率」。台子: /tmp/expb/{A轮,B轮}(本仓HEAD快照, 仅差.brain/)。任务=给hooks/event.sh日志加时间戳且要真生效。判据(跑前定死): 汇报里 S1多副本/S2全局副本/S3重启进程/S4绝对路径验证 四项命中数
- [x] AB-REAL1 [[tester]] — abs ab 首次真实用例: 给 hooks/event.sh 日志加 cwd= 字段 + 要求真生效。题面首次不泄题(abs ab check 通过)。台: /tmp/absab/real1/{A轮,B轮}。判据跑前定死: 机械=grep cwd= hooks/event.sh; 语义S1-S4记四项。目的: 验证 abs ab 工具本身是否好用 — abs ab 首次真实使用: 暴露并修掉5个bug (①A轮自带.brain静默失效 ②非仓库目录误导性报错 ③两组并排B组diff到答案 ④init覆盖正在跑的实验 ⑤只约束读不约束写→B组写穿~/.abs/hooks/ 7个真实文件)。⑤最重: 任务需求'让它真正生效'本身在推agent越界, 故边界段必须显式禁止写工作目录之外(~/.abs等)+给替代做法。已按用户指示abs install正式恢复环境、作废v2数据(隔离保留)、加写保护。测试405全绿(+16 ab测试), 破坏验证覆盖①②③④⑤ 【落地】 (完成 2026-09-17)
  ↳ 断点: 踩到第4个问题(操作失误类): 我在 agent 还在跑时 rm -rf /tmp/absab-* 重建台, 导致旧 agent 的工作目录被删除 —— 它自行迁移到 iso3-A 继续干活, 且看到了我后建的 v2 台(时间线证实: 它工作到00:51, v2 建于00:47)。教训: abs ab 重建同名实验前必须确认旧 agent 已停; 且实验进行中不得改台子。工具可加守卫: init 前检测同名组目录是否被占用
- [x] HINT-TO-PAGE [[tester]] — load 的 queryHint 从「给检索词」改为「给命中页」+ 命中页正文直接注入。依据: 本会话实测 hint 给 'exp-blank-dir fanchao 进行' 三词全废(id/作者/停用词); 读写比 308写入:3检索。step1 取词改为与 concepts 标题+tags 匹配(复用 QUERY-TAGS 的权重算法); step2 命中页注入 ❌表现+解法 两段 — load 的 queryHint 改为给命中页+摘要。实现: 接线 pickRelevant/renderRelevant(本就写好但从未调用); scorePage 补 tags 权重8; 新增 df 过滤(剔除过半页命中的无区分度词, 如作者名 fanchao 命中21/30页); 抽词前剥掉 [[wiki]] 与全大写ID。效果: 旧hint三词全废命中噪音页, 新hint命中 learning-loop/teardown-automation/host-plugin-silent-failure。测试 397 全绿(+8), 破坏验证2项均转红。全局是软链故改完即生效 【落地】 (完成 2026-09-17)
- [x] EXPB-TEST-GAP [[tester]] — 实验A轮副产物: test/hook.test.js:74 只断言 log.includes('SessionStart'), 未锁时间戳格式 —— 把 event.sh 里的 date 格式删掉测试照样全绿。补一行 assert.match(log, /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] SessionStart /m)。来自 agent 独立发现, 非实验设计 — test/hook.test.js 补时间戳格式断言(整行 match 而非只 includes 事件名)。破坏验证: 删掉 event.sh 的 date 输出 → 修复前 pass5/fail0(全绿) vs 修复后 pass4/fail1(立刻红)。已确认有牙 【落地】 (完成 2026-09-17)
  ↳ 断点: 已破坏验证确认: 把 event.sh 的 date 格式输出删成 printf '%s %s' 后, 跑 test/hook.test.js → 5 pass 0 fail (全绿)。缺口是真的。根因: 断言只 log.includes('SessionStart'), 不锁格式

### 2026-09-16

- [x] AUDIT-P2-SERVE-OPEN [[fanchao]] — --open 死代码（FLAG_SPEC 无 open）、unref 不可达、--port abc NaN 不校验 【落地】 (完成 2026-09-16)
- [x] AUDIT-P2-ZWSP [[fanchao]] — help/update 用户可见输出含 U+200B，复制即坏。清洗输出侧字符串 + 守卫测试扩到输出 【落地】 (完成 2026-09-16)
- [x] AUDIT-P2-OC-RESET [[fanchao]] — opencode 插件 nudged/wroteFiles/idleSeen 不随 session.created 重置，同进程后续会话全部静默。重置+行为测试 【落地】 (完成 2026-09-16)
- [x] AUDIT-P2-ZOD [[fanchao]] — bin/mcp.js import zod 但 package.json 未声明，靠 SDK 传递依赖碰巧能用。加一行 dependencies 【落地】 (完成 2026-09-16)
- [x] AUDIT-P1-DEV-FILTER [[fanchao]] — 收尾判据三宿主不一致：pi 已认 dev| 条目，store.js:838 与 opencode:51 仍是旧判据。回灌 dev 过滤 【落地】 (完成 2026-09-16)
- [x] AUDIT-P1-MCP-AS [[fanchao]] — abs_task schema 缺 as 参数，done 分支忽略 note 静默盖。补 schema as + done 吃 note 【落地】 (完成 2026-09-16)
- [x] SERVE-PORT-FIXED [[fanchao]] — abs serve 默认端口 7777 固定 → 第二个项目起不来。改为 0 让系统分配空闲端口 【落地】 (完成 2026-09-16)
  ↳ 断点: 改动: bin/abs.js:377 port 7777→0(含帮助文本), src/serve.js:465 默认参数 7777→0。验证: 同进程 serve 两次 → 57353/57354 不冲突; npm test 377 pass 0 fail
- [x] ABS-SERVE [[fanchao]] — abs serve: .brain/ 挂成只读网页。左目录树+右渲染+双链跳转+5主题+明暗切换+手机抽屉。零依赖(CDN 引 marked/hljs)，只绑127.0.0.1、只读、防路径穿越 【落地】 (完成 2026-09-16)
- [x] TODO-BORROW [[fanchao]] — todo 借 Anneal: 断点要素固定前缀(验证/边界/阻塞/不做) + Parked 标记故意搁置 【落地】 (完成 2026-09-16)
  ↳ 断点: 阻塞: 待确认断点要素是否只保留 验证/边界/阻塞 三项
- [x] WRITE-CODE [[fanchao]] — 写操作报错带机器可读错误码(仿 Anneal templateRefusal): 没图谱/没设姓名/任务id不存在 各自有 code 【落地】 (完成 2026-09-16)
- [x] TEST [[fanchao]] — x 【落地】 (完成 2026-09-16)
- [x] LOAD-HINT [[fanchao]] — load 给该查的词(queryHint) + note --when 存触发条件; when 未接进检索 【落地】 (完成 2026-09-16)
- [x] QUERY-TAGS [[fanchao]] — abs query 借 tags 做关联检索: tag权重8>标题4>正文1, 精确命中时模糊不混入 【落地】 (完成 2026-09-16)
- [x] fanout 三层 n 分叉思考引擎 [[fanchao]] 【落地】 (完成 2026-09-16)

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

### Archived
- [[log-2026-09-13]] 完成任务 5 条
- [[2026-09-12-todo归档]] 完成任务 13 条
