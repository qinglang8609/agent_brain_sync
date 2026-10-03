---
name: abs-agent-brain-sync
description: abs (agent-brain-sync) 跨会话记忆与任务续接。适用于「开工续接状态」「沉淀会话收获」「任务登记不丢」「经验落成知识页」「图谱体检」等任务。
---

# abs — 跨会话记忆 (agent-brain-sync)

## 最高优先：触发总则（凌驾本文所有流程）

**关键词不是触发器，意图才是。**句子里出现 abs 词（收尾/todo/沉淀/load/log/note）不等于要执行 abs 动作：谈论、提问、吐槽、定规则（"太啰嗦""这个设计怎样"）**只回应，不执行动作**；明确让我做事才执行。

- 拿不准时**先问**。规则变更（"以后简短点"）写入本文，不执行动作。
- 输出简短：收尾/提示/todo 汇报一两句。本总则适用于所有工具。

## 命令速查

完整帮助：`abs help`。agent 读写优先走 MCP（`abs_load`/`abs_task`/`abs_note`/`abs_query`/`abs_lint`/`abs_rule`）比 bash 跑 CLI 快；`abs wrapup` / `abs teardown-check` 是 hook 内部命令。
分工：hook 自动记技术日志到 `~/.abs/log/`（不用管）；CLI/MCP 实时落盘；**skill 负责深提炼 + 收尾 + 修 index**。

```bash
abs load                          # 开机读状态；abs query <词> 检索；abs resolve <页名> 反查路径
abs todo add <id> --note "做什么"   # 登记（note 补断点 / state 改标记 / done 完成）；abs log "完成 X" 记成果
abs note "经验" [--tags a,b]       # 暂存经验；abs concept <slug> --title "…" 建概念页骨架
abs rule [add "一句话"]           # 读写 ## Rules；abs lint 体检；abs todo archive 归档；abs init 建图谱
```

## 触发总入口（每次命中技能，第一步先走这里）

技能被触发时第一步走这条链，再看用户要什么：

1. **找图谱**：只看**当前目录**是否含 `.brain/`。不许向上搜索（会命中 `~/.brain` 的无关图谱，把项目静默挂错），必须 cd 到项目根。
2. **没有？按意图定建档**：意图是**沉淀**或**即将开工的长期任务**（"帮我做 X / 开工 / 修 X"）→ **先 `abs init`**，别在没图谱时就开写；**闲聊 / 一次性问句 / 明说不要建档 / 只读目录** → 不建档，当普通会话处理。
3. **有/刚建好？分流**：

| 用户意图 | 走哪 |
|---|---|
| 总结经验 / 结束了 / "把这次记下来" | 收尾循环（沉淀） |
| 查询坑 / "我上次怎么解决 X" | `abs query` 检索 |
| 体检图谱 / `abs lint` | `abs lint` |
| 开新任务 / 继续开发 / "帮我做 X" | 开场 Init Sync（续接）；新需求先走受理协议 |
| 报 bug / 要求加功能 | **受理协议**：先方案 → 再登记 → 问开工 |
| 意图不明 / 默认 | **续 todo**：读未完成项开工续做 |

**主心骨**：意图不明且项目有 `.brain/` 时，默认**续 todo**。

## 新需求受理协议（bug / 新功能：先方案 → 再登记 → 问开工）

用户报 bug 或要求加功能时先别动代码，三步：

1. **总结方案**（一屏内，给用户过目）：准确复述需求（不确定就写明假设）；bug 给根因、功能给做法；要改哪些文件、怎么验证。
2. **登记 todo**：`abs todo add <id> --note "<需求+关键约束>"`；根因/取舍用 `abs todo note <id>` 落到断点。
3. **问是否开工**：明确问一句，**等确认再改代码**。

**例外（可直接开工，回复里须说明援引哪一条）**：用户已说"开工/直接做/修它"；一行级修字、纯查询、纯收尾沉淀；同一需求已登记且用户确认过。

`.brain/` 放项目根，一个项目一份；所有命令只认当前目录的 `.brain/`，不向上搜索。`abs status` 显示当前定位。

