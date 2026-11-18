# pi-subagents 调研报告

> 调研日期：2026-11-17。对象：`pi-subagents` v0.89.0，位于 `~/.pi/agent/npm/node_modules/pi-subagents/`。
> 目的：评估它能否支撑「群聊式多 agent」方案，哪些现成、哪些要自己写。

## 1. 它是什么

Pi 的**扩展（extension）**，不是 Pi 核心自带。功能一句话：把工作委派给专注的子代理（child agent），用于代码审查、侦察、实现、并行审计、后台任务等。安装只需 `pi install npm:pi-subagents`，需要 Pi 1.2.0+。

自带 7 个内置 agent：`scout`（快速代码侦察）、`researcher`（带来源的网络研究）、`evidence-auditor`（独立核实证据）、`worker`（实现/改文件）、`reviewer`（只读代码审查）、`oracle`（决策前的第二意见）、`delegate`（贴近父会话的通用委托）。

## 2. 核心架构

- **父 session（主 agent）→ 子代理**：子代理是一个有自己任务的 Pi 子会话。
- **前台子代理**：跑在父 Pi 进程内，流式显示在对话里。
- **后台子代理**：跑在 detached runner 进程里，父会话交还控制后继续干，之后可查。
- **执行模型 = 任务制**：每次调用是「给 task → 返回 output」，跑完结束；`resume` 保留上下文续聊。
- **通信模型 = 树状**：父↔子，子代理之间**不直接通信**，只能靠父代理转发。

## 3. Agent（角色）定义

位置（优先级从低到高）：builtin < 已装 package < user（`~/.pi/agent/agents/**/*.md`）< project（`.pi/agents/**/*.md`）。同名时高优先级覆盖低优先级。

frontmatter 关键字段（完整清单见 multi-agent-system.md）：

| 字段 | 作用 |
| --- | --- |
| `name` / `description` | 名字 + 一句话能力标签 |
| `advertise: true` | 把 name+description 自动写进父代理 system prompt |
| `tools` / `excludeTools` | 能力白名单/黑名单（从 pi 工具集里挑） |
| `skills` / `skillPath` | 选定技能 / 私有技能路径 |
| `model` / `thinking` | 模型 + 思考档位 |
| `memory` | 角色私有持久记忆（见 §7） |
| `systemPromptMode` | `replace`（默认）/ `append` |
| `allowNestedSubagents` / `allowedAgents` | 是否允许嵌套派发、允许派发谁 |
| `async` / `timeoutMs` | 默认前台/后台、超时 |

## 4. 能力继承规则（内存开销关键）

| 项 | 默认 | 开销 | 说明 |
| --- | --- | --- | --- |
| skill | 继承 | **小** | 只注入元数据（名字+描述+路径），任务匹配才用 read 读全文 |
| 会话缓存 | **不继承**（fresh） | fresh 小 / fork 巨大 | `fork` 复制父 session 文件+全量历史进 prompt |
| MCP | 看前后台 | 中 | 后台子代理才加载 ambient（含 MCP adapter）；前台选 MCP 会失败 |
| extensions | 看前后台 | 中 | 后台继承 ambient，前台不继承 |
| memory | 按字段 | 小 | 每 run 注入 MEMORY.md 前 200 行 |

**结论**：真正要防的是 `fork` 会话缓存（复制几百 MB session 文件 + 全量历史）。skill 和 MCP 的「继承」本质是元数据/工具选择，可控不贵。

## 5. 通信机制

- `contact_supervisor`：子代理向父代理提问（要决策/澄清），reason 有 `need_decision` / `interview_request` / `progress_update`。
- `subagent_supervisor`：父代理回子代理（`reply` / `pending`）。
- 嵌套 A→B→C：C 问 B，B 再问 A；B 需要 `subagent + contact_supervisor + subagent_supervisor` 三工具才能既向下派发又向上提问。
- `intercom bridge`：父↔子的编排通道（`intercomBridge` 配置），`result-intercom` 是外部结果投递，**不是 agent 间对等聊天**。

