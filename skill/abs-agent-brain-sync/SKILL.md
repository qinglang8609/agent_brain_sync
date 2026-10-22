---
name: abs-agent-brain-sync
description: "USE FOR abs / agent-brain-sync 跨会话记忆与任务续接。触发词：用户直接输入 abs（单独一个词或 abs + 命令，如 'abs 开工'、'abs 沉淀'），以及「开工续接状态」「沉淀会话收获」「任务登记不丢」「经验落成知识页」「图谱体检」等任务。"
---

# abs — 跨会话记忆 (agent-brain-sync)

## 触发器

**关键词不是触发器，意图才是。**句子里出现 todo / 沉淀 / load / note 这些词，若是谈论、提问、定规则，只回应不执行。

唯一例外：用户直接输入 `abs`（单独一个词，或 `abs` + 命令，如 `abs 开工`）—— 这是明确要用 abs，直接执行；无子命令时走开工续接。

## 命令速查

完整帮助 `abs help`。读写优先走 MCP（`abs_load`/`abs_task`/`abs_note`/`abs_query`/`abs_lint`/`abs_rule`），比 CLI 快；`abs wrapup`/`abs teardown-check` 是 hook 内部命令。分工：hook 记技术日志；CLI/MCP 实时落盘；skill 负责深提炼 + 收尾 + 修 index。

```bash
abs load                          # 开机读状态
abs query <词>                    # 检索；abs resolve <页名> 反查路径
abs todo add <id> --note "做什么"   # 登记；note/memo/state/done 见「进行中」
abs note "经验" [--tags a,b]      # 暂存经验
abs concept <slug> --title "…"    # 建概念页骨架
abs rule add "一句话"             # 加 Rules；abs lint 体检；abs init 建图谱
```

## 文档精简（硬规则，写 todo / 知识库文档必须遵守）

1. 所有内容必须服务于主题目标，与主题目标无关的直接去掉。
2. 不允许盲目总结，没有经过验证的经验和总结，直接去掉。
3. 文档永远保持秩序，提高可阅读性，层次分明。
4. 清爽的文字风格，禁止反转反问、猜测。
5. 加快运行速度，提高运行效率。
6. 拒绝重复，其他文档存在的方法优先引用，拒绝反反复复写。
7. 禁令内容不要唠叨，直接了当。
8. 不要过度揣测：用户没说的不要替他补，给了要求就做要求内的。
9. 说中文，说人话；表达通畅、有前因后果，不堆抽象名词、不自造新词。已经说过、已经确定的事不重复。

写入 `.brain/` 的 todo 行、log 行、知识页、sessions 快照，生成时按上面九条自检。

## 入口：先找图谱再分流

1. **找图谱**：只看**当前目录**是否含 `.brain/`，先 cd 到项目根。不向上搜索（会命中 `~/.brain`，把项目挂错）。
2. **没有图谱**：意图是沉淀或即将开工的长期任务（"帮我做 X / 开工 / 修 X"）→ 先 `abs init`；闲聊、一次性问句、明说不要建档、只读目录 → 不建档。
3. **分流**：

| 用户意图 | 走哪 |
|---|---|
| 总结经验 / 结束了 / "把这次记下来" | 收尾循环 |
| 查询坑 / "我上次怎么解决 X" | `abs query` |
| 体检图谱 | `abs lint` |
| 开新任务 / 继续开发 | 开场 Init Sync |
| 报 bug / 要求加功能 | 受理协议 |
| 意图不明 | 续 todo |

意图不明且项目有 `.brain/` 时，默认续 todo。

## 新需求受理协议（先方案 → 再登记 → 问开工）

用户报 bug 或要求加功能时先别动代码：

1. **总结方案**（一屏内）：准确复述需求（不确定就写明假设）；bug 给根因，功能给做法；要改哪些文件、怎么验证。
2. **登记 todo**：`abs todo add <id> --note "<需求+关键约束>"`；根因/取舍用 `abs todo note <id>` 追加成子项。
3. **问是否开工**：明确问一句，等确认再改代码。

**例外（可直接开工，回复里说明援引哪一条）**：用户已说"开工/直接做/修它"；一行级修字、纯查询、纯收尾沉淀；同一需求已登记且用户确认过。

## `.brain/` 怎么组织

`.brain/` 放项目根，一个项目一份，`abs status` 显示当前定位。

| 位置 | 放什么 | 硬约束 |
|---|---|---|
| `index.md` | `## Rules` 铁律 + 各类页清单 | Rules 一句一条不带链接，只有「违反会丢数据/静默失效/白干活」级才进，>42 字符或含链接被拒；清单每页一行 `- [[slug]] — 一句话` |
| `log.md` | 成果流水，倒序一行 | 只记成果，不记工具动作 |
| `todo.md` | 活看板 | 只有 `## Todo`/`## Done`；Done 必带 `【落地/否决/仅方案】`+`(完成 YYYY-MM-DD)` |
| `entities/` `concepts/` | 具名事物（`Docker.md`）/ 可复用规律坑（`docker-prisma-429.md`） | 拿不准默认进 `concepts/` |
| `sources/` `syntheses/` | 经验暂存 / 横向选型取舍 | sources 是暂存，提炼后删 |
| `sessions/` | 会话快照 + 当日归档段 | **一天只允许一个 `log-<日期>.md`**，多主题写多个 `##` 段 |

