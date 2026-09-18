# 📋 Todo Board
## Todo
## Done
### 2026-09-17

- [x] hook-idempotent-minute-window [[tester]] — test/hook.test.js:98 偶发失败，定位后确认是产品缺陷非测试问题：event.sh 幂等 mark 名钉在分钟级 STAMP 上，跨分钟就换身份 → 「60s 幂等」实际最坏退化为 1s。实测复现（STAMP 2359→0000 落 2 行）。已修：mark 名只含指纹 + 时间戳写进文件内比较（拒绝 find -newermt：BSD 不认 @epoch；拒绝 -mmin：仍是分钟级）。395 测试全绿、幂等测试 10 轮 0 失败（原 1/12）。提交 8e70c4d — 已修并提交 8e70c4d：幂等 mark 改为「只含 payload 指纹 + 时间戳写在文件内」，窗口=真 60s，与分钟边界无关；清理逻辑不再按分钟批量删（那会在跨分钟时误删刚写的 mark）。破坏验证：退回旧方案 → 两条新测试均 fail。自身踩坑：新写的第一版测试是空测试（只改 mark 内容，而旧代码不读内容）—— 破坏验证拓出来了，改为断言身份方案才真打到缺陷 【落地】 (完成 2026-09-17)
- [x] load-dirties-index [[tester]] — abs load 每次都会修改 .brain/index.md（无条件写入）: checkBrainShape 的 rebuildStructure 在 ## Entities 前插一个空行，生成结果与磁盘不同 → 每次 load 都把 index.md 弄脏。可复现（git checkout 后跑一次 load，diff 立即出现）。危害: 干净的 git 树被判脏、可能被误提交 — 根因与我当初登记的不同（重要更正）：不是 rebuildStructure 的代码 bug。生成器的定点是「有内容的分区前插空行、空分区紧贴」，且幂等（跑两次第二次 changed=[]）。真因是提交的 .brain/index.md 被手改偏离了定点（## Entities 前漏空行、空 ## Syntheses 前又多一个）→ 首个 load 写回一次。修法：不动代码，把两个文件带到定点后提交。验证：全新 checkout 后连跑 3 次 load，git status 均 0 脏文件（原为每次 1 行）。教训：我第一版改成「只第一个分区插空行」是错的（差异 20→57 行），靠实测数据推翻；当时若直接提交就会把真定点改坏 【落地】 (完成 2026-09-17)
- [x] teardown-nudge-race [[tester]] — 收尾注入反复打断主任务。证据: ~/.abs/log/hooks.log 同会话 5 分钟内 6 次 teardown-nudge（注释写每会话一次），全日志 55 次。根因一: hooks/abs.pi.ts:155 守卫是跨 await 的检查-后置位（teardownNudged=true 隔了 logHook/loggedToday 两个 await）→ 并发 agent_end 全先过检查再各自置位；已复刻复现（5 次触发→注入 5 次）。根因二: 扩展重复注册（session_start 11 分钟内 8 次，00:07:58 连续 3 次）→ 闭包守卫不共享，同进程多实例各有自己的 flag。附因: agent_end 不是会话结束（docs/extensions.md:569 明说），且 loggedToday 判据反向（今天没 abs log→第一次就打扰；已 log→全沉默）。修法待定 — 两个根因均修并实测：①守卫跨 await 竞态（并发 5 次→注入 5 次，已复现）→ 进函数首动作置 teardownInFlight；②扩展重复注册（session_start 11 分 8 次）→ 状态提到模块级。393 测试全绿 + 两条回归测试均做破坏验证。提交 5c148fc 并已安装到 ~/.pi/agent/extensions/abs.ts（已核对实际生效） 【落地】 (完成 2026-09-17)
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

### Archived
- [[log-2026-09-15]] 完成任务 11 条
- [[log-2026-09-13]] 完成任务 5 条
- [[2026-09-12-todo归档]] 完成任务 13 条
