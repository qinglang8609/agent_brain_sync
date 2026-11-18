# DeepSeek Harness（dsh）调研报告

> 调研日期：2026-11-17。对象：`deepseek-ai/deepseek-harness`（浅克隆到 `/tmp/dsh-research`），本机已装（`~/Documents/deepseek-harness/`、`~/.dsh/`）。
> 目的：评估「支持 dsh」的落地方式，以及它与 pi / pi-subagents 的对应关系。

## 1. 它是什么

DeepSeek 官方开源的 agent 框架（agent harness），TypeScript 写，MIT 协议，**开发者预览阶段**（官方明说未来有破坏性变更）。核心理念 `Agent = Model + Harness`：模型是灵魂，Harness 给模型理解环境、用工具、持续工作的能力。

## 2. 架构核心：一切皆插件（Cordis）

- **无特权内核**：产品每一部分都是插件——模型适配器、工具注册表、会话日志、**agent loop 本身**——都可从配置替换。扩展方式是「把插件挂到其他插件旁边」，各项注册是副作用，插件卸载时撤销。
- **Cordis 五个核心概念**：插件、上下文（Context）、依赖注入、类型化事件、可逆副作用。
- **Profile + Bundle（组合包）**：运行中的 dsh 是一棵插件树，按序叠加组合。`dsh.profile` 列 bundle，`dsh.bundle` 指向 bundle 的 patch 文件。本机 profile 见 `~/.dsh/profiles/desktop/`。
- **核心包**：`core/session`（追加式会话日志）、`core/system-prompt`（提示组装）、`core/tools`（作用域工具注册表）、`core/agent`（Agent 接口 + 活跃 agent 注册表）、`core/agent-loop`（agent 循环驱动器）。
- **事件三域**：会话事件（持久事实）、Agent 事件（inbox/step/status/request，观察进行中的工作）、能力事件（attach 策略/适配器）。

## 3. 多 agent 能力（重点）

dsh 有**两层**多 agent 机制，其中第二层比 pi 更接近「群聊协作」：

### 3.1 Subagents（子代理）

- 子代理 = **Session**，树状结构；`listDescendants()` 递归枚举。
- 名字是「面向模型的引用」（slash 分隔路径，1–32 小写），Session id 才是执行身份。
- `SubagentProvider` 契约：`spawn` / `fork` / `codex` / `claude-code` / `acp` / `dsh-sdk` 等 provider 注册传输方式。
- 成员间消息：inbox / mailbox，成员交换普通 subagent messages。

### 3.2 Agent Teams（智能体团队）—— 关键发现

`packages/team/agent-team/` 已内置「团队 + 共享任务看板 + 成员消息」：

- **共享任务 DAG**：`TeamTaskSnapshot` 含 id、subject、description、status（`pending`/`in_progress`/`completed`/`deleted`）、ownerId、`blockedBy`（阻塞关系）、`writeScopes`（写范围）。API：`createTask` / `getTask` / `listTasks` / `updateTask`（compare-and-set，`revision` 版本号）。
- **成员花名册**：`TeamMemberSnapshot` 含 name、description、provider、context（fresh/fork）、phase。
- **成员间消息**：mailbox，senderId/senderName/targetId/content。
- **Cordis 服务**：`ctx.agentTeams`（TeamService），`agentTeam.enabled` 开关 + Web 投影（任务面板）。

**这几乎就是我们设计的「共享看板」的现成实现**——pi-subagents 要自己搭的东西，dsh 的 Agent Teams 已经给了。

## 4. 子系统对应表

| 能力 | pi（+pi-subagents） | dsh |
| --- | --- | --- |
| 角色/agent 定义 | frontmatter（`~/.pi/agent/agents/*.md`） | SubagentProvider + agent 名字/描述（具体前端待确认） |
| 派发子代理 | subagent 工具 | SubagentRuntime（spawn/fork 等 provider） |
| 树状通信 | contact_supervisor | 成员消息（inbox/mailbox） |
| 共享任务看板 | ❌ 要自己搭 | ✅ Agent Teams Task DAG |
| 成员花名册 | frontmatter advertise | ✅ Team roster |
| 技能 | SKILL.md | skills 子系统 |
| 工具 | tools 字段 | tools 子系统（ctx.tools） |
| MCP | mcp.json + tools | mcp 子系统 |
| 扩展/插件 | TS extension | Cordis plugin（bundle） |
| UI 扩展 | ctx.ui.custom | client-modules（界面区块） |
| 工作流 | workflow scripts | workflow 子系统 |
| 目标/任务 | missions/goal | goal 子系统 |

## 5. 对我们「群聊式多 agent」的意义

**核心结论**：dsh 的 Agent Teams 已经内置「共享任务看板 + 成员 + 消息」，比 pi 更接近「群聊协作」；「支持 dsh」的落地 = **核心层解耦 + 两套适配层**：

| 层 | 内容 | pi 实现 | dsh 实现 |
| --- | --- | --- | --- |
| 核心层（harness 无关） | 角色定义、协调规则、看板结构 | 同一套 | 同一套 |
| 适配层（harness 相关） | 派发、工具、消息、UI | pi-subagents + 自建看板文件 | Agent Teams（Task DAG）+ 成员消息 + Cordis 插件 |

具体地说：**「群聊协调层」在 dsh 里就是一个 Cordis 插件（bundle）**，挂到 profile 里，用 `ctx.agentTeams` 的 Task DAG 当共享看板、用成员消息当角色间通信。核心层（角色人格、接力规则、收敛规则）两边复用。

## 6. 待进一步确认

- dsh 的「角色定义」具体前端（类似 pi 的 frontmatter 落点）——从 subagent.md 看到 SubagentProvider 契约和 agent 名字规则，但「人格 prompt 写在哪」需再看 `packages/subagent/subagent/README.md` 和 catalog 持久化。
- dsh 的 skills / tools 子系统的具体扩展写法（有 cookbook：`adding-a-tool.md`、`adding-a-plugin-preview.md` 等）。
- dsh 的 client-modules（界面区块）怎么扩展——对应我们的「群聊 UI」。

## 7. 风险提示

- dsh 处于**开发者预览**，官方明说未来有破坏性变更，现在为它写适配层有返工风险。
- 本机 dsh 走 agent2api（`code.d8gx.com`）+ deepseek 模型，与 pi 的模型配置是两套。
