---
title: Node 的 os.homedir() 不受 HOME 影响，沙箱测试会写进真实配置
tags: [concept, 坑, 测试隔离, node]
author: fanchao
updated: 2026-11-01
status: active
layer: 3
---

# os.homedir() 不受 HOME 影响

用 `HOME=...` 做测试隔离时，任何走 `os.homedir()` 的路径**照样写进真实用户目录**。

## 触发场景

测试里设 `HOME=/tmp/sandbox` 期望隔离，而被测代码用 `os.homedir()` 算配置目录。

## ❌ 表现

2026-10-16 实测：pi todo 面板「显示但缺任务」。真因不是面板 bug，而是
`~/.abs/config.json` 的 `user` 被测试污染成了 `'audit'` —— 面板按 user 过滤作者，
非本人且非无作者的任务即不可见。

`userConfigPath()` 优先读 `ABS_CONFIG_DIR`、回退 `homedir()`，而 Node 的
`homedir()` 读系统真实用户目录，**不读 `HOME` 环境变量**。

## 🛠 解法

被测代码支持一个显式覆盖变量（本项目是 `ABS_CONFIG_DIR`），测试里用它而不是 `HOME`：

```js
// 错：对 os.homedir() 无效
process.env.HOME = sandbox;

// 对：显式覆盖变量
process.env.ABS_CONFIG_DIR = sandbox;
```

判据：**凡是要被测试隔离的路径，都必须有专属环境变量，不能只靠 HOME。**

## 验证

在测试里设覆盖变量后跑，断言目标文件落在沙箱内、真实家目录文件 mtime 未变。
反向验证：去掉覆盖变量再跑，应当写进真实目录（确认该测试真在测这件事）。

## 关联连接

- [[global-config-contaminates-projects]] — 全局单值配置污染项目的那个更大的坑
- [[resource-default-let-os-assign]] — 同类：全局资源该让 OS 分配而非写死