## 6. 持久机制（逼近「角色常驻」的关键）

- **`memory` 字段**：角色私有持久记忆，独立 `agent-memory/` 命名空间，每次 run 注入 MEMORY.md 前 200 行，角色可追加写入。跨 run 连续。
- **retained children + `resume`**：保留已完成的子代理 run，可带着它的上下文续聊。
- **missions**：持久任务记录（`~/.pi/agent/missions/`），workflow 默认创建，可恢复、可记 receipt（PR/CI 链接）。
- **schedules**：定时/周期任务（`.pi/subagents/schedules/`），后台定时跑。

**结论**：pi 的「持久」= **状态落盘 + 用时恢复**，不是「常驻进程」。角色没有 7×24 常驻进程，但靠 memory 落盘 + resume + missions 能逼近「一直活着、记得之前」的体感。

## 7. 模型分层与成本控制

- 配置项：`subagents.defaultModel`（默认）、`agentOverrides.<name>.model`（按角色钉模型）、`modelScope`（模型范围硬约束）。
- 推荐四层：fast workhorse（便宜低思考，侦察/机械活）、standard（中档，常规实现/审查）、deep（顶级推理，仅硬任务）、intent（读意图，模糊任务）。
- 角色用便宜模型 = 成本控制主手段。

## 8. 扩展 API（我们做「群聊层」的技术基础）

这是**我们自己写扩展**时能用的公开接口，全部有类型和事件契约：

| API | 用途 | 对我们群聊层的价值 |
| --- | --- | --- |
| In-process event-bus RPC | `spawn`/`steer`/`stop`/`resume`/`status`/`cost`，跨扩展调用 | 群聊层可程序化拉起/控制角色 |
| Runtime agent registration | 扩展运行时动态注册 agent | 可在扩展里动态创建角色 |
| Structured delegation API | 跑前台 leaf agent 拿结构化结果 | 角色产出结构化消息 |
| Capability ceilings | 会话级限制可用 agent/工具 | 实现「@门禁」的硬约束层 |
| Background-work provider | 让扩展的任务被 `bg_wait` 感知 | 群聊任务等待 |
| External job provider bridge | 接外部长任务 | （可选）接外部模型 |

## 9. 关键配置项

- `defaultSubagentContext`：全局 fresh/fork 默认。
- `forkContext`：`pruned` 模式用 64KB 预算摘要压缩 fork 上下文。
- `fleetView` / `asyncWidget`：TUI 里的运行视图。
- `maxSubagentSpawnsPerRun`（默认 64）、`maxActiveAsyncRunsPerSession`：并发/累计上限。
- `globalConcurrencyLimit`：并发限制。

## 10. 对我们「群聊式多 agent」的意义（对照）

| 我们要的 | pi-subagents 现状 | 结论 |
| --- | --- | --- |
| 角色定义（职位+能力） | frontmatter 原生支持 | ✅ 现成 |
| 角色独立记忆 | `memory` 字段 | ✅ 现成 |
| 共享 skill/MCP/插件 | 全局配置天然共享 | ✅ 现成 |
| 共享会话记录 | 无，需自建看板文件 | ⚠️ 自己写 |
| 角色后台独立运行 | async 后台子代理 + schedules | ✅ 现成 |
| 角色「常驻」 | memory 落盘逼近，无常驻进程 | ⚠️ 逼近，非真常驻 |
| 角色间互相可见 | 子代理互不直接通信 | ❌ 需自己搭协调层 |
| @ 门禁 | 无原生 @ 触发 | ⚠️ 自然语言+清单+capability ceiling |
| 群聊协调层 | 无 | ❌ 自己写扩展（用 §8 的 API） |

## 11. 总结

pi-subagents 把「角色、能力、记忆、后台运行、模型分层」这些地基全部铺好了；缺的只有**「角色间对等通信 + 群聊协调 + @门禁」这层**，而这层可以用它的扩展 API（RPC + runtime agent registration + capability ceilings）自己写成新扩展，**不需要改 pi-subagents 或 pi 的底层**。
