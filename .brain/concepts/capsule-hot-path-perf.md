---
tags: [concept, pi-tui, performance]
id: capsule-hot-path-perf
author: fanchao
updated: 2026-11-08
status: active
---

# 概念：pi 工具胶囊热路径：别每帧碰大入参

## 触发场景
- 给 pi 写工具渲染器（`registerToolRenderer`），入参里有长度不可控的字段（`command`、`code`、整段输出、diff）。
- 转轮每 90ms 重跑一次 `renderCall`；pi 的 `updateDisplay()` 每次重绘还会重跑 `renderResult`。
- 展开大输出后体感顿，或历史里 edit/bash 多了以后变卡。

## ❌ 表现
三处都会把「一次性的活」干成「每帧的活」：

1. `firstLine` 用 `split("\n")` 取命令首行——`ctx_execute` 的 `code` 上 MB 时，
   每帧把整段切成几十万个元素的临时数组。1MB 实测 **580µs/次**，10 秒转轮白烧 64ms，
   还喂饱 GC。
2. `edit` 结束后每次重绘都 `split` 整个 diff 数 `+N -M`。250KB diff **362µs/帧**。
   历史里每个 edit 都来一遍，旁边有转轮时尤其浪费。
3. 展开态 `renderResult` 每帧 `new Capsule`——`Capsule` 里的按宽换行缓存
   （`cachedBody`）是**实例级**的，new 一个就全失效。2000 行输出 **675µs/帧**，
   2 万行 **6.9ms/帧**（60fps 预算 16.7ms，直接占 40%）。

## 🛠 解法

### 1. 首行只看前 max+1 个字符
首行超过 120 字本来就要截断，后面的内容对胶囊没有用。

```ts
function firstLine(text: string, max = 120): string {
	const raw = String(text ?? "...");
	const head = raw.slice(0, max + 1);
	const nl = head.indexOf("\n");
	const line = nl === -1 ? head : head.slice(0, nl);
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
```

### 2. 折叠的结果行早退，别碰 result
pi 折叠时结果行本来就画空。之前是算完 `describe`（edit 数 diff、bash 取首行）
再扔掉。早退之后大 diff 根本不进热路径。

### 3. diff 计数：不 split，按 `details` 缓存
pi 每帧都 new 一层 `{ content, details }` 包装，但 **`details` 是同一个引用**。
用 `WeakMap<object, counts>` 挂在 `details` 上；数行数用 `charCodeAt` +
`indexOf("\n")`，不分配行数组。

### 4. 展开 Capsule 按 `content` 数组复用
和 call 行复用 `lastComponent` 同一个思路。键用 `result.content` 数组
（引用不变），tag 里带 `toolName|长度|命令|状态`：

- 内容没变 → 返回同一个 `Capsule`，`cachedBody` 命中；
- 流式时长度变、或失败态变 → tag 变，重建；
- 折叠时从 WeakMap 里删掉，别让大输出的 body 副本一直挂着。

pi 的 bash 流式输出每次 `content: [{ type: "text", text: ... }]` 都是**新数组**，
所以流式期间天然不命中（该重建就重建），结束后数组稳定才开始命中。

## 验证
2026-11-08 实测（`node --experimental-strip-types`，同一台机器）：

| 项 | 旧 | 新 |
|---|---|---|
| firstLine 1MB code | 580 µs/次 | 完整 renderCall **4.4 µs** |
| 250KB diff 折叠 | ~362 µs/帧 | **0.1 µs** |
| 250KB diff 展开重复渲染 | 每帧 split | **2.9 µs** |
| 展开 2000 行 | 675 µs/帧 | **1.9 µs** |
| 展开 20000 行 | 6.9 ms/帧 | **17.8 µs** |

判据：
- `npm run check` 全绿（含大 code、大 diff、复用同实例、内容/失败变重建）；
- `npm run typecheck` 无错；
- 同内容两次 `capsuleResultRow(..., true)` 返回**同一个**组件实例。

首次展开该付的换行还是一次付清；流式期间展开大输出仍会每帧重建（内容真在变）。

## 关联连接
- [[tui-line-width-limit]] — 换行/截断本身要按宽缓存，本页是别把缓存冲掉
- [[pi-tool-renderer-animation]] — 转轮每帧重跑 renderCall 是这些热路径的源头
- [[tui-spinner-glyph-compat]] — fullscreen 卡顿先压测组件；本页是压测之后该看的实现
- [[installed-pi-package-check]] — 量数字别猜
- [[fanchao]] — 本页沉淀者
