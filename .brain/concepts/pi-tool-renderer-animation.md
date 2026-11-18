---
tags: [concept]
id: pi-tool-renderer-animation
author: fanchao
updated: 2026-10-10
status: active
---

# 概念：给 pi 工具渲染器加动效（转轮 / 失败变色）

## 触发场景
想给工具调用行加「运行中转起来、失败变红」这类**随时间变化**的渲染。

## 第零个坑（最坑、最该先查）：先确认扩展真的被加载了
这轮「没效果」绕了好几轮，**根因不在动效代码，而在扩展根本没加载**：

- `~/.pi/agent/extensions/` 里没有 capsule-tools.ts，pi 启动时自然没这东西。
- 手打 `pi -e ./capsule-tools.ts` 只是单次显式加载，不写进 settings，下次启动就没了。
- **`cp` 到 extensions/ 是错的**（本仓库 README 自己的警告）：那份副本没有包身份，去不掉，
  会和正规安装的那份同时加载 → 每个工具调用出现**两层胶囊**。

正确做法（本仓库 README 也是这么写的）：

```bash
pi install ./          # 本地路径，写进 settings.json，改完直接生效
pi list                # 确认只有一份！两份会渲染两层胶囊
pi remove npm:xxx      # 多余的删掉
```

**教训**：写「渲染器不生效」类调试时，**第一步就查「进程真的加载这个文件了吗」**。
渲染逻辑测得再全（我这轮 106 项全绿）也证明不了它被调用。

## 最大的坑：`renderCall` 每次重绘都重跑，返回新组件 = 定时器滚雪球

pi 的 `ToolExecutionComponent.updateDisplay()`（每次 `invalidate()` 都跑）逻辑是：

```js
let component = callRenderer(this.args, theme, this.getRenderContext(this.callRendererComponent));
this.callRendererComponent = component;              // ← 整个替换掉
renderContainer.addChild(this.createResultRegion(component));
```

`getRenderContext` 里的 `invalidate` 是 `() => { this.invalidate(); this.ui.requestRender() }`。

于是如果在 `renderCall` 里**每次 new 一个带动定时器的组件**：

1. 定时器 tick → 调 `invalidate()` →
2. `updateDisplay()` → 又跑一次 `renderCall` → **又 new 一个定时器** →
3. 新的又 tick……

**实测：300ms 时 8 个定时器，600ms 时 64 个，还在涨，且一个都没被 clear。**
旧的组件连着它的定时器一起被丢弃，没人停。

用户看到的现象就是「**没效果**」：几十个定时器互相抢着替换那一行，
谁也刷不出稳定的一帧（实测 32 次重绘只有 1 种不同画面）。

**解法**：复用 pi 递回来的组件，跟 pi 自己内置渲染器一样：

```ts
renderCall(args, theme, ctx) {
  const previous = ctx?.lastComponent;
  if (previous instanceof RunningCapsule) {
    previous.update(makeLine, ctx);   // 只换行内容和重绘钩子，定时器不重建
    return previous;
  }
  return new RunningCapsule(makeLine, () => ctx?.invalidate?.());
}
```

修完后：全程**恒定 1 个定时器**，帧帧不同。

> `context.lastComponent ?? new Text(...)` 这个写法 pi 内置渲染器都在用，不是巧合。

## 第二个坑：停表要靠 `ctx.state`，不能靠 `lastComponent`
`lastComponent` 是**按行分开**的：`renderCall` 里是上一次的 call 组件，
`renderResult` 里是上一次的 result 组件。两行各一份。

所以「在 renderResult 里用 `ctx.lastComponent` 停掉 call 行的转轮」**永远停不掉**。
用 `ctx.state`（pi 里 `rendererState`，call/result 共享）：

```ts
if (ctx?.state) ctx.state.capsule = row;          // renderCall 里存
settleRunningRow(ctx?.state?.capsule, {...});     // renderResult 里停
```

## 第三个坑：HTML 导出跑同一套渲染器
导出会真的调 `renderCall`/`renderResult`，传的 `invalidate` 是**真函数**（`() => {}`）。
所以「看有没有 invalidate 判断是不是实时会话」不成立。靠 `isPartial`：
导出永远传 `false`，实时会话运行中才是 `true`。`!isPartial` 就该停表。

## 第四个坑：停表后别把转轮冻在半路
`stop()` 里保留当前帧的 `⠹` 看着像「还在想」，要把箭头 `▸` 换回来，失败则红色箭头。

另外，盲文点阵字符本身在 Herdr 等终端会掉进回退字体、宽度超一格、整行抖动，
后来换成了 `◐◓◑◒`。见 [[tui-spinner-glyph-compat]]。

## 怎么验证（普通单测拦不住）
除了下面这些，还有一条**最隐蔽的测试教训**：

**别在手写测试里重新实现一遍颜色逻辑。** 我写「失败变红」那组断言时，在测试里自己拼了个
`makeLine`（`theme.fg(tone === "error" ? "error" : "accent", frame)`）——这测的是
**测试自己写的假渲染函数**，不是产品代码。结果真实产品把转轮画成了青色，
测试全绿，直到用户看到屏幕才报上来。

**判据**：断言要跑**真实解析器**拿到的组件。产品渲染的颜色，必须从产品代码流出来：

```ts
const renderers = resolver("bash", () => undefined);   // 真实解析器
const row = renderers.renderCall(args, recordingTheme(), ctx);
row.render(80);
// 现在 theme 收到的 token 才是产品真实选的颜色
```

> 反向验证：把产品改回 `accent`，断言必须 FAIL（实测确实 FAIL，报 `tokens: ["accent"]`）。

以上都是「组件/定时器没被正确收尾」类问题，测渲染函数本身测不出来。要**按 pi 的调用链跑**：

```ts
// 关键：invalidate 必须真的回到 renderCall，才能复现雪球
const ctx = { invalidate: () => redraw(), lastComponent: undefined, state, ... };
function redraw() {
  const c = renderers.renderCall(args, theme, ctx);
  ctx.lastComponent = c;      // pi 会把上一个组件递回来
  c.render(80);
}
```

断言：**只创建 1 个定时器**（包 `globalThis.setInterval` 计数）、帧帧不同。

> 反向验证过：把复用分支关掉，这条会 FAIL（`created 32` + `1 distinct frames of 32`），
> 正好是用户看到的「没效果」的量化版。

## 关联连接
- [[pi-tool-renderer-override]] — 动效的前置：先得真的接管渲染器
- [[pi-call-result-double-row]] — 同一类坑的祖宗：call/result 是两行，别假设它们共享；本页的「两层胶囊」是它的翻版
- [[publish-pi-package-to-npm]] — 安装方式的权威依据（pi install，别 cp）
- [[test-handmade-data-hides-key-mismatch]] — 「拿真实调用路径跑」这条教训的源头
- [[tui-line-width-limit]] — 每一帧转轮也受行宽约束
- [[tui-spinner-glyph-compat]] — 转轮字形在部分终端的字体兼容与卡顿排查
- [[capsule-hot-path-perf]] — 转轮每帧重跑 renderCall，别在里面 split 大入参
- [[fanchao]] — 本页沉淀者
