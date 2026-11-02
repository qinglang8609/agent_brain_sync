---
title: pi 的 MCP 配置已迁到 mcp-adapter.json，mcp.json 不再被读
tags: [concept, pi, mcp, 配置]
author: fanchao
updated: 2026-11-02
status: active
layer: 3
---

# pi 的 MCP 配置迁移

新版 pi 不再读 `~/.pi/agent/mcp.json`，改为读 `mcp-adapter.json`。

## 触发场景

升级 pi 后看到这条警告，或在 `mcp.json` 里加了服务却始终不生效。

## ❌ 表现

每次启动都报：

```
Warning: pi-mcp-adapter no longer reads /Users/fanchao/.pi/agent/mcp.json.
Merge /Users/fanchao/.pi/agent/mcp.json into /Users/fanchao/.pi/agent/mcp-adapter.json,
then remove /Users/fanchao/.pi/agent/mcp.json.
```

**更隐蔽的后果**：删掉 `mcp.json` 之后跑 `abs update`，警告又回来了 —— 因为更新逻辑还在往旧文件写。

## 🛠 解法

1. 把 `mcp.json` 的 `mcpServers` 合并进 `mcp-adapter.json` 的 `mcpServers`
2. 删掉 `mcp.json`
3. **检查 `abs` 的安装/更新逻辑是否还在写 `mcp.json`** —— 实测 `abs update` 会重新生成它，
   说明写入侧没跟着改，只清文件治不了。

判据：**改配置格式时，写入方与读取方必须同一个版本一起改**；只改一边就是「删了又回来」。

## 验证

改完后重启宿主，确认：警告消失；`mcp.json` 不复存在；`abs update` 之后仍然不复存在。

## 关联连接

- [[deploy-artifact-copies]] — 同族：多副本必须同时改
- [[mcp-stale-paths-multi-store]] — MCP 陈旧路径的另一个坑
