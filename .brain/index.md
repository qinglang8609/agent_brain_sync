# 🗂 Graph Index

本文件唯一入口。每新建/大改一个知识页，同步在此分类下加一行 `[[页面名]] — 一句话`。

## Rules
- 动手前先停，自问：需求明确吗 / 登记了吗 / 怎么验证
- 未经用户核对，不准发版、不准推送。
- 只写做过、跑过、测过的事实。
- 已存在的人工内容一律不覆盖。
- 绝不通读 `.brain/`。
- 读取侧输出不得随规模增长。
- 记录属内容决策，工具只报不改。
- 判「等价」必须真跑到，且跑破坏验证。
- 证据到手前不给结论。
- 写入侧收口，别在下游救。
- 加守卫前先问谁在非交互地调我。
- 改一份不算改，多副本全要改。
- 靠提醒才能工作的功能，该删不该补；让不掌握判据的一方启动动作，同样该删。
- 先列≥2假设+反证条件；自造输入测出的结果不算证据。
- 结论要明确：给结论+依据+下一步；不定位要说清缺什么。
- 改布局/签名/协议必须与读它的一方同一个 commit；分开就是静默失效
- 体检输出必须按类型折叠计数，同类超限只报条数+样例
- 过滤「不该出现」的东西要查所有出口，不只入口

