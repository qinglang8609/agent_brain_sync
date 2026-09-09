---
tags: [concept, install]
updated: 2026-09-09
status: reviewed
---

# 概念：abs 全局安装形态 = npm link 单一真源

## 触发场景
用户要"装到系统全局"，同时 hook/MCP 也需要稳定代码路径。

## 🛠 形态
1. `cd abs && npm link` → 全局 `abs` 命令（symlink 回开发目录，`npm unlink -g abs` 可撤）。
2. hook 脚本（`~/.abs/hooks/<agent>/`）烧死两条绝对路径：`NODE_BIN`（node 可执行）+ `ABS_BIN`（abs.js 绝对路径）——**不依赖 PATH、不依赖 exec 位**。
3. MCP 注册 `mcpServers.abs = { command: node, args: [abs.js] }`，同样绝对路径。
4. skill 拷贝到 `~/.claude/skills/abs-agent-brain-sync/`（内容快照，重装更新）。

## 关键点
全局命令、hook、MCP 三者经 realpath 汇聚到**同一份开发目录代码**——改代码即时全局生效，无需重装（重装只刷 hook 模板与 skill 快照）。
nvm 切 node 大版本时 NODE_BIN 失效 → 重跑 `abs install` 刷新。

## 知识冲突（演进）
本文的「npm link 单一真源」是**开发期**形态。**产品模式**已改为发布到 npm registry、`npm install -g @fanchao8609/agent_brain_sync` 正式全局装——hook/MCP 烧的绝对路径指向发布包而非开发目录。两者差异见 [[npm-publish-flow]]（坑 5：link 与发布包抢 bin）。hook 烧绝对路径、nvm 切换重装这两个机制在两种形态下**不变**。

## 关联连接
- [[AgentBrainSync]] — 安装器实现（src/install.js）
- [[npm-publish-flow]] — 产品模式发布全流程（scoped 改名/2FA/link 清理）
