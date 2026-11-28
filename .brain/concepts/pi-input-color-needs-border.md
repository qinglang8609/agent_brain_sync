---
tags: [concept, pi, ui, 颜色, 实测]
id: pi-input-color-needs-border
author: fanchao
updated: 2026-11-27
status: active
layer: 4
anchors: []
---

# 概念：染 pi 输入框时，颜色要连边框一起染

## 触发场景
写 pi 扩展，想按状态给输入框上色（例如按推理档位换色）。

## 现象
只染文字等于没改：空输入框里没有文字，整行看起来跟没上色一样。
pi 的边框颜色来自主题的 `borderColor`，不是文本框自己画出来的——
所以光给文字换色，视觉上仍是旧色。

## 做法
走 `roundBorder` 那条整行重新上色的路径，把边框一起盖掉；
只改文字颜色不算改完。

## 验证
在**空输入框**上切换档位，看边框颜色有没有变——空框是这条规律的判据
（有字时文字色会掩盖问题）。

## 关联连接
- [[fanchao]] — 记录者
