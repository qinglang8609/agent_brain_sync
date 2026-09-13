# 📋 Todo Board
## Backlog
## Today / In Progress
## Blocked
## Done
### 2026-09-13

- [x] SKILL-DRIFT [[fanchao]] — skill 双份漂移：仓库 skill/SKILL.md（中文分区名）vs 安装版 ~/.claude/skills/abs-agent-brain-sync/SKILL.md（英文分区名）不一致。下次改 skill 极易改错一份。建议：安装器从仓库 skill/SKILL.md 单向覆盖，或文档化'安装版为准、仓库版只是模板'。 【落地】 (完成 2026-09-13)
- [x] VERSION-DRIFT-1.7.6 [[fanchao]] — 版本号谎言：v1.7.5 打标后 c3c9974(英文分区名+checkBrainShape)落地但未 bump，全局装 1.7.5 实为旧码。已 npm version patch→1.7.6 发布+全局重装，abs load 实测 checkBrainShape 生效(todo.md 结构重排)。教训:代码前进了版本号没跟=发布流程断，npm view 有 cache 延迟需 --force clean 【落地】 (完成 2026-09-13)
- [x] LOAD-SHAPE-CHECK [[fanchao]] — load 顺手核对 index/log/todo 形状(每次 load 都读这三个): 缺分区=最严重→自动补建(幂等,不覆盖已有内容); 无头(H1不符)→只提醒不自动改(结构可能整体脱轨); 多分区→不管; log 条目只判 '## [' 开头, 不判内容完整(LOG-BACKFILL-34 已定论不修)。正常时静默零字节。已实现+沙盒验证5场景, 未发版(等用户核对) 【落地】 (完成 2026-09-13)
- [x] STRUCT-EN-AND-RULE [[fanchao]] — ①分区名/H1 全改英文(Roadmap/Rules/Graph Index/Activity Log/Todo Board/Done/Archived/Undated) ②load 结构核对: 不符就按标准重建(B档, 自加分区留末尾, 内容零丢失, 幂等) ③新增 abs rule 命令+MCP abs_rule+lint 两项检查(RULES-PILED-UP/TOO-LONG) ④skill 按文件结构重写+精简(342→272行, -32%) ⑤5 个真实项目已迁移(内容零丢失) (完成 2026-09-13) 【落地】 (完成 2026-09-13)

### 2026-09-12

