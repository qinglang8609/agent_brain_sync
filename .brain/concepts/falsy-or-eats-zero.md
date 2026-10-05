---
tags: [concept, javascript, 坑, 静默失效, 参数校验]
updated: 2026-10-05
status: active
---

# `x || 默认值` 吃掉合法零值：JS falsy 陷阱

## 触发场景
给参数兜默认值时写 `Number(v) || 3` / `opts.n || 10` / `name || 'anon'`。

## ❌ 表现
**传 0（或空串、false）时被当成"没传值"，静默落到默认值。** 用户以为自己的参数生效了。

实测（2026-10-05，`abs todo archive --keep-days 0`）：

```js
const days = Math.max(1, Number(keepDays) || 3);
//                              0 是 falsy ──┘
// --keep-days 0 → 实际保留 3 天，且输出理直气壮说"保留近 3 天"
```

用户期望"归档全部"，实际**一条没动**，而界面上没有任何异常 —— 属于
[[host-plugin-silent-failure]] 同族的静默失效。

## 🛠 根因
`||` 判的是 **falsy**（`0` / `''` / `false` / `NaN` / `null` / `undefined`），
不是 **nullish**（只有 `null` / `undefined`）。当 `0`、`''`、`false` 是**合法入参**时，
`||` 就把它误判成"没传"。

## ✅ 三种修法（按场合选）

```js
// ① 只想兜 null/undefined —— 用 ??（最常用）
const n = Number(v) ?? 3;          // 但 Number(undefined)=NaN，需配合校验

// ② 有合法下限/边界 —— 显式校验 + 明确报错（本项采用）
const raw = Number(keepDays);
if (!Number.isFinite(raw) || raw < 1 || !Number.isInteger(raw)) {
  return `✗ --keep-days 需为 ≥1 的整数（收到 "${keepDays}"）\n  下限 1 天是为了…`;
}

// ③ 用默认参数（仅在参数缺省时生效，不碰显式传的 0）
function f(n = 3) { ... }          // f(0) → 0 ✓  f(undefined) → 3 ✓
```

## 更根本的一层：不要"静默改写"用户的意图

`Math.max(1, ...)` 那种**夹紧**也是一样的毛病 —— 即使修好 falsy，用户传 0 得到 1，
他仍然不知道。**宁可报错让他改参数，也别悄悄替他决定。**

> **通则：参数的"缺失"与"非法"要分开处理。**
> 缺失 → 用默认值；非法 → 明确报错。
> 用 `||` 一把抓，就是把"非法"静默降级成"缺失"。

这与项目 Rule「结论要明确：给结论+依据+下一步」同源 —— 工具也不该含糊。

## 验证
```bash
# 非法值全部明确报错（不回落到默认）
node bin/abs.js todo archive --keep-days 0     # → ✗ 需为 ≥1 的整数
node bin/abs.js todo archive --keep-days -1    # → ✗
node bin/abs.js todo archive --keep-days abc   # → ✗
node bin/abs.js todo archive --keep-days 2.5   # → ✗
node bin/abs.js todo archive --keep-days 5     # → 保留近 5 天（文案跟随参数）
node bin/abs.js todo archive                   # → 保留近 3 天（默认）
```
回归：`node --test test/cli.test.js`（含上述 3 例）。

## 关联连接
- [[host-plugin-silent-failure]] — 同族静默失效（装上了≠加载了≠触发了）
- [[guard-blocks-noninteractive-callers]] — 守卫/校验要顾及各种调用方
- [[read-side-output-must-not-scale]] — 输出文案要与真实行为一致（本例文案曾撒谎）
