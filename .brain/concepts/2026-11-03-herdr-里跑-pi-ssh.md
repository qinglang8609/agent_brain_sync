---
tags: [concept, pi, herdr, 剪贴板]
layer: 3
kind: gotcha
author: fanchao
updated: 2026-11-03
status: active
---

# 工具：herdr 里跑 pi（SSH 远程）时复制失效：pi 全屏模式强开鼠标跟踪截走拖选事件。解法 tuiMode 改 regular。根因是…

TITLE: herdr 里跑 pi（SSH 远程）时复制失效：pi 全屏模式强开鼠标跟踪截走拖选事件。解法 tuiMode 改 regular。根因是 herdr-core 剥掉 SSH 环境变量，pi 误判本地会话，pbcopy 写进远程机剪贴板

## 记录
- herdr 里跑 pi（SSH 远程）时复制失效：pi 全屏模式强开鼠标跟踪截走拖选事件。解法 tuiMode 改 regular。根因是 herdr-core 剥掉 SSH 环境变量，pi 误判本地会话，pbcopy 写进远程机剪贴板

## 验证
- 实测：改 tuiMode=regular + fullscreenCopyOnSelect=false 后，用户确认拖选复制粘贴恢复。
- 根因证据：进程树 `sshd-session → herdr-core → zsh → pi`，但 pi 进程环境里 SSH_CONNECTION/SSH_CLIENT/MOSH_CONNECTION 全空（herdr-core 剥掉），故 pi 误判本地会话。
- OSC52 与 pbcopy 两条回退在 herdr 里都不通（实测粘贴不出），只能靠 herdr 自己的拖选复制。

## 关联连接
- [[fanchao]] — 本页沉淀者
- [[mcp-stale-paths-multi-store]] — 同族：安装路径/环境被宿主剥改后，工具误判自己所在处
