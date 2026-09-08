---
tags: [source, concurrency, arch]
updated: 2026-09-08
status: draft
---

# 来源：abs markdown并发写冲突: 所有读-改-全写回文件操作都应经共享edi

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- abs markdown并发写冲突: 所有读-改-全写回文件操作都应经共享editFile锁(open wx原子锁文件+SKIP哨兵+超10s残留锁摘除+短重试), 锁内串行读改写, 否则CLI/MCP/hook多进程会互相覆盖丢行。新增src/lock.js集中一处挡所有调用方。

## 关联连接
（提炼成 concepts 规律页后，在此挂双链到该页）
