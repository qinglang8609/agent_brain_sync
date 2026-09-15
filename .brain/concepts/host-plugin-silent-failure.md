---
tags: [concept, 宿主插件, 坑, 可观测性]
updated: 2026-09-10
status: active
---

# 宿主插件"静默失效"三坑（装上了≠加载了≠触发了）

## 触发场景
给宿主（op​encode / pi 等）装插件/hook，看代码没问题、语法也过，**功能却毫无反应且零报错**。

## ❌ 表现
技术日志**恒为 0 条**，插件仿佛不存在；宿主不报任何错。

## 🛠 三坑（独立存在，修完一个还有下一个）

### 坑 0：只在"真生效"时写日志 → 三态不可区分
插件只在真注入时写 `nudge` 痕。查日志时**无法区分**：
① 事件根本没触发（插件没加载）② 触发了但被守卫拦下 ③ 真生效了。
**修法**：首次事件**无条件**写一行 `seen` 痕（只记一次，不刷屏）。
→ 三态变为：**无痕** = 未触发；**有 seen 无 nudge** = 被拦下；**有 nudge** = 真生效。
**通则**：判断"机制是否生效"的日志，必须有一条**不受任何守卫影响**的痕。

### 坑 1：回调签名 / 事件名凭印象写
op​encode 曾写 `event: async ({ name }) => ...`，但官方类型是
`event?: (input: { event: Event }) => Promise<void>`，事件名在 **`event.type`**
→ `name` 恒 `undefined` → `includes()` 恒 false → 静默失效。
事件名也错：真实是 `session.created` / `session.idle` / `session.deleted`，
不是 `session.start` / `session.end`。

### 坑 2：导出方式错（命名导出 vs default）
用 `export const AbsPlugin = ...`（命名导出），但加载器取 **`default`**
→ `mod.default === undefined` → 插件被忽略。
正确写法（与同机可用插件一致）：
```ts
const server = async ({ client, directory }) => ({ event, 'tool.execute.after' })
export default { id: "abs", server }
```
官方类型已明示：`PluginModule = { id?: string; server: Plugin; tui?: never }`。

## 纪律

1. **按官方 `.d.ts` 实核**，不凭印象写插件 API。
2. **三层分开证**：文件在 → `default` 能 import 出 `server` → 日志有落痕。
   仅语法检查/契约检查会放过导出方式错误。
3. **字符串断言不够**：`install.test.js` 只 grep 源码文本，于是坑 1 和坑 2 **两次全绿**。
   必须**行为级**测试：真 import 生成产物 + 驱动真实事件 + 断言日志落痕
   （见 `test/plugin-behavior.test.js`）。
4. **证伪方式**：`grep -c "opencode:" ~/.abs/log/hooks.log` 曾两次为 0 ——
   "装上了"必须用日志落痕来证，不能靠"我觉得应该能跑"。

## 验证（改完插件/hook 后逐条跑）

```bash
# ① 文件在：产物已落盘
ls -la ~/.config/open/plugins/abs.ts

# ② default 能 import 出 server（坑 2 的坑位）—— 只看语法/契约检查会放过它
node -e "import('file://' + process.env.HOME + '/.../abs.ts').then(m => console.log('default.server:', typeof m.default?.server))"
# 期望: function；得到 undefined 就是导出方式错

# ③ 日志有落痕（唯一能证「真触发」的证据）
grep -c 'seen'  ~/.abs/log/hooks.log    # =0 → 未触发；>0 → 插件已加载
grep -c 'nudge' ~/.abs/log/hooks.log    # >0 → 真生效
```

**三态判读**（对应坑 0 的修法）：

| seen | nudge | 含义 |
|---|---|---|
| 0 | 0 | 插件未加载（查导出方式 / 路径） |
| >0 | 0 | 已加载但被守卫拦下（查守卫判据） |
| >0 | >0 | 真生效 |

**行为级回归**：`node --test test/plugin-behavior.test.js` ——
字符串断言（grep 源码）曾让坑 1/2 两次全绿，必须真 import 产物 + 驱动真实事件。

## 关联连接
- [[teardown-automation]] — 收尾自动化的注入机制（本坑的发现场景）
- [[abs-install-layout]] — 四宿主安装器与 hook 配置
