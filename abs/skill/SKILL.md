---
name: abs-agent-brain-sync
description: abs 跨会话记忆。会话开场用 abs load / MCP abs_load 续接上下文；查坑用 abs board / abs query；状态落盘由 hook 自动完成，无需手动记。
---

# abs — 跨会话记忆 (agent-brain-sync)

本项目装有 abs：hook 机械落盘 + markdown 图谱（`.brain/`）+ MCP 工具面。
分工一句话：**hook 机械记流水、任务/经验你实时落盘（工具命令）、深提炼你收尾做（自觉层）**。

## 1. 会话开场 → 续接
用 MCP 工具 `abs_load`（或终端 `abs load`）读 index/todo/log，接上未完成任务再开工。
有明确新任务时先 `abs_task(action="start", id=...)` 登记一行，再动工——不登记，会话一切断就丢。

## 2. 干活中 → 实时落盘（每个任务边界，和 git commit 同一个反射）
todo 是活看板，别等收尾。MCP `abs_task` 四个动作 / CLI `abs task`：

| 时机 | 动作 |
|---|---|
| 认领新任务 | `abs_task(action="start", id, note=做什么)` |
| 子任务做完 | `abs_task(action="done", id)` —— 自动归位 Done 区 |
| **碰壁/阻塞** | `abs_task(action="blocked", id, note=卡点原因)` —— 移 Blocked 区附失败输出 |
| **被打断/改向/干到一半要停** | `abs_task(action="note", id, note="改到哪个文件哪一步")` —— 原位补 `↳ 断点:` 行 |

**经验/技巧/坑刚冒出来就落**：`abs_note(text="一句话", tags="坑,docker")`（CLI `abs note`）
——机械暂存进 sources/（幂等去重），防 context 爆掉/被截断时流失。宁少勿滥：能从代码 grep 出来的不记。

## 3. 收尾 → 深提炼（自觉层，工具不替你做）
任务完成/告一段落时把暂存提炼成真知识：
1. sources/ 里值得留的 → 提炼成 concepts/<kebab-slug>.md（触发场景/❌表现/🛠解法+验证命令），挂 `[[实体页]]` 双链；提炼完的 source 删掉并清引用。
2. 最终对账 todo（滞留 Today 的归位；半成品放回 Backlog 补 `↳ 断点:`）。
3. 新页同步进 index.md。过容量纪律：能一行的别开页，单页 <150 行。

## 边界
- 代码问题（符号在哪/谁调用）直接读源码，`.brain/` 只答"以前踩过什么、上次做到哪"。
- hook 自动记 log 流水（SessionStart/UserPromptSubmit/Stop/SessionEnd）；你不重复记，也不写 log。
- 图谱是给下个会话读的：双链 `[[页面名]]` 必须指向真实存在的文件；改完可跑 `abs lint` 自检。
