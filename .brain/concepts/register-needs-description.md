---
title: 登记任务必须带描述，只给 id 会留下无法补回的空壳
tags: [concept, todo, 坑, 登记]
author: fanchao
updated: 2026-11-01
status: active
layer: 4
kind: gotcha
---

# 登记任务必须带描述

只传 id 不传描述，登记出来的是一个**永远无法补回内容**的空壳任务。

## 触发场景

调 `abs_task action=start` 或 `abs todo add` 时，恰好想不出描述，先占个位子。

## ❌ 表现

2026-10-15 实测，`baozufang` 项目留下这样一条：

```
- [ ] [进行中] fe-deploy-h5 [[fanchao]] (认领 2026-10-15 01a13e0f-a16c-75)
```

只有 id、作者、认领时间，**没有任何描述**。两周后（2026-10-17）看到这条时：

- 那个会话已经不在了，任务内容无从补回
- 只能从 id 名字猜它大概是「前端 H5 部署」——猜的，不是记录里写的
- 它一直停在「进行中」，每回 `abs load` 都被顶出来，成为噪音

## 🛠 解法

**描述可以粗糙，不能不写。** 想不出好名字就先写一句白话：

```bash
abs todo add fe-deploy-h5 --note "baozufang 的 H5 端部署，卡在 manifest.json 配置"
```

判据：**任务是给未来的自己看的**。未来的你没有这段对话，只有这一行字。
一个字都没有的行，等于没登记。

id 可以事后改（`abs todo rename`），描述也可以追加（`abs todo note`），
但**「当时想干什么」这个信息，错过就永久丢失**。

## 验证

`abs todo --full` 扫一遍看板，每条未完成任务都该有 `—` 之后的描述。
没有描述的立即补一句或搁置——留着比删掉更糟，它会一直出现在 `abs load` 顶部。

## 关联连接

- [[incomplete-state-no-auto-decide]] — 同族：不完整的输入不该被静默接受
- [[remind-vs-gate]] — 对齐机制：让问题被看见
