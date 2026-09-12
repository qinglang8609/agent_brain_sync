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

## 使用者姓名（作者标记）

图谱需要知道「谁登记的」。写操作（`todo add/note/blocked/done`、`log`、`note`）会检查：
**未设置姓名则报错并给设置命令**，不默默落盘无名条目。

```bash
abs config set user <你的名字>     # 写入 ~/.abs/config.json，一次即可
abs config                        # 查看当前姓名
ABS_USER=<名字> abs todo add ...   # 临时覆盖（CI/多身份），不改落盘配置
```

设置后自动标记（**作者是人页的 wikilink，点得进去看技术栈/特点**）：
- `todo.md`：`- [ ] TASK-ID [[fanchao]] — 说明 (认领 2026-09-12)`（作者紧跟 id，扫板先看到人）
- `log.md`：`## [2026-09-12 13:17] [[fanchao]] dev | 完成 X`（作者前置于 kind）
- `sources/`：frontmatter `author: fanchao`

同时自动建人页 `.brain/entities/<name>.md`（含「技术栈 / 特点·工作习惯 / 名下踩过的坑」三个空槽），
并登记进 `index.md` 的 Entities 区。**已存在则一律不动** —— 里面的内容是人工沉淀的，机器不许覆盖。

> **沉淀时顺手填人页**：经验提炼进 concepts/ 时，若观察到工程师的技术栈或判断倾向，
> 写进 `entities/<name>.md`。这页是可积累的画像，不是一次性标签。

**只读命令不检查**（`load`/`todo`/`status`/`lint`/`query`/`index`/`log` 无参）——
hook 在会话结束时非交互调 `abs wrapup`/`abs teardown-check`，那儿拦人会卡断收尾。

> `index.md` 的**经验行不加作者**：index 行是覆盖式更新的，作者会从"创建者"漂成"最后改的人"，
> 语义不固定。要查谁写的，看该页自己的 `author`，或 `abs query` 输出（带每页 author）。
> 历史条目**不回填**：旧行的裸 `@name` 只在原位更新时按原形态保留，不批量改写（原文/现场已不在，
> 回填等于编造）。

## 图谱定位（一个项目一个 `.brain/`，abs 自动定位不用手工指定路径）

`.brain/` 放项目根，一个项目只建一份。所有 `abs` 命令（`abs load/todo/note/task/query/lint...`）
**只认当前目录的 `.brain/`**——必须在项目根目录（即 `.brain/` 所在处）运行，
不用传路径。

**不在子目录自动归属，也不向上搜索**。原因是上爬会命中家目录 `~/.brain`
（vault / 临时目录 / 任意路径都可能爬到），把无关项目静默挂到别人图谱上。
宁可报错也不猜。多项目各自独立，各自 `cd` 到自己的根再跑。

monorepo 若多个子包各自独立交付，可各建一份 `.brain/`。`abs status` 显示当前定位到哪个项目。

## 图谱长什么样（都在 `.brain/` 下）

```
.brain/
├── index.md        # 总索引 + 当前路线(Roadmap)。入口。
├── log.md          # 工作成果流水：完成 X 的一行摘要，倒序。不写工具动作。
├── todo.md         # 动态看板：进行中/待办/阻塞/已完成。进度唯一真源。
├── entities/       # 实体页：一个"具名事物"一页。
├── concepts/       # 概念页：一个"可复用规律/坑"一页。
├── sources/        # 暂存页：实时经验(abs note)落点。提炼完即归档/删。
├── syntheses/      # 综合页：跨实体横向判断/选型/路线。
└── sessions/       # 会话快照 + Next Session Hook。
```

**骨架由 `abs init` 生成，不手工建。** 每个 `.brain/` 建一份，不逐子目录乱建。结构不完整时
`abs init --repair` 只补缺、不覆盖已有文件。

### 归类规则（新知识进哪类——判断力）

| 类别 | 放什么 | 命名 |
|------|--------|------|
| `entities/` | 具名的**事物**：`docker`、`auth-module` | TitleCase：`Docker.md` |
| `concepts/` | 可复用的**规律/坑**：`docker-prisma-429` | kebab-case |
| `sources/` | 实时经验**暂存**（`abs note` 自动落这里） | `YYYY-MM-DD-slug.md` |
| `syntheses/` | **横向综合**：选型、架构取舍 | `synthesis-slug.md` |

