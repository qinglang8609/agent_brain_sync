---
tags: [concept, 图谱纪律]
author: fanchao
updated: 2026-09-12
status: active
---

# index 行不承载"谁写的"

## 触发场景
想在图谱入口（`index.md`）一眼看出**每条经验是谁沉淀的** —— 直觉做法是往 index 行里塞作者名：
`- <双链> — fanchao — 一句话`。

## ❌表现
作者名会**从"创建者"静默漂成"最后改的人"**：index 行是**覆盖式更新**的
（`registerInIndex` 判「index 里是否已含该双链」，已存在即跳过；但重组/重写时会带上当前写者）。
于是同一个 slug 的作者随每次改动而变，语义不固定 —— 读者以为在问"谁原创"，实际拿到"谁最近碰过"。

## 🛠解法（根因 + 修复 + 验证命令）
**根因**：index 行是**指针**，不是记录。指针只该回答"页面在哪"，不该承载会随时间变化的事实。
**修复**：
- index 行**只留** `<双链> — 一句话`，永不写作者。
- 作者写在**页自身的 frontmatter**（`author:`）—— 那是唯一权威来源，不随他人改动而漂。
- 要展示"谁写的"就**改读取侧**：`abs query` 输出已带每页 frontmatter 的 `author`。
- 历史条目不回填：旧格式（裸 `@name`）只在原位更新时按原形态保留，不批量改写。

**判据 / 验证**：
```bash
abs query <词>        # 每页显示 @<author>（读自该页 frontmatter）
abs lint              # 0 problem；index 行不含作者名
```

## 推广：什么该放 index，什么不该
| 该放 index | 不该放 index |
|---|---|
| 稳定的定位信息（slug、一句话描述、分区归属） | 会变的归因（作者、修改时间、状态、计数） |
| —— | 任何"最后改的人/时间"，除非接受它=最近改者 |

同源纪律见 [[summary-truncation-hidden-cause]]（写入侧收口，别在下游救）
和 [[symbol-reference-needs-real-run]]（判"等价"必须真跑）。

## 关联连接
- [[todo-rewrite-not-map]] — 同类：覆盖式/整文件重写的结构，别指望行内累积语义
- [[fanchao]] — 本规律的来源（提出"index 要不要标姓名"，评估后决定不塞）