## Concepts
- [[wechat-miniprogram-review-traps]] — 微信小程序审核两大高频拒因：登录页混淆官方元素、无资质出现「提现」字眼
- [[mcp-json-migrated-to-adapter]] — pi 的 MCP 配置迁到 mcp-adapter.json；只删旧文件治不了，写入侧也要改
- [[db-replica-not-auto]] — 主从不是自动同步：只有写主库才复制，读从库要应用自己路由
- [[knowledge-self-evolution]] — 知识自我进化：推翻关系进库，能看出知识在往哪走；含三个判据错误
- [[search-relevance-pitfalls]] — 中文检索四个实测坑：单字 gram、归一化分母、高频虚词门槛、解构吃掉字段
- [[abs-origin-problem]] — abs 的缘起与判据：服务「让琐碎经验不流失」才做，否则是自嗨
- [[agent-end-is-not-session-end]] — agent_end 不是会话结尾：聊一句就触发，判据不能靠事件名推断时机
- [[register-needs-description]] — 登记任务必须带描述：只给 id 会留下无法补回的空壳
- [[incomplete-state-no-auto-decide]] — 状态不完整时不替用户决定：四种兜底全错，程序只报告状态不决定归属
- [[subitem-satisfies-two-predicates]] — 缩进子项同时满足两个判据：凡按行判断处都要先排子项
- [[homedir-ignores-home-env]] — os.homedir() 不受 HOME 影响：测试隔离必须用专属环境变量
- [[memory-box-seven-layers]] — 七层分层 + 图数据库：L1 铁律永不衰减，L6 是双链词，扩散必须压制否则全亮
- [[chinese-fts-two-gram]] — 中文全文检索必须自切 2-gram：trigram 要≥3字符、unicode61 整句一个 token，两字词恒 0 命中
- [[sqlite-vs-graph-db]] — 图查询选 SQLite 不选 Neo4j 的判据：万级规模 + 会话级调用 + 不能依赖常驻进程
- [[reuse-existing-field-over-new-one]] — 能塞进已有字段就别新增：归档整行搬运自动兼容、通配正则零改动；含两个陷阱
- [[dead-code-vs-over-export]] — 三种「看着像问题」分开判：真死代码(剥声明行数0)/多导出(多数别动)/大文件拆分(先画依赖图)；含拆分四步与脚本误报坑
- [[remind-vs-gate]] — todo 对齐两层：对齐（必做，让我看见）+ 门禁（兜底，漏了跑不掉）
- [[naming-contract-and-judge-precision]] — 目录契约(一天一文件)+判据精度(看结构不看关键词/正则词边界陷阱)+存量迁移方法
- [[feature-delete-not-patch]] — 触发频率错是设计错误不是实现错误：功能该删不该补（4 例实证 + YAGNI 判据）
- [[borrowed-protocol-designs]] — 抄协议不抄依赖：manifest 分层/fallback 自救/id 抗改名（含不抄 uuid/哈希的理由）
- [[learning-loop-collect-distill-deliver]] — 规律进化三环节(采集/消化/生效)：只有前两环在工作，生效环缺失 = 同类坑反复(git 实证 Rules 不积累)
- [[abs-install-layout]] — 全局安装形态: npm link 单一真源 + hook/MCP 烧绝对路径 + skill 布局须与代码同版本（半升级两头都坑）
- [[todo-rewrite-not-map]] — todo 行操作必须整文件重写保序，map 改不了分区结构
- [[hook-sh-not-bash]] — hook 脚本 shebang 与语法必须同方言（POSIX sh 无子串扩展）
- [[skill-rewrite-residual-old-methods]] — skill 以旧文档为基底重写时, 旧方法(bootstrap/.sh)残留成悬空引用; 须对照实际工具清单逐条核对
- [[file-write-locking]] — 并发写保护: 读改写才需 editFile 锁; append/原子写/单用户动作天然安全不妄加锁
- [[npm-publish-flow]] — npm 发布全流程: 2FA发布限制/scoped改名绕相似名/发布后registry读延迟/全局link清理/宿主install零宽字符坑
- [[teardown-automation]] — 收尾自动化: hook 必须主动推(注入指令)而非被动记日志; 各宿主 idle/Stop 事件 + 触发条件收窄
- [[hook-code-in-wrong-branch]] — 加 hook 不生效先查"代码在哪条分支里"：用一行无条件埋点区分"没执行"与"执行了但失败"，别猜环境
- [[cleanup-kills-own-refresh]] — 清理动作别把重绘通道一起停掉：面板消失后需自己 requestRender（唯一重绘入口是动画定时器）
- [[auto-todo-register-design]] — 自动登记 todo 的失败复盘：三版迭代后整体移除（卡顿+看板堆占位）；通则=自动化必须挂在"机器确实知道"的判断上
- [[param-added-at-one-callsite-only]] — 加参数只改一个调用点：命令说成功、磁盘没变（报告与落盘来自两次计算就会漂移）
- [[falsy-or-eats-zero]] — `x || 默认值` 吃掉合法零值：参数的"缺失"与"非法"要分开处理，非法要报错不静默改写
- [[host-plugin-silent-failure]] — 宿主插件"静默失效"三坑: 可观测性(缺无条件 seen 痕)/回调签名错/导出方式错; 含宿主升级与"同族不同形"API 差异(omp 整体替换 systemPrompt); 装上了≠加载了≠触发了
- [[skill-trigger-invisible-killers]] — skill 不触发的两个隐形杀手: description 没写触发词(主题描述匹配不上)/symlink 指向不受管理的陈旧副本; 无报错静默失效
- [[deploy-artifact-copies]] — hook/插件产物有三份(仓库/宿主落点/进程内存)+全局 npm 副本; 改一份不算改, 删文件对已加载进程无效必须重启宿主
- [[perf-fixed-overhead]] — 性能优化先分解固定开销: 实测 abs 27ms 中 node启动占20ms(读写仅3ms); 逐段追问"这段能否拿掉"; daemon 方案为此被否(仅省5ms)
- [[silent-data-loss-diagnosis]] — 静默丢数据排查顺序: 串行能否复现→组件级压测→临界区 trace 看 orig→write 序列; 证据到手前不给结论(先猜机制会连续翻车)
- [[self-triggering-hook-loop]] — 自触发 hook 死循环: 主动推会触发下一轮→ 必须双保险(宿主防重入字段 + 己方节流), 且节流器不允许有"跳过"分支
- [[guard-check-then-set-across-await]] — 守卫的检查与置位跨 await 就会漏: 并发调用一起通过检查→实测每会话注入 6 次(应 1 次)
- [[opencode-inject-channel-verdict]] — op​encode 注入通道判定: promptAsync(204)/prompt(200)/command(200) 均能唤醒 idle session; tui.* 假成功不唤醒; "零 nudge"真因是 gate 非通道
- [[summary-truncation-hidden-cause]] — 散文截断是「摘要读起来抽象」的隐形根因且自我掩盖: 先查写入侧(硬切率 34/85 即确诊), 别去调 prompt; 修法须收口在一处
- [[symbol-reference-needs-real-run]] — 引用新符号/判"等价"/新功能测试, 验证必须真跑到: node --check 查不出未导入标识符; 判等价只测恒真式不算验证(删 resolveProjectDir 回退分支即此坑); 新测试要跑破坏验证, 不红=没盖到
- [[vacuous-test-passes-on-broken-code]] — 空测试: 断言恒真(如断言整个路径不等, 而路径里的 A/B 段已保证不等), 回退修复照样全绿; 检出只能靠破坏验证(回退到 bug 的真实旧实现看是否变红)
- [[guard-blocks-noninteractive-callers]] — 加前置守卫前先问「谁在非交互地调我」: hook/CI 调的内部命令一律放行, 否则守卫失效是静默的(报错被吞); 必配一条「hook 路径不被拦」的测试
- [[index-row-not-attribution]] — index 行是指针不是记录: 塞作者名会从"创建者"漂成"最后改的人"; 归因只写页 frontmatter, 要在读取侧展示
- [[hook-throttle-alignment]] — hook 节流三种静默失效: 状态跨会话不重置 / 判据用代理信号(note 也写 log) / 素材不清空; 测试必须成对跑
- [[read-side-output-must-not-scale]] — 读状态的入口不得打印无上限增长的数据: 同一根因连续踩三次(Done区 68.8% / log条目 / index清单 64%); 只给计数+逃生口, 判据是"会不会随规模增长"而非"现在是不是最大"
- [[file-shape-check-on-load]] — load 顺手核对 index/log/todo 形状: 缺分区→自动补建(机械可判定); 无头(H1不符)→只提醒不自动改(结构可能整体脱轨, 机器猜错等于毁数据); 多分区→不管; 正常时零字节
- [[agents-skills-not-ownerless]] — ~/.agents/skills/ 属 skills CLI(lockfile 所有者), 宿主 skills/ 只是其扇出目标; 判残留副本要三证据齐; 只读检测+告警, 绝不代写代删
- [[mcp-stale-paths-multi-store]] — MCP 陈旧路径: 适配器把 9 个外部 store 当权威读, 任一处的旧条目会盖过自己写对的那份; 校正须挂 runInstall/runUninstall 层, 并逐处核对宿主实际读到的值
- [[self-authored-evidence]] — 自造证据: 单假设逼你造假(编输入→真实验→真404); 多假设+反证条件才治得住
- [[resource-default-let-os-assign]] — 稀缺全局资源的默认值：让 OS 分配，不写死
- [[audit-claims-verify-before-fix]] — 审计清单也是待证证据：逐条最小探针确证后再改
- [[self-reported-reasoning-is-post-hoc]] — 让模型自述思考层≠真思考：实测是知答案后编陪跑
- [[gate-needs-outlet-not-just-block]] — 加闸门必须同时给出路：todo 总结污染复发三次的真根因是缺落点，不是闸门不严
- [[validation-gate-on-shared-write-path]] — 共享写入路径加校验必须先问：存量有反例吗、能无损失自动修吗、值真传到校验点了吗
- [[pi-extension-api-traps]] — 写 pi 扩展时的 API 陷阱：字段值是基线非真实、MCP 工具不进 active 表、宿主内部包不可 import
- [[global-config-contaminates-projects]] — ~/.abs/config.json 的 user 是全局单值：一次手动设值会永久污染之后所有项目的作者标记
- [[normalize-branch-forgot-empty]] — 归一/重建的判定分支要覆盖空态；「反复丢」类现象是真库复现出来的，读代码猜不到
- [[gate-exit-code-not-piped]] — 门禁静默放行：退出码被管道吞掉
- [[tool-empty-vs-no-output]] — 工具的「空结果」不等于「没有输出」
- [[mechanism-visible-vs-effective]] — 机制的「跑了」不等于「起作用了」
- [[2026-11-03-检索有效不等于记忆被用]] — 检索有效不等于记忆被用：主动取靠「触发规则写进 skill 开场」而非「工具更聪明」。实测一场会话 agent 全程没主动调检索，不是命令不够好…
- [[2026-11-03-herdr-里跑-pi-ssh]] — herdr 里跑 pi（SSH 远程）时复制失效：pi 全屏模式强开鼠标跟踪(?1000/1002/1003)截走拖选事件，herdr 收不到选中复制。解法…
- [[2026-11-03-定义了判据却没接到使用侧-比没判据更常见]] — 定义了判据却没接到使用侧，比没判据更常见：abs query 排序混流水页的根因是 lint.js 早有 isTerminal 判据，但 query…
- [[session-digest-design]] — 会话页：把整场会话变成知识的落点（三种形状 + session id 双向挂钩 + 亮度 0.5）
- [[command-surface-narrow]] — 实测 abs 三个重叠命令，删的依据与风险
- [[npm-global-is-symlink]] — 改完代码谁立刻生效、谁必须重装
- [[迁移路径绕过存量宽容]] — prevSig 必须和 text 走同一次迁移，否则历史脏数据会让读取直接崩
- [[入口出口同一判据]] — 检索里排掉一类页，扩散路径必须同判据，否则从邻居绕进来
- [[新机制要重判旧判据]] — ingest 一场一页 vs summon 按天判重：两套粒度不同就会互相埋掉
- [[别用猜的用已有的标识]] — hook 明明有 sessionIdFor 却用 --last 猜，多会话时落错页
- [[detached-子进程的可验证性]] — hook 用 detached+unref，父进程退出后子进程必须仍能完成工作
- [[读改写要加锁]] — 账本实测丢了 29/30，而且不报错，只在下次被当成未完成重催
- [[abs-skill-structure]] — abs 结构与写作规范：七层判据 / 知识页格式 / 受理协议
- [[abs-skill-flow]] — abs 流程：会话落页 / 提炼 / 收尾 / 维护
- [[no-graph-db]] — 不建图数据库：写侧在跑、读侧没人用，整套拆掉