## `.brain/` 怎么组织

`.brain/` 文件结构（`abs init` 生成，`--repair` 只补缺不覆盖）：

文件结构（全部在 `.brain/` 下）：

```
/ .brain/
  index.md  log.md  todo.md
  entities/  concepts/  sources/  syntheses/  sessions/
```

| 位置 | 放什么 | 硬约束 |
|---|---|---|
| `index.md` `## Rules` | 本项目铁律 | 一句一条，不带链接；只有「违反会丢数据/静默失效/白干活」级才进（普通经验进 `concepts/`）；>42 字符或含链接/URL 被拒 |
| `index.md` 清单区 | 各类页清单 | 每页一行 `- [[slug]] — 一句话` |
| `log.md` | 成果流水，倒序一行 | 只记成果，不收工具动作流水（那在 `~/.abs/log/`） |
| `todo.md` | 活看板，只有 `## Todo` + `## Done` | 未完成用行首标记 `[进行中]`/`[讨论中]`/`[滞留中]`；Done 必带 `【落地/否决/仅方案】` + `(完成 YYYY-MM-DD)` |
| `entities/` | 具名事物（"它是什么"） | `Docker.md` |
| `concepts/` | 可复用规律/坑（"这么做就避坑"） | `docker-prisma-429.md`；归类拿不准时默认这里 |
| `sources/` | 经验暂存（`abs note` 自动落） | `YYYY-MM-DD-slug.md`；是暂存，不是归档 |
| `syntheses/` | 横向选型/架构取舍 | `synthesis-slug.md` |
| `sessions/` | 会话快照 + 当日归档段 | **一天只允许一个文件，只能叫 `log-<日期>.md`** |

`todo.md` 行形态：`- [ ] [进行中] <id> [[认领人]] — 说明 (认领 YYYY-MM-DD)`（`[[认领人]]` = 使用者名，非任务名）。`abs todo done <id>` 勾选并归位到 Done 日期组顶部，断点（`↳` 行）随迁；超 3 天且整天完成的组由 `abs wrapup` 迁进当天快照的归档段。

**`sessions/` 一天一个文件**（多主题多写几个 `##` 段，不许拆文件），含快照正文（AI 手写）+ `## 关联连接` + `## 🪝 Next Session Hook`（强制）+ `## 📦 任务归档`（机器写，勿手改）。归档唯一动作 `abs todo archive`：已有快照只替换归档段（段外内容逐字保留），没快照则建一个只有归档段的文件，同日二次归档段内追加。

`abs lint` 兜底：死链 / 孤岛 / 悬挂页 / 缺 frontmatter / 超限 / sources 堆积 / 超龄未提炼 / index 漏列 / Rules 超限 / 缺尾。

### 容量纪律（写任何页之前过四关）

不过关就不写或压缩：① **再命中** —— 下会话不知道这条会踩同坑/重做同决定？不会就不存，代码能 grep 到的一律不记。② **单页上限** —— `entities/concepts/syntheses` 单页 <150 行且 <8KB，超了拆或外链。③ **sources 是暂存** —— 提炼成规律后删/归档，并清引用（防死链）。④ 能不能用一行链接代替新增整页？

## 开场：Init Sync（开工 / 默认续 todo）

收到第一个核心开发指令**之前**走这条链载入上下文：

1. **读状态**：`abs load`（MCP `abs_load`）读 Rules + 图谱计数 + todo + 最近 log。**开工前先看 `## Rules`**。load 输出是折叠的（Done 按日期计数、清单只给页数）；全量明细用 `abs todo --full` / `abs index`。
2. **对账滞留（强制，别跳过）**：若顶部出现 `⏳ 上会话滞留`，说明上会话任务断了，先收尾再开工 —— 真做完的 `abs todo done <id>`；没做完的 `abs todo note <id> --note "接到哪/改到哪个文件"` 补断点。
3. **读命中页**：`abs query <词>` → `abs resolve <页名或id>` 拿路径后**只读命中那几页**。**绝不通读 `.brain/`**；汇总多文件用 `ctx_execute` 类工具在沙箱里处理，只打印结论。
4. **续 todo**：把顶部未完成项当当前任务开做；有明确新任务而 todo 没有 → `abs todo add <id> --note 做什么` 再动工。

