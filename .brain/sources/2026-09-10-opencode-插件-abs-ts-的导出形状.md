---
tags: [source, opencode, plugin, hook, abs, 坑]
updated: 2026-09-10
status: draft
---

# 来源：opencode 插件 abs.ts 的导出形状确认: @opencode-ai

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- opencode 插件 abs.ts 的导出形状确认: @opencode-ai/plugin 要求 PluginModule={id?,server:Plugin}，且 server 是 ({client,directory,...})=>Promise<Hooks>。官方 example.js 是 `export const ExamplePlugin = async (_ctx) => ({...})` 具名导出。abs 用 `export default {id:"abs",server}` 也符合 PluginModule —— 实证: 2026-09-10 13:20:04 写入了 opencode:session.created，说明插件已加载并触发 event 回调。此前 0 条日志的根因是 event 回调误用 ({name}) 而非 ({event})（代码注释 src/install.js:246 已记此坑）。

## 关联连接
（提炼成 concepts 规律页后，在此挂双链到该页）
