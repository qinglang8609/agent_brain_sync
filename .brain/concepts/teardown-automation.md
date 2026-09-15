---
tags: [concept, hook, 自动化, 宿主插件]
updated: 2026-09-10
status: active
---

# 收尾自动化：hook 必须主动推，不能只被动记日志

## 触发场景
装了 abs 却"形同虚设"——干了一整天活，`.brain/todo.md`/`log.md` 一字未动，经验全丢。

## ❌ 表现
- `.brain` 文件时间戳停在几天前，而当天明明做了大量实事；
- `~/.abs/log/hooks.log` 只有 `session_start`/`session_shutdown`，**零条收尾痕迹**；
- 下会话 `abs load` 看不到任何滞留（因为压根没登记）。

## 🛠 根因（两层，缺一层都不work）
1. **事件缺**：只挂"会话级"事件（`session_start`/`session_shutdown`）。而 `session_shutdown`
   只在**退出宿主**时触发——正常干活到一半永远等不到信号。
2. **机制被动**：`abs wrapup` 只往 `wrapup.log` 写一行快照。它"记了有滞留"，
   但**没有任何机制让 agent 真的去收尾**。下会话靠 `abs load` 顶出滞留，
   前提是"你还记得跑 `abs load`"。→ 收尾仍靠自觉，而自觉不可靠。

**一句话**：缺口不在"记日志"，而在"没人提醒"。记日志是被动的，注入指令才是主动的。

## ✅ 解法：每轮结束主动注入收尾指令

各宿主的"每轮结束"信号 + 主动注入手段：

| 宿主 | 每轮结束事件 | 注入手段 |
|---|---|---|
| pi | `agent_end` | `pi.sendUserMessage(指令, { deliverAs: 'followUp' })` |
| Cl​aude / Co​dex | `Stop`（event.sh） | hook stdout / 后续 turn |
| op​encode | `session.idle` | `client.session.promptAsync({ path:{id}, query:{directory}, body:{parts:[{type:'text',text}]} })` — ✅ 实测能唤醒 idle session（204 不代表没起 turn），详见 [[opencode-inject-channel-verdict]] |

### 触发条件必须收窄（否则每轮都吵）
四个条件全满足才注入：
1. **本会话真改过文件** —— pi 用 `toolResults` 判 `write`/`edit`/非只读 `bash`
   （只读命令用 `READONLY_CMD` 正则排除 `ls/cat/grep/git status/curl...`）；
   op​encode 用 `tool.execute.after` 观测工具名；
2. **`.brain` 存在**（`findBrain` 从 cwd 向上找）—— 无图谱=不在这项目沉淀，不打扰；
3. **`log.md` 今日无记录**（`loggedToday`）—— 已收尾就不再念；
4. **防重入 + 每会话最多一次**（见下节）。

### 两个致命坑（都是"守卫写错把功能关掉或开爆"）

**坑 A：主动推必须自带死循环防护** —— 详见 [[self-triggering-hook-loop]]。
`decision:block` / 注入新 turn 会触发新一轮，而新一轮结束会**再 fire 同一个 hook**。
必须双保险：宿主防重入字段（CC 的 `stop_hook_active`）+ 己方节流，
且**缺 session_id 时要退化为可用节流，绝不能"无节流"**。

**坑 B：守卫的工具白名单要按宿主实际用法穷举** —— 漏一个就静默关掉功能。
op​encode 侧抄 pi 时漏了 `bash`，而该宿主大量改走 `bash`（heredoc/`sed -i`），
纯 bash 会话永不置位 → 提醒静默不发，还被误诊成"注入通道坏了"整整一轮。
**跨宿主搬运守卫时，必须逐项核对"这个宿主的写操作都长什么样"。**

## 坑：插件"装上了" ≠ "加载了" ≠ "触发了"

三坑（可观测性 / 回调签名 / 导出方式）详见 [[host-plugin-silent-failure]]。要点：
- 首次事件写无条件 `seen` 痕，否则分不清"未触发"与"被拦下"；
- 插件 API 按官方 `.d.ts` 实核（`({event})` 非 `({name})`；事件名在 `event.type`）；
- 加载器取 `default`，须 `export default { id, server }`；
- 字符串断言会放过这些错，必须行为级测试（真 import + 驱动事件 + 断言日志落痕）。

## 验证
- **行为级测试**（`test/plugin-behavior.test.js`）: 真 import 生成的产物 + 驱动真实事件序列
  + 断言技术日志有真实落痕。pi 6 例 / opencode 5 例 / ZWSP 守卫 2 例。
- 插件另在 **Bun**（opencode 真实运行时）下验证加载与注入通过。
- **零宽字符（ZWSP）坑**: `opencode` 一词在源码里带 U+200B。混入**标识符/路径/参数**
  会语法错或让 CLI 认不出 agent 名。日志前缀里的 ZWSP 是**纯负担**（grep/断言都得跟着带），
  已改纯 ASCII 并加守卫测试（断言 CLI 识别不带 ZWSP 的 agent 名 + 生成物代码行无 ZWSP）。

## 关联连接
- [[opencode-inject-channel-verdict]] — op​encode 四通道唤醒判定表（含"零 nudge 真因是 gate 非通道"的反面教训）
- [[self-triggering-hook-loop]] — 主动推类 hook 的死循环防护（stop_hook_active + 节流退化）
- [[hook-throttle-alignment]] — 节流判据要对齐「真收尾」且跨会话重置（三种静默失效的叠加）
- [[host-plugin-silent-failure]] — 插件三坑（可观测性/签名/导出）
- [[abs-install-layout]] — 四宿主安装器与 hook 配置
- [[hook-sh-not-bash]] — hook 脚本方言坑
- [[learning-loop-collect-distill-deliver]] — 本页只解决「采集」环；另外两环（消化/生效）缺失才是坑反复发作的根因
- [[AgentBrainSync]] — 项目实体页
