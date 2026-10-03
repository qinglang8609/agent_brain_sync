---
tags: [source, pi扩展, 坑, 验证]
id: 2026-10-03-pi-扩展-before_agent_start
author: fanchao
updated: 2026-10-03
status: draft
---

# 来源：pi 扩展 before_agent_start 里 event.systemPromptOptions.selectedTools 是基线值不是真实工具表:…

TITLE: pi 扩展 before_agent_start 里 event.systemPromptOptions.selectedTools 是基线值不是真实工具表: agent-session.js 在 handler 之后(1573行)才用 getActiveToolNames() 回填真实值, 实测拿到 31 个且不含任何 MCP 工具 → 靠它判断'某个工具是否可用'永远为假。正确做法: 用 pi.getActiveTools()(实时读 agent.state.tools)。教训: 对扩展 API 的字段语义必须查源码确认, 不能靠字段名猜。

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- pi 扩展 before_agent_start 里 event.systemPromptOptions.selectedTools 是基线值不是真实工具表: agent-session.js 在 handler 之后(1573行)才用 getActiveToolNames() 回填真实值, 实测拿到 31 个且不含任何 MCP 工具 → 靠它判断'某个工具是否可用'永远为假。正确做法: 用 pi.getActiveTools()(实时读 agent.state.tools)。教训: 对扩展 API 的字段语义必须查源码确认, 不能靠字段名猜。

## 关联连接
- [[fanchao]] — 本页沉淀者
（提炼成 concepts 规律页后，在此挂双链到该页）
