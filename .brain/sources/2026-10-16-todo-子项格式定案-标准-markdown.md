---
tags: [source, abs, 坑, todo格式]
id: 2026-10-16-todo-子项格式定案-标准-markdown
author: fanchao
updated: 2026-10-16
status: draft
---

# 来源：todo 子项格式定案：标准 Markdown 嵌套列表（2 空格缩进 + - [ ]），不搞自定义前缀。踩过的坑：① 校验闸门里任务行分支先…

TITLE: todo 子项格式定案：标准 Markdown 嵌套列表（2 空格缩进 + - [ ]），不搞自定义前缀。踩过的坑：① 校验闸门里任务行分支先 continue，导致缩进的 - [ ] 子项只受 TASK_LINE_MAX(400) 管，BREAKPOINT_MAX(200) 闸门走不到（300 字子项静默写入）；② done 归位只认 ↳ 前缀收集附属行，换格式后子项残留原区；③ 归档 count 用 /^\s*- \[x\]/ 把子项也算成任务；④ parseDoneUnits 里 isTaskLine 先命中，子项被当独立条目。共同点：缩进的 - [ ] 同时满足任务行与子项两个判据，凡按行的形态判定的地方都要先排子项。

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- todo 子项格式定案：标准 Markdown 嵌套列表（2 空格缩进 + - [ ]），不搞自定义前缀。踩过的坑：① 校验闸门里任务行分支先 continue，导致缩进的 - [ ] 子项只受 TASK_LINE_MAX(400) 管，BREAKPOINT_MAX(200) 闸门走不到（300 字子项静默写入）；② done 归位只认 ↳ 前缀收集附属行，换格式后子项残留原区；③ 归档 count 用 /^\s*- \[x\]/ 把子项也算成任务；④ parseDoneUnits 里 isTaskLine 先命中，子项被当独立条目。共同点：缩进的 - [ ] 同时满足任务行与子项两个判据，凡按行的形态判定的地方都要先排子项。

## 关联连接
- [[fanchao]] — 本页沉淀者
（提炼成 concepts 规律页后，在此挂双链到该页）
