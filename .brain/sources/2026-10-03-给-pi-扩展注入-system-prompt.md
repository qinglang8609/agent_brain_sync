---
tags: [source, pi扩展, prompt, 坑]
id: 2026-10-03-给-pi-扩展注入-system-prompt
author: fanchao
updated: 2026-10-03
status: draft
---

# 来源：给 pi 扩展注入 system prompt 常驻指引的正确姿势: 用 pi.on('before_agent_start') 改 event…

TITLE: 给 pi 扩展注入 system prompt 常驻指引的正确姿势: 用 pi.on('before_agent_start') 改 event.systemPromptOptions.promptGuidelines 数组(每条会渲染进 system prompt 的 <rules> 段, 每轮都在), 而不是往对话里插消息 —— 后者(sendUserMessage deliverAs:followUp)会抢走一个 turn 打断用户, 本项目删过两次都因为太吵。两者的分界线: 静态 prompt 内容 vs 新增对话条目。实测验证方式: 扩展里留一行 logHook 记 todo_guide=on/off, 再 grep hooks.log 确认(不能凭感觉)。判定条件用'项目有没有 .brain/'而不是'有没有 abs 工具' —— MCP 工具默认 exposure=codemode 不进 active 工具表, 且 event.selectedTools 在 handler 里是基线值(真实表在 handler 之后才回填)。

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- 给 pi 扩展注入 system prompt 常驻指引的正确姿势: 用 pi.on('before_agent_start') 改 event.systemPromptOptions.promptGuidelines 数组(每条会渲染进 system prompt 的 <rules> 段, 每轮都在), 而不是往对话里插消息 —— 后者(sendUserMessage deliverAs:followUp)会抢走一个 turn 打断用户, 本项目删过两次都因为太吵。两者的分界线: 静态 prompt 内容 vs 新增对话条目。实测验证方式: 扩展里留一行 logHook 记 todo_guide=on/off, 再 grep hooks.log 确认(不能凭感觉)。判定条件用'项目有没有 .brain/'而不是'有没有 abs 工具' —— MCP 工具默认 exposure=codemode 不进 active 工具表, 且 event.selectedTools 在 handler 里是基线值(真实表在 handler 之后才回填)。

## 关联连接
- [[fanchao]] — 本页沉淀者
（提炼成 concepts 规律页后，在此挂双链到该页）
