---
tags: [concept, shell]
updated: 2026-09-08
status: draft
---

# 概念：hook 脚本 shebang 与语法必须同方言

## 触发场景
abs 的 `hooks/event.sh` 声明 `#!/bin/sh`（可指向 dash/busybox），但用了 bash 专属子串扩展。

## ❌ 表现
`"${PAYLOAD:0:120}"` 在 macOS bash 下正常，在 Linux dash 下**静默报错**——hook 是 fire-and-forget，错误被 `2>/dev/null` 吞掉，log 永远不落，且无任何告警。

## 🛠 解法
1. 根本原因：`#!/bin/sh` 不保证 bash；POSIX sh 无 `${var:offset:len}`。
2. 关键代码：
   ```
   SHORT=$(printf '%s' "$PAYLOAD" | awk '{print substr($0, 1, 120)}')
   ```
3. 验证命令：`sh hooks/event.sh <<< '{}'`（用 sh 而非 bash 测，输出 `{}` 且 exit 0）。

## 关联连接
- [[AgentBrainSync]] — hook 层的跨平台纪律