## 进行中：什么时候动它

**todo 是随改随写的活看板，同 git commit 同反射。**

| 时机 | `abs_task` action | 落到哪 |
|---|---|---|
| 认领新任务 / 聊出一个话题 | `start` + note 做什么 | Todo `[进行中]` |
| 只在讨论、还没动手 | `state` + note 讨论中 | 原地改标记 |
| 卡住了/等人等数据 | `state` + note 滞留中 | 原地改标记 |
| 被打断/干到一半 | `note` + 改到哪个文件/到哪步 | 原地 ↳断点 |
| 子任务做完 | `done` + note 结语 + as 落地\|否决\|仅方案 | Done（别让假【落地】污染看板） |
| 总结出经验/坑/规律 | 改用 `abs_note` text + tags | sources/ |

**硬规则（开工前触发器，别被状态表漏掉）：**

1. **开工前先登记** —— 认领任何要动文件/跑命令的任务，**第一步是 `abs_task` action=start**，然后才读第一个文件。名字想不到就先起粗糙的（`fix-hook-nudge`）—— 名字可事后改，**未登记的开工补不回来**。
2. **一段活儿干完立刻 done** —— 不是等整个需求收尾。宁可拆成 5 条小的，别攒成 1 条大的。
3. **动手超过两三轮还没登记 = 已在失控路上** —— 立刻补 `start`。

**经验刚冒出来就落**：`abs_note` 暂存 `sources/`（幂等去重），宁少勿滥。
**跨会话任务只用 abs todo，别用宿主原生 todo**（TodoWrite / todo-list / `/list`）—— 那些是会话内临时，不写 `.brain/todo.md`，下会话接不上。

## 收尾循环（用户明确要求收尾时才走）

用户**明确说要收尾/结束/切别的事**时按下面走（不是每个词都触发，见开头总则）：

1. **读 todo** → `abs load`，看 Todo 还有哪些没完成。
2. **对账** → 漏登记的 `abs todo done <id>`；做一半补 `abs todo note <id> --note 断点`；卡住的 `abs todo state <id> --note 滞留中`。别让干完的事还留在 Todo。
3. **沉淀经验（该沉淀才沉淀）** → 值得记的坑/可复用技巧 → `abs note` 暂存；值得深提炼的按 Teardown 走。
4. **判教训够不够格进 Rules（别跳过）** → 是否「违反会丢数据/静默失效/白干活」级？
   - **够格 → 提议，不直写**：输出一行 `[Rules 提议] <一句话>` 问用户要不要加，确认后才 `abs rule add "<一句话>"`（短句，不带链接/解释）。
   - 不够格 → 不提，普通经验留在概念页。
   **为什么单列**：Rules 是唯一每次 load 全量送达的通道，概念页只在关键词命中时出现；够格不加 = 下次不送达。
5. **更新 index/log/todo** → 新页同步进 index；`abs log "完成 X：..."` 记一行成果；跑 `abs lint` 确认自洽。

**完成标准**：看板反映真实状态（Done 无滞留半成品）、该沉淀已落、够格的教训已提议进 Rules、index/log/todo 与事实一致。

Stop 时 hook 把「未完成任务 + 断点」快照进 `~/.abs/log/wrapup.log`，下会话 `abs load` 自动把滞留顶到顶部。**不主动往对话里插收尾提醒** —— 插一个 turn 就是打断（挂钩只在 `~/.abs/log/hooks.log` 留痕）。

## 收尾：Teardown Sync（深提炼，工具不替判断）

任务告一段落/结束前，把**真实发生**写回图谱。只写做过/跑过/测过的事实，禁止脑补。按序：

