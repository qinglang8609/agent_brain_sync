# abs 工程 方案（PLAN · 定稿 v2）

> 目标：把「AI 会话状态只在智能体脑子里」升级为「**hook 纯触发 → MCP 定位并转接 → CLI 读写 markdown 图谱**」。
> 状态：**方案定稿 v2**（经多轮讨论，最终回归"hook→MCP→CLI"三层，由 MCP 承担项目定位）。
> 历史沿革（为何从 v1"CLI 收束"改回"hook→MCP→CLI"）见[历史沿革](#历史沿革)。
> 本文档是唯一方案源。无并行文档。

---

## 0. 一句话定位

**ai-memory 我们不用学**：它解决"多项目/多工具/多机器统一管理"，是重引擎（Rust server + SQLite + FTS5 + embeddings + managed workstream）。abs 只要**单项目的轻量 markdown 图谱、进 git 方便**。

本方案 = **hook 触发 + Node MCP 转接 + CLI 读写**，落点始终是 `.brain/` markdown 图谱。

**已确认**：不用 Rust 重引擎、不用 SQLite、不自动浓缩全程、不用统一多 workspace 图谱、不把定位逻辑写进脆弱的 shell hook。
**取经**：ai-memory `docs/design-decisions.md`（§6 hook fire-and-forget、§10 MCP narrow、§14 mistakes checklist）+ 其 hooks/MCP **各宿主接入机制**（作实现参考）——只取其轻量可移植的几条。

---

## 1. 为什么做（痛感）

- **会话无状态**：Cl​aude/Op​enCode/Cursor 各开一堆会话，经验/进度/坑碎片化，重开像失忆。
- **状态只在 AI 脑子里**：智能体忙什么、做到哪——人和其他会话看不到，一断就丢。
- **写靠自觉不可保证**：skill 要求 AI 收尾/打断时写 todo，但上下文爆掉/意图不明/被截断时没机会写 → **必须机械落盘，不靠 AI 自觉**。

---

## 2. 核心架构：hook → MCP → CLI（v2 定稿）

```
 hook 触发层                      MCP 层(常驻 Node)              CLI 读写层
 ┌────────────────┐            ┌──────────────────┐          ┌──────────────────┐
 │ CC/Op​enCode 事件 │            │  ①定位当前项目目录 │          │  写入 todo        │
 │ (纯触发,不碰文件)│──事件──▶   │    (代码写死,向上 │──转接──▶  │  读取/查询         │
 │ fire-and-forget│            │     找 .brain/)   │          │  更新 todo 行     │
 └────────────────┘            │  ②转接调用 CLI 命令│          └──────────────────┘
                               └──────────────────┘
                                        │
                                 .brain/todo.md  ← 唯一真源 (markdown, 进 git)
```

**职责单一、各不越界：**

| 层 | 职责 | 不做 |
|---|---|---|
| **hook** | 纯触发：把宿主事件转发给 MCP。薄、各异（每个宿主一套） | 不碰 todo 文件、不做项目定位 |
| **MCP**（常驻 Node） | **① 定位当前项目目录（代码写死逻辑，唯一负责定位的层）② 转接指向该调哪个 CLI 命令** | 不自己实现读/写/查逻辑、不养 SQLite |
| **CLI** | 纯读写：被 MCP 转接调用的具体命令（写/读/查/更 todo） | 不做项目定位判断 |

**关键设计：项目定位只发生在 MCP 层，且用代码写死**——不靠脆弱的 shell hook 猜、不靠 skill 自觉。MCP 是常驻、有代码逻辑、能可靠解析路径的进程，定位放这里一次写对、所有宿主共享。

---

## 3. 第一铁律：多项目隔离（由 MCP 定位兜底）

用户可能同时开多个项目。若状态按"当前默认"猜会互相污染。**任何写入先经 MCP 定位"当前属于哪个项目"，写错宁可失败也不落错。**

- ✅ **定位方式 = MCP 从调用方 cwd 向上找最近含 `.brain/` 的祖先即命中**（代码写死）。A 会话调用落 A，B 会话落 B，由调用方 cwd 决定，MCP 只把"解析锚点"做成确定代码。
- ✅ **目录各一 `.brain/`**，不搞统一图谱内多 workspace（那像 ai-memory，与轻量冲突）。
- ✅ **不用"每项目装一次 hook 烧死路径"**——因为 MCP 每次调用独立解析 cwd，无状态，多项目天然各归各位，hook 只装一次指向 MCP 即可。
- ✅ MCP 拿不到锚点 → 返回明确错误/静默失败，不写任何地方。

> 权衡说明：这里放弃了 v1 纠结过的"每项目烧死路径"（太麻烦）与"装一次但靠 shell 猜 cwd"（不可靠）——折衷落在 **MCP 用代码写死解析逻辑**，既有可靠性（代码确定）又省事（hook 装一次指向 MCP，多项目由 MCP 每次按 cwd 解析）。

---

## 4. 分层实现细节

### 4.1 CLI（纯读写命令，被 MCP 转接，也可手动/被 skill 调用）

| 命令 | 做什么 | 来源 |
|---|---|---|
| `abs init` | 建 `.brain/` 骨架 | 现有 bootstrap.sh |
| `abs read` | 读 index/todo/log 输出状态 | SKILL.md Init 所需信息 |
| `abs board` | 渲染 todo 成可扫读看板 | 新增 |
| `abs query <词>` | 查以前踩过的坑 | SKILL.md query |
| `abs task start/done <id>` | 幂等写 todo 行 | 新增（hook 经 MCP 转接的落点） |
| `abs lint` | 体检图谱 | 现有 lint.sh |

> 注意：CLI **不带**项目定位参数推断——它只对"传入/已知的一个 `.brain/`"做读写，定位由 MCP 完成。语言 ✅ Node（与 MCP 同栈可共享 todo 解析逻辑）。

### 4.2 MCP（Node stdio server，本方案核心新增）

- **职责只有两个**：
  1. `resolve_project(cwd)` → 向上找最近 `.brain/`，返回该图谱绝对路径（代码写死，可靠）。
  2. 把工具调用**转接**给对应 CLI 命令（`abs task/board/query...`），传入已定位的 `.brain/` 路径。
- **暴露窄工具面**（ai-memory §10 narrow 哲学）：`todo_update` / `board` / `query` / `status` 等少数几个，不膨胀。
- **常驻但无状态**：每次调用从入参 cwd 重新解析，不记录"当前项目"全局态（避免多项目串）。
- hook 指向 MCP（stdio/HTTP 均可），MCP 是 hook 与 CLI 之间唯一稳定的转接口。

### 4.3 hook（薄，宿主各异）

- **三时机触发**：任务开始 / 边界（完/碰壁/被打断）/ 结束 → 转发事件给 MCP。
- **纪律（抄 ai-memory §6/§14，绝不硬刚）：**
  1. **fire-and-forget** + 硬超时（≤200ms），绝不阻塞 agent 热路径（§14.4）。
  2. **幂等**：同一事件别重复落，MCP/CLI 带确定性 id（§14.12）。
  3. 只记 todo，不深提炼 knowledge（深提炼仍归 skill 自觉，防刷噪音）。
  4. hook 拿不到/传错 cwd → 交由 MCP 解析失败处理，hook 自身不猜。

> **实现参考**：ai-memory 对 Cl​aude Code / Op​enCode / co​dex / pi 的 hook+MCP 接入机制（装哪个配置、写什么 schema、事件清单、stdin JSON 形状、stdout 要求、gotcha）→ 产出 `docs/REFERENCE-hosts.md`。先做 Cl​aude Code + Op​enCode；co​dex / pi 待确认宿主机制后补。

---

## 5. 存储 & 格式（沿用 SKILL.md 契约，不新造）

- todo.md 模板沿用两级分区：`Backlog` → `Today / In Progress` → `Blocked` → `Done`，半成品 `↳ 断点:`。
- 行内元数据：认领/完成标日期、可选 `Next-Step`、可选 `[[知识页]]` 双链串到 concepts/entities。
- log.md 采用 Karpathy 可解析前缀 `## [YYYY-MM-DD] ingest | ...`，可 `grep` 最近动作。
- `.brain/` 目录结构、容量纪律、lint 规则**全部沿用** SKILL.md，不改契约。
- 好答案复利（Karpathy）：query 得到的好答案可选归档回图谱成新页（由 skill 判断，防噪音）。

---

## 6. 与现有文件的关系

| 文件 | 处置 |
|---|---|
| `SKILL.md` | 保留 = 图谱契约 + 深提炼自觉层 + `abs`/MCP 使用引导。实现后补"hook/MCP 机械记 todo、skill 自觉写 knowledge"分工节 |
| `PLAN.md`（本文） | 定稿方案源 v2 |
| `scripts/bootstrap.sh` / `lint.sh` | 保留，`abs init` / `abs lint` 内部复用或迁移到 Node |
| `docs/REFERENCE-hosts.md`（规划） | ai-memory 各宿主 hook/MCP 接入机制参考（D0 提取产出） |
| 新增代码目录 | MCP server（Node）+ CLI + hooks 模板，建议放 `src/` 或 `mcp/`+`cli/`+`hooks/` 分目录 |

---

## 7. 落地顺序（每阶段可独立交付、可测）

| 阶段 | 交付 | 验证 |
|---|---|---|
| **D0** | 产出 `docs/REFERENCE-hosts.md`：从 ai-memory 提取 CC/Op​enCode/co​dex/pi 的 hook+MCP 接入机制 | 每宿主：配置/schema/事件/stdin/stdout/gotcha |
| **D1** | CLI 读写层：`abs init/read/board/query/task/lint` 跑通（手动，不串项目） | 建两个不同项目，各自 CLI 读写不串 |
| **D2** | Node MCP：`resolve_project` + 转接 CLI，暴露窄工具面 | MCP 对两个不同 cwd 解析出各自 `.brain/`，转接正确 |
| **D3** | Cl​aude Code hook 指向 MCP，端到端（三时机→MCP→CLI→todo.md） | 一个会话任务边界，todo.md 落对项目 |
| **D4** | 扩 Op​enCode（+ 按需 co​dex/pi）；SKILL.md 补分工节 | 多宿主各自隔离 |
| **D5**（可选）| 看板 Web / 更多读面 | 需要才做 |

---

## 8. 容量纪律 / 自我约束（沿用 SKILL.md）

- 只读写 `.brain/` 与目标项目，不碰用户全局配置（一次性 hook/MCP 安装除外）。
- todo.md 唯一真源；hook/MCP 只机械记 todo，深提炼仍归 skill。
- 宁缺毋滥，不刷噪音。

---

## 历史沿革

**v1（本文件前身）** 曾走"一个 `abs` CLI 收束 + MCP 降级可选"：认为 CLI 能承担用户主动入口 + hook 落盘，MCP 无真实消费者故砍掉。

**多轮讨论暴露 v1 两个破绽，故回归 v2：**
1. **skill 不稳定**：v1 想把"看状态/开机"等入口交给 skill（AI 按 SKILL.md 流程干），但 skill 靠 AI 自觉、不可靠——而"记状态"恰恰要求确定性，不能靠自觉。
2. **多项目定位难**：hook 靠 shell/事件 cwd 自己猜项目不可靠（宿主各异、会话内 cd 混乱）；"每项目装一次烧死路径"又太麻烦。定位逻辑必须放在**能写确定代码的进程**里。

**v2 解法**：让 **MCP 回归为核心层**——它既有真实职责（项目定位用代码写死 + 转接 CLI），又保持轻量（无 SQLite、无全程自动浓缩、无状态）。hook 退化回纯触发（薄、各异、只指向 MCP）；CLI 纯读写（定位由 MCP 喂）；skill 只管深提炼。三层职责单一，解决"确定性"与"多项目隔离"两个真问题。

**定稿前仍确认过的不做项**：不学 ai-memory 重引擎（Rust server/SQLite/FTS5/embeddings/managed workstream/多用户 auth）；不做统一多 workspace 图谱；不养常驻全功能后台（MCP 是常驻的但只做定位+转接，无复杂状态）。
