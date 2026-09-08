---
tags: [entity, project]
updated: 2026-09-08
status: draft
---

# AgentBrainSync (abs)

## 是什么
本仓库本体：跨会话 AI 记忆的机械落盘。三层架构（PLAN.md v2 定稿）：**hook 纯触发 → Node MCP（定位+转接）→ CLI 读写 `.brain/` markdown 图谱**。本图谱（`.brain/`）即 dogfooding 实例。

## 本项目里怎么用
- 代码: `abs/`（bin/abs.js CLI · bin/mcp.js MCP · src/{index,todo,store,hosts,install}.js · hooks/event.sh · test/store.test.js 29 用例）
- 开发: `cd abs && npm test`（node:test，零外部依赖）
- 方案源: 根目录 `PLAN.md`（图谱外）；审查共识 `.review-fix-plan.md`（可删）

## 相关概念（名下踩过的坑）
- [[todo-rewrite-not-map]] — 行内 map 改不了分区结构，done 归位要整文件重写
- [[hook-sh-not-bash]] — event.sh 的 sh/bash 方言坑

## 关联连接
- [[todo-rewrite-not-map]] — 开发看板纪律的来源
