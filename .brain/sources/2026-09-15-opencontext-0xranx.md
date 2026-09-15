---
tags: [source, 对比, 读取协议, opencontext]
author: fanchao
updated: 2026-09-15
status: draft
---

# 来源：OpenContext(0xranx) 对比结论：它的读取协议值得抄——manifest 先给「路径+一行desc+计数」让 Agent 自己挑，而非吐全文…

TITLE: OpenContext(0xranx) 对比结论：它的读取协议值得抄——manifest 先给「路径+一行desc+计数」让 Agent 自己挑，而非吐全文；MCP 错误带 fallback 路径(INDEX_NOT_AVAILABLE→改用 oc_manifest)让 Agent 自救；stable_id 让引用跨改名存活(lint 从'事后查死链'变'链不会断')。abs 的对应短板：abs load 吐全文会随图谱膨胀(自己 README 的 read-side-output-must-not-scale 正是此病)，页面引用用路径、改名即断链。它的反面：全局存储+向量检索+LLM 提炼+API key 依赖，牺牲了 abs 的 git 化/零依赖/项目隔离；其 agent 集成是'写 AGENTS.md 建议 Agent 主动调'，属建议式触发，正是 abs 已证明会失效的那类(靠提醒才能工作的功能该删)。

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- OpenContext(0xranx) 对比结论：它的读取协议值得抄——manifest 先给「路径+一行desc+计数」让 Agent 自己挑，而非吐全文；MCP 错误带 fallback 路径(INDEX_NOT_AVAILABLE→改用 oc_manifest)让 Agent 自救；stable_id 让引用跨改名存活(lint 从'事后查死链'变'链不会断')。abs 的对应短板：abs load 吐全文会随图谱膨胀(自己 README 的 read-side-output-must-not-scale 正是此病)，页面引用用路径、改名即断链。它的反面：全局存储+向量检索+LLM 提炼+API key 依赖，牺牲了 abs 的 git 化/零依赖/项目隔离；其 agent 集成是'写 AGENTS.md 建议 Agent 主动调'，属建议式触发，正是 abs 已证明会失效的那类(靠提醒才能工作的功能该删)。

## 关联连接
- [[fanchao]] — 本页沉淀者
（提炼成 concepts 规律页后，在此挂双链到该页）
