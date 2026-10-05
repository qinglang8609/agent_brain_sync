---
tags: [concept, 配置, 多项目, 坑]
id: global-config-contaminates-projects
author: fanchao
updated: 2026-10-05
status: active
---

# 概念：全局单值配置会污染所有项目

## 触发场景

工具把「使用者身份」这类**每项目都该独立**的值，放在**全局单值配置**里
（如 `~/.abs/config.json` 的 `{user}`）。
表现触发点：**新项目里任务/日志的作者标记是陌生人名**（tester / foo / 别人）。

## ❌ 表现

一次手动 `abs config set user tester`（或任何临时切身份的调试动作）
会**永久污染之后所有项目** —— 实测新项目看板每条都标 `tester`。
症状看起来像「代码写错了作者」，实际是**残留的全局值**。

**为什么难查**：测试隔离本身是好的（`ABS_CONFIG_DIR` 指向沙箱），
所以开发者会先怀疑代码，而真凶在一个不相关的文件里。

## 🛠 解法

**诊断三步（按序，别跳）**：

```bash
cat ~/.abs/config.json      # ① 有值就是它 ← 多数情况在这结束
echo "$ABS_USER"            # ② 无值才查环境变量
# ③ 都没有 → 才是代码问题
```

**判据**：见到陌生用户名，**先怀疑残留、别先怀疑代码**。

**设计层面的推论**：凡是「每项目/每用户都该独立」的值，就不该放在全局单值里
—— 放全局＝隐式的跨项目共享状态，污染是必然的、而且在别处爆出来。

## 验证

- `cat ~/.abs/config.json` 确认 `user` 是你自己
- 新建一个项目，`abs todo start T-1`，看板行作者应为当前使用者而非陌生人名
- 测试隔离：相关测试用 `ABS_CONFIG_DIR` 指向沙箱，不碰真实全局配置

## 关联连接
- [[fanchao]] — 沉淀者
- [[validation-gate-on-shared-write-path]] — 同属「共享状态 + 存量污染」这类失效
- [[AgentBrainSync]] — 本机制所属项目
