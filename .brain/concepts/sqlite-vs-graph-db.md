---
title: 图查询选 SQLite 而不是 Neo4j 的判据
tags: [concept, sqlite, 选型, 图数据库]
author: fanchao
updated: 2026-11-01
status: active
layer: 3
---

# 图查询选 SQLite 而不是 Neo4j 的判据

需要「图的能力」不等于需要「图数据库产品」。判据是规模与调用频率。

## 判据

| 条件 | 选 SQLite | 选 Neo4j / FalkorDB |
|---|---|---|
| 节点规模 | 万级 | 千万级 |
| 调用频率 | 会话级（开工查一次） | 业务级（每秒多次） |
| 能否常驻进程 | 最好不要 | 可以 |
| 依赖偏好 | 零外部依赖 | 接受 Docker |

## 实测数据（2026-11-01，本机 node:sqlite 3.53.1）

2 万节点 / 20 万边：

| 操作 | 耗时 |
|---|---|
| 3 跳递归扩散查询 | 0.5ms |
| FTS5 全文搜索 | 0.01ms |
| 写热度更新 | 0.29ms |
| 库文件体积 | 10MB |

SQLite 早已超额满足「高频搜索」。0.01ms 意味着每秒十万次。

## 反例：什么时候该上真图库

- 需要 Cypher 那种声明式路径查询（`MATCH (a)-[*1..5]->(b)` 带复杂过滤）
- 图规模到千万节点，递归 CTE 开始吃力
- 需要多写者并发（SQLite 单写者）
- 需要图算法库（PageRank、社区发现）开箱即用

**本场景都不满足**：`.brain/` 是百页级、单用户、开工时查一次。

## 坑：环境依赖

2026-11-01 实测本机 Docker daemon 未启动（OrbStack 未运行），
Neo4j 根本跑不起来。而 abs 的 hook 要随时可调 —— 依赖常驻服务的方案在
「用户关掉 Docker」时会静默失效。

## 关联连接

- [[memory-box-seven-layers]] — 这套选型服务的是哪个机制
- [[chinese-fts-two-gram]] — 选 SQLite 后遇到的第一个真问题
