---
tags: [source, 坑, 重构, 等价判断]
updated: 2026-09-12
status: draft
---

# 来源：over-engineering 审计里的"等价删除"必须先跑到那条分支: 我把 resolveProjectDir 的 if(!dir) return…

TITLE: over-engineering 审计里的"等价删除"必须先跑到那条分支: 我把 resolveProjectDir 的 if(!dir) return cwd 判为等价冗余删掉(理由: resolve(undefined) 该回退 cwd) —— 实际 resolve(undefined) 抛 ERR_INVALID_ARG_TYPE。node -e 验证时只测了 resolve('/a/b')===resolve('/a/b') 这个恒真式, 没测 undefined 分支就下结论。同一 diff 里 parseArgs 迁移也踩同类: 手写版只认 -- 长选项, parseArgs 把 -X 当成 5 个短选项把正文吃光。判据: 说"行为不变"前, 对每个分支各跑一次新旧对照; 判据不是"读起来等价"。

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- over-engineering 审计里的"等价删除"必须先跑到那条分支: 我把 resolveProjectDir 的 if(!dir) return cwd 判为等价冗余删掉(理由: resolve(undefined) 该回退 cwd) —— 实际 resolve(undefined) 抛 ERR_INVALID_ARG_TYPE。node -e 验证时只测了 resolve('/a/b')===resolve('/a/b') 这个恒真式, 没测 undefined 分支就下结论。同一 diff 里 parseArgs 迁移也踩同类: 手写版只认 -- 长选项, parseArgs 把 -X 当成 5 个短选项把正文吃光。判据: 说"行为不变"前, 对每个分支各跑一次新旧对照; 判据不是"读起来等价"。

## 关联连接
（提炼成 concepts 规律页后，在此挂双链到该页）
