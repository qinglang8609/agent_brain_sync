---
tags: [entity, project]
updated: 2026-10-05
status: active
---

# AgentBrainSync (abs)

## 是什么

本仓库本体：跨会话 AI 记忆的机械落盘。三层架构（PLAN.md v2 定稿）：
**hook 纯触发 → Node MCP（定位+转接）→ CLI 读写 `.brain/` markdown 图谱**。
本图谱（`.brain/`）即 dogfooding 实例。

## 本项目里怎么用

- 代码: `bin/abs.js`（CLI）· `bin/mcp.js`（MCP）· `src/`（12 个模块：index/todo/store/lint/lock/query/relevant/wrapup/hosts/install/codegraph/userconfig）· `hooks/`
- 开发: `npm test`（node:test，零外部依赖；446 用例）
- 发布: `npm publish`，包名 `@fanchao8609/agent_brain_sync`

## 相关概念（名下踩过的坑）

- [[todo-rewrite-not-map]] — 行内 map 改不了分区结构，done 归位要整文件重写
- [[hook-sh-not-bash]] — event.sh 的 sh/bash 方言坑
- [[validation-gate-on-shared-write-path]] — 给共享写入路径加校验的三个必答问题

## 关联连接

- [[todo-rewrite-not-map]] — 开发看板纪律的来源
- [[fanchao]] — 本项目的使用者
- [[read-side-output-must-not-scale]] — 读取侧输出必须有界（Done 折叠、lint 折叠都源于此）