`todo.md` 行形态：`- [ ] [进行中] <id> [[认领人]] — 说明 (认领 YYYY-MM-DD)`（标记还有 `[讨论中]`/`[滞留中]`；`[[认领人]]` 是使用者名）。`abs todo done <id>` 勾选并归位到 Done 日期组顶部，已勾子项随迁；超 3 天**且整天已完成**的组由 `abs wrapup` 迁进当天快照归档段（任一天还有未完成则整天不归档）。

`sessions/` 快照 = 正文 + `## 关联连接` + `## 🪝 Next Session Hook`（强制）+ `## 📦 任务归档`（机器写勿手改）。归档唯一动作 `abs todo archive`：已有快照只替换归档段，段外逐字保留；那天没有快照就建一个只含归档段的页；同日重复归档在段内追加。

### 容量纪律（写任何页之前过四关）

① **再命中** —— 下会话不知道这条会踩同坑/重做同决定？不会就不存，grep 得到的不记。② **单页上限** —— `entities/concepts/syntheses` 单页 <150 行且 <8KB，超了拆或外链。③ **sources 是暂存** —— 提炼后删并清引用。④ 能用一行链接代替新增整页吗？

## 开场：Init Sync（开工 / 默认续 todo）

1. **读状态**：`abs load`（MCP `abs_load`）读 Rules + 图谱计数 + todo + 最近 log，**先看 `## Rules`**。输出已折叠，全量明细用 `abs todo --full` / `abs index`。
2. **对账滞留（强制）**：顶部出现 `⏳ 上会话滞留` 说明上会话断了，先收尾再开工 —— 做完的 `abs todo done <id>`；没做完的 `abs todo note <id> --note "接到哪"`。
3. **读命中页**：`abs query <词>` → `abs resolve <页名或id>` 拿路径，**只读命中那几页**，绝不通读 `.brain/`；多文件汇总交 `ctx_execute` 在沙箱处理，只打印结论。
4. **续 todo**：把顶部未完成项当当前任务开做；有新任务而 todo 没有 → `abs todo add <id> --note 做什么` 再动工。

## 进行中：什么时候动它

todo 是随改随写的活看板，和 git commit 同反射。

| 时机 | `abs_task` action | 落到哪 |
|---|---|---|
| 认领新任务 | `start` + note 做什么 | Todo `[进行中]` |
| 只讨论没动手 / 卡住等人等数据 | `state` + note 讨论中\|滞留中 | 原地改标记 |
| 被打断 / 干到一半 | `note` + 改到哪个文件哪一步 | 任务下追加一条子项（**一句话**） |
| 干活中随手记多句发现 | `memo` + 原文 | `sessions/` 当日笔记，**不上看板** |
| 子任务做完 | `done` + note 结语 + as 落地\|否决\|仅方案 | Done |
| 总结出经验/坑/规律 | `abs_note` text + tags | `sources/` |

**四个落点的区别**：

- `note` = **子项**，一句话**追加式**（每次多一条，不覆盖），上看板。
- `memo` = **随手记**，可多句**追加式**，不占看板。
- `abs_note` = 提炼过的**经验/坑**，一句话结论 → `sources/` 待提炼。
- `abs log` = 一轮干完的**成果流水**行，不占看板。

过程随手记走 `memo`，别塞 `todo.md`（Todo 区有**白名单闸门**：只收任务行、缩进子项、空行、标题，其余拒写报错）。

```bash
abs todo memo <id> "第一句：根因是判据极性。第二句：改成白名单就不漏了。"   # 记（可多句）
abs todo memo <id>                                                       # 查看
```

任务 `done` 后笔记文件留在 `sessions/`，随当日归档。

**开工前三条硬规则**：

1. **开工前先登记** —— 认领任何要动文件/跑命令的任务，第一步是 `abs_task` action=start，然后才读第一个文件。名字想不到就先起粗糙的（`fix-hook-nudge`）：名字可事后改，**未登记的开工补不回来**。
   - 登记只能由你主动做（hook 看不到"这是件什么事"）；别抄用户原话。
   - 改 id：`abs todo rename <旧id> --note "<新id>"`。
2. **一段活儿干完立刻 done** —— 不等整个需求收尾。宁可拆 5 条小的，别攒 1 条大的。
3. **超过两三轮还没登记 = 已在失控路上** —— 立刻补 `start`。

经验刚冒出来就 `abs_note` 暂存（幂等去重），宁少勿滥。**跨会话任务只用 abs todo**，别用宿主原生 todo（TodoWrite / `/list`），那些不写 `.brain/todo.md`，下会话接不上。

## 收尾循环（用户明确要求收尾时才走）

