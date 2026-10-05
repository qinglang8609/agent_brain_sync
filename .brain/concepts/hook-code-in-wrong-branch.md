---
tags: [concept, hook, 行为测试, 排查, 坑]
updated: 2026-10-05
status: active
---

# 加了 hook 却不生效：先确认「代码在哪条分支里」，别猜环境

## 触发场景
给宿主加 hook 逻辑（自动登记/自动注入/自动清理），代码写完、单测过、也真装进了宿主，
**但功能就是不生效**，且没有任何报错。

## ❌ 表现
功能静默无声。日志里**能看见同一 handler 的其他埋点**（证明 handler 确实在跑），
就是看不见新逻辑的痕。于是很容易归因成"环境没传对 / spawn 失败 / cwd 不对"。

## 🛠 本次真实根因：代码插错了分支

给 pi 扩展加「自动登记 todo」时，把登记代码**插进了 `if (!hasBrain(cwd)) { ... return }`
的 `return` 之前**：

```js
if (!(await hasBrain(cwd))) {
  logHook(`... todo_guide=off reason=no_brain`)
  // ← 新增的登记代码被放进了这里
  if (sid && prompt) spawnAutoTask(...)
  return                                    // ← 然后就 return 了
}
logHook(`... todo_guide=on ...`)            // 正常路径根本走不到登记
```

**逻辑整个反了**："有图谱才登记" 变成了 "只有没图谱时才登记"。
而**有 `.brain` 的项目正是正常路径** → 永远不登记。

## 为什么这坑特别难查（浪费了 6 轮）

因为它**完美伪装成环境问题**：

| 现象 | 看着像 | 实际 |
|---|---|---|
| `todo_guide=on` 有痕 | handler 跑了 | 对，但没跑到登记那段 |
| 沙盒 todo 空 | spawn 失败 / 写错地方 | 压根没调 spawn |
| 手动跑 CLI 成功 | 命令本身没问题 | 对，问题在调用点没执行 |
| 真库也没被写 | cwd/env 传错 | 对，因为没调 |

于是反复去查 env 传递、`cwd`、`stableBinPath`、detached spawn、会话 id 提取……
**每一条都不是原因**。

## 🛠 怎么快速定位（本次事后总结）

**不要从"为什么它不生效"入手，先回答"它到底有没有被执行"。**

在可疑代码**紧邻处**加一行无条件的埋点：

```js
if (sid && event?.prompt) {
  logHook(`auto_task attempt sid=${sid}`)   // ← 先证"走到了这里"
  spawnAutoTask(...)
}
```

埋点**没出现** = 没执行到 → 查分支/条件，**完全不必查 env**。
埋点**出现了** = 执行了 → 这时才查 env/spawn/cwd。

> **通则：区分"没执行"与"执行了但失败"，用一行无条件埋点，而不是读代码猜。
> 这两类的排查方向完全不同，搞混就是白烧时间。**

顺带一条：**读代码时注意缩进层级**。这次那段代码在编辑器里缩进是对的，
但因为被插在 `if` 块内，视觉上很容易被当成在块外 —— 读的时候要**先看括号边界**。

## 纪律

1. **加 hook 逻辑后，先在一行日志里证"执行到了"，再谈功能对不对。**
2. 现象像环境问题但**手动能跑通**时，优先怀疑"调用点没执行"而不是"环境不同"。
3. 这类 bug **字符串断言全放过**（源码里那行代码确实存在且正确），
   **只有行为测试能抓** —— 见 [[host-plugin-silent-failure]] 的同源教训。

## 验证

```bash
# 行为测试（真装 + 真驱动事件 + 断言磁盘产物）
node --test test/plugin-behavior.test.js
node --test test/auto-task.test.js
```

回归判据：`自动登记` 相关用例必须全绿；只跑字符串断言的 `install.test.js` 抓不到本类问题。

## 关联连接
- [[host-plugin-silent-failure]] — 插件三坑（签名/导出/可观测性），本页是"第四坑：分支位置"
- [[skill-trigger-invisible-killers]] — 同族"静默失效"：查之前先确认读到的就是改的那份
- [[self-triggering-hook-loop]] — hook 加"主动推"时必须先想刹车在哪
