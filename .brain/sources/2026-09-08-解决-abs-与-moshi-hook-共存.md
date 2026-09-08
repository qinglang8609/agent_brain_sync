---
tags: [source, abs, install, hook, 共存, moshi-hook]
updated: 2026-09-08
status: draft
---

# 来源：解决 abs 与 moshi-hook 共存: installClaudeCod

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- 解决 abs 与 moshi-hook 共存: installClaudeCode 从覆盖式 settings.hooks[ev]=[abs] 改为分区合并追加(保留既有 hook 条目, entryHasAbs 去重幂等); uninstall 改为只删 abs 条目、无共存才整删。真实 ~/.claude/settings.json 应用后 4 生命周期事件各 moshi+abs 2条共存, moshi 其它4事件(Notification等)未误伤。claude-code hooks 同事件天然支持多数组条目按序执行

## 关联连接
（提炼成 concepts 规律页后，在此挂双链到该页）
