---
tags: [concept, pi, 扩展, 坑]
id: pi-extension-api-traps
author: fanchao
updated: 2026-10-05
status: active
---

# 概念：pi 扩展开发：API 语义与加载坑

## 触发场景

写/改 pi 扩展（`hooks/*.pi.ts`、`pi.on(...)` 事件处理）时。
**核心教训：pi 扩展 API 的字段语义必须查源码确认，不能靠字段名猜**
—— 同类假设连错两次，说明「猜 API 语义」这个动作本身该被禁用。

## ❌ 表现

**① `event.systemPromptOptions.selectedTools` 是基线值，不是真实工具表**

在 `before_agent_start` 的 handler 里读到的是**回填前**的基线（实测只有 31 个
无关工具，且不含任何 MCP 工具）。真实值由 `agent-session.js:1573` 在 **handler
之后**才用 `getActiveToolNames()` 回填。
→ 靠它判断「某个工具是否可用」**永远为假**。

**② 换 `pi.getActiveTools()` 仍拿不到 MCP 工具**

MCP 默认 `exposure=codemode`，工具**本就不进 active 表**
（实测输出 `lazy: tools from cache, not connected yet`）。

**③ `tool_execution_end` 的 toolName 是代理入口名**

实测为 `mcp__abs`（代理入口），**不是**子工具名 `abs_task`，且该事件**不带 args**
→ 无法从它判断调的是哪个 MCP 子工具。
另：`turn_end` 不是「整轮回答结束」而是「每条 assistant 消息结束」（实测每条都触发）。

**④ import 宿主内部包会在真实环境崩**

`@earendil-works/pi-tui` 等是 pi jiti loader 的 **alias**，只在 pi 运行时能解析。
测试用原生 node 加载扩展 → `ERR_MODULE_NOT_FOUND`（实测挂 6 个测试）。
「真实环境有 alias」也不安全 —— 版本一变就崩。

**⑤ 模板文件不能直接跑语法自检**

`hooks/abs.pi.ts` 是模板，含 `@@ABS_BIN@@` 占位符，直接给 node 跑会报
`Expected ident` 且**不指位置**，白折腾。
另：全局包的 `hooks/` 是**独立副本**，改完仓库 `src/hooks` 必须 cp 到全局包再
`abs install`，否则装的还是旧模板。

## 🛠 解法

| 坑 | 正解 |
|---|---|
| 判断工具是否可用 | **查项目有没有 `.brain/` 目录** —— 可直接观测，比查 API 可靠 |
| 识别具体 MCP 子工具 | 用 `tool_call` 事件（**带 input**，子工具名在 `input.tool`）置标记，`tool_execution_end` 消费标记后刷新 |
| 需要宿主内部能力 | **自己实现**（如按显示宽度截断 CJK 记 2 列，~40 行），别 import |
| 语法自检 | 跑**渲染后**的文件，不是模板 |
| 注入常驻指引 | 用 `before_agent_start` 改 `event.systemPromptOptions.promptGuidelines` 数组（渲染进 system prompt 的 `<rules>` 段，**每轮都在**），而不是往对话插消息 —— 后者会抢走一个 turn 打断用户（本项目删过两次都因为太吵）。**分界线：静态 prompt 内容 vs 新增对话条目** |

**一个附带坑**：自实现宽度截断必须先**剥 ANSI 色码再量宽**，
否则颜色转义被误算宽度 → 每行都被误判超宽截断。

## 验证

- 注入指引后**留痕验证**：扩展里 `logHook` 记 `todo_guide=on/off`，
  再 `grep hooks.log` 确认 —— **不能凭感觉**
- 改完扩展必须重启才加载；「文件写对了」≠「被加载了」
  （实测：装完立刻宣称生效，但 hooks.log 里没有）
- 判断工具可用性时，用「目录存在」这类**可直接观测**的信号做判据

## 关联连接
- [[fanchao]] — 沉淀者
- [[validation-gate-on-shared-write-path]] — 同属「别信表面信号，要有可观测证据」
- [[silent-data-loss-diagnosis]] — 静默失效的通用识别法
