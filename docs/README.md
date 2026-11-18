# 文档索引

`docs/` 放**长文档**：设计、规范、约定。一眼能看完的东西（命令用法、目录说明）留在根
[`README.md`](../README.md)，不在这里重复。

## 按功能分类

| 分类 | 目录 | 放什么 |
| --- | --- | --- |
| **系统设计** | [`pi-agents/`](pi-agents/) | 多 agent 系统（群聊式接力）的架构与规则 |
| **插件说明** | `agents/pi/plugins/<插件>/README.md` | 每个 pi 插件自己的用法与实现要点 —— **不搬进 docs/**，就近放 |
| **项目主文档** | [`../README.md`](../README.md) | 安装、命令、图谱机制、目录结构 |

`docs/` 下没有第三类空目录。新增一类时建一个子目录 + 在本文件加一行，别在 `docs/` 根下平铺。

## pi-agents（多 agent 系统）

### 规范（写代码按这四份来）

| 文件 | 一句话 |
| --- | --- |
| [`architecture.md`](pi-agents/architecture.md) | 三层分工：`code/multi-agent/` 是全局功能（不 import pi）、`agents/pi/` 是 pi 宿主实现、角色 md 由用户自己写；附「换个宿主还能用吗」的判据 |
| [`board-format.md`](pi-agents/board-format.md) | 共享看板 `board.md` 的四段格式、只有主持人写、长度上限、与 `.brain/todo.md` 的区别 |
| [`role-card.md`](pi-agents/role-card.md) | 角色 md 的 frontmatter 字段、四人组的工具边界、解析规则 |
| [`relay-rules.md`](pi-agents/relay-rules.md) | `@` 门禁、主持人点人的五条优先级、轮次与字数上限、收敛双保险、中断处理 |

### 材料（写规范时的依据，改动不必同步）

| 文件 | 是什么 |
| --- | --- |
| [`multi-agent-system.md`](pi-agents/multi-agent-system.md) | 最初方案 v1：目标、架构约束、主持人接力、五部件（含待定事项） |
| [`pi-subagents-research.md`](pi-agents/pi-subagents-research.md) | pi-subagents v0.89.0 调研：agent 定义、能力继承、通信模型、持久机制、扩展 API、缺什么要自己写 |
| [`deepseek-harness-research.md`](pi-agents/deepseek-harness-research.md) | dsh 的 Agent Teams 调研（共享任务看板 + 成员 + 消息），对照参考 |

**规范与材料冲突时以规范为准**：规范是拍板后的结论，材料是当时的讨论与调研记录。

## 插件文档

| 插件 | 文档 | 是什么 |
| --- | --- | --- |
| capsule-tools | [`agents/pi/plugins/capsule-tools/README.md`](../agents/pi/plugins/capsule-tools/README.md) | 工具调用折叠成一行绿色胶囊；独立发 npm |
| rounded-editor | [`agents/pi/plugins/rounded-editor/README.md`](../agents/pi/plugins/rounded-editor/README.md) | 圆角四边框输入框 + 右下角状态 |
| todo-panel | [`agents/pi/plugins/todo-panel/README.md`](../agents/pi/plugins/todo-panel/README.md) | 编辑器上方的 `.brain/todo.md` 面板 |

## 写文档的规矩

- **文件名说清楚内容**，不用 `notes.md` `misc.md` 这类名字。
- **一份文档一件事**。要写第二件事就新建一份，然后在相关文档里互相引用 —— 引用的代价远小于
  一份什么都讲的长文档。
- **别抄**。同一个结论只在一处写，其它地方给链接。抄两份必然漂移。
- **没验证的标出来**（「未实测」「源码推断」），别把推测写成事实。
- **禁令直接写**（「不要 X」），不写「建议尽量避免 X」—— 后者等于没写。
