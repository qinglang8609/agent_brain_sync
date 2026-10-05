---
tags: [concept, 宿主插件, 坑, 可观测性]
updated: 2026-10-05
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

## 🔁 复发（2026-10-05）：宿主 API 升级后，坑 2 换了个形状回来

op​encode 升到 **v2**，插件契约从 `{ id, server }`（server 返回 hooks 对象）
改成 **`{ id, setup }`**（setup 收 api，用 `api.event.subscribe(fn)` 订阅）。
旧写法报：

```
Plugin failed: /Users/fanchao/.config/opencode/plugins/abs.ts
(日志) Plugin must export a default definition with an id and an effect or setup function.
       Missing key at ["default"]["effect"] / ["default"]["setup"]
```

**为什么没早发现**：`test/install.test.js` 与 `test/plugin-behavior.test.js`
两处测试**把 v1 契约写死成了断言**（`default.server 是函数`），于是 API 变了、
测试还全绿 —— 断言锁定旧实现，等于给回归发了通行证。

**修法**（三处必须同改，少一处就复发）：

| # | 位置 | 说明 |
|---|---|---|
| ① | `<repo>/hooks/abs.opencode.ts` | 模板源头 |
| ② | `$(npm root -g)/@fanchao8609/agent_brain_sync/hooks/` | `abs install` 实际读的那份（[[deploy-artifact-copies]] 的第四份） |
| ③ | `~/.config/opencode/plugins/abs.ts` | 宿主落点 |

**最阴的一刀**：只改 ③ 不改 ①② ，下次 `abs install` 会用旧模板**静默覆盖**掉宿主落点。
本次就是这样先修好、又被 install 冲掉、复发一轮。

**验证**：op​encode 侧不看语法，看服务端日志有没有 `failed to load plugin`：
```bash
awk '/plugin reconciliation/{p=1} p' ~/.local/share/opencode/log/opencode.log | grep -c "failed to load plugin"   # 0 = 好
```
（重启 `opencode service restart` 才会重新加载；watcher 只盯文件变更。）


## 纪律

1. **按官方 `.d.ts` 实核**，不凭印象写插件 API。**宿主大版本升级后必须重核一遍** ——
   官方改了契约，己方代码不会自己知道（v2 的 `{id,setup}` 就吃掉了 v1 的 `{id,server}`）。
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
- [[skill-trigger-invisible-killers]] — skill 侧同构失效: 描述无触发词 / symlink 指向陈旧副本
- [[hook-code-in-wrong-branch]] — 第四坑：代码插错分支（handler 跑了但新逻辑在错误路径里）
- [[auto-todo-register-design]] — 用 hook 自动登记 todo 的设计约束（指引治不了的场景）
