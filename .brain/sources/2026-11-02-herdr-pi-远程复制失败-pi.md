---
tags: [source]
id: 2026-11-02-herdr-pi-远程复制失败-pi
author: fanchao
updated: 2026-11-02
status: draft
---

# 来源：herdr + pi 远程复制失败：pi 全屏模式强开鼠标跟踪(?1000/1002/1003)截走拖选事件，herdr 收不到，选中复制不触发。解法…

TITLE: herdr + pi 远程复制失败：pi 全屏模式强开鼠标跟踪(?1000/1002/1003)截走拖选事件，herdr 收不到，选中复制不触发。解法 tuiMode 改 regular + fullscreenCopyOnSelect=false，重启进程生效。附带坑：pi 进程跑在 SSH 远程但 SSH_CONNECTION 等被 herdr-core 剥光，pi 以为在本地，pbcopy 写进远程机剪贴板还报成功；PI_CLIPBOARD_OSC52=1 与 pbcopy 在 herdr 里都不通

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- herdr + pi 远程复制失败：pi 全屏模式强开鼠标跟踪(?1000/1002/1003)截走拖选事件，herdr 收不到，选中复制不触发。解法 tuiMode 改 regular + fullscreenCopyOnSelect=false，重启进程生效。附带坑：pi 进程跑在 SSH 远程但 SSH_CONNECTION 等被 herdr-core 剥光，pi 以为在本地，pbcopy 写进远程机剪贴板还报成功；PI_CLIPBOARD_OSC52=1 与 pbcopy 在 herdr 里都不通

## 关联连接
- [[fanchao]] — 本页沉淀者
（提炼成 concepts 规律页后，在此挂双链到该页）
