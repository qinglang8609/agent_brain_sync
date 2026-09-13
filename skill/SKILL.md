---
name: abs-agent-brain-sync
description: abs (agent-brain-sync) 跨会话 AI 编码记忆与任务续接。开场续接状态(abs load/MCP abs_load)，干活中任务/经验实时落盘(abs_task/abs_note)，每轮结束走收尾循环(读todo→判未登记→沉淀→更新index/log)。解决会话无状态：经验/进度/坑碎片化、重开失忆。
---

# abs — 跨会话记忆 (agent-brain-sync)

把 AI 编码经验从会话沙盒里救出来。每个会话都是无状态的——Cl​aude、Op​enCode、Cursor
各开一堆会话，经验/进度/踩坑全碎片化，重开像失忆。本技能用一个放**项目根目录**、
Obsidian 可直接打开的 Markdown 图谱（`.brain/`）做统一落点。
**骨架/任务/暂存/检索/体检走 abs 工具（不手工建骨架、不手工登记任务）；深提炼（把暂存经验
写成 concept/entity 页）必须手工——那是判断力，abs 不替你判断什么值得沉淀。**

## CLI 命令速查（`abs`，完整帮助：`abs help`）

```bash
# 读
abs load                     # 开机读状态（Roadmap + Rules + todo + 最新 log）
abs todo                     # 看板（Done 折成计数；明细 abs todo --full）
abs index / abs log          # 完整 index.md / log.md
abs status                   # 当前项目 + 图谱概要
abs query <词1> [词2 …]      # 检索 .brain/ 知识页（多词 OR）
abs lint                     # 图谱体检（死链/悬挂/超限/堆积/未提炼/Rules 超限）

# 写
abs todo add <id> --note "做什么"              # 登记任务（start 同义）
abs todo note <id> --note "断点/进度"           # 实时落 ↳ 断点 行
abs todo blocked <id> --note "卡点原因"         # 移入 Blocked
abs todo done <id> [--as 落地|否决|仅方案]      # 完成（默认 落地）
abs log "完成 X：…"                            # 记一行工作成果（无参=查看）
abs note "经验一句话" [--tags 坑,docker]        # 经验实时暂存 → sources/
abs rule [add "一句话"]                        # 读写 index.md 的 ## Rules 硬规则

# 维护
abs todo archive [--keep-days N] [--dry-run]   # 归档 Done 旧日期组 → sessions/
abs init [--repair]                            # 建图谱；--repair 只补缺不覆盖
abs config [set user <名字>]                   # 使用者姓名（写操作需先设）
```

> **agent 读写优先走 MCP**（`abs_load`/`abs_task`/`abs_note`/`abs_query`/`abs_lint`/
> `abs_rule`）—— 常驻 ~2ms，比 bash 跑 CLI（每次起 node 进程 27ms）快一个量级。
> CLI 留给「人手动查看」。`abs wrapup` / `abs teardown-check` 是 hook 内部命令，不需手动调。

## 触发总入口（每次命中技能，第一步先走这里）

技能被触发（用户问话、开新会话、或说 `abs ...`）时，**第一步永远是下面这条链**，
然后再看用户真正要什么：

1. **找图谱**：只看**当前目录**是否含 `.brain/`（一个项目一个 `.brain/`）。
   **不向上搜索**：向上爬会从子目录甚至 vault 一路命中家目录 `~/.brain` 的无关图谱，
   静默把项目挂错地方。所以必须 cd 到项目根再跑，子目录不会自动归属。
2. **没有？按意图决定建档与否**：
   - 用户意图是**沉淀**（收尾/「把这次记下来」）或**即将开工的长期任务**（会跨会话，
     用词如「帮我做 X / 开工 / 继续开发 / 修 X」）→ **先建档**：`abs init`。别在没图谱时就开写。
   - 用户是**闲聊 / 一次性问句 / 明说不要建档 / 目录只读** → **不建档**，当普通会话处理，
     避免在无关项目乱落文件。
