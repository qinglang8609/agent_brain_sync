# 🗂 Graph Index

本文件唯一入口。每新建/大改一个知识页，同步在此分类下加一行 `[[页面名]] — 一句话`。

## Rules
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
- 靠提醒才能工作的功能，该删不该补。
- 先列≥2假设+反证条件；自造输入测出的结果不算证据。
- 结论要明确：给结论+依据+下一步；不定位要说清缺什么。
- 改布局/签名/协议必须与读它的一方同一个 commit；分开就是静默失效

## Concepts
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
- [[host-plugin-silent-failure]] — 宿主插件"静默失效"三坑: 可观测性(缺无条件 seen 痕)/回调签名错/导出方式错; 装上了≠加载了≠触发了
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

- [[vacuous-test-passes-on-broken-code]] — 空测试：恒真断言，破坏代码也全绿

- [[guard-check-then-set-across-await]] — 守卫的检查与置位跨 await 就会漏：并发调用一起通过
## Entities
- [[AgentBrainSync]] — 本项目实体页：三层架构、代码入口、开发命令
- [[fanchao]] — 使用者；技术栈 / 特点·工作习惯 / 名下踩过的坑
- [[tester]] — tester — 使用者；技术栈 / 特点 / 名下踩过的坑

## Sources
- [[2026-09-17-对照实验实测-2026-09-16-abs]] — 对照实验实测(2026-09-16): abs 经验确实被读到并改变行为, 但增益集中在'现场验证不出来+失败无信号+错误需求'三类知识。T1 有效对照:…
- [[2026-09-17-做关键词排序-queryhint]] — queryHint 三条实测: CLI 被大写剥离规则挡在词表外(故 df 重叠论证不成立, 前版已作废) / df 阈值 T=11~15 不起作用 / 剔高频词后 top3 仍噪音; 修复方向未定
- [[2026-09-18-user-名残留会让新项目任务全标错作者]] — user 名残留会让新项目任务全标错作者：~/.abs/config.json 的 {user} 是单一全局值，一次手动 'abs config set…
- [[2026-09-18-todo-是-随做随写-的活看板-攒到最后补]] — todo 是'随做随写'的活看板，攒到最后补 = 看板在被人看的时候是空的，跨会话续接丢锚点。abs 的 start/done 是任务行级操作（与已砍掉的…
- [[2026-09-18-npm-publish-报]] — npm publish 报 '+ pkg@ver' 后 registry 读到 404/E409 不等于发布失败：实测 1.9.4/1.9.5 均成功…
## Syntheses

## Sessions
- [[log-2026-09-16]] — 会话：修复 abs serve 端口写死（默认 7777→0 系统分配），两项目可同时开服务；含 abs note 重复页自坑
- [[log-2026-09-17]] — 会话：更正 queryHint 错误结论(cli 被大写剥离规则挡住论证不成立) + abs ab 补判据可比性自检 + 修 arm 后缀碰撞；沉淀"空测试"概念
- [[log-2026-09-12]] — 2026-09-12（任务归档）
- [[log-2026-09-09]] — 2026-09-09（任务归档）
- [[log-2026-09-15]] — 会话：fnos 安装失败定位为半升级（旧代码1.8.2 + 新布局1.8.3）→ 发布 1.8.4 加安装树守卫；含守卫边界与二次对账
- [[log-2026-09-10]] — 修 Co​dex 安装崩溃(对象 vs 扁平数组) + 补收尾自动化(pi agent_end 注入) + lint 反向死引用检查; 含自动化形同虚设的根因剖析
- [[log-2026-09-08]] — 本轮开发全记录+测试清单（D1收尾→D2→D3→实时化→全局安装）
- [[log-2026-09-13]] — 2026-09-13（会话快照 + 任务归档）
- [[log-2026-09-18]] — 2026-09-18（会话快照 + 任务归档）
