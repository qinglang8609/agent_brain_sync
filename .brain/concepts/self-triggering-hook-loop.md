---
tags: [concept, hook, 死循环, stop_hook_active, 守卫]
updated: 2026-09-10
status: active
---

# 自触发型 hook 的死循环：主动推必须自带防重入

## 触发场景
任何 hook 的作用是**让 agent 再做一轮**时，它就在给自己制造下一次触发条件：

```
Stop hook 回 decision:block  →  agent 被拉回跑一轮  →  那一轮结束
      ↑                                                        │
      └──────────── Stop 再次 fire ───────────────────────────┘
```

同类形态：
- CC / Codex：`Stop` 回 `{"decision":"block","reason":...}`
- pi：`agent_end` 里 `pi.sendUserMessage(..., {deliverAs:'followUp'})`
- op​encode：`session.idle` 里 `session.promptAsync(...)` 注入新消息

**只要"注入"会带来"下一次同事件"，就必须有刹车。**没有刹车的后果不是"多跑一轮"，
而是**烧光整个会话配额**——官方 issue #55754 记录过约 50 分钟跑满配额。

## ✅ 双保险（缺一不可）

### ① 宿主防重入字段
CC 的 Stop payload 带 `stop_hook_active`：**true = 本次 Stop 已经是"上次注入后产生的"**。
官方文档原话：

> The `stop_hook_active` flag stops infinite loops — **check it, or your gate will jam shut forever.**

```js
if (ev.stop_hook_active === true) return '{}';   // 绝不再推
```

### ② 己方节流，且必须"无 id 也能刹"
只靠 ① 不够：`stop_hook_active` 有**已知不传播 bug**（官方 #54360，同一 turn 内重复 fire
时它仍是 `false`）。所以自己也要落 mark 节流。

**最容易写错的地方**——旧实现长这样：

```js
const sid = ev.session_id || '';
if (sid) {                      // ← 坑：拿不到 id 就整段跳过
  // ...落 mark...
}
```

拿不到 `session_id` 时**完全没有节流**，于是每次都注入 → 每次又触发 → 无限自激。
必须退化为"任何情况下都能刹住"的键：

```js
const sid = String(ev.session_id || '').replace(/[^\w-]/g, '');
const key = sid || 'nosession-' + day + '-' + root;   // ← 退化：项目 + 日期
const mark = join(absLogDir(), `teardown-${key}.mark`);   // absLogDir() = ABS_LOG_DIR || ~/.abs/log
```

（注：曾写作 `join(homedir(), '.abs', 'log', …)` —— 那样会绕过 `ABS_LOG_DIR`，
测试注入沙盒时隔离不到，mark 落到真实家目录。已收口进 `absLogDir()`。）

**原则：节流器不允许有"跳过"分支。**要么按会话，要么按更粗的维度（项目+日期），
但永远要有一个能刹住的键。

## 测试要点（这类 bug 只能靠专门的回归测试守住）
- `stop_hook_active=true` → 必须放行（`{}`）。
- **缺 `session_id`** 的 payload 连推两次 → 第二次必须被拦。
  这一例专打"无节流"分支，是真正的命门。
- 断言方式：先确认"条件全过"上下文确实会注入（正例），再验证第二次被拦——否则测试可能
  因为别的守卫拦下而"假通过"。

## 教训
- **加"主动推"功能时，第一件事就想刹车在哪**，而不是等它跑飞。
- 守卫的**失败方向**要选对：这里必须 fail-closed（拿不到信息就少推），
  而不是 fail-open（拿不到信息就不拦）——后者直接等于没有守卫。
- 与 [[teardown-automation]] 的坑 B 同源：**守卫写错的表现往往不是报错，而是静默关掉或静默开爆。**

## 关联连接
- [[teardown-automation]] — 收尾自动化总则（各宿主每轮结束事件 + 注入手段）
- [[guard-check-then-set-across-await]] — 刹车写成「检查后 await 才置位」时，并发会一起冲过去（实测每会话注入 6 次）
- [[host-plugin-silent-failure]] — 插件三坑（可观测性/签名/导出）
- [[opencode-inject-channel-verdict]] — opencode 四通道唤醒判定表
- [[AgentBrainSync]] — 项目实体页
