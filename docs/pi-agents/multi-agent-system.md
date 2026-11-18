# 多 agent 系统（pi）— 方案设计 v1

> 状态：讨论中，未写代码。起始 2026-11-17。
> 一句话：在 pi-subagents 之上加一个「主持人驱动的接力对话」层，把树状任务派发改造成头脑风暴式协作。

## 已拍板的决策

- **聊天形态**：混合——你 @角色点名起头，角色们由主持人接力对话，直到收敛喊停。
- **第一步范围**：只做后端四部件（指挥文档 + 智能体管理 + 协调层 + 共享独立），群聊 UI（头像 + 展开）后补。
- **指挥文档形式**：SKILL.md（pi 的 skill 机制，自动发现、按需加载）。
- **节奏**：串行接力 + 共享看板（头脑风暴式，轮流发言看同一块白板），暂不做并行实时互看。

## 目标

1. 创建多个 agent，每个是一个「职位/角色」，有自己的能力和记忆；
2. 聊天时用 `@agent` 把某个角色拉进会话，**没 @ 过的不能调**；
3. 角色之间像头脑风暴一样互相可见：知道别人在做什么、做得怎样，知道总任务和分任务；
4. 角色像聊天一样回复用户、回复主 agent、回复其他角色；
5. 任务共担：聊出方案后分工执行、并行、汇总。

## 架构约束（重要前提）

角色 agent **不是独立进程、不是外部应用**，就是当前 pi 会话里的子代理（pi-subagents 的 subagent），干活靠 pi 自己的能力：

- **能力 = pi 工具集的子集**：角色的 `tools` 字段是从 pi 现有工具（read/write/edit/bash/mcp 等）里「挑一部分」，不是给角色造新能力。
- **执行环境 = 当前 pi 会话**：子代理共享 cwd、git 仓库、文件系统，角色改的就是本项目文件。
- **模型 = pi 配的模型**：角色用 pi 的模型，frontmatter `model` 只是覆盖成便宜档，不是另接模型。
- **不造执行引擎**：本方案只做调度层（skill + @门禁 + 共享看板），执行完全复用 pi-subagents 的 subagent 机制。

由此，本方案的难点是**组织调度问题**（怎么让角色知道彼此在干嘛、怎么轮流接话），不是执行问题。

## 核心设计：主持人驱动的接力对话

消息流转（以「做登录功能」为例）：

```
你: @架构师 我要做登录功能，聊聊方案
        │
        ▼
[主持人] 点架构师 → 架构师说方案
        ▼
[主持人] 判断"还缺实现视角" → 点程序员 → 程序员说"能实现，但X要改"
        ▼
[主持人] 判断"涉及安全" → 点测试 → 测试说"得补OAuth"
        ▼
[主持人] 判断"没有新意见，收敛" → 汇总给你
```

- **接力是主持人驱动的**，不是角色自己抢话。贴合 pi-subagents「父代理把关」模型。
- **主持人先由主 agent 担任**（它天生有 subagent 工具），逻辑稳定后再固化成独立 coordinator agent。

## 项目结构：五部件

本项目 = 一个 Pi 扩展，五个部件：

| 部件 | 落点 | 现成/要写 |
| --- | --- | --- |
| 1. 指挥文档 | SKILL.md（skill 机制） | 现成，写文案 |
| 2. 智能体管理（增删改） | pi-subagents management actions / 运行时注册 | 现成 |
| 3. 协调层（主持人） | 主 agent + 共享看板文件 | 要写（prompt + 文件） |
| 4. 群聊 UI | TUI 扩展（ctx.ui.custom + @解析） | 要写（最重） |
| 5. 共享 + 独立 | 看板文件（共享）+ frontmatter memory（独立） | 现成机制 |

第一步只做 1、2、3、5，部件 4（群聊 UI）后补。

## 关键设计点

### 角色定义（frontmatter）

- `name` / `description`（一句话能力标签）/ system prompt（人格 + 详细能力阐述）
- `tools`：能力边界（架构师只读、程序员可写、测试只读验证、产品只读）
- `memory`：角色私有持久记忆（跨会话记住自己说过啥）
- `advertise: true`：把 name+description 自动写进主持人 system prompt，主持人天然知道有哪些角色