3. **有/刚建好？分析用户意图**，分流：

| 用户意图 | 走哪 |
|---|---|
| 总结经验 / 结束了 / "把这次记下来" | 收尾 Teardown（沉淀） |
| 查询坑 / "我上次怎么解决 X" | `abs query` 检索 |
| 体检图谱 / `abs lint` | `abs lint` 跑体检 |
| 开新任务 / 继续开发 / "帮我做 X" | 开场 Init Sync（续接）；**新需求先走下面的受理协议** |
| 报 bug / 要求加功能 | **受理协议**：先方案 → 再登记 → 问开工（下一节） |
| 意图不明 / 默认 | **续 todo**：读未完成项开工续做 |

**主心骨**：意图不明且项目有 `.brain/` 时，默认**续 todo**——任何情况下先接上未完成工作，
不是停在闲聊。

## 新需求受理协议（bug / 新功能：先方案 → 再登记 → 问开工）

用户报 bug 或要求加功能时，**先别动代码**。三步：

1. **总结方案**（一屏内，给用户过目）
   - 需求的准确复述；不确定就写明假设，别猜着做
   - bug → 根因；功能 → 做法。**有证据给证据，没查到就直说"未定位"**
   - 要改哪些文件、怎么验证（跑什么、看什么）
2. **登记 todo**：`abs todo add <id> --note "<一句话需求+关键约束>"`
   方案里的关键结论（根因/取舍）再 `abs todo note <id> --note ...` 落到断点。
3. **问是否开工**：明确问一句，**等确认再改代码**。

**例外（可直接开工，但回复里须说明援引哪一条）**
- 用户已说"开工 / 直接做 / 修它" —— 那就是授权
- 一行级修字、纯查询、纯收尾沉淀 —— 无方案可言
- 同一需求已登记且用户确认过 —— 接着做即可

> 为什么：方案先过目能省掉整轮返工；登记让跨会话可续；"问开工"把决定权留在用户手里。
> **这不是拖延** —— 总结方案本身就是工作，做完再问。
## 图谱定位

`.brain/` 放**项目根**，一个项目一份。所有命令只认**当前目录**的 `.brain/`（在项目根运行，不传路径）。
**不向子目录归属，也不向上搜索**（上爬会命中 `~/.brain`，把无关项目静默挂错）。宁可报错也不猜。
`abs status` 显示当前定位。

## `.brain/` 怎么组织（每个文件/分区做什么、怎么用）

骨架由 `abs init` 生成（`--repair` 只补缺不覆盖）。

### `index.md` —— 图谱入口

| 分区 | 放什么 | 怎么用 |
|---|---|---|
| `## Roadmap` | 方向：已落地 / 下一阶段候选 | **写方向不写版本号**（复述第三方状态必然漂移）。有界的，load 原样展示 |
| `## Rules` | 本项目铁律 | 见下 |
| `## Concepts` `## Entities` `## Sources` `## Syntheses` `## Sessions` | 各类页的清单 | 每页一行 `- [[slug]] — 一句话`（`abs note`/建归档页会自动登记），load 里折成计数 |

**`## Rules` 区**：铁律清单，`abs load` 每次都全量读（代码里明确不折它）。
- 一句一条；有概念页就用 `[[链接]]` 指过去，**不在此展开**。
- 只有「违反会丢数据 / 静默失效 / 白干活」级才进 —— 普通经验进 `concepts/`。
- 读写：`abs rule` / `abs rule add "一句话"`（>120 字符被拒）；`abs lint` 超 30 条会报。

### `log.md` —— 工作成果流水

倒序一行摘要（`abs log "完成 X：…"`）。**只记成果，不收工具动作流水**（那在 `~/.abs/log/`）。
load 只展示最新 5 条、每条按语义边界收口。

### `todo.md` —— 活看板（进度唯一真源）

