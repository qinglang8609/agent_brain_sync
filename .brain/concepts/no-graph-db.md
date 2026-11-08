---
tags: [concept, 图数据库, 检索, 功能删除]
layer: 4
kind: decision
author: fanchao
updated: 2026-11-08
status: active
---

# 不建图数据库：写侧在跑、读侧没人用，整套拆掉

2026-11-08 用户定：「光写不读有鸡毛用」→ 删除 SQLite 图库那套（`abs db` / `abs search`
/ `abs recall` / 相关 MCP 工具 / 写后自动重建）。本文记判据与实测数据。

## 触发场景

- 一个「顺手建的」索引/库/缓存，没人能说出它今天帮到了什么
- 讨论要不要继续投入某个检索机制之前，先量一下它被用过几次

## ❌ 表现：能力很强，调用记录是零

库本身是活的：382 节点 / 1312 边 / 257 断点词 / 跨 8 个项目，`abs note` 落盘时自动重建，
18:05 刚同步过。但它**没有出口**：`abs load` 里唯一的呈现函数 `hotPagesSection`
（`src/brain/load.js`）没有任何生产调用点 —— 只有定义和 2 条测试。

实测调用次数（`~/.abs/log/mcp.log` 2501 条 + 881 个 pi 会话文件里的 bash 命令）：

| 用途 | 次数 |
|---|---|
| 写看板 `abs_task` / `abs todo` | 1897 / 473 |
| 落经验 `abs note` / `concept` | 354 / 74 |
| `abs lint` 体检 | 373 |
| `abs load` 开机 | 275 |
| **检索合计**：`query` 61 + `resolve` 26 + `recall` 9 + **`search` 3** | **99** |

结论：**写侧是主战场，读侧（亮度检索/联想扩散）基本没人用**。
更刺眼的是 `abs search` 全套跨项目扩散能力，881 场会话里被调 3 次。

## 🛠 解法：删掉整块，而不是再加一层出口

删掉的东西：

- `src/brain/db.js`（SQLite 引擎）、`db-cmd.js`（db 命令族 + autoIndex）、`evolve.js`（进化体检）
- CLI：`abs db rebuild|status|evolve|add`、`abs search`、`abs recall`
- MCP：`abs_search`
- 写后自动重建（`autoIndex`）：`abs note` / `concept` / `capture` 里那几行
- `load.js` 的 `hotPagesSection` / `queryHint` / `cmdRecall` / `contextKeywords`
- `~/.abs/graph.db`、`~/.abs/projects.json`

**留下的**：`abs query` —— 它是**扫 .md 页**的字面 OR 检索（`src/query.js` + `relevant.js`），
不依赖库；`abs resolve`（页名反查路径）、`abs lint`、双链与 index 也都不动。

为何是删而不是「把出口接回去」：接回出口只能让 load 多 3 行，回答不了「这机制值不值」——
这一年里它一次都没进过开工首屏，说明需求不在「更聪明的检索」，在「写下来别丢」。
判据同 [[feature-delete-not-patch]]：触发频率错是设计错误，不是实现错误。

## ⚠️ 同一次拆库里暴露的两处自相矛盾（都属「入口出口不同判据」）

1. **`hotPagesSection` 无人调用**：2026-11-08 精简 load 时摘掉了唯一调用点，函数与测试留着
   —— 测试全绿，功能已死，没有任何信号。这是「删功能只删一半」的典型形态。
2. **库报「悬挂 1 条」而 `abs lint` 报 0 问题**：那条 `2026-09-12-todo归档` 来自会话页的
   `## 用户原话` 段（原样抄了用户贴的文本，里面带方括号），而 sessions/ 页豁免 DEAD-LINK
   —— 两个判据各管一头，谁都没错，合起来就是不一致。

## 验证

```bash
npm test                     # 拆完 766 全绿（原 843，删掉库相关 77 条）
npm run check                # 语法 + eslint 0 问题
abs --help | grep -cE "abs (search|recall|db) "   # 应为 0
ls ~/.abs/graph.db 2>&1      # 应报 No such file
grep -rn "node:sqlite" src bin                    # 应为空
```

## 关联连接

- [[feature-delete-not-patch]] — 同一判据：靠提醒/靠自觉的功能该删不该补
- [[入口出口同一判据]] — 两处矛盾的共同根
- [[read-side-output-must-not-scale]] — 留下的 query 仍受这条约束
- [[learning-loop-collect-distill-deliver]] — 只留下一环（采集）也要能自洽
- [[fanchao]] — 本页沉淀者
