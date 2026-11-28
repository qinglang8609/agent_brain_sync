---
tags: [concept, sleep, 设计, 方案]
id: abs-sleep-offline-consolidation
author: fanchao
updated: 2026-11-27
status: active
layer: 4
anchors: []
---

# 概念：abs sleep 的离线整理方案（只有方案，没实现）

## 状态
2026-11-08 写下，**未实现**。方案全文在仓库 `docs/sleep-design.md`。

## 方案要点
- 夜里离线跑，不在会话里做
- 补空：把空着的会话页补上
- 压缩会话页、把可复用的提炼成概念页
- 墓碑遗忘：不再有用的内容留墓碑而不是直接消失
- 默认 dry-run（先看会改什么，再真改）
- 保留期 7 / 30 / 90 / 180 天四个档位，**尚未拍板**

## 判断据
这里只记「有过这个方案、它没落地、卡在保留期档位没定」——
不要把它当成已存在的命令去用（`abs sleep` 当前不存在）。

## 做完怎么确认
`abs sleep --help` 报未知命令 = 还是未实现；`docs/sleep-design.md` 末尾写着
「保留期 7/30/90/180 待拍板」= 档位没定。两条都变了才说明它真落地了。

## 关联连接
- [[fanchao]] — 记录者
