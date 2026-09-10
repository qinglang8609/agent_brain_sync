---
tags: [source, true]
updated: 2026-09-10
status: draft
---

# 来源：主动推类 hook(回 decision:block/注入新 turn)必须自带

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- 主动推类 hook(回 decision:block/注入新 turn)必须自带死循环防护: 注入会触发新一轮, 新一轮结束又 fire 同一个 hook。两道守卫缺一不可 —— ①宿主防重入字段(CC 的 stop_hook_active) ②己方按会话/按项目+日期的节流, 且缺 id 时必须退化为可用节流而非"无节流"。官方 issue #55754 记录过无节流 Stop hook 烧掉整个会话配额(~50min) hook,死循环,stop,坑

## 关联连接
（提炼成 concepts 规律页后，在此挂双链到该页）
