---
title: 七层分层：层规格与判层判据
tags: [concept, 记忆, 分层, 图谱]
author: fanchao
updated: 2026-11-08
status: active
---

# 七层分层：层规格与判层判据

`.brain/` 的知识按「作用」分七层，规格落在 `src/brain/layers.js`。
**这层规格只服务两件事**：落页时把知识放到该放的位置（`abs capture --layer` / `abs note`），
以及 lint 按目录校层（`layerConflict`）。它不再驱动任何检索。
（原「图数据库 + 亮度联想」那半已于 2026-11-08 拆掉，见 [[no-graph-db]]。）

## 触发场景

- 一条经验该落 sources 还是 concepts：判错会让通用规律混进工具经验里
- 要区分「铁律」和「随口一句话」：铁律不能被当成普通条目
- 给目录定默认层、或给某一页显式标层

## 七层规格

| 层 | 名称 | 物理位置 | 衰减 |
|---|---|---|---|
| L1 | 铁律 | `index.md` 的 `## Rules` 区，不立页 | 0（永不衰减） |
| L2 | 规则 | `layer: 2` 的页 | 0.2 |
| L3 | 工具 | `layer: 3` 的页 | 0.4 |
| L4 | 认知 | 默认层（concepts/entities/syntheses） | 0.6 |
| L5 | 会话 | `sessions/` | 0.75 |
| L6 | 断点 | 双链词，不立页 | 0.85 |
| L7 | 混沌 | `sources/` | 0.95 |

**层归属判据**（`resolveLayer`）：frontmatter 的 `layer` 字段优先 → 没有就按目录推 → 都没有落到 L4。
非法值（如 `layer: 99`）**报错不静默**，同时降级到 L4 继续跑。

## 判层判据（真实要动手时看这条）

**总结必须判层，不能一律塞 sources。** 判据：讲某个具体工具怎么用/有什么坑 → L3；
讲通用设计规律、不绑具体工具 → L4。只靠 tags 关键词猜会把「资源默认值让 OS 分配」
这种通用规律误判成工具经验 —— 实测一律塞 L7 会让 44% 的知识按错误权重参与排序。

## 双链怎么解析

双链写法有三种：普通链、带别名、带小节锚点，都取方括号里的页名。三处排除：

1. 模板占位符（作者、页面名、slug 这类）—— 正文在讨论语法，不是真链接
2. 代码块与行内代码里的 —— 那是文档示例
3. `todo.md` / `log.md` 里的 —— 那里是**作者标记**，不是知识链接

## 验证

```bash
npm test                                   # 层规格相关的用例都在这里（含非法 layer 报错不静默）
abs capture --layer 3 "一句话"              # 落页后看 frontmatter 的 layer
abs lint | grep LAYER                      # 目录与层不符时报 LAYER-CONFLICT
```

## 关联连接

- [[no-graph-db]] — 为什么亮度联想/图数据库那半被拆掉（含实测调用次数）
- [[session-digest-design]] — 会话摘要落在 L5，一页多段
- [[learning-loop-collect-distill-deliver]] — 分层是「沉淀」环节的结构
- [[fanchao]] — 本页沉淀者
