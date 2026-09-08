---
tags: [source, true]
updated: 2026-09-08
status: draft
---

# 来源：hook 调 .js 文件必须经 node 调起(bin 无 exec 位), 

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- hook 调 .js 文件必须经 node 调起(bin 无 exec 位), 且 fire-and-forget 的静默失败要留 /tmp 错误痕 hook,坑

## 关联连接
- [[hook-sh-not-bash]] — 同属 hook 方言/调用坑，提炼时合并或互链