| 分区 | 放什么 |
|---|---|
| `## Backlog` | 想做但没开工 |
| `## Today / In Progress` | 正在做 |
| `## Blocked` | 卡住（附原因，`abs todo blocked`） |
| `## Done` | 已完成，**必须带结语 `【落地/否决/仅方案】` + `(完成 YYYY-MM-DD)`** |

`abs todo done <id>` 会勾选并归位到 Done 的日期组顶部，断点（`↳` 行）随迁；
Done 区由 `abs wrapup` 在会话结束时自动把「超 3 天且整天都已完成」的组迁到 `sessions/<日期>-todo归档.md`
（任一天有未完成则整天不迁）。**什么时候动它见「进行中」一节。**

### `entities/` `concepts/` `sources/` `syntheses/` `sessions/`

| 目录 | 放什么 | 命名 |
|---|---|---|
| `entities/` | 具名的**事物**（能说"它是什么"） | `Docker.md` |
| `concepts/` | 可复用的**规律/坑**（能说"这么做就避坑"） | `docker-prisma-429.md` |
| `sources/` | 实时经验**暂存**（`abs note` 自动落） | `YYYY-MM-DD-slug.md` |
| `syntheses/` | **横向**选型/架构取舍（跨多个 entity/concept 的判断） | `synthesis-slug.md` |
| `sessions/` | 会话快照 + `## 🪝 Next Session Hook`、todo 归档页 | `log-YYYY-MM-DD.md` |

归类拿不准时**默认 `concepts/`**。

### 容量纪律（写任何页之前过四关）

图谱贵在**精**不在全，不过关就不写或压缩：
1. **再命中**：下会话不知道这条会踩同坑/重做同决定？会→存，不会→不存。代码能 grep 到的一律不记。
2. **单页上限**：`entities/concepts/syntheses` 单页 <150 行且 <8KB，超了拆或外链。
3. **sources 是暂存**：提炼成规律后删/归档，并清掉指向它的引用（防死链）。
4. **能不能用一行链接代替新增整页**？

`abs lint` 兜底：死链/孤岛/**悬挂页(NO-INBOUND)**/缺 frontmatter/超限/sources 堆积/**超龄未提炼(SOURCE-UNDISTILLED)**/index 漏列/Rules 超限。
## 开场：Init Sync（开工 / 默认续 todo）

图谱已存在；收到第一个核心开发指令**之前**走这条链载入上下文：

1. **读状态**：`abs load`（或 MCP `abs_load`）读 index 路线 + Rules + todo 看板 + 最近 log。
   > **开工前先看 `## Rules`** —— 那是本项目踩过坑后定下的硬规则，每条都是曾经付过代价的。
   > 违反的代价一般是丢数据/静默失效/白干活，而它就在 load 输出里，没有理由不看。
   >
   > **load 输出是折叠过的，不是全量。** 两个无上限增长的区块在读取侧收口：
   > - **Done 区** → 按日期计数（曾占 load 输出 68.8%，长历史项目上单次 load 吃掉 40% 上下文）
   > - **index 页面清单** → 各分区只给页数（concept 清单占 load 输出 64%，隨图谱线性增长）
   > - 「最近动作」每条按语义边界收口到 220 字符
   >
   > **路线(Roadmap) 与 Rules 两区原样保留** —— 那是 load 要传达的状态本身（代码里明确不折）。
   > 要全量明细：`abs todo --full` / `abs index`，或直接读 `.brain/` 文件、
   > `.brain/sessions/<日期>-todo归档.md`。
2. **对账滞留（强制，别跳过）**：若 `abs load` 顶部出现 `⏳ 上会话滞留`，说明上会话有任务做完/做到一半就断了。**先收尾再开工**：
   - 快照里的任务现在真做完了 → `abs todo done <id>`（done 后下次 load 滞留自动消失）；
   - 还没做完 → `abs todo note <id> --note "接到哪/改到哪个文件"` 补断点（别空手续接）。
   滞留没清完就不算接上了状态——这是「任务做完没进 Done」的根治动作。
