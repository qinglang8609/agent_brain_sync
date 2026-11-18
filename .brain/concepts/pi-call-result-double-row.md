---
tags: [concept]
id: pi-call-result-double-row
author: fanchao
updated: 2026-10-09
status: active
---

# 概念：renderCall 和 renderResult 各画一次 = 每行重复

## 触发场景
给 pi 的工具写自定义渲染时，习惯性地在 `renderCall` 和 `renderResult` 里都画同一个头部（因为「两边都要显示工具名」）。

## ❌ 表现
**每次工具调用在画面上出现两行**。因为 `renderCall` 画了一次头部，`renderResult` 又把同一个头部画了一次，
而 pi 把 call 行和 result 行**分开显示**，于是就是两行。

## 🛠 解法
**根因**：call 行和 result 行是两条独立的渲染行，不是「同一行的两个阶段」。

**修复**：折叠（未展开）时 **result 行返回空**，头部只由 `renderCall` 画一次。

```ts
if (!expanded) return new Text("", 0, 0);
```

展开时再画带 `▾` 的头部 + 输出体。
**注意别丢信息**：reason（如 `exit 1`）这类内容在折叠态不显示，要在**展开态的体里**补回来，
否则就变成「为了去重把信息也丢了」。

## 验证
断言折叠态下「所有非空行」恰好只有一行：

```bash
node --experimental-strip-types rows-check.ts   # 30 项：双行 bug + 工具名头
```

判据：
- call 行恰好 1 行；折叠 result 行**空**（`trim() === ""`）；
- 两者拼起来可见行数 === 1；
- 展开后输出回来、且不超宽；`exit 1` 在展开态出现、在折叠态不出现。

## 关联连接
- [[pi-tool-renderer-override]] — 先接管渲染，才有「谁画哪一行」的问题
- [[tui-line-width-limit]] — 展开态同样受宽度限制
- [[fanchao]] — 本页沉淀者
