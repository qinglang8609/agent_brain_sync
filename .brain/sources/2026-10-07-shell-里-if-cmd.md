---
tags: [source, shell, gate, exit-code]
id: 2026-10-07-shell-里-if-cmd
author: fanchao
updated: 2026-10-07
status: draft
---

# 来源：shell 里 `if ! cmd | tail` 取的是 tail 的退出码（永远 0），门禁恒放行且照样打「✓ 通过」——静默失效…

TITLE: shell 里 `if ! cmd | tail` 取的是 tail 的退出码（永远 0），门禁恒放行且照样打「✓ 通过」——静默失效。修法：输出落临时文件（mktemp + trap 清理）再截尾，退出码走 cmd 本身；sh 无 PIPESTATUS。判据：凡是靠退出码的门禁，都要有一个测试直接跑该脚本、用假依赖模拟失败，断言退出码为 1；只断言输出文字会被措辞改动带偏。

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- shell 里 `if ! cmd | tail` 取的是 tail 的退出码（永远 0），门禁恒放行且照样打「✓ 通过」——静默失效。修法：输出落临时文件（mktemp + trap 清理）再截尾，退出码走 cmd 本身；sh 无 PIPESTATUS。判据：凡是靠退出码的门禁，都要有一个测试直接跑该脚本、用假依赖模拟失败，断言退出码为 1；只断言输出文字会被措辞改动带偏。

## 关联连接
- [[fanchao]] — 本页沉淀者
（提炼成 concepts 规律页后，在此挂双链到该页）
