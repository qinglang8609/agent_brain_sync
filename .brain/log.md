# 🗒 操作日志
## [2026-09-12 23:54] [[fanchao]] dev | 1.7.3 收尾: 沉淀本会话三次同源膨胀为概念页 read-side-output-must-not-scale(Done 68.8% → log条目 → index清单 64%; 判据是'会不会随规模增长'而非'现在是否最大', 因为修完最大的第二大就顶上来) + skill 补'绝不通读 .brain/'(29 页≈11万 token, 单页最大16KB; 给 load/query/只读命中页/ctx_execute 只打印结论 四条正确姿势)。踩到 deploy-artifact-copies: abs install 从全局包取 skill 而非仓库, 故文档改动也须发版才对四宿主生效。279 测试绿, 四宿主 SKILL.md 逐字节一致。
## [2026-09-12 23:47] [[fanchao]] dev | 1.7.2 发布: ①abs load 的 index 区随图谱线性增长(concept 清单带每页描述, 本仓库占 load 64%) → 新增 collapseIndex() 把页面清单折成计数(## Concepts（17 页）), 路线区原样保留(是内容不是清单), 逃生口 abs index; ②OPTS-DOUBLE-KEYS: parseArgv 曾 ...values 叠加 camelCase → opts 双份 key(keep-days/keepDays, no-mcp/mcp), raw 零引用属噪音 → 改显式白名单单份输出, 未知 --flag 静默收下行为保留。实测 load 28442B→4015B(128K 窗口 10.1%→1.4%), 60concepts+400Done 模拟仅 680B。279 测试绿(新增 3) + 双 revert-check。
## [2026-09-12 23:38] [[fanchao]] dev | 1.7.1 修复: abs load 吐出 Done 归档导致上下文膨胀(另一台机器单次 load 吃 40%)。根因: cmdLoad/boardText 直接 todo.trim() 全量打印 todo.md, 而 Done 是无上限增长的归档区, load 是开机读状态入口 —— 职责错配且随历史线性膨胀。修法(读取侧): 新增 collapseDone() 折成按日期计数(日期组最多 7 个, 因日期组本身也增长), load 的「最近动作」每条 clip(220) 语义收口, 逃生口 abs todo --full。实测 28442B→7564B(68.8% 的 Done 段 → 249B), 400 条 Done 时输出恒定 ~930B。MCP abs_load/abs_board 走同函数自动继承。276 测试绿 + 2 新回归 + revert-check。
## [2026-09-12 23:25] [[fanchao]] dev | 发布 1.7.0 并推送(7754ab6 + 289f500 + tag v1.7.0): 作者标记 @name → [[name]] wikilink + 使用者实体页 entities/<name>.md。registry latest=1.7.0(读延迟~5s 后可见), 全局升级完成, 四宿主 install 刷新完毕(hook/MCP/skill 全绿, 四份 SKILL.md 与仓库逐字节相同)。274 测试绿 + lint 0 problem。注: registry 读延迟是 npm-publish-flow 页已记录的老坑, 不是发布失败。
## [2026-09-12 23:22] [[fanchao]] dev | ENTITY-LINK-USER 落地: 作者标记 @name → [[name]] wikilink(@ 去掉, 用合法 slug); 写路径(todo/log/note)自动建 entities/<name>.md 人页(技术栈/特点/名下坑 三空槽), 已存在不动, wx 独占写防并发覆盖, 建了才登记 index; config set user 也即时建页。extractAuthor 兼容新旧双形态, 旧 @name 行原位更新保持旧形态不静默改写。index 行不塞作者(会从"创建者"漂成"最后改的人"), 改 query 输出带页 frontmatter 的 author。274 测试绿(新增 3 条: 建页+index 登记/删页后重建/旧形态保留), revert-check 6 例失败确认盖到; lint 0 problem。本仓库 dogfood: 建了 .brain/entities/fanchao.md 并填技术栈/特点
## [2026-09-12 13:58] @fanchao dev | 发布 1.6.1 (00382db + v1.6.1 tag): 修「未设姓名无主动提醒」。守卫本身报错正确, 但只挂写操作 —— 用户建了图谱、跑 load、一路到第一次 todo add 才撞墙, 中间 init/load/hook 全沉默。补三处: ①abs init 完成后输出 ⚠+设置指令 ②abs load 开场(项目行后、路线前)插提醒 ③teardown-check 收尾注入未设姓名时把「先设姓名」插为第 0 步(否则提醒里的 2/3/4 条条被守卫拦下而提醒本身不提)。已设姓名时三处均不啰嗦。测试 268→272, 三处均 revert-check 验证。顺手修测试隔离: 收尾注入用例与其它用例共享项目目录, 前面用例写过 log.md 使守卫③恒不满足→恒返回{}, 改独立目录。registry latest=1.6.1, 四宿主已刷新。
## [2026-09-12 13:47] @fanchao dev | 发布 1.6.0 并推送(v1.6.0 tag): 新增使用者姓名设置 + 作者标记。src/userconfig.js 新文件(~/.abs/config.json + ABS_USER 覆盖); 新命令 abs config [show]/set user; todo 行 'ID @name — 说明'、log 行 '[@name] kind | 内容'、sources frontmatter 加 author(三项→四项)。关键设计: 守卫只挂写操作 —— hook 在会话结束非交互调 wrapup/teardown-check, 拦了会静默卡断收尾; init 也放行(否则死锁)。配套修 2 个真 bug: upsertTask 原位更新重建整行会静默丢 @author; config set user 'fan chao' 静默只存 'fan'。测试 261→268, 且对 '保留作者' 那条跑破坏验证时发现 268 全绿(即没盖到), 补测后才红。registry latest=1.6.0, 四宿主已刷新。
## [2026-09-12 13:35] dev @fanchao | 作者标记功能落地
## [2026-09-12 13:17] note | over-engineering 审计里的"等价删除"必须先跑到那条分支: 我把 resolveProjectDir 的 if(!dir) return cwd 判为等价冗余删掉(理由: resolve(undefined) 该回退 cwd) —— 实际 resolve(undefined) 抛 ERR_INVALID_ARG_TYPE。node -e 验证时只测了 resolve('/a/b')===resolve('/a/b') 这个恒真式, 没测 undefined 分支就下结论。同一 diff 里 parseArgs 迁移也踩同类: 手写版只认 -- 长选项, parseArgs 把 -X 当成 5 个短选项把正文吃光。判据: 说"行为不变"前, 对每个分支各跑一次新旧对照; 判据不是"读起来等价"。
## [2026-09-12 13:17] dev | 1.5.8 发布并推送(92c2524 + v1.5.8)。过度工程审计清理: 删 src/brainio.js(-157行死代码)/hosts.js 的 mcpServerEntry+settingsPath+hookKind(零读者)/index.js 的 export{basename}/abs agents 隐藏命令/bin/abs.js 死 import cmdBoard; parseArgv 117 行手写 if-else → node:util.parseArgs + FLAG_SPEC 声明表。真 bug 修: teardown mark 曾用裸 homedir() 绕过 ABS_LOG_DIR(测试注入沙盒隔离不到且污染真机去重状态) → 新增 absLogDir() 收口。迁移中我引入并被对抗式审查抓出 2 个回归: P0 resolve(undefined) 抛 ERR_INVALID_ARG_TYPE 而非回退 cwd(显式分支被误判为等价冗余删掉, 致 init/load/board 不带 --dir 全崩); P1 parseArgs 把任何 - 开头 token 当选项连正文一起吃(abs note "-X 是个坑" 静默丢正文只建空目录, 退出 0) → 改用 tokens 的原始 index 只认 -- 开头已知 flag。测试 259→261…
## [2026-09-12 12:33] dev | 1.5.7 发布并推送(987e3c3)。本机生效验证: ~/.cl​aude.json 的 mcpServers.abs 从仓库路径被自动校正为全局包路径, command 保留、49 个顶层键零丢失; cl​aude mcp list 现解析到全局包且 Connected(此前是仓库路径)。全局包已升级到 1.5.7。
## [2026-09-12 12:31] dev | 修 install 路径校正面: ①外部 MCP store 从 1 个扩到 9 个(claude.json/claude mcp.json/Desktop/Cursor/Windsurf/codex config.json 双容器名/.config/mcp/.agents×2) —— 这些是 pi-mcp-adapter hostConfigDiscovery 的权威读取源, 任一处陈旧就会盖过 abs 自己写对的注册; ②codex TOML 的 args 校对改整体替换(新增 findTomlKeyRange), 多行数组不再静默留旧路径, 无 args 行则重写 section; ③校正/清理移到 runInstall/runUninstall 层, 修掉单宿主 --agent codex 漏跑; ④~/.agents/skills/ 只读检测+告警(skills CLI 所有, abs 不写); ⑤清掉三处注释里的 U+200B。测试 248→259 全绿。
## [2026-09-12 12:31] note | ~/.agents/skills/ 不是无主目录, 是 skills CLI(npx skills, ~/.agents/.skill-lock.json 的所有者)的规范存储位置, 各宿主 skills/ 只是它 fan-out 的目标。判据: lockfile 的 skills 字段为空 + 目录 mtime 与某次 abs install 同秒 + 内容逐字节相同 = 手工 cp 的残留副本。abs 不该写那里(绕过 lockfile 会被 sync 覆盖), 正确处置是只读检测+告警+给清理命令。
## [2026-09-12 12:31] note | MCP 陈旧路径不只在一个文件: pi-mcp-adapter 的 hostConfigDiscovery 把 9 个外部 store 当权威读(IMPORT_PATHS+AGENTS_GLOBAL_CONFIG_PATHS+GENERIC_GLOBAL_CONFIG_PATH), 任一处的 abs 条目指向旧路径就会盖过 abs 自己写对的注册。只改自己写的文件不够, 得校正所有会被读走的外部件。另一个坑: 校正逻辑放进某个宿主 installer 里, 单宿主 install/uninstall 就整段跳过 —— 与宿主无关的动作必须挂 runInstall/runUninstall 层。
## [2026-09-12 11:18] dev | 清空 todo 看板：INSTALL-HELP-FOOTGUN 与 NOTE-TAGS-BOOL 复核确认仍可复现并修复（install --help 曾写 15 文件；note --tags 曾写成 tags:[source,true]），LOG-BACKFILL-34 复核残句原文确不存在、维持【否决】。新增 3 条回归测试含 revert-check。
## [2026-09-12 01:59] dev | 发布 1.5.4：摘要写入侧硬切修复上线。registry latest=1.5.4，本机全局已升级并用真实命令实测（155 字长句完整落盘，尾 '全缺失（用户在另一台机器复现）。'），四宿主 hook/skill/MCP 已刷新。打包产物在干净沙盒预验通过后才发。
## [2026-09-12 01:58] dev | 修 LOG-TRUNC-100 并发布 1.5.4：摘要写入侧硬切（同一段文字在 cmdNote 被截 6 次，阈值 24/40/60/100）导致 log/index/文件名处处残句，且 abs load 开机读的就是这份。新增 clip(text,n) 语义边界收口 + slugOf() 标点收口；cmdLog 100→600 码点，cmdNote 各截断收敛，页面新增 TITLE 行。测试 193→197（含 clip 边界、文件名回归、revert-check）；打包产物在干净沙盒实测长句完整落盘。index.md 9 条历史截断描述从源页重建（机器校验：只延长不覆盖 9/9）。旧 log 34 条残句不动（原文从未落盘，不可恢复）。
## [2026-09-12 01:47] dev | 修 LOG-TRUNC-100：摘要写入侧硬切。新增 clip(text,n) 按标点→空格→硬切收口 + slugOf()；cmdLog 100→600 码点，cmdNote 的 6 处截断收敛为完整优先，页面新增 TITLE 行。实测 log 断句 34/85 → 0；index.md 10 条历史截断描述从源页重建为完整句。测试 193→196 (含 clip 4 例边界 + revert-check)，abs load 最近动作端到端验收完整。相邻 bug(NOTE-TAGS-BOOL) 另登记未修。
## [2026-09-12 01:47] note | 散文截断是「摘要读起来抽象」的隐形根因，且它自我掩盖：硬切后的残句看着像模型表述能力差，于是所有人去调 prompt，没人查写入侧。判据可量化：统计落盘文本的行尾是否停在词中间(硬切率)，34/85 条即确诊。修法要收口在一处(单一 clip 函数)，而非每个调用点各截各的(本次同一段文字被截 6 次, 24/40/60/100 四个不同阈值)。
## [2026-09-12 01:46] dev | 验证 LOG-TRUNC-100 修复后 abs load 的最近动作不再断句：本条目为端到端验收样本，含中英文混排 revert-check 与 file-write-locking 与路径 ~/.claude/skills。
## [2026-09-12 01:43] dev | 定位 log/index/对话「抽象」的真因：不是 agent 表述差，是写入口硬切。store.js 的 cmdNote 对同一段文字截 6 次(355 log / 490 query / 520 
## [2026-09-12 01:43] note | 摘要的文字质量由写入口决定，不由写摘要的模型决定：abs 的 log/index 摘要被读起来'抽象'，第一嫌疑不是 a
## [2026-09-11 23:49] dev | 修 Pi 缺失 MCP 注册：installPi 的 withMcp 分支只打印「走 extension 内桥接」却无任何桥接代码，导致无 cl​aude 宿主的机器上 abs MCP 完全缺失（本机
## [2026-09-11 23:48] note | 「间接可用」不是「已配置」: abs install --agent pi 曾只打印「走 extension 内桥接」却
## [2026-09-11 23:47] dev | 纠正 abs MCP 误判：此前结论「Pi 从未注册 MCP」有误——abs 经 mcp-adapter 的 hostConfigDiscovery 间接读 ~/.claude/settings.js
## [2026-09-11 23:47] note | 宿主 MCP「没配置」可能是假象: ~/.pi/agent/mcp.json 的 mcpServers 为空是正确的——
## [2026-09-10 23:30] dev | 更正: 上一条'已沉淀经验(进程快照≠证据)'已撤回 —— 那属 bug-hunter 的排查纪律且它已覆盖('别用单个样本下结论'), 存进 abs 图谱是重复。按'sources 是暂存不是存档'
## [2026-09-10 23:28] dev | 查 MCP 孤儿进程: 结论是不存在泄漏 —— 上次看到两个 mcp.js 是重启过渡态，关 stdin 实验证明 bin/mcp.js 会自退(code=0)。已沉淀经验"进程快照≠证据"; 顺带发
## [2026-09-10 23:28] note | 进程快照会撞上过渡态，不能当证据：重启 pi 时我抓到一张 ps，看到两个 mcp.js 就断定"孤儿进程泄漏"。实际旧
## [2026-09-10 23:23] dev | 修 abs load 的「最近动作」贴最旧几条(log.md 新在上而取的是末尾; 换成 recentLogLines 取前 5 条) + index 路线图不再复述版本号(删重复状态即根除漂移); 
## [2026-09-10 23:18] note | 引用新符号后必须真跑一条命令：node --check 只查语法，查不出"未导入的标识符"，跑到那行才炸 Referen
## [2026-09-10 23:13] dev | 放宽 OVER-SIZE 上限 5120B→8KB(实测偏紧: 68页仅2页超且只超一点; 曾为此把一页从5319B压到4972B), 阈值提成常量避免检查与提示漂移; 189测试绿+revert-c
## [2026-09-10 23:11] dev | 修 lint 提示路径缺 .brain/ 前缀(用户按报的 concepts/x.md 去项目根找不到文件): rel 改 .brain/<dir>/<file>, 7 处提示受益; 含回归测试 + 
## [2026-09-10 23:06] dev | 发 1.5.0: skill 新增「新需求受理协议」(报bug/加功能 → 先总结方案 → abs todo add 登记 → 问是否开工, 含三条例外与入口表分流) + 修 lint 误报 [[to
## [2026-09-10 20:58] note | try/catch 吞异常会把「写错的代码」变成「永远不触发的检查」——本次 lint 的 DONE-PILED-UP 
## [2026-09-10 20:44] dev | 收拾待办看板: Done 区 74→34 行(迁出 09-08/09-09 共 28 条至 sessions/done-archive-2026-09.md, 保留今天)。迁而非删: 51 条 Don
## [2026-09-10 17:59] dev | 修宿主 MCP 注册路径不稳定: ABS_DIR(install.js自己住哪) → mcpEntryPath()(优先全局安装位置); codex 由'已存在即跳过'改为校对校正。四宿主路径已统一。
## [2026-09-10 17:59] note | 宿主 MCP 注册路径必须写"包的稳定安装位置", 不能写 ABS_DIR: ABS_DIR = install.js 
## [2026-09-10 17:47] dev | 修 MCP 可观测性死代码: withTrace 从未被调用 → mcp.log 永不生成; 改为统一 tool() 注册入口(总是包 trace)。171 测试绿 + revert-check。注意
## [2026-09-10 17:33] dev | 命令面重整完成: abs todo 统一读写(task→todo 改名, add/start 等价), 消灭静默吞参; 修 9 处代码内旧命令名(teardown 注入文本/todo 空态提示); 1
## [2026-09-10 16:59] dev | 三件收尾: ①清理我造成的测试残留(2个 mark + hooks.log 19行 /tmp 痕迹) ②wrapup.log 加轮转(与 hooks.log 同类, 原来只追加不清理; 旧块 pars
## [2026-09-10 16:26] dev | 评估并撤销 daemon 方案: 实测 abs 27ms 中 node 启动占 20ms(读写仅3ms), daemon 只省5ms, 收益不抵常驻进程复杂度 → 撤掉3个新文件。沉淀概念页 perf
## [2026-09-10 16:25] note | daemon 被否的决策依据(留档避免重提): CLI+daemon 仅 27→22ms, 收益边际; 而代价是常驻进程
## [2026-09-10 16:25] note | 优化性能前先分解固定开销: 实测 abs 单次 27ms = node启动20ms + 模块加载4ms + 读写3ms。
## [2026-09-10 16:21] note | daemon 设计约束(实测): ①macOS unix socket 路径上限104字节 => socket 放 ~/
## [2026-09-10 16:09] dev | 更新经验: 新增概念页 deploy-artifact-copies(产物三份: 仓库/宿主落点/进程内存 + 全局npm副本; 删文件对已加载进程无效必须重启); file-write-lockin
## [2026-09-10 16:04] dev | 沉淀静默丢数据排查方法论: 新增概念页 silent-data-loss-diagnosis(串行能否复现→组件级压测→临界区 trace 看 orig→write 序列; 证据到手前不给结论)。记录
## [2026-09-10 16:03] note | "并发下才复现"不一定是并发 bug: 先单独压测被怀疑的组件(本次锁单独压 20/20 全对), 再换单线程串行复现。
## [2026-09-10 16:03] note | id/键定位一律全等比对, 禁用 includes/子串: 'T11'.includes('T1') 为真 → T1 误
## [2026-09-10 16:03] note | 定位"丢数据"类 bug 必须看写入序列而非猜机制: 往临界区加 trace(记录每次锁内的 orig→write 指纹
## [2026-09-10 16:02] dev | 修 id 子串匹配丢任务 bug: includes(id) → 行首 id token 全等比对(三处同源: findTaskLine/upsertTask/markDone); 零并发可复现(T1
## [2026-09-10 15:30] dev | 完成 6 项待办 + 3 个真 bug 修复 + 经验沉淀: ①版本对齐误判澄清(本地已 1.1.0) ②git 收尾(7 commits) ③loggedToday 裸日期 substring 守卫
## [2026-09-10 15:28] note | 类型签名/返回码推不出运行时语义: promptAsync 返回 204 void 被推断为"fire-and-forg
## [2026-09-10 15:28] note | 改 hook/插件的部署产物必须同时刷新"仓库 + 全局安装"两份副本, 并删掉已运行进程的旧插件(删文件对已加载进程无
## [2026-09-10 15:28] note | 排查"某行为没发生"先证明上游 gate 满足, 再怀疑下游通道。顺序错了会白花一轮: 本次零 nudge 先怀疑注入通
## [2026-09-10 15:28] note | 守卫(guard)的工具白名单必须按宿主实际用法穷举, 漏一个就把功能静默关掉。opencode 侧 wroteFile
## [2026-09-10 15:28] note | 主动推类 hook(回 decision:block/注入新 turn)必须自带死循环防护: 注入会触发新一轮, 新一轮
## [2026-09-10 15:02] note | 实验中发现: ~/.config/opencode/plugins/probe-oc.ts (上个会话留的探针, ses
## [2026-09-10 15:00] dev | 完成 OC-INJECT-CHANNEL 判定: 实测四通道(prompt_async 204/prompt 200/command 200 均能唤醒 idle session; tui.* 200 
## [2026-09-10 14:59] note | OC-INJECT-CHANNEL 判定实验结论: promptAsync 对 idle(终结态) session 确实
## [2026-09-10 13:21] note | opencode 插件 abs.ts 的导出形状确认: @opencode-ai/plugin 要求 PluginMod
## [2026-09-10 12:05] note | 命令报'看不到新版本'先分两类: 实现不存在 vs 数据/网络不对。本次'abs update 看不到新版本'根因是命令
## [2026-09-10 12:05] dev | 补 abs update + abs --version: 用户报'update 看不到新版本'根因是命令从未实现(不是缓存/网络); update 走 npm 升级后自动刷新四宿主 hook/ski
## [2026-09-10 11:58] dev | 发布正式版 1.0.0: 从 npm 包真机冒烟(四宿主安装+init/task/note/log/load/query/lint/MCP 9工具+插件加载)全通过; 全局升级 1.0.0 并刷新四宿
## [2026-09-10 11:47] dev | 真机验证通过: pi 真实会话首次跑通 agent_end→seen→teardown-nudge 完整链路; seen 痕补记 cwd+brain 使异常可归因; 146测试绿, 发布0.5.1
## [2026-09-10 11:38] dev | 补插件 seen 痕可观测性: 首次 agent_end/session.idle 无条件留痕, 使'未触发/被拦下/已注入'三态可从日志区分; 146测试绿, 发布0.5.0
## [2026-09-10 11:38] note | 可观测性缺口: 插件只在真正注入(nudge)时写日志, 于是查日志时无法区分三种状态 —— ①事件根本没触发 ②触发了
## [2026-09-10 11:35] dev | 补插件行为级测试(9例)+ZWSP守卫(2例): 真import生成产物驱动真实事件+断言日志落痕; 顺带修掉日志前缀里的零宽字符; 144测试绿, 发布0.4.0
## [2026-09-10 11:35] note | 插件验证必须行为级, 字符串断言会漏掉导出方式错误: install.test.js 只 grep 源码文本, 于是 (
## [2026-09-10 11:28] dev | op​encode 插件第二个静默失效: 命名导出→default(export default {id,server}), 修完签名仍 0 触发因插件根本没被加载; 133测试绿, 发布0.3.1
## [2026-09-10 11:28] note | op​encode 插件加载器取 default 导出, 用 export const 命名导出会被静默忽略(mod.d
## [2026-09-10 11:17] dev | op​encode 插件从未触发过(第二半): event 回调签名错({name}→{event})+事件名错(session.start→session.idle) 导致静默失效0条日志; 据官方
## [2026-09-10 11:16] note | op​encode 收尾自动化落地: session.idle 是每轮结束信号(对应 pi 的 agent_end / 
## [2026-09-10 11:16] note | 宿主插件 API 必须按官方类型定义实核, 不能凭印象写: op​encode 插件曾把 event 回调入参写成 ({
## [2026-09-10 11:10] dev | 补 lint 反向死引用检查(INDEX-DEAD-LINK): 原来只查 page→index, 不查 index→page, 归档 source 后 index 残留死引用静默留存; 130测试绿
## [2026-09-10 11:08] dev | 修 Co​dex 安装崩溃 + 补收尾自动化: hooks.json 改对象形态(兼容迁移/卸载双侧), pi 扩展挂 agent_end 注入收尾指令(真改过文件+今日未收尾才推, 每会话一次); 
## [2026-09-10 11:08] note | 收尾自动化的缺口不在'记日志'而在'没人提醒': pi 扩展原来只挂 session_start/session_shu
## [2026-09-10 11:08] note | Co​dex hooks.json 真实形态是对象 {hooks:{EventName:[{matcher?,hooks
## [2026-09-09 12:43] dev | 发布到npm+沉淀发布经验: @fanchao8609/agent_brain_sync@0.1.0成功发布并全局安装(清旧link); 提炼concept npm-publish-flow(2FA/
## [2026-09-09 12:21] dev | 修 pi/opencode 插件生命周期事件灌图谱 log.md: 模板改直写技术日志 hooks.log(与 event.sh 同纪律, ABS_LOG_DIR 可覆盖), 真机 Pi extens
## [2026-09-09 12:02] dev | Done按日期分组: ### date新在前, 老平铺惰性迁移兼容, markDone归组顶部, 125测试绿
## [2026-09-09 11:56] dev | 方案②+wrapup对账落地: skill加跨会话任务只用abs task/原生todo仅会话内草稿规则(全宿主同步), 118测试绿
## [2026-09-09 11:56] note | 方案②落定: 跨会话任务只用 abs task(.brain/todo.md唯一真源), 宿主原生todo(CC/co​
## [2026-09-09 11:52] dev | wrapup收尾保险(A+B): abs wrapup快照滞留进wrapup.log+load顶出上会话滞留(交叉核对自清理)+pi扩展/event.sh Stop触发+skill开场强制对账. 11
## [2026-09-09 00:35] dev | README 更新 + readme 任务归位: README 重写(112行)反映产品模式npm安装(agent_brain_sync)/lock并发写保护/brainio统一读写/moshi共存/
## [2026-09-09 00:20] dev | 收尾: TASK-DEEP-TEST + MD-STANDARD-RW 归位 Done. TASK-DEEP-TEST=四层(CLI/install/MCP/hook)测试110绿+真实冒烟+lock
## [2026-09-08 23:57] note | lock.js并发丢根因: 非锁失效(临界区重叠=0完美互斥), 而是 LOCK_MAX_WAIT_MS=3s太短, 高
## [2026-09-08 23:33] note | 并发写安全审计心法: 别对'所有写入'一律加锁, 先按风险分类——①读改写(读旧覆盖别人新行)才需锁; ②append日
## [2026-09-08 23:31] note | hook测试脆弱点: event.sh 幂等 mark 硬编码 /tmp/abs-hook-<cksum>-<分钟>.m
## [2026-09-08 23:29] note | hooks/event.sh幂等mark文件用date分钟粒度写共享/tmp/abs-hook-*.mark, 跨测试运
## [2026-09-08 23:28] note | abs markdown并发写冲突: 所有读-改-全写回文件操作都应经共享editFile锁(open wx原子锁文件+
## [2026-09-08 23:27] dev | TASK-DEEP-TEST 真实冒烟 + INSTALL-COEXIST: CLI/MCP/hook 三层真机通过; install.js 覆盖式改共存合并(追加保留moshi), 4新测试12/1
## [2026-09-08 23:27] note | 解决 abs 与 moshi-hook 共存: installClaudeCode 从覆盖式 settings.hook
## [2026-09-08 23:14] note | 真实冒烟: CLI/MCP/hook 三层全通过(CLI沙盒项目全链路、MCP独立进程9/9、真实abs-Stop.sh
## [2026-09-08 22:58] dev | 收尾提醒(不越界)落地: Stop hook 在 ~/.abs/log/wrapup.log 留一行 wrapup-remind(session_id); 非 Stop 事件不写; 已重装 4 hoo
## [2026-09-08 22:40] dev | 收尾自动化测试: Stop hook 机械层触发验证通过(hooks.log 落痕/stdout {} /幂等); skill/SKILL.md v2(185行) 同步装到 ~/.claude/ski
## [2026-09-08 22:33] note | 测试 Stop hook 机械层触发通过: 模拟宿主事件 stdin → 落 ~/.abs/log/hooks.log 
## [2026-09-08 22:25] dev | 整合版 skill 重写完成(174行): 以原版为骨架+图谱定位节+每轮结束收尾循环, 清 bootstrap/.sh 旧方法, 分工具/手工边界; 沉淀 concept skill-rewrite-residual-old-methods
## [2026-09-08 22:20] note | skill 重写陷阱: 以旧文档为主时, 旧方法引用(bootstrap.sh/.sh/手工建图)会残留成悬空引用; 必
## [2026-09-08 21:40] dev | 修 log.md 定位: 只记工作成果沉淀, 去掉 task 过程自动刷; 时间戳改本地(原 UTC 差8h)
## [2026-09-08 21:30] dev | 修 done 归位断点残留 bug(markDone trimStart), 50测试绿
## [2026-09-08 21:20] dev | lint 对 sources/ 豁免孤立页检查(abs note 暂存页不再误报 ORPHAN)
## [2026-09-08 20:30] dev | 目录重构: abs/* 上移仓库根做根 npm 包, install.js ABS_DIR 自动适配, 47测试绿
## [2026-09-08 12:24] dev | 整批变更已提交 5 commits (gitignore/PLAN/abs核心/SKILL/brain)
## [2026-09-08 11:15] dev | 补分工节: hook机械记log + task/note实时落盘 + skill自觉深提炼; 37测试绿
## [2026-09-08 10:45] dev | 全局安装 npm link + hook 经 node 调起修复(不依赖 exec 位)
## [2026-09-08 10:00] dev | D1补全: query/lint CLI+MCP, task幂等, done归位Done, hook sh兼容, 29测试绿