### 自我介绍两层

- **静态能力卡**：frontmatter 的 `description`，主持人调度时点对人。
- **动态自我介绍**：角色被 @ 进场时先自我介绍，写进共享看板「成员」栏，其他角色也能认识它。

### 共享看板（解决「互相知道在干嘛」）

角色 `memory` 是**私有**记忆（看不到别人说了啥），接力需要角色知道别人在做什么，所以主持人维护一份**公共看板**，每轮把看板快照作为上下文传给被点名角色，角色干完写回看板。

看板结构示例：

```
# 总任务：做登录功能
## 分任务
- [进行中] 方案设计 —— 架构师
- [待办]   后端实现 —— 程序员
- [待办]   安全验证 —— 测试
## 在场成员：架构师、程序员、测试（产品没@，不在）
## 最新动态
- 架构师：建议 OAuth2+JWT，指出 token 过期有风险
- 程序员：OAuth2 可行，要引两个依赖
```

### 接力规则（主持人怎么点下一位）

写死在调度 skill 里：你 @谁先点谁；之后每轮看「上一个人留下的问题谁最该接」（实现缺口→程序员、风险→测试）；每轮最多点 1-2 人。

### 收敛条件（双保险）

- 轮次上限：自动接力最多 3 轮（待确认）；
- 主持人判断：角色开始重复、跑题、没有新实质意见就喊停。

### 成本控制

- 角色用便宜快的模型（haiku 档），主持人用强模型；
- 轮次、角色数、单轮长度都设硬上限。

### 聊天与干活分离

- 阶段一（聊）：角色只发表意见，产出「结论 + 分工」；
- 阶段二（干）：主持人按结论把活拆给能动手的角色，并行跑、汇总验收。

## 待定事项（下次继续）

1. 角色阵容：默认「架构师 / 程序员 / 测试 / 产品」四人组，待用户确认；
2. 收敛轮次：建议 3 轮，待确认；
3. 文件落点：调度 skill 放项目 `.pi/skills/agent-chat/` 还是 `~/.pi/agent/skills/`；成员清单 + 看板放 `.pi/agents-chat/`，待确认；
4. 每个角色的详细人格文案、看板字段细则、skill 里调度规则的具体措辞。

## 已查证的关键技术事实（pi-subagents）

- agent 定义位置：`~/.pi/agent/agents/**/*.md`（用户级）、项目 `.pi/agents/**/*.md`；优先级：builtin < package < user < project。
- frontmatter 字段：`name` `package` `description` `advertise` `aliases` `tools` `excludeTools` `extensions` `subagentOnlyExtensions` `model` `thinking` `systemPromptMode` `inheritProjectContext` `inheritGlobalContext` `inheritSkills` `skills` `skillPath` `output` `defaultReads` `defaultProgress` `async` `timeoutMs` `toolTimeoutMs` `acceptance` `acceptanceRole` `mutationTools` `interactive` `maxSubagentDepth` `allowNestedSubagents` `allowedAgents` `memory`。
- `memory` 字段：角色持久记忆，独立 `agent-memory/` 命名空间，每次 run 注入 MEMORY.md 前 200 行。
- 通信是树状：父→子（subagent 派发）、子→父（`contact_supervisor` 提问）、父→子回（`subagent_supervisor reply`）；子代理之间不直接通信，只能靠父代理转发；嵌套 A→B→C 时 C 问 B、B 再问 A。
- 执行是任务制（task→output），`resume` 保留上下文续聊；`runs.all` 并行、`runs.run` 单发。
- intercom bridge 是父↔子的编排通道，`result-intercom` 是外部结果投递，不是 agent 间对等聊天。
- 包位置：`~/.pi/agent/npm/node_modules/pi-subagents/`（v0.89.0），文档 `docs/agents.md` `docs/tool-reference.md` `docs/workflows.md` `docs/extension-api.md` `docs/configuration.md`。
