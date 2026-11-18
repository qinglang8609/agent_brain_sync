---
tags: [concept]
id: test-handmade-data-hides-key-mismatch
author: fanchao
updated: 2026-10-09
status: active
---

# 概念：手造测试数据会让实现与测试一起猜错键名

## 触发场景
给「读取外部对象某个字段」的逻辑写测试时。凡是代码形如 `result?.details?.someKey`、`response.body.xxx`、`event.payload.yyy`
——**字段名不是你自己定的，是上游给的**——就要想起这条。

## ❌ 表现
功能**从未生效**，但测试全绿、类型检查干净的假象。

真实案例（pi-capsule-tools）：
- 胶囊读 `result.details.exitCode` 显示 `exit N` —— pi 的 `BashToolDetails` **根本没有这个字段**，退出码在 `structuredContent.exit_code`。
- 胶囊读 `result.details.addedLines` / `removedLines` 显示 `+N -M` —— 真实的 details 键其实是 `diff` / `patch` / `firstChangedLine`。

两处都**从未显示过**。而测试为什么没抓到？因为测试里的结果对象也是手造的：

```ts
const result = { details: { exitCode: 0 } };   // ← 我以为的形状
```

**实现猜了一个键名，测试也猜了同一个键名** → 互相印证 → 一直绿。

更隐蔽的是 `?? 0` 这类兜底会把 `undefined` 静默变成合法值，连"漏了"都看不出来。

## 🛠 解法
**测试数据必须来自上游本身，不能手造。**

```ts
// 而不是手写 { details: {...} }
const tool = createBashTool(cwd);
const result = await tool.execute("t1", { command: "exit 3" }, undefined, undefined);
```

**查字段名的正确顺序**（比读文档可靠）：
1. 直接跑一次真实调用，`console.log` 出对象结构
2. 查上游的 `.d.ts` 类型定义
3. 查上游源码里**实际构造**这个对象的地方（如 `bash.js` 的 `formatOutput`）

pi 场景下的额外注意：**渲染器拿不到全部字段**。`tool-execution.js:244` 只传
`{ content, details }` 给 `renderResult`——`structuredContent` 不可达。要确认"这个字段渲染器到底能不能拿到"，
得读那一行，而不是看工具 `execute()` 的返回值（两者字段集不同）。

出错时先问：这个键名我是**看到的**，还是**猜的**？

## 验证
新增的 `real-data-check.ts` 就是这条的落地：全部断言用 pi 真实工具的 `execute()` 输出。

```bash
node --experimental-strip-types real-data-check.ts   # 13 项
```

判据：改回读错键名时断言必须 FAIL。反向验证过三处：
- `edit` 改回 `details.addedLines` → `edit shows '+3 -2'` FAIL
- `bash` 改回 `details.exitCode` → `failing bash shows 'failed'` FAIL
- `shortenPath` 改回只 `startsWith` → `sibling prefix is left alone` FAIL

**新加的"读外部字段"逻辑必须往这个文件加断言**，否则盲区重现。

## 关联连接
- [[pi-tool-renderer-override]] — 同属 pi 扩展踩坑；那条讲"渲染器没被选中"，这条讲"选中了但读错了字段"
- [[fanchao]] — 本页沉淀者