判断一问：能说"它是什么"→ entities；能说"这么做就避坑"→ concepts；卡住默认 concepts。

## 容量纪律（最重要的节——别什么都往里扔）

图谱贵在**精**不在全。写页前过四关，不过就不写或压缩：

1. **再命中测试**：下个会话不知道这条，会不会踩同坑/重做同决定？会→存；不会→不存。
   能从代码 grep 读出的细节一律不记。
2. **单页硬上限**：`entities/ concepts/ syntheses/` 单页 <150 行/<5KB。超了拆或外链。
3. **sources 是暂存不是存档**：提炼成规律后删/归档 source（同步清引用，防死链）。
4. **写前压缩三问**：规律还是噪音？不记会怎样？能不能用一行链接已有页代替新增整页？

`abs lint` 检查单页超限、sources 堆积、死链、index 漏列。

## 开场：Init Sync（开工 / 默认续 todo）

图谱已存在；收到第一个核心开发指令**之前**走这条链载入上下文：

1. **读状态**：`abs load`（或 MCP `abs_load`）读 index 路线 + todo 看板 + 最近 log。
   > **Done 区是折叠的（按日期计数）**，不是全量 —— Done 是无上限增长的归档区，
   > 全量打印会随项目历史线性膨胀，把上下文塞满（曾占 load 输出 68.8%，
   > 长历史项目上单次 load 吃掉 40% 上下文）。
   > 要 Done 明细：`abs todo --full`，或看 `.brain/sessions/<日期>-todo归档.md`。
   > 「最近动作」每条也按语义边界收口 —— 续接只需线索，不需要日志全文。
2. **对账滞留（强制，别跳过）**：若 `abs load` 顶部出现 `⏳ 上会话滞留`，说明上会话有任务做完/做到一半就断了。**先收尾再开工**：
   - 快照里的任务现在真做完了 → `abs todo done <id>`（done 后下次 load 滞留自动消失）；
   - 还没做完 → `abs todo note <id> --note "接到哪/改到哪个文件"` 补断点（别空手续接）。
   滞留没清完就不算接上了状态——这是「任务做完没进 Done」的根治动作。
3. **读命中页**：按关键词在 index 定位 → 读对应 concepts/entities 全文。
4. **续 todo**：默认续 todo 分支 → 把顶部未完成项当当前任务开做。
5. **登记新任务**：有明确新任务而 todo 没有 → `abs todo add <id> --note 做什么` 登记
   再动工。不登记，会话一切断就丢。

## 进行中：todo 是活看板 + 经验实时落（最重要的纪律）

**todo 不是收尾仪式，是干活中随改随写的活看板。** 每个任务边界立即更新，和 git commit
同一个反射，别等收尾。用工具（MCP `abs_task` / CLI `abs todo`）：

> **写操作优先 MCP，不要用 `bash` 跑 `abs`。** 实测：MCP 单次 ~2ms（server 常驻），
> CLI 单次 27ms（其中 20ms 是每次起 node 进程的固定开销，读写本身仅 3ms）。
> 一轮发多条命令时差距明显。CLI 留给「人手动查看看板」，agent 读写走 MCP。
> 详见 [[perf-fixed-overhead]]。

| 时机 | 动作 |
|---|---|
| 认领新任务 | `abs todo add <id> --note "做什么"` |
| 子任务做完 | `abs todo done <id>`（自动归位 Done 对应 `### YYYY-MM-DD` 分组顶部，新完成在前；断点随迁） |
| 碰壁/阻塞 | `abs todo blocked <id> --note "卡点原因"`（移 Blocked） |
| 被打断/改向/干到一半停 | `abs todo note <id> --note "改到哪个文件/到哪步"`（补 ↳ 断点 行） |