## Entities
- [[AgentBrainSync]] — 本项目实体页：三层架构、代码入口、开发命令
- [[fanchao]] — 使用者；技术栈 / 特点·工作习惯 / 名下踩过的坑

## Sources
- [[2026-11-07-染输入框颜色要连边框一起染-空输入框里没字]] — 染输入框颜色要连边框一起染：空输入框里没字，只染文字等于没改。pi 的边框色来自主题 borderColor，扩展要用 roundBorder…
- [[2026-11-07-发版-1-28-5-时-npm-i-g-会把全局包装成指向仓库的符号链接]] — 发版 1.28.5 时 npm i -g . 会把全局包装成指向仓库的符号链接（依赖从仓库 node_modules 解析），要真实安装得先 npm pack…
- [[2026-11-08-abs-sleep-离线整理方案在-docs-sleep-design-md]] — abs sleep 离线整理方案在 docs/sleep-design.md（仅方案未实现）：夜里补空/压缩会话页/提炼概念/墓碑遗忘，默认 dry-run…

## Syntheses

## Sessions
- [[log-2026-11-02]] — 会话：记忆盒子落地（七层分层 + SQLite 图库 + 亮度检索 + 跨项目共享 + 会话托底 + 自我进化）+ 导入 14 个项目 586 页 + 总结 92 场会话
- [[log-2026-10-09]] — 会话：项目结构化整理（删 12 处死代码 + todo.js 拆 6 模块 + ESLint/CI）+ 会话 sid 归属（塞进已有认领字段）+ 发布 1.17.0；含 flaky 未决与排查方法教训
- [[log-2026-09-16]] — 会话：修复 abs serve 端口写死（默认 7777→0 系统分配），两项目可同时开服务；含 abs note 重复页自坑
- [[log-2026-09-17]] — 会话：更正 queryHint 错误结论(cli 被大写剥离规则挡住论证不成立) + abs ab 补判据可比性自检 + 修 arm 后缀碰撞；沉淀"空测试"概念
- [[log-2026-09-12]] — 2026-09-12（会话快照 + 任务归档）：parseArgv 返回的 opts 同时带 raw 与 normalized 两份 key(keep-days/keepDays, no-mcp/mcp...), 后者才是读者。审查建议收成显式白名单映射…
- [[log-2026-09-09]] — 2026-09-09（会话快照 + 任务归档）：todo Done 按日期分组(### date,新在前)+老格式惰性迁移兼容；wrapup 快照(B)+load滞留展示(A)+hook接入+skill开场强制对账；统一 .brain 文档读写为单一方法(所有需读写…
- [[log-2026-09-15]] — 会话：fnos 安装失败定位为半升级（旧代码1.8.2 + 新布局1.8.3）→ 发布 1.8.4 加安装树守卫；含守卫边界与二次对账
- [[log-2026-09-10]] — 修 Co​dex 安装崩溃(对象 vs 扁平数组) + 补收尾自动化(pi agent_end 注入) + lint 反向死引用检查; 含自动化形同虚设的根因剖析
- [[log-2026-09-08]] — 本轮开发全记录+测试清单（D1收尾→D2→D3→实时化→全局安装）
- [[log-2026-09-13]] — 2026-09-13（会话快照 + 任务归档）：写代码时不登记，只有复盘/手工才更新；skill 双份漂移：仓库 skill/SKILL.md（中文分区名）vs 安装版 ~/.claude/skills/abs-agent-brain-sync/SKILL…
- [[log-2026-10-05]] — 2026-10-05（会话快照 + 任务归档）：宿主升级适配 + todo 自动登记三版迭代
- [[log-2026-09-18]] — 2026-09-18（会话快照 + 任务归档）：发版 1.9.5 + 本地更新（npm publish + 四宿主 abs install）；todo 登记不及时：SKILL 加开工前触发器 + 收尾注入任务优先
- [[log-2026-10-03]] — 2026-10-03（会话快照 + 任务归档）：给 abs 的 todo 加 pi 扩展层常驻指引(治不及时): 在 before_agent_start 往 system prompt 的 Guidelines 段注入 3 条静态指引(动手前 start/完成立刻…
- [[log-2026-10-06]] — 2026-10-06（会话快照 + 任务归档）：index.md 空分区前置空行被归一吃掉：rebuildStructure 对空分区不补空行；空看板也显示面板 + 首轮3条硬规则 + 无图谱自动init + abs update 方向判断；544全通过、破坏验证过…
- [[log-2026-10-07]] — 2026-10-07（会话快照 + 任务归档）：pre-commit 注释/提示说可加 --no-todo，但代码只认 ABS_NO_TODO 环境变量，用户照提示敲 git commit --no-todo 会失败。文档与实现必须一致…
- [[log-2026-10-11]] — 2026-10-11（会话快照 + 任务归档）：提交看板收尾 + 版本号升 1.17.1 + 推送 + npm publish + 本地重装验证；读 /Users/fanchao/.agents/.brain/todo.md，确认总结/misc 被写进 todo…
- [[log-2026-10-16]] — 2026-10-16（会话快照 + 任务归档）：package.json 写 MIT 但仓库根没有 LICENSE；src/todo/spec.js 里 119 行，占文件一半；升 @modelcontextprotocol/sdk 1.30.0 → 1.32.1…
- [[log-2026-10-18]] — 2026-10-18（会话快照 + 任务归档）：重启后验证 MCP 进程已是 1.19.4：孤儿行应阻断写入；子任务完成进 Done 后必须保持缩进挂在主任务下，不能丢层级；闸门四漏全修，629/629 过，已提交 31f9541（原 release-1.19.1…
- [[log-2026-10-20]] — 2026-10-20（会话快照 + 任务归档）：彻底移除旧箭头子项写法及相关命令，统一到标准 md 嵌套列表
- [[log-2026-10-22]] — 2026-10-22（会话快照 + 任务归档）：修审查发现的前三条：fuzz 虚跑的 bp-done、spec.js 重复注释、pi hook 临时取证日志；审查 agent_brain_sync 项目本身：代码、结构、测试、文档一致性；把文档精简 9 条固定进…
- [[log-2026-11-01]] — 2026-11-01（会话快照 + 任务归档）：abs log 落盘时顺手扇出会话：增 size+mtime 预筛避开全读，然后把未总结/有更新的会话提给人；扫 pi 会话目录，把琐碎会话内容总结成知识（L5→L4 提炼）；补上「混沌层没有正常总结」这一环；清…
- [[log-2026-11-03]] — 2026-11-03（会话快照 + 任务归档）：修 query 流水页降权力度不足 + 补 draft 草稿过滤，对齐 db search；全项目审查后修复 4 个 P1 缺陷；新增 abs recall：卡住时按处境主动取相关页；检索结果里给…
- [[log-2026-11-04]] — 2026-11-04（会话快照 + 任务归档）：看面板渲染效果用，看完删；todo 面板标题的 📋 换成新图标；输入框三改：working 改为框上单个运行图标；去左右边距；右侧显示模型名；pi 输入框改成左右两侧都有边线 + 圆角；去掉 pi todo…
- [[log-2026-11-05]] — 2026-11-05（会话快照 + 任务归档）：收尾沉淀 → 推送 git → 发版 1.26.0 → 本地安装验证；db search 加 --no-rules，并发到 MCP 暴露 abs_search；修审查发现：ingest md5 空串、capture…
- [[log-2026-11-06]] — 2026-11-06（会话快照 + 任务归档）：推理关闭时 todo 面板改成灰阶；todo 面板文字色 + 输入框文字色跟随推理强度；提交未提交改动、推送、npm 发布、本地全局更新；命令面 27→14（保留别名）、SKILL 303→~120 行分层、单一入口表…
- [[log-2026-11-07]] — 2026-11-07（会话快照 + 任务归档）：1.28.6 已提交+打标+推送+npm publish；全局包与 ~/.pi 宿主副本已更新到新码（--prefer-online 绕过元数据缓存）；提交待提交改动、bump 版本、npm publish…
- [[log-2026-11-08]] — 2026-11-08（会话快照 + 任务归档）：面板恢复层次：标题/状态亮色，描述/子项灰阶；文字提亮，边框压暗；skill/load/命令 精简；设计在 docs/sleep-design.md：补空/压缩阶梯/提炼/墓碑，四条不碰的红线，M1-M4 分期…
