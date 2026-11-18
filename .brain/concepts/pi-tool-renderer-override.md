---
tags: [concept]
id: pi-tool-renderer-override
author: fanchao
updated: 2026-10-09
status: active
---

# 概念：pi 扩展接管内置工具渲染的正确姿势

## 触发场景
想用 pi 扩展改**内置工具**（bash / read / edit / write / grep / find / ls）的渲染外观时。
关键症状是「改不动」：扩展写完了、加载成功、零报错、画面却一点变化都没有。

## ❌ 表现
- `registerTool()` 用同名工具覆盖内置定义，注册了 7 个工具、零报错，**渲染上不赢**，画面毫无变化。
- 另一种坑：`registerToolRenderer` 的解析器返回 `{}`，**不等于「什么都不做」**，而是「我提供渲染器」——它会阻止链继续往下走，把下游渲染器一起吞掉。未知工具（MCP、其他扩展）会因此失去自己的渲染。

## 🛠 解法
**根因**：pi 交互模式这样取渲染器（`interactive-mode.js:1706`）：

```js
resolveToolRenderers(name, () => withBuiltInRenderers(name, this.session.getToolDefinition(name)))
```

最外层又套了一次 `withBuiltInRenderers`，把通过 `registerTool` 塞进去的 `renderCall` 盖掉了。
`registerToolRenderer` 是 `resolveToolRenderers` 里的**第一环**，跑在那个内置包装之前，所以能真的接管。

**修复**：
1. 扩展改用 `pi.registerToolRenderer((toolName, next) => ...)`。
2. 不认识的工具**必须 `return next()` 显式透传**，绝不能返回 `{}`。
3. 返回体里加 `renderShell: "self"`，关掉 pi 默认的工具方框，否则胶囊外面还会套一层框。

## 验证
**只有 `resolve-check.ts` 这类回归能拦住「没效果」**——普通单测测的是渲染函数本身，而 bug 出在「渲染器根本没被选中」这一层。

它按 pi 的方式走一遍解析器链，断言 7 个内置工具都落到胶囊渲染器上、且未知工具正确透传：

```bash
node --experimental-strip-types resolve-check.ts   # 18 项
```

判据：`bash`/`read`/`edit`/`write`/`grep`/`find`/`ls` 全部 `capsule renderer wins` + `renderShell is self`；
`mcp` 这类未知工具 `falls through to base`。

## 关联连接
- [[tui-line-width-limit]] — 接管成功后紧接着的第二道坎：渲染行不能超宽
- [[pi-call-result-double-row]] — 第三个坑：call/result 各画一次 = 重复行
- [[test-handmade-data-hides-key-mismatch]] — 第四个坑：渲染器接管了，但读的字段名是猜的
- [[publish-pi-package-to-npm]] — 前面四坑跨完后，怎么把它发成标准 npm 包
- [[fanchao]] — 本页沉淀者