**Done 区会自动收口**：会话结束时 hook 调 `abs wrapup`，顺手把「超过 3 天 且 整天都已完成」
的日期组迁到 `.brain/sessions/<日期>-todo归档.md`，并在 Done 区尾部留一行
`### 归档` → `- [[<日期>-todo归档]] 完成任务 N 条`。
**任一天只要还有未完成任务（`- [ ]`），整天都不归档** —— 不会把半成品扫走。
手动跑：`abs todo archive [--keep-days N] [--dry-run]`。

> `abs todo start` 与 `abs todo add` 等价（老写法仍可用）。
> 旧版 `abs task ...` / `abs board` 已改名，会报错并提示新写法。
> 只读命令（`todo`/`status`/`lint`/`load`/`index`）遇多余参数会报错 —— 不再静默吞掉。

> **跨会话任务只用 abs todo，别用宿主原生 todo。** Cl​aude TodoWrite/Task、co​dex todo-list、
> Op​enCode todowrite、pi `/list`/goal 各有各的原生任务——但**多是会话内临时**，不会写进
> `.brain/todo.md`。若用原生 todo 建了跨会话任务，它就会「只在界面 0/N 里、abs 看不到」，
> 下会话接不上、收尾没影。**分工**：跨会话/会被打断的任务 → `abs todo add`（唯一真源）；
> 原生 todo 顶多记「本会话内不跨断点的临时拆解草稿」。

**经验/坑刚冒出来就落**：`abs note "一句话经验" --tags 坑,docker`（MCP `abs_note`）——
暂存进 sources/（幂等去重、自动进 index/log），防 context 爆/截断流失。宁少勿滥。

## 每轮结束：收尾循环（Stop/告一段落后必做）

**每个任务边界、每轮被 Stop/打断、告一段落时，别停半空——走收尾循环。**
这是"开场接上状态、结束落回状态"的闭环，否则下会话接不上、经验流失。

> 触发信号：Stop/会话结束 时 hook 会把「当前项目仍未完成任务 + 断点」快照进 `~/.abs/log/wrapup.log`
> （经 `abs wrapup`，机械、幂等去重，不替你做判断）。**下会话 `abs load` 会自动把滞留顶到顶部**
> （`⏳ 上会话滞留`），所以收尾不是靠自觉记日志，而是开场被强制接上。要不要把某个任务标 done，
> 仍由你判断（快照只记录「哪些还开着」，不猜完成）。
>
> **主动注入（pi 已实现，别等它、也别嫌它吵）**：pi 扩展在 `agent_end` 检测「本会话真改过文件
> （write/edit/非只读 bash）」且「`.brain/log.md` 今日无记录」时，会注入一条 `[abs 收尾提醒]` 消息
> 逼你走本循环（每会话最多一次，已收尾/无图谱则不打扰）。**收到就照做，别复述提醒、别解释为什么在收尾**；
> 确无可沉淀产出回一句「无可沉淀」即可。Cl​aude/Co​dex 侧靠 `Stop` 事件（见 event.sh）达成同样效果。

收到 Stop / "结束/先这样/切别的事" / 长任务告一段落，立即执行（快、准、不啰嗦）：

1. **读 todo** → `abs load`，看 Today 还有哪些没完成。
2. **判有没有做完没登记** → 实际完成了漏登记的 `abs todo done <id>`；做到一半补
   `abs todo note <id> --note 断点`；碰壁 `abs todo blocked`。别让干完的事还停 Today。
3. **沉淀经验（该沉淀才沉淀）** → 踩了值得记的坑/有可复用技巧/跨会话判断 → `abs note`
   暂存；值得深提炼的（规律/坑/决策）按 Teardown 走完整流程。
4. **更新 index/log/todo** → 新页同步进 index；`log.md` 倒序记一行**工作成果**摘要
   （`abs log "完成 X：..."`，不是工具动作）；todo 对账。跑 `abs lint` 确认自洽。

**完成标准**：看板反映真实状态（Done 无滞留半成品）、该沉淀已落、index/log/todo 与事实一致。

## 收尾：Teardown Sync（深提炼，工具不替判断）

任务告一段落/结束前，把**真实发生**写回图谱。只写做过/跑过/测过的事实，禁止脑补。按序：