1. **暂存线索**：`abs note` 记做了什么、改哪些文件、验证命令。
2. **抽规律**：值得留的 → `abs concept <slug> --title "…"` 建页（自动带四段骨架）再填内容。四段别缺，尤其末尾「验证」段（`abs lint` 报 NO-TAIL）。**判断仍归你**：值不值得留、新建还是并入已有页；核实过的把 `status` 改 `active`。
3. **查推翻**：旧页有被本次推翻的说法 → `abs supersede <旧页> --by <新页>`（别删页）。
4. **沉淀实体 / 综合**：重要未记录的事物 → `entities/<TitleCase>.md`；选型/取舍 → `syntheses/`。
5. **收拢 sources**：提炼成规律的删 source，**同步清指向它的引用**（防死链）。
6. **修 index + 记 log**：新页同步 index；过 Rules 门槛的规律加一行到 `## Rules`。
7. **留接力棒**：`sessions/log-YYYY-MM-DD.md` 强制写 `## 🪝 Next Session Hook`。

## 知识页格式

统一 frontmatter：`tags / author / updated / status`。`tags` 首标签 ∈ `entity|concept|source|synthesis|session-log`；`author` 与 `entities/<name>.md` 同名。

**`status` 三个值（别写别的）**：`active` 当前有效（缺字段默认就是它，正常展示）；`draft` 待核实（`abs note` 默认落这个，展示但标 `[draft 未核实]`）；`superseded` 已被推翻，别再依据（`query` 默认隐藏）。

推翻一条经验用 `abs supersede <页名> --by <新页>`（改 `status` 为 `superseded` 并写 `superseded-by`；不写 `--by` = 单纯弃用）。历史必须留；核实后仍有效就把 `status` 改回 `active`。`--by` 指向不存在的页会被拒。

- **每页必须有 `## 关联连接`**，用 `[[页面名]]` 链相关页，严禁孤岛页。链路解释写在 `—` 后面（`[[hook-throttle-alignment]] — 节流判据要对齐「真收尾」`），只写链点等于没链。
- **命名即链接**：`[[Docker]]` → `entities/Docker.md`；`[[docker-prisma-429]]` → `concepts/`。不建别名层。
- **知识冲突**：不静默覆盖，加 `## 知识冲突` 两版都留、标来源时间，交人工裁决。
- 概念页骨架：`触发场景 / ❌表现(贴报错) / 🛠解法(根因+修复+验证命令) / 关联连接`。

## 维护：query / lint

- `abs query <词>` → 读命中页 → 答用 `[[页面名]]` 标来源。**代码问题（符号在哪/谁调用）不在 .brain，直接读源码**；已推翻经验默认不返回（`--all` 可看）。
- `abs lint` 报错码：`NO-INBOUND` 有出边无人链接 / `SOURCE-UNDISTILLED` source 超 7 天未链 concept / `SUPERSEDED-DANGLING` superseded-by 页不存在 / `DRAFT-STALE` 停在 draft / `NO-TAIL` 缺「做完怎么确认」段。

## ⛔ 禁止做

1. **禁止手工建骨架 / 手工登记任务** —— 用 `abs init` / `abs todo add`。
2. **禁止由关键词直接触发动作**（"简短""收尾"等词出现在定规则的句子里时只回应，不执行）—— 拿不准先问。
3. **禁止通读 `.brain/`** —— 要状态用 `abs load`，要主题用 `abs query`，要单页用 `abs resolve` 后只读那页。
4. **禁止删知识页来表达"已失效"** —— 用 `abs supersede <旧页> --by <新页>`。
5. **禁止归档单独建文件 / 一天拆多个快照 / 手工搬大文件** —— 用 `abs todo archive`；一天只有一个 `log-<日期>.md`；大文件进 `sources/` 或摘出规律进 `concepts/`。
6. **禁止编造没跑过的验证结论** —— 只写做过/跑过/测过的事实；不清楚就写"未定位"。
7. **禁止直写 Rules** —— 够格的先输出 `[Rules 提议]` 问用户，确认后才 `abs rule add`。
8. **禁止用宿主原生 todo 承载跨会话任务** —— 用 `abs_task`，原生 todo 只记本会话临时拆解。

## 自我约束

- 只读写 `.brain/` 与目标代码，不动全局配置（一次性接入除外）。只写真实发生的事实，遵守容量纪律。
- 双链/frontmatter/index 必须自洽 —— 坏链 = 掰断接力棒。

