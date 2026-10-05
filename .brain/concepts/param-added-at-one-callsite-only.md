---
tags: [concept, 坑, 静默失效, 参数传递]
updated: 2026-10-05
status: active
---

# 同一参数有两个调用点，只改一处：命令说成功、磁盘没变

## 触发场景
给某个函数**加一个可选参数**，然后在调用方传它。但那个函数在同一个调用方里
**被调用了两次**（一次预算/预览、一次锁内重算/提交）—— 只有一处传了新参数。

## ❌ 表现（2026-10-05 实测）
`abs todo archive` 报：

```
✓ 已归档 2 天 / 33 条
  → sessions/log-2026-10-05.md
```

**但 `todo.md` 一个字没动**（65 行 → 65 行），lint 继续报 `ROOT-OVER-SIZE`。
更迷惑的是：`sessions/` 里的归档页**确实写了** —— 两边数据不一致，
但命令的输出看起来完全正常。

## 🛠 根因

```js
// 调用点 A：预算（传了新参数）
const plan = archiveDoneInText(raw, { keepDays: days, from: today(), maxLines: TODO_MAX_LINES });
if (!plan.archived.length) return '（无可归档）';
...写 sessions/ 归档页...

// 调用点 B：锁内重算（★ 漏传 maxLines）
await editFile(todoP, (cur) => {
  const p2 = archiveDoneInText(cur ?? '', { keepDays: days, from: today() });  // ← 没有 maxLines
  return p2.archived.length ? { text: p2.text } : SKIP;   // archived 为空 → SKIP → 不写
});
```

调用点 A 用 `maxLines` 算出"可归档 33 条"并据此写了归档页；
调用点 B 没有 `maxLines`，算出的 `archived` 是空 → 返回 `SKIP` → `todo.md` 没改。

**于是"报告"和"落盘"来自两次不同的计算，只有一次带上了新参数。**

## 🛠 修法与判据

1. **先 grep 那个函数的所有调用点**，而不是只改眼前这一处：
   ```bash
   grep -rn "archiveDoneInText(" src/
   ```
   加参数时，**每个调用点都要一起看**。

2. **同一函数在同一函数体里出现两次时，参数应当一致**。若确实要不一致，
   得写清为什么（那是两个不同的语义，而不是漏改）。

3. **测试必须断言磁盘真的变了**，不能只断言命令输出：
   ```js
   const before = lines(todo.md);
   await run(['todo', 'archive']);
   const after = lines(todo.md);
   assert.ok(after < before, 'todo.md 应真的变短 —— 只写 sessions/ 不算归档');
   ```
   只断言 `stdout 含"已归档"` 的测试**会放过这个 bug**（它就是那么报的）。

## 更一般的形态（值得警惕的同类）

- 加参数只改了一个调用点 → 另一个走默认值，静默按旧行为跑
- 加校验只加在一个入口 → 另一个入口绕过
- 加锁/加开关只加在一处 → 另一条路径没保护

> **通则：给函数加参数时，第一步是列出它的全部调用点，而不是改眼前那一个。**
> 「报告」与「落盘」如果来自两次独立计算，它们就会漂移 —— 而且漂移时通常没有人报错。

## 验证
```bash
node --test --test-name-pattern="archive 真把条目移出" test/cli.test.js
# 破坏验证：把调用点 B 的 maxLines 去掉 → 该测试必须变红（实测过）
```

## 关联连接
- [[falsy-or-eats-zero]] — 同族"参数处理出错但不报错"
- [[host-plugin-silent-failure]] — 同族静默失效家族
- [[validation-gate-on-shared-write-path]] — 共享写入路径的闸门要收口在一处