1. **暂存线索**：`abs note`（或建 `sources/YYYY-MM-DD-slug.md`）记做了什么、改哪些文件、验证命令。
2. **抽规律**：值得留的 → `concepts/<kebab-slug>.md`：触发场景/❌表现/🛠根因+解法+验证。挂双链。
3. **沉淀实体**：碰了重要未记录的事物 → `entities/<TitleCase>.md`。
4. **对账 todo**：滞留 Today 归位（Done 标日期 / Backlog 补断点）；遗留 bug 写 Backlog/Blocked。
5. **综合(可选)**：推进了选型/取舍 → `syntheses/`。
6. **收拢 sources**：提炼成规律的删 source，**同步清指向它的引用**（防死链）。
7. **修 index + 记 log**：新页同步 index；`log.md` 倒序记一行摘要。
8. **留接力棒**：`sessions/log-YYYY-MM-DD.md`，强制写 `## 🪝 Next Session Hook`。

**完成标准**：每条过了容量纪律的知识一处落点；index 与事实一致；sessions 有带 Hook 快照。

## 知识页格式（concepts/entities/syntheses）

所有页统一 frontmatter：`tags / author / updated / status`。

```markdown
---
tags: [concept, 领域]   # 首标签 ∈ entity|concept|source|synthesis|session-log
author: fanchao         # 作者（abs note 自动写；手写页也须填，且与 entities/<name>.md 同名）
updated: YYYY-MM-DD
status: draft           # 或 reviewed（仅指知识冲突裁决结案）
---
```

作者名同时是**人页 slug**：`[[fanchao]]` → `entities/fanchao.md`（技术栈 / 特点 / 名下踩过的坑）。

- **关联连接区**：每页必须有 `## 关联连接`，用 `[[页面名]]` 链相关页。严禁孤岛页。
- **知识冲突**：与旧页矛盾不静默覆盖。加 `## 知识冲突` 两版都留、标来源时间，交人工裁决。
- **命名即链接**：`[[Docker]]` 落 entities/Docker.md；`[[docker-prisma-429]]` 落 concepts/。别建别名层。

概念页核心结构（坑）：`触发场景 / ❌表现(贴报错) / 🛠解法(根因+修复+验证命令) / 关联连接`。

## 维护：query / lint

- **query（检索）**：`abs query <词>`（或先读 index 定位）→ 读命中页 → 答用 `[[页面名]]` 标来源。
  **代码问题（符号在哪/谁调用）答案不在 .brain，直接读源码**；.brain 只答"踩过什么坑/上次做到哪"。
- **lint（体检）**：`abs lint`。查死链/孤岛/缺 frontmatter/模板残留/未决冲突/超尺寸/sources 堆积/
  index 漏列。按报告修（死链→补链；孤岛→补关联；超大→拆；sources 积压→提炼归档）。

## 分工：hook 机械记 / 工具实时落 / skill 深提炼（装了 abs 的项目）

| 层 | 干什么 | 靠什么 |
|---|---|---|
| **hook（机械）** | SessionStart/UserPromptSubmit/Stop/SessionEnd 自动记**技术日志**（~/.abs/log/） | 宿主 hook 配置。你不写技术日志。 |
| **CLI/MCP（实时）** | 任务/经验**实时落盘**：`abs todo add/note/blocked/done`、`abs note` | 每个任务边界立即调；经验随时 abs note。 |
| **skill（自觉）** | **深提炼**（sources→concepts）+ 收尾循环 + 修 index | 判断什么值得沉淀，工具不替你判断。 |

实时层解决"断了就丢"；自觉层解决"噪音污染"。分工明确：骨架/任务/暂存/检索/体检走 abs 工具
（`abs init`/`abs_task`/`abs note`/`abs query`/`abs lint`）；**深提炼（sources→concept/entity 页）
手工写**——那是判断力，工具不替。改完 `abs lint` 确认自洽。

## 自我约束

- 只读写 `.brain/` 与目标代码，不动全局配置（一次性接入安装除外）。
- 内容基于真实发生的事实；遵守容量纪律宁缺毋滥。
- 双链/frontmatter/index 必须自洽——图谱给下个会话读，坏链=掰断接力棒。
