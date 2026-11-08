---
title: 中文全文检索必须自切 2-gram
tags: [concept, sqlite, fts, 中文]
author: fanchao
updated: 2026-11-01
status: superseded
layer: 3
superseded-by: no-graph-db
---

# 中文全文检索必须自切 2-gram

SQLite FTS5 内置分词器对中文都不可用；必须自己切 2-gram 存进索引列。

## ❌ 表现

搜索「静默」返回 0 条，但页里明明有这个词。搜索「静默失效」却正常。

## 根因（2026-11-01 实测三种分词器）

| 分词器 | 「静默」 | 「静默失效」 | 原因 |
|---|---|---|---|
| `trigram` | **0 命中** | 3 命中 | 要求查询 ≥3 字符 |
| `unicode61` | **0 命中** | 1 命中 | 整句当一个 token |
| 自切 2-gram | 1 命中 | 1 命中 | 正确 |

中文没有词边界，FTS5 的默认分词假设「空格分词」或「3 字符滑窗」，
两字词（中文最常见的查询粒度）恰好被两边都漏掉。

## 🛠 解法

```js
// 存储侧与查询侧必须用同一个函数，否则静默失配
export function bigrams(s) {
  const out = [];
  for (const m of s.matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
    const seg = m[0];
    for (let i = 0; i + 2 <= seg.length; i++) out.push(seg.slice(i, i + 2));
  }
  for (const m of s.matchAll(/[\u4e00-\u9fa5]/g)) out.push(m[0]); // 单字词
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9_-]{1,}/g)) out.push(m[0].toLowerCase());
  return [...new Set(out)];
}
```

建表时把切好的 gram 存进独立列，FTS 索引那一列：

```sql
CREATE TABLE nodes_bigram (id INTEGER PRIMARY KEY, g TEXT NOT NULL DEFAULT '');
CREATE VIRTUAL TABLE fts USING fts5(g, content='nodes_bigram', content_rowid='id', tokenize='unicode61');
```

查询时同样切：`WHERE fts MATCH '"静默" OR "默失" OR ...'`。

**验证**：`node --test test/brain-graph.test.js` 里
「搜索：两字中文词能命中（trigram 方案在这里会失败）」钉住这一条。

## 关联连接

- [[memory-box-seven-layers]] — 这套索引服务的是哪套检索机制
- [[sqlite-vs-graph-db]] — 选 SQLite 时的其他考虑
- [[search-relevance-pitfalls]] — 检索层再往上的四个坑：误命中、归一化、高频虚词、状态过滤
