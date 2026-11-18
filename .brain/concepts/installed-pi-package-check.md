---
tags: [concept, pi-extension, npm, node]
id: installed-pi-package-check
author: fanchao
updated: 2026-11-08
status: active
---

# 概念：已装 pi 扩展的体检方法与 node 24 调试限制

## 触发场景
- 怀疑 pi 里跑的装版和仓库源码不一致（改了没生效、行为对不上、出现两层胶囊）。
- 想直接 import 已装版的 `.ts` 做体检或单测。
- `pi-tui-crash.log` / `crashes.json` 里记了「行超宽」崩溃，要归因是哪个组件画的行。

## ❌ 表现
**node 24 直接跑装版 `.ts` 会报错**：

```
ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
```

node 24 不允许对 `node_modules` 里的 `.ts` 剥类型。装版装在
`~/.pi/agent/npm/node_modules/pi-capsule-tools/` 下，从那里 import 就撞这堵墙。

**崩溃归因容易猜错**：崩溃日志在哪个项目目录下产生，人就容易怪那个项目的扩展。
2026-10-14 体检时，`pi-tui-crash.log` 里越宽的那行其实是 abs 的 todo 状态栏
（`📋 todo (1) — fanchao`，36 列 > 35 列终端），不是 capsule-tools
（它的行全是 w=35）。按 cwd 猜就会冤枉好人。

## 🛠 解法

### 1. 先对身份：装版和源码是否字节一致

```bash
md5 capsule-tools.ts ~/.pi/agent/npm/node_modules/pi-capsule-tools/capsule-tools.ts
```

两边 md5 一致，才谈得上「装的就是我改的这份」。不一致先 `pi list` 看装了几份、
装的哪个来源，多余的那份 `pi remove` 掉（两份一起加载会渲染两层胶囊，
见 [[pi-tool-renderer-animation]] 和 [[publish-pi-package-to-npm]]）。

### 2. 调试要在项目目录里 import 项目源码

node 24 的类型剥离只对项目内的 `.ts` 放行。所以体检脚本放在项目里、
import 项目源码，依赖解析借项目 `devDependencies` 的 `pi-tui`（当时 1.2.0）：

```bash
cd /path/to/pi-capsule-tools
node --experimental-strip-types check.ts
```

不要去 import `~/.pi/agent/npm/node_modules/` 下的 `.ts`。

### 3. 崩溃日志逐行看 `w=`，别按 cwd 猜

`pi-tui-crash.log` 每行带渲染宽度。定位真凶的办法是**逐行看 `w=` 值**：
谁超过终端宽度谁就是嫌疑，再看那一行的内容是谁画的。
cwd 只说明崩溃发生在哪个会话里，不说明是那个会话的扩展画的行。

## 验证
```bash
md5 capsule-tools.ts ~/.pi/agent/npm/node_modules/pi-capsule-tools/capsule-tools.ts
# 两段 md5 相同 → 装版与源码一致

pi list
# 只有一份 capsule-tools，没有重复来源

node --experimental-strip-types check.ts
# 项目内能跑通；换到 node_modules 路径则复现 ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
```

崩溃归因判据：日志里超宽那行的 `w=` 值 > 终端列数，且该行内容能对上某个组件；
其它组件的行 `w=` 都在限内，才能洗清。

## 关联连接
- [[publish-pi-package-to-npm]] — 发布与安装方式；装版体检是发布后的下一站
- [[pi-tool-renderer-animation]] — 两份扩展同时加载 = 两层胶囊
- [[tui-line-width-limit]] — 行超宽崩溃的根因页；本页的 `w=` 归因是它的取证方法
- [[tui-spinner-glyph-compat]] — 同一轮体检/排查里另一个「别猜，要测」的例子
- [[fanchao]] — 本页沉淀者