- [x] OPTS-DOUBLE-KEYS @fanchao — parseArgv 返回的 opts 同时带 raw 与 normalized 两份 key(keep-days/keepDays, no-mcp/mcp...), 后者才是读者。审查建议收成显式白名单映射。收益=形状整洁, 风险=再碰刚修好的解析路径(现有 9 条测试钉着)。低优先。 【落地】 (完成 2026-09-12)
- [x] ENTITY-LINK-USER @fanchao — 作者标记 @name → [[name]] wiki 链接格式; 用户独立实体页 entities/<user>.md (含技术栈/特点, config set user 或首次写操作时创建); extractAuthor 兼容旧 @name 与新 [[name]]; index.md 不塞作者, 改 query/load 输出附带页 author; lint 加 [[人名]] 有人页存在校验 【落地】 (完成 2026-09-12)
- [x] USER-ATTRIBUTION @fanchao — abs 增加用户姓名设置: 未设则写操作报错要求设置; todo/log/生成的文档标记 @name。方案已过目, 待用户确认三个歧义点(检查放哪层/配置存哪/标记格式与位置)后开工 【落地】 (完成 2026-09-12)
- [x] SMOKE-TEST — 验证作者标记 @fanchao 【落地】 (完成 2026-09-12)
- [x] ZW-CHARS-IN-COMMENTS — src/install.js 三处注释(:152/:209/:723)含 U+200B 零宽字符, 会让基于文本的匹配(edit/grep)静默失配 —— 本次修 bug 时反复踩到(edit 的 oldText 永远匹配不上, 因为多了一个不可见字符)。已清除, 两个源文件现为 0 处 Cf 字符。 【落地】 (完成 2026-09-12)
- [x] AGENTS-SKILL-READONLY-DETECT — ~/.agents/skills/ 归 skills CLI 所有(abs 不写它), 但常有一份手工 cp 的残留副本会与真身脱节。处置: 只读检测+告警+给清理命令, 绝不代删代写。内容逐字节相同则静默, --no-skill 时不检查。 【落地】 (完成 2026-09-12)
- [x] CODEX-TOML-ARGS-MULTILINE — codex config.toml 的 [mcp_servers.abs] 路径校对曾经只找单行 /^\s*args\s*=/ 原地替换 —— args 写成多行数组时那行不匹配, 走 else 只打印'无 args 行,未动', 旧路径静默保留。且 body.includes 判等会被 command 行里的同串骗过。修法: 新增 findTomlKeyRange 把 args 作整体替换(跨行吃到配对 ]); 无 args 行则整段重写 section。 【落地】 (完成 2026-09-12)
- [x] MCP-FOREIGN-STORE — install 时校正 9 个外部 MCP store(~/.claude.json、~/.claude/mcp.json、Claude Desktop、Cursor、Windsurf、codex config.json 双容器名、~/.config/mcp/mcp.json、~/.agents/mcp.json ×2)里已存在的 mcpServers.abs.args。只改 args 不动 command、不新增条目、缺失/坏 JSON 静默跳过、幂等不写。uninstall 对称只删该键。校正挂在 runInstall/runUninstall 层(与宿主无关, 否则 --agent codex 单宿主路径漏跑)。 【落地】 (完成 2026-09-12)
- [x] LOG-BACKFILL-34 — 【已决定不修】log.md 34 条历史残句。事实认定: 完整原文在文件/git 全历史/归档 session 页均不存在(逐 commit 核对), 截断发生在写入时且原文已销毁 → 属不可恢复, 只能推断重写。风险实证: 本次试写批量脚本即把'修 Pi 缺失 MCP 注册：'整段开头吃掉(已回滚并逐字节校验)。已向用户确认: 旧的不管。保留此条仅为记录认定结论, 避免后续会话重复调查。新写入自 1.5.4 起不再截断。 【否决】 (完成 2026-09-12)
- [x] NOTE-TAGS-BOOL — abs note --tags 被解析成布尔 true → frontmatter 写成 tags: [source, true], 且 'abs,摘要' 还粘进了正文。复现: abs note '测试' --tags abs,摘要 → 页头 tags:[source,true]。根因疑在 bin/abs.js 的 parseArgv: --tags 被当成无值开关(与 --note 同类形态), 或值与下一位置参数错位。验证: 断言 tags 行含传入的各标签且正文不含标签串。非本次 LOG-TRUNC-100 引入(旧版同样复现, 已对 pristine 版验证) 【落地】 (完成 2026-09-12)
- [x] INSTALL-HELP-FOOTGUN — abs install --help 会静默执行全量安装而非打印帮助。根因: bin/abs.js 把 --help 只当顶层命令处理(case 'help': case '--help'), 跟在 install 后面时落到 parseArgv 的通用分支 o['help']=true, 而 install 分支根本不读它 → 走安装路径。危害: 用户想看帮助却改了四宿主配置(幂等所以不炸, 但是意外副作用)。修法: ①install/uninstall 分支开头检查 opts.help 则打印该命令用法并 return ②或在 parseArgv 里遇 --help 直接短路。验证: abs install --help 不产生任何文件写入(沙盒断言), 且输出用法 【落地】 (完成 2026-09-12)
- [x] LOG-TRUNC-100 — log.md/index.md 写入口硬切 100 字符，34/85 条 log 断在词中间(revert-c/file-write-lockin/~/.cl​aude/ski)，且 abs load 开机读的就是这份残句 → 用户/AI 看到的'最近动作'天然是半句。根因: src/store.js:355 cmdLog 的 .slice(0,100) + index 描述复用同一段截断文本(store.js:~519) + slugify 后标题也截断造成死链标题([[2026-09-10-主动推类-hook-回-decision-blo]])。修法候选: A 删截断(最省, log 本为人类摘要) B 切句读边界 C 支持 ↳ 续行。验证: 断言写 200 字 log 后落盘完整 + index 描述非截断拼接 + 页面标题不被切。修完后需重新生成/修正 index 里已生成的截断标题  【落地】 (完成 2026-09-12)
  ↳ 断点: 已定位扩大: 同一段文字在 cmdNote 里被截 6 次(store.js:355 log / 490 query / 520 slug=文件名 / 529 H1 / 546 index描述 / 557+558 转发与回显), 截断值还各不相同(24/40/60/100)。所以 note 落盘是 slug、标题、index 描述三重残句 —— 例: 文件名 ...-decision-blo, index 描述 'promptAsync 对 '。修法建议: 只在一处收口(引入 clip(text, n, boundary) 按标点/词边界收尾), slug 从完整文本取前 24 字后仍保留完整 TITLE 字段。落点见 src/store.js。
- [x] PI-MCP-NOOP — 已修并发布 1.5.3。installPi 的 withMcp 分支只打印「MCP → Pi 走 extension 内桥接」却无任何桥接代码 —— 生成的 abs.ts 只 spawn abs wrapup + 挂 3 个 pi.on()，从不碰 bin/mcp.js。本机靠 mcp-adapter 的 hostConfigDiscovery=on 间接读到 ~/.claude/settings.json 的注册才侥幸可用，无 claude 宿主的机器上 abs MCP 完全缺失（用户在另一台机器复现）。修法：真写 ~/.pi/agent/mcp.json 的 mcpServers.abs={type:stdio,command:node,args:[mcpEntryPath()]}，路径走 mcpEntryPath 解析包稳定安装位置而非 ABS_DIR；uninstallPi 同步只删 abs 条目不误删他人 MCP。验证：+4 回归测试（真注册 / 幂等重装保留既有 mcpServers+settings+imports / 卸载只删自己），全量 193 pass；npm pack 解包产物在干净沙盒（无 claude/codex/opencode）直跑装 pi 成功注册；端到端拉起 serverInfo abs 1.5.3 + 9 tools；已发 registry latest + 本机全局升级 + 四宿主刷新。  【落地】 (完成 2026-09-12)
