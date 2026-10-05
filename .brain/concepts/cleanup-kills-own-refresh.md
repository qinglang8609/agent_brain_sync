---
tags: [concept, tui, 重绘, 坑, 自相矛盾]
updated: 2026-10-05
status: active
---

# 消失了却不重绘：清理动作把自己的刷新通道一起关掉

## 触发场景
TUI 里的一个常驻面板（widget），内容清空后应该**自动消失**。
数据确实清了，但**屏幕还留着旧画面**，按 ESC 或重启宿主才正常。

## ❌ 表现
用户实报：「todo.md 里的任务标完成了，但 pi 面板上还是进行中」。
关键副作用：**按一下 ESC 或重启就好了** —— 这条把范围直接锁死在"没人请求重绘"。

## 🛠 根因：一个自相矛盾的闭环

```
任务全部完成 → parseOpenTasks 返回 total=0
                    ↓
        ui.setWidget(key, undefined)      ← 数据清了（对）
                    ↓
        stopAnimTimer()                   ← 停掉动画定时器
                    ↓
   动画定时器是【唯一】调用 requestRender 的地方
                    ↓
        从此没有任何人请求重绘 → 屏幕冻结在旧帧
                    ↓
        按 ESC / 重启 → 宿主自己重绘 → 看起来"正常了"
```

**"面板消失"这个动作，把自己的重绘通道一起关掉了。**

## 为何难查

- 数据层完全正确（`parseOpenTasks` 对空看板确实返回 0，`setWidget(key, undefined)` 也确实是隐藏的正确写法）
- **没有报错**
- 逐行读代码，每行都对；**错误在"行与行之间"的时序依赖上**

## 🛠 修法

隐藏路径**自己请求一次重绘**，不依赖定时器：

```ts
/** 最近一次渲染拿到的 tui 引用（widget factory 被调用时存下）。 */
let lastTui: any = null

function hidePanel(ui: any): void {
  try { ui.setWidget(PANEL_KEY, undefined) } catch {}
  stopAnimTimer()
  try { lastTui?.requestRender?.() } catch {}   // ← 关键：消失后自己刷一次
}
```

注意 `ui` 上**没有** `requestRender`（那是 `TUI` 的方法，只在 widget factory
的入参里拿得到）—— 所以必须先把 factory 拿到的 `tui` 引用存到模块级变量。

## 🛠 测试怎么写（这里有个二次坑）

**假 `ui` 必须真的调用 widget factory**，否则扩展永远拿不到 `tui`，
测试就测不到真实行为：

```js
const ui = {
  setWidget: (k, v) => {
    widget = v === undefined ? 'hidden' : 'shown'
    // 模拟真实 pi：传 factory 时宿主会调它取组件（tui 引用由此进入扩展）
    if (typeof v === 'function') v({ requestRender: () => { renders++ } }, { fg: (c, s) => s })
  },
}
// 断言：面板隐藏 + renders 增加
```

> 本测试**第一版跑出来是失败的**（`renders 0 → 0`）—— 那恰好证明它在测真东西。
> 若换成"只断言 widget === 'hidden'"，改动没生效也会绿。

## 通则

**"状态清理"和"呈现刷新"是两件事，清理时别把刷新通道一起停了。**
任何 `stop*/dispose/clear` 的动作，都要问一句：**刷新的下一个触发点还在吗？**

同类形态（都值得警惕）：
- 停定时器/取消订阅之后，还指望界面自己更新
- 关掉动画 → 顺带关掉了"每帧重绘"这个副作用
- 数据源清空 → 触发隐藏 → 隐藏路径依赖已停的机制

## 验证

```bash
node --test --test-name-pattern="面板消失" test/plugin-behavior.test.js
```

判据：面板隐藏 **且** `requestRender` 计数增加。只断言前者会漏掉本 bug。

## 关联连接
- [[hook-code-in-wrong-branch]] — 同期另一个"加 hook 却不生效"的坑（分支位置错）
- [[host-plugin-silent-failure]] — 宿主插件静默失效家族
- [[read-side-output-must-not-scale]] — 面板输出必须随规模可控（同类：呈现层的约束）
