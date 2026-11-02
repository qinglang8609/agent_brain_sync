---
title: 缩进子项同时满足两个判据，凡按行判断处都要先排子项
tags: [concept, 坑, todo, 解析]
author: fanchao
updated: 2026-11-01
status: active
layer: 4
kind: gotcha
---

# 缩进子项同时满足两个判据

todo 用标准 Markdown 嵌套列表（2 空格缩进 + `- [ ]`）后，子项行的形态**同时满足**「任务行」与「子项」两个判据。凡按行形态判断的地方，都要先排掉子项。

## 触发场景

改动 todo 的行解析逻辑，或新增任何「按行匹配」的校验、统计、归位、归档逻辑。

## ❌ 表现

同一类 bug 在四个地方各犯一次（2026-10-16 实测）：

| 位置 | 后果 |
|---|---|
| 校验闸门 | 任务行分支先 `continue`，缩进子项只受 `TASK_LINE_MAX`(400) 管，`BREAKPOINT_MAX`(200) 闸门走不到 → 300 字子项静默写入 |
| done 归位 | 只认 `↳ ` 前缀收集附属行，换格式后子项残留原区 |
| 归档 count | 正则 `/^\s*- \[x\]/` 把子项也算成任务，计数虚高 |
| `parseDoneUnits` | `isTaskLine` 先命中，子项被当独立条目 |

## 🛠 解法

**判据顺序固定：先判子项（有缩进），再判任务（行首 `- [ ]`）。** 不要靠「哪个正则先匹配」。

```js
// 错：任务行判据先命中，子项漏掉
if (isTaskLine(l)) return handleTask(l);
if (isChildLine(l)) return handleChild(l);

// 对：子项先排掉
if (isChildLine(l)) return handleChild(l);
if (isTaskLine(l)) return handleTask(l);
```

## 验证

跑 `npm test`，确认 todo 相关的闸门测试与归档测试全绿；刻意把顺序改回「任务先行」，应当有测试变红——若不红说明缺覆盖。

## 关联连接

- [[todo-rewrite-not-map]] — 同类：todo 结构操作的另一个必须先想清楚的约束
- [[naming-contract-and-judge-precision]] — 判据精度：看结构不看关键词