3. **读命中页**：按关键词在 index 定位 → 读对应 concepts/entities 全文。
   > ⚠️ **绝不通读 `.brain/`**（29 页就约 11 万 token，全读塞满窗口）。
   > 要状态→`abs load`；要主题→`abs query <词>`（只回命中几页）；要某页→只读那页。
   > 汇总多文件时用 `ctx_execute` 类工具在沙箱里处理，**只打印结论**。
4. **续 todo**：默认续 todo 分支 → 把顶部未完成项当当前任务开做。
5. **登记新任务**：有明确新任务而 todo 没有 → `abs todo add <id> --note 做什么` 再动工。

## 进行中：什么时候动它（最重要的节）

**todo 不是收尾仪式，是随改随写的活看板。** 每个任务边界立即更新，与 git commit 同反射。

| 时机 | 动作 |
|---|---|
| 认领新任务 | `abs todo add <id> --note "做什么"` |
| 子任务做完 | `abs todo done <id>` |
| 碰壁/阻塞 | `abs todo blocked <id> --note "卡点原因"` |
| 被打断/干到一半 | `abs todo note <id> --note "改到哪个文件/到哪步"` |

**经验刚冒出来就落**：`abs note "一句话经验" --tags 坑,docker` → 暂存 `sources/`（幂等去重）。宁少勿滥。

> **写操作走 MCP（`abs_task`/`abs_note`），别用 bash 跑 CLI** —— MCP 常驻 ~2ms，
> CLI 每次起 node 进程 27ms。（[[perf-fixed-overhead]]）
>
> **跨会话任务只用 abs todo，别用宿主原生 todo**（Cl​aude TodoWrite / co​dex todo-list /
> Op​enCode todowrite / pi `/list`）—— 那些多是会话内临时，不写 `.brain/todo.md`，
> 下会话接不上、收尾没影。原生 todo 顶多记“本会话不跨断点的临时拆解”。

## 每轮结束：收尾循环（Stop / 告一段落后必做）

**每个任务边界、被 Stop/打断、告一段落时，别停半空。** 这是“开场接上状态、结束落回状态”的闭环。

> Stop 时 hook 把「未完成任务 + 断点」快照进 `~/.abs/log/wrapup.log`（`abs wrapup`，机械幂等），
> 下会话 `abs load` 会自动把滞留顶到顶部（`⏳ 上会话滞留`）—— 所以收尾不靠自觉，是开场被强制接上。
>
> **主动注入**：pi 扩展在 `agent_end` 检测「本会话真改过文件」且「log.md 今日无记录」时注入
> `[abs 收尾提醒]`（每会话最多一次）。**收到就照做，别复述提醒**；确无可沉淀回一句「无可沉淀」。
> Cl​aude/Co​dex 靠 `Stop` 事件达成同样效果。

收到 Stop / "结束/先这样/切别的事" / 长任务告一段落，立即执行：

1. **读 todo** → `abs load`，看 Today 还有哪些没完成。
2. **判有没有做完没登记** → 实际完成了漏登记的 `abs todo done <id>`；做到一半补
   `abs todo note <id> --note 断点`；碰壁 `abs todo blocked`。别让干完的事还停 Today。
3. **沉淀经验（该沉淀才沉淀）** → 踩了值得记的坑/有可复用技巧/跨会话判断 → `abs note`
   暂存；值得深提炼的（规律/坑/决策）按 Teardown 走完整流程。
4. **更新 index/log/todo** → 新页同步进 index；`log.md` 倒序记一行**工作成果**摘要
   （`abs log "完成 X：..."`，不是工具动作）；todo 对账。
   **新规律是「违反会丢数据/静默失效/白干活」级别 → 往 index 的 `## Rules` 加一行**
   （短句 + `[[概念页]]`，不展开）。普通经验不进 Rules —— 否则会长成第二份概念库。
   跑 `abs lint` 确认自洽。

