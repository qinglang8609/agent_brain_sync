---
tags: [concept, concurrency, arch]
updated: 2026-09-08
---

# Markdown 并发写保护 (file-write-locking)

## 一句话
abs 所有 `.md` 都是「读-改-整文件覆盖写回」；跨进程（CLI/MCP/hook）并发会让后写者覆盖别人新行 → 用共享 `editFile` 锁（open wx 原子锁 + SKIP 哨兵 + 残留锁摘除 + 短重试）把读改写串行化，锁内 readFile→mutator→writeFile。

## 核心结论：并发安全 ≠ 全加锁
先按风险分类，判断基准是「会不会丢更新」而非「有没有写」：

| 类别 | 处理 |
|---|---|
| ① 读改写（读旧覆盖新行）| **需锁** — `.brain` todo/index/log 全部走 `editFile` |
| ② append 日志短行（≤200 字符）| 天然安全 — O_APPEND 单 write 原子，实测多进程 0 撕裂 |
| ③ 新文件 tmp+rename 原子写 | 天然安全 — 读方只见 old 或 new，绝无半写 |
| ④ 单用户离散动作（install）| 不必锁 |
| ⑤ requireBrain 门控 | init/repair 只建缺失文件，无并发读者 |

## 实现要点 (src/lock.js)
- `editFile(file, mutator)`：锁内 `readFile → mutator(cur) → 若非空非同 writeFile`
- mutator 返回 `{ text, ...meta }`（写盘+透传 meta）或 `SKIP`（不写）
- 锁文件 `.<basename>.lock` 用 `fs.open('wx')` 原子抢占；`EEXIST` 则指数退避重试(15ms 起, 上限 150ms)
- 抢锁排队预算 **30s**(曾为 3s): 高并发 15-30 进程抢一文件时, 后到进程排队中途若累积超预算会抛 LockTimeout 崩溃丢写入; 预算须容纳排队者依次排完("等锁不饿死")
- 残留锁(超 60s, 须 > 排队预算)视为崩溃遗留，摘除重试；排队超预算抛 `LockTimeout`
- 必须关掉 open 的 fd，否则 Node GC 告警 "Closing file descriptor N"

## 改造接入点
`todo.js`: addTask / upsertTask / setBreakpoint / moveBlocked / ensureTodo(建模板也走锁防半写) / readTodo(惰性迁移)
`store.js`: cmdLog(log.md) / markDone(todo.md) / cmdNote 的 index Sources 登记 + source 页 tmp+rename

## 验证
`test/lock.test.js` 5 例：20 并发 task 全保留、15 并发 log 全落、幂等不重复、cmdNote 并发各成文件、无锁残留。全套 102 测试通过。

## 相关
- [[2026-09-08-abs-markdown并发写冲突-所有读-改]]
- [[2026-09-08-并发写安全审计心法-别对-所有写入-一律加锁]]
- [[todo-rewrite-not-map]]
