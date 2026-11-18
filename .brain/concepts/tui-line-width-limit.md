---
tags: [concept]
id: tui-line-width-limit
author: fanchao
updated: 2026-11-08
status: active
---

# 概念：pi TUI 渲染行超宽会抛异常

## 触发场景
在 pi 里自定义渲染工具调用 / 消息行，且内容长度由外部输入决定时（命令原文、文件路径、搜索结果）。
凡是「长度不可控」的渲染行都要想起这条。

## ❌ 表现
渲染行宽度超过终端宽度时 pi 的 TUI **直接抛异常**（不是自动折行、也不是静默裁剪）。
`crashes.json` 里就有这种记录。

## 🛠 解法
**根因**：pi 的 TUI 不接受渲染行超过终端宽度，它指望组件保证这一点。

**修复**：组件自己截断，别指望外层折行。

```ts
const head = truncateToWidth(this.head, Math.max(1, width - 1), "…");
```

要点：
- 用 `truncateToWidth`（来自 `@earendil-works/pi-tui`），它按**可见宽度**算，ANSI 转义码不占宽。
- 留 1 列余量（`width - 1`）。
- 终端可能窄到荒谬（1/2/5 列），边界要能扛住。
- 渲染结果有缓存时，**缓存 key 必须含宽度**，否则换宽度不重画。

## 验证
按多个宽度渲染，断言没有一行可见宽度超过该宽度：

```bash
node --experimental-strip-types check.ts   # 27 项：宽度/折行/缓存
```

判据：`visibleWidth(line) <= width` 对 1/2/5/20/40/80/120/300 全部成立；
折叠态恒为一行；换宽度后确实重画（缓存没串）。

## 截断会打掉背景色
`truncateToWidth` 在被截断时，会在省略号前插一个**完整 SGR 重置** `\x1b[0m`
（见 pi-tui `utils.js` 的 `finalizeTruncatedResult`）。这个重置连父级 `Box` 给的背景一起清掉，
于是 `…` 之后整段变成终端本色，绿底断成两截。

修法：截断后把行背景重新贴回每个重置后面。

```ts
line.split("\x1b[0m").join(`\x1b[0m${theme.getBgAnsi("toolSuccessBg")}`);
```

只有命令长到要截断时才看得见，宽终端下完全正常——所以它很容易漏掉。

## 崩溃日志取证：逐行看 `w=`，别按 cwd 猜

`pi-tui-crash.log` 每行带渲染宽度。2026-10-14 体检时，越宽的那行是 abs 的 todo 状态栏
（`📋 todo (1) — fanchao`，36 列 > 35 列终端），不是 capsule-tools（它的行全是 w=35）。
按崩溃发生的项目目录猜凶手，就会冤枉好人。

取证办法：**逐行看 `w=` 值**，谁超过终端宽度谁就是嫌疑，再看那一行内容是谁画的。
细节见 [[installed-pi-package-check]]。

## 关联连接
- [[pi-call-result-double-row]] — 展开态同样受宽度约束
- [[pi-tool-renderer-animation]] — 每一帧转轮也受行宽约束，且同样要保住底色
- [[tui-spinner-glyph-compat]] — 回退字体把转轮字符挤宽，撞的是同一类宽度问题
- [[installed-pi-package-check]] — 崩溃日志 `w=` 取证的具体做法
- [[capsule-hot-path-perf]] — 截断/换行别每帧重算大入参
- [[fanchao]] — 本页沉淀者
