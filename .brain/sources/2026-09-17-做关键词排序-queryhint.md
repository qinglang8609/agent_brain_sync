---
tags: [source, 坑, 检索]
id: 2026-09-17-做关键词排序-queryhint
author: tester
updated: 2026-09-17
status: draft
---

# 来源：queryHint 关键词排序的实测事实（前版含错误论证，已改）

TITLE: queryHint 关键词排序的三条实测事实：大写词被剥离、df 阈值在被测区间不起作用、高频词滤掉后 top3 仍是噪音。修复方向未定。

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）

**本页 2026-09-17 曾写「cli(df=13) vs load(df=11) 频率不可分 → 调参无解 → 下次别重试」。
该论证的对象不存在，已作废。** 错因：把 `query`/`rankPage` 路径的 `cli` 现象，
套到了 `queryHint` 路径上。两条路的取词不同。

### 实测事实（均在 `.brain/concepts/` 30 页语料上跑出）

1. **`CLI` 进不了 hint 词表。**
   `src/store.js` 的 `queryHint` 在抽词前执行 `.replace(/\b[A-Z][A-Z0-9_-]{2,}\b/g, ' ')`，
   把全大写 token 当任务 ID 剥掉。实测：
   ```
   keywords("CLI 结语路径与 help 不一致")
   → ['help','store','结语','语路','路径','径与','不一','一致']   ← 无 cli
   ```
   故 df 重叠那套说法不适用于 `queryHint`。`cli` df=13 是 `query`/`rankPage` 侧的观测。

2. **df 阈值在 T=11~15 区间无区分作用。**
   对同一场景扫 T=15/13/12/11，top3 结果**逐字相同**。该场景中唯一超阈的词是
   `路径=18`，其余词 df 全 ≤11，故阈值在这个区间不改变任何输出。

3. **滤掉高频词后，top3 仍是噪音。**
   `T=11` 已滤掉 `路径`(df=18)，但 top3 仍是
   `audit-claims-verify-before-fix(7) / mcp-stale-paths-multi-store(6) / abs-install-layout(2)`，
   得分来自 `结语/不一/一致` 等低频词拼接。**低频词凑出来的分同样不可信。**

### 未定

修复方向**未定**，不写「解法」也不写「别重试」。已知的是上述三条否证；
「这个词是不是该页主题」的判据仍未找到。

### 过程教训（比结论更值钱）

本轮同一病根连犯三次：2-gram 归因、df 方向归因、cli 论证 —— 全部是
**没跑就下结论**，且每次都言之凿凿。其中 2-gram 那条连 `keywords("日志")` 都没跑过。

实测于 2026-09-17，图谱 30 页。

## 关联连接
- [[tester]] — 本页沉淀者与第一版错误结论的作者
- [[self-authored-evidence]] — 本次三次错误同源：自造推理当证据，未跑即下结论
（提炼成 concepts 规律页后，在此挂双链到该页）