1. **读 todo**：`abs load`，看还有哪些没完成。
2. **对账**：按「进行中」四个落点补记 —— 漏登记的 `done`、做一半的补 `note` 子项、卡住的转 `滞留中`。
3. **沉淀经验**（值得才沉淀）：坑/可复用技巧 → `abs note` 暂存；值得深提炼的走 Teardown。
4. **判教训够不够格进 Rules**：是否「违反会丢数据/静默失效/白干活」级？够格就输出一行 `[Rules 提议] <一句话>` 问用户，确认后才 `abs rule add "<一句话>"`；不够格不提。
5. **更新 index/log/todo**：新页同步进 index；`abs log "完成 X：..."`；`abs lint` 确认自洽。

**完成标准**：看板反映真实状态（Done 无滞留半成品）、该沉淀已落、够格教训已提议、index/log/todo 与事实一致。

Stop 时 hook 把「未完成 + 子项」快照进 `~/.abs/log/wrapup.log`，下会话 `abs load` 自动顶到顶部。不往对话里插收尾提醒。

## 收尾：Teardown Sync（深提炼）

把**真实发生**的写回图谱，只写做过/跑过/测过的事实。按序：

1. **暂存线索**：`abs note` 记做了什么、改了哪些文件、验证命令。
2. **抽规律**：`abs concept <slug> --title "…"` 建页（自动带四段骨架）再填；四段别缺，尤其末尾「验证」段（`abs lint` 报 NO-TAIL）。留不留、新建还是并入由你判断；核实过的 `status` 改 `active`。
3. **查推翻**：旧页有被推翻的说法 → `abs supersede <旧页> --by <新页>`，别删页。
4. **沉淀实体 / 综合**：重要未记录的事物 → `entities/<TitleCase>.md`；选型取舍 → `syntheses/`。
5. **收拢 sources**：提炼成规律的删 source，**同步清指向它的引用**（防死链）。
6. **修 index + 记 log**：新页同步 index；过门槛的规律加进 `## Rules`。
7. **留接力棒**：`sessions/log-YYYY-MM-DD.md` 写 `## 🪝 Next Session Hook`。

## 知识页格式

统一 frontmatter：`tags / author / updated / status`。`tags` 首标签 ∈ `entity|concept|source|synthesis|session-log`；`author` 与 `entities/<name>.md` 同名。

**`status` 只有三个值**：`active` 当前有效（缺字段默认）；`draft` 待核实（`abs note` 默认，展示标 `[draft 未核实]`）；`superseded` 已被推翻，别再依据（`query` 默认隐藏）。推翻用 `abs supersede <页名> --by <新页>`（写 `superseded-by`；不写 `--by` = 单纯弃用；指向不存在的页会被拒）。历史必须留，核实后仍有效就改回 `active`。

- **每页必须有 `## 关联连接`**，用 `[[页面名]]` 链相关页，解释写在 `—` 后（`[[x]] — 节流判据要对齐真收尾`），只写链点等于没链。
- **命名即链接**：`[[Docker]]` → `entities/Docker.md`，`[[docker-prisma-429]]` → `concepts/`。不建别名层。
- **知识冲突**：不静默覆盖，加 `## 知识冲突`，两版都留、标来源时间，交人工裁决。
- 概念页骨架：`触发场景 / ❌表现(贴报错) / 🛠解法(根因+修复+验证命令) / 关联连接`。

## 维护：query / lint

- `abs query <词>` → 读命中页 → 答用 `[[页面名]]` 标来源。代码问题（符号在哪/谁调用）不在 `.brain`，直接读源码；已推翻经验默认不返回（`--all` 可看）。
- `abs lint` 报错码：`NO-INBOUND` / `SOURCE-UNDISTILLED` / `SUPERSEDED-DANGLING` / `DRAFT-STALE` / `NO-TAIL`。

## ⛔ 禁止做

1. 禁止手工建骨架 / 手工登记任务 —— 用 `abs init` / `abs todo add`。
2. 禁止由关键词直接触发动作 —— 拿不准先问。
3. 禁止通读 `.brain/` —— 要状态用 `abs load`，要主题用 `abs query`，要单页用 `abs resolve` 后只读那页。
4. 禁止删知识页表达"已失效" —— 用 `abs supersede`。
5. 禁止归档单独建文件 / 一天拆多个快照 / 手工搬大文件 —— 用 `abs todo archive`；一天只有一个 `log-<日期>.md`；大文件进 `sources/` 或摘规律进 `concepts/`。
6. 禁止编造没跑过的验证结论 —— 只写做过/跑过/测过的事实。
7. 禁止直写 Rules —— 先 `[Rules 提议]` 问用户，确认后才 `abs rule add`。
8. 禁止用宿主原生 todo 承载跨会话任务 —— 用 `abs_task`。

## 自我约束

只读写 `.brain/` 与目标代码，不动全局配置（一次性接入除外）；双链、frontmatter、index 必须自洽，坏链等于掰断接力棒。
