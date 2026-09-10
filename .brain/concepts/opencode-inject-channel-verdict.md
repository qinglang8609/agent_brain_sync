---
tags: [concept, opencode, 注入通道, promptAsync, session.command, teardown]
updated: 2026-09-10
status: reviewed
---

# op​encode 注入通道：能唤醒 idle session 的只有 session 级 prompt，TUI 级无效

## 触发场景
要往一个**已进入 idle（终结态）**的 op​encode session 注入一轮新指令（如收尾提醒），
需判定：哪种调用真能把 agent 重新唤醒跑一轮？类型层（`sdk.gen.d.ts`）只标了返回码，
**不告诉你是否真重启 turn**——必须真机 HTTP 实验。

## 判定表（隔离 `op​encode serve --pure`，octopus/deepseek-v4-flash，no-tools prompt）

| 调用 | HTTP 状态 | 是否唤醒 | 证据（真实响应） |
|---|---|---|---|
| `session.promptAsync` → `POST /session/{id}/prompt_async` | **204** No Content（body 0 字节） | ✅ **是** | 调用前 assistant=2，**2 秒内**新增 assistant=3，text=`AUDIT-ASYNC`；真机经 abs 插件注入的 `[abs 收尾提醒]` 作为 user 消息落地（msg#6）后，**新 assistant turn 回应该提醒**（msg#7） |
| `session.prompt` → `POST /session/{id}/message` | **200** OK（同步返回 1237B） | ✅ **是** | body 直接是 assistant 消息：`finish=stop`，text=`AUDIT-SYNC`；assistant 3→4 |
| `session.command` → `POST /session/{id}/command` | **200** OK（同步返回 1236B） | ✅ **是** | body 是 assistant 消息：`finish=stop`，text=`AUDIT-CMD`；assistant 4→5 |
| `tui.appendPrompt` → `POST /tui/append-prompt` | **200** OK（body `true`, 4B） | ❌ **否** | 返回 true 但 **assistant 计数不变**（仍=5）。只入 TUI input buffer，无 TUI 挂载时什么都不发生 |
| `tui.executeCommand` → `POST /tui/execute-command` | **200** OK（body `true`） | ❌ **否** | 同上，dispatch 一个 UI 命令，不产生任何 assistant 输出 |

## 关键结论
1. **`promptAsync` 的 204 不等于"没启动 turn"**。"fire-and-forget / Prompt accepted" 只是说
   *调用方不阻塞等结果*，服务端照常起一轮。实测 2 秒内就有新 assistant 输出。
   **"204 void ⇒ 对终结态 idle 只入队不重启" 是被证伪的错误推断。**
2. **SDK 与裸 HTTP 同构**：`client.session.promptAsync(...)` 内部就是
   `POST /session/{id}/prompt_async`（见 `sdk.gen.js` 第 382-384 行）。裸 curl 结论可直接外推到插件。
3. **TUI 通道不能用于服务端注入**：headless `serve` 没有 TUI，`append-prompt`/`execute-command`
   永远返回 `true` 却无副作用——是"假成功"，会误导人以为注入成功了。
4. **busy 态注入**：在 session **busy** 时调 `promptAsync` 也有效——消息排队为**下一个 turn**
   （实测注入 `MIDTURN-INJECT` 后 idle 时该 assistant 回复已存在）。即"turn 内注入"（`tool.execute.after`）
   亦可行，但只是把注入时机提前，**非必需**。
5. **同步替代**：若要"调用即拿到结果/错误"（消除 fire-and-forget 的不确定性），用
   `session.prompt`（200 同步返 body）而非 `promptAsync`（204）。两者都能唤醒。

## 反面教训：把"通道嫌疑"当成了根因
曾判定"零 teardown-nudge = 通道坏"，方向错。真因是**上游 gate**：
abs 插件的 `wroteFiles` 守卫要求本会话真的调过写入类工具；
**纯文本 turn 永远不会置位**，于是 nudge 被静默拦下。

> **后续修正（2026-09-10，指挥官侧）**：该守卫当时还**漏了 `bash`** —— 而 op​encode 里
> 大量修改是经 bash（heredoc / `sed -i`）完成的，所以"纯 bash 会话"同样永不置位。
> 已对齐 pi 侧写法（`WRITE_TOOLS` 含 bash + `READONLY_CMD` 只读过滤），见 commit 6b3466f。
> 教训追加：guard 的**工具白名单必须按宿主实际用法穷举**，漏一个就把功能静默关掉。
- 症状（`session.idle:seen` 有痕、零 nudge）+ 错误归因（通道）会浪费一整轮排查。
- 复现方法：让 agent 真跑一次 write 工具（`gate.txt`）→ 立刻落 `session.idle:teardown-nudge` 痕，
  且注入的 `[abs 收尾提醒]` 生效。**先证明 gate 满足，再怀疑通道。**

## 关联连接
- [[teardown-automation]] — 收尾自动化总则（各宿主每轮结束事件 + 注入手段）
- [[host-plugin-silent-failure]] — 插件三坑
