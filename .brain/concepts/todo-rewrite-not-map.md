---
tags: [concept, node]
updated: 2026-09-08
status: draft
---

# 概念：todo 行操作必须整文件重写保序

## 触发场景
abs CLI 对 `.brain/todo.md` 做登记/勾选/归位时，任务行要跨分区移动（如 `done` 从 Today 归位 Done）。

## ❌ 表现
用 `lines.map()` 只改匹配行：勾选完成但行**留在原地**，`## Done` 区永远空——SKILL.md B4 契约「完成归位 Done」静默失效（本轮 TDD 暴露的第一个真 bug）。

## 🛠 解法
1. 根本原因：行内替换 ≠ 结构移动；分区是有序结构，移动必须重排数组。
2. 关键代码：
   ```
   // markDone: 单遍扫描收集 moved(任务行+↳断点附属行)，kept 其余，
   // 最后 splice 回 Done 标题后。map 回调里做不了"删除+插入"两件事。
   ```
3. 验证命令：`node --test test/store.test.js`（「done 勾选并归位」用例）。

## 关联连接
- [[AgentBrainSync]] — todo 看板的底层读写纪律
