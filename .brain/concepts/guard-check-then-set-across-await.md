---
tags: [concept, 坑, hook, 静默失效]
id: guard-check-then-set-across-await
author: tester
updated: 2026-09-17
status: active
---

# 概念：守卫的检查与置位跨 await 就会漏：并发调用一起通过

## 触发场景

任何「只准做一次」的守卫，写在 `async` 回调里，且**检查与置位之间夹了 `await`**：

```js
if (done) return        // ← 检查
await something()       // ← 让出控制权（其余调用从这里插进来）
await another()         // ← 再让出
done = true             // ← 置位太晚，前面的都好过检查了
```

高发位置：hook 的 `agent_end` / `session.idle` / `Stop`，定时器回调，事件监听器。
**只要"检查→置位"不是一条直线，并发就一定漏。**

## ❌ 表现

**守卫完全不报错，只是"看起来生效过"** —— 所以靠读代码发现不了，靠单次调用也测不出。

本仓实例（2026-09-17）：`hooks/abs.pi.ts` 的收尾注入注释写着「每会话最多一次」，
而 `~/.abs/log/hooks.log` 里同一会话 5 分钟注入 **6 次**：

```
[00:13:36] pi:agent_end:teardown-nudge
[00:14:36] pi:agent_end:teardown-nudge
[00:14:53] pi:agent_end:teardown-nudge
[00:15:16] pi:agent_end:teardown-nudge
[00:15:21] pi:agent_end:teardown-nudge
[00:17:53] pi:agent_end:teardown-nudge
```

全日志累计 **55 次**。用户体感是「正在跑任务，突然开始收尾，侵入性太强」。

**为何并发是常态而非极端**：`agent_end` 是**每轮 run 结束**都触发（官方
`docs/extensions.md:569`：它 ≠ 会话结束，Pi 之后还可能继续跑 follow-up）。
多轮任务里它天然会并发/连续触发。

## 🛠 解法

**把置位提到第一个 `await` 之前**，做成"抢占式"（check-and-set 之间无让出点）：

```js
if (done || inFlight) return   // 两个标志：终态 + 进行中
inFlight = true                // ← 第一个动作，无 await 间隔
const release = () => { inFlight = false }   // 让提前 return 也能放锁
...
if (!applicable) return release()
done = true; inFlight = false
```

要点：
1. **两个标志**，不只是 `done`。「已做」是终态，「正在做」是过渡态；只有前者挡不住并发。
2. **所有提前 return 都要 `release()`** —— 否则一次不适用就把本次会话永久锁死（反向静默失效）。
3. **状态放模块级，不放被反复调用的工厂函数里**：扩展会被重复注册（本仓实测
   `session_start` 11 分钟内触发 8 次），每次注册一份独立闭包 → 守卫互不可见，
   「每会话一次」变成「每实例一次」。

> 同类：shell 里 `[ -e "$MARK" ] && exit 0` 紧跟 `: > "$MARK"` 也是这个模式 ——
> 只要两次调用能并发，就有窗口。若 mark 名还含时间戳（如分钟级 `HHMM`），
> 时间一滚就更认不出自己，窗口进一步退化。

## 验证

**必须用并发触发来测**，单次顺序调用测不出（顺序调用时守卫看着完全正常）：

```js
// 反例写法：逐个 await —— 永远通过
await handler(); await handler(); await handler();

// 正例写法：同时触发 —— 才会暴露
await Promise.all([handler(), handler(), handler(), handler(), handler()]);
assert.equal(injected.length, 1);   // 期望 1，旧实现实测 5
```

配套两条：
- **断言可观测落痕的次数**，不只断言业务结果。本仓 `agent_end:seen` 是无条件留痕，
  它泄漏 6 次直接证明守卫没守住（比只数注入更早锁定）。
- **跑破坏验证**：把置位挪回 `await` 之后，并发测试必须 fail。否则测试是空的。

本仓回归测试：`test/plugin-behavior.test.js` 的
「并发 agent_end 只注入一次（跨 await 的检查-置位竞态回归）」与
「重复注册扩展（多实例）仍共享节流」。

## 关联连接
- [[hook-throttle-alignment]] — 节流判据要对齐「真收尾」；本页补的是**并发**维度的漏
- [[self-triggering-hook-loop]] — 同类：主动推必须自带刹车，且刹车要有"能刹住"的键
- [[vacuous-test-passes-on-broken-code]] — 本页的验证必须靠破坏验证兜底，否则测试是空的
- [[teardown-automation]] — 收尾自动化的各宿主触发点与注入手段
- [[tester]] — 本页沉淀者
