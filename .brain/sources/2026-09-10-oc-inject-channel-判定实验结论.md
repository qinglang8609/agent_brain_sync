---
tags: [source, opencode, inject, teardown-nudge, promptAsync, 结论]
updated: 2026-09-10
status: draft
---

# 来源：OC-INJECT-CHANNEL 判定实验结论: promptAsync 对 

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- OC-INJECT-CHANNEL 判定实验结论: promptAsync 对 idle(终结态) session 确实能唤醒跑新 turn, 不是"只入队不重启". 真机证据(plugin-enabled server 4599): abs 插件在 gate 满足后落痕 session.idle:teardown-nudge (14:58:36), 注入的 [abs 收尾提醒] 作为 user 消息进入会话(第6条), 紧接着第7条新 assistant turn 回应该提醒 => 唤醒成功. 三种通道实测(隔离 _pure server 4600, octopus/deepseek-v4-flash, no-tools prompt): prompt_async=HTTP204空body 2s内产生新assistant(TUIWAKE/ASYNCWAKE-777); session.prompt=/message HTTP200 同步返回assistant body(finish=stop); session.command /command HTTP200 同步返回; tui.append-prompt & tui.execute-command 都 HTTP200 body=true 但零新消息(无TUI挂载,只入buffer)=不唤醒. 旧测零nudge真因=wroteFiles gate(纯文本turn不触发write工具), 非通道故障.

## 关联连接
（提炼成 concepts 规律页后，在此挂双链到该页）
