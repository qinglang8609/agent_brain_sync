# 角色定义：md 文件的字段规范

> 状态：定稿（2026-11-18）。落到 `code/multi-agent/roles.js`（解析）与 `agents/pi/skills/agent-chat/SKILL.md`（用法，pi 宿主实现）。

一个角色 = 一个 markdown 文件，frontmatter 写能力和边界，正文写人格与打法。
**角色不是代码**：加一个角色只写一个文件，不改一行 JS。

## 位置与优先级

```
项目根/.pi/agents/<角色名>.md         ← 项目级，优先
~/.pi/agent/agents/<角色名>.md        ← 用户级，跨项目
```

同名时项目级覆盖用户级（这是 pi-subagents 自己的规则：`builtin < package < user < project`，
详见 `pi-subagents-research.md` §3）。

**默认四人组不进任何目录** —— 它们由 `agents/pi/skills/agent-chat/SKILL.md` 里的模板给出，
用户第一次开会话时复制到项目 `.pi/agents/` 再改。原因：角色配置是内容，装到全局目录会污染
别的项目，而"插件内置一份、用户覆盖"的机制在 pi-subagents 里已经有优先级规则，再叠一层
会造成"到底加载了哪份"说不清。

## frontmatter 字段

只用 pi-subagents 支持的字段，不自造。下表是这套系统**实际用到**的：

| 字段 | 必填 | 作用 | 我们的约定 |
| --- | --- | --- | --- |
| `name` | ✓ | 角色名，`@` 时用它 | 中文名，短（2-4 字）：`架构师` `程序员` `测试` `产品` |
| `description` | ✓ | 一句话能力标签，写进主持人 prompt | 写「什么时候该点它」，不写「它很擅长什么」 |
| `advertise` | ✓ | `true` 才把 name+description 写进父代理 prompt | 四个人全 `true`。否则主持人根本不知道有这个角色 |
| `tools` | ✓ | 工具白名单，从 pi 现有工具里挑 | 见下方「工具边界」 |
| `model` | | 覆盖模型 | 角色用便宜档，主持人保持 pi 当前模型 |
| `memory` | ✓ | 角色私有持久记忆 | `true`，记忆落在 pi 的 `agent-memory/` 命名空间 |
| `systemPromptMode` | | `replace`（默认）/ `append` | 用 `replace`：角色是「职位」，不该背 abs 的记忆规则 |

**不要用** `fork` 类选项（`defaultSubagentContext: fork`）：它会把父会话的文件和全量历史复制进子代理，
几百 MB 起步。我们靠看板传上下文，不靠 fork。

## 工具边界

角色能干什么，由 `tools` 白名单钉死。默认四人组的建议值：

| 角色 | 该给的工具 | 不该给 | 理由 |
| --- | --- | --- | --- |
| 架构师 | `read` `grep` `find` `ls` | `write` `edit` `bash` | 只出方案不动手。给了写权限它会边聊边改代码，讨论就废了 |
| 程序员 | `read` `write` `edit` `bash` `grep` | —— | 唯一该动手的角色 |
| 测试 | `read` `bash`（只跑测试命令） | `write` `edit` | 只验证不改。否则它会把测试改成能过 |
| 产品 | `read` | `write` `edit` `bash` | 只读需求与文档，防止它改实现 |

这条的用意：**能力边界是硬的，靠 prompt 求它别改是软的**。聊天阶段所有人都应该只读
（见 `relay-rules.md` 的「聊天与干活分离」），所以除程序员外全给只读工具，程序员在聊天阶段
也靠规矩约束自己不动手。

## 示例

`<项目>/.pi/agents/架构师.md`：

```markdown
---
name: 架构师
description: 需要定方案、拆模块、判断技术选型时点它；方案里有取舍拿不准时也点它
advertise: true
tools: [read, grep, find, ls]
memory: true
model: haiku
systemPromptMode: replace
---

你是这次讨论里的架构师。

## 你怎么说话
- 先给结论，再给理由。不超过三句话的结论，理由最多三条。
- 每个方案必须带**代价**：慢在哪、贵在哪、以后改起来难在哪。只说好处的方案不算方案。
- 拿不准的地方点名让谁接（「这个得程序员确认依赖能不能引」）。

## 你不做什么
- 不写代码、不改文件。你只出方案。
- 不复述别人说过的话。同意就说「同意 X，补一点」，不要重说一遍。

## 你的记忆
MEMORY.md 里是你之前的判断记录。每次进场先看一眼有没有相关的，别推翻自己又不说为什么。
```

正文写什么、怎么写，没有硬约束 —— 它就是 system prompt。但三条纪律要遵守：

1. **不写「你是一个专业的...」这类空话**。角色的价值在具体的打法与边界，不在头衔。
2. **写清楚「你不做什么」**。只写正向要求时，角色会往宽了做。
3. **写清楚怎么说话**。不写长度和格式约束，角色会一次吐八百字，吃掉整个上下文。

## 解析规则

`code/multi-agent/roles.js` 只做三件事，不做别的：

1. 读 frontmatter（`---` 之间的 YAML 子集：字符串、布尔、方括号数组、数字）
2. 校验必填字段，缺了报错并指出**哪个文件缺哪个字段**（不静默给默认值）
3. 返回 `{ name, description, tools, memory, model, systemPromptMode, body }`

**不校验正文质量** —— 那是人的事，代码判断不了「人格写得对不对」。

解析失败的处置：**跳过该角色并告警**，不要让整次会话起不来。一个角色文件写坏了，
其余角色照常工作，比全体罢工有用。
