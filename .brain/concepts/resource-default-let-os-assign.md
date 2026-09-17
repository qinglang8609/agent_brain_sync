---
tags: [concept, 坑, 默认值, cli]
id: resource-default-let-os-assign
author: fanchao
updated: 2026-09-16
status: active
---

# 稀缺全局资源的默认值：让 OS 分配，不写死

## 触发场景
给 CLI/服务端工具定**端口、临时文件名、锁路径、共享目录**这类「多进程要同时用、但每个实例要独占一份」的资源的默认值时。

## ❌ 表现
> **案例来源已删（2026-09-17）**：本文提到的 `abs serve`、`src/serve.js`、`bin/abs.js` 里的
> 端口默认值均已随该命令删除 —— 现在 `grep` 不到这些符号。**规律本身仍有效**，
> 引用时请把它当历史案例，别去找那些文件。

`abs serve` 默认端口写死 7777（bin/abs.js、src/serve.js 两处默认值）。用户实测：
**第一个项目开 7777，第二个项目直接 `EADDRINUSE` 起不来** —— 工具的基本用法（多项目并用）被默认值砍掉。

## 🛠 解法
默认值用 **0（或等价的「让系统分配」原语）**，不是「固定端口 + 冲突重试下一个」：

```js
const port = opts.port ? Number(opts.port) : 0;   // 0 = OS 挑空闲端口
```

配套前提：**实现层必须把真实值回传给调用方**。`serve()` 本来就返回
`server.address().port`（真实端口），调用方用 `url` 而非 `port` 变量 →
打印、自动开浏览器全部自动正确，调用链一行不用改。

- 端口 → `listen(0)`；临时文件 → `mkdtemp`/`tmpfile`；锁文件 → `pid + 随机`。
- 为什么不「重试下一个端口」：那是把无冲突问题当成冲突问题来治，多一段代码、多一种竞态；OS 分配天然无冲突。
- 想固定的用户仍可显式传：`--port 7777`（原例为 `abs serve --port 7777`，该命令已删）。

## 验证
> 复现手法（与已删的 `serve()` 无关，可照做）：起两个监听 `port: 0` 的 server，
> 读回 `server.address().port`，确认两值不同且同时存活。

原实测（2026-09-16，`abs serve` 尚存时）：同进程连起两个 `serve()`：`57353` / `57354`，
端口不同、同时活着；`npm test` 385 全绿。

## 关联连接
- [[self-authored-evidence]] — 无关；本页是默认值选型，不是排查方法
- [[perf-fixed-overhead]] — CLI 路径起进程有固定开销（选择 0 不影响它）
- [[fanchao]] — 本页沉淀者