**完成标准**：看板反映真实状态（Done 无滞留半成品）、该沉淀已落、index/log/todo 与事实一致。

## 收尾：Teardown Sync（深提炼，工具不替判断）

任务告一段落/结束前，把**真实发生**写回图谱。只写做过/跑过/测过的事实，禁止脑补。按序：

1. **暂存线索**：`abs note`（或建 `sources/YYYY-MM-DD-slug.md`）记做了什么、改哪些文件、验证命令。
2. **抽规律**：值得留的 → `concepts/<kebab-slug>.md`：触发场景/❌表现/🛠根因+解法+验证。挂双链。
3. **沉淀实体**：碰了重要未记录的事物 → `entities/<TitleCase>.md`。
4. **对账 todo**：滞留 Today 归位（Done 标日期 / Backlog 补断点）；遗留 bug 写 Backlog/Blocked。
5. **综合(可选)**：推进了选型/取舍 → `syntheses/`。
6. **收拢 sources**：提炼成规律的删 source，**同步清指向它的引用**（防死链）。
7. **修 index + 记 log**：新页同步 index；**过 Rules 门槛的规律加一行到 `## Rules`**；
   `log.md` 倒序记一行摘要。
8. **留接力棒**：`sessions/log-YYYY-MM-DD.md`，强制写 `## 🪝 Next Session Hook`。

**完成标准**：每条过了容量纪律的知识一处落点；index 与事实一致；sessions 有带 Hook 快照。

## 知识页格式

统一 frontmatter：`tags / author / updated / status`（`status: draft`，或 `reviewed` = 冲突已裁决）。
`tags` 首标签 ∈ `entity|concept|source|synthesis|session-log`。`author` 与 `entities/<name>.md` 同名。

- **每页必须有 `## 关联连接`**，用 `[[页面名]]` 链相关页 —— 严禁孤岛页。
- **命名即链接**：`[[Docker]]` → `entities/Docker.md`；`[[docker-prisma-429]]` → `concepts/`。不建别名层。
- **知识冲突**：不静默覆盖，加 `## 知识冲突` 两版都留、标来源时间，交人工裁决。
- 概念页骨架：`触发场景 / ❌表现(贴报错) / 🛠解法(根因+修复+验证命令) / 关联连接`。

## 维护：query / lint

- `abs query <词>` 检索（多词 OR）→ 读命中页 → 答用 `[[页面名]]` 标来源。
  **代码问题（符号在哪/谁调用）不在 .brain，直接读源码**；.brain 只答"踩过什么坑/上次做到哪"。
- `abs lint` 体检：死链/孤岛/**悬挂页**/缺 frontmatter/模板残留/超尺寸/sources 堆积/**超龄未提炼**/index 漏列/Rules 超限。
  - `NO-INBOUND`：有出边但无人 `[[链接]]` 到你 = 挂在图上没人接（孤岛检查只抓"零出零入"）。
  - `SOURCE-UNDISTILLED`：source 超 7 天仍未链到任何 concept = 暂存了没归位。

## 三层分工

| 层 | 干什么 |
|---|---|
| **hook（机械）** | 自动记技术日志到 `~/.abs/log/`，你不用管 |
| **CLI/MCP（实时）** | 任务/经验实时落盘：`abs todo …`、`abs note` |
| **skill（自觉）** | **深提炼**（sources→concepts）+ 收尾 + 修 index —— 工具不替你判断 |

骨架/任务/暂存/检索/体检走工具；**深提炼手工写**（那是判断力）。改完跑 `abs lint`。

## 自我约束

- 只读写 `.brain/` 与目标代码，不动全局配置（一次性接入除外）。
- 只写真实发生的事实；遵守容量纪律，宁缺毋滥。
- 双链/frontmatter/index 必须自洽 —— 坏链 = 掰断接力棒。
