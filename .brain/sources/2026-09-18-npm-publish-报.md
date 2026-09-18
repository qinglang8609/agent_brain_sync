---
tags: [source, 坑, 发版]
id: 2026-09-18-npm-publish-报
author: fanchao
updated: 2026-09-18
status: draft
---

# 来源：npm publish 报 '+ pkg@ver' 后 registry 读到 404/E409 不等于发布失败：实测 1.9.4/1.9.5 均成功…

TITLE: npm publish 报 '+ pkg@ver' 后 registry 读到 404/E409 不等于发布失败：实测 1.9.4/1.9.5 均成功，只是传播延迟 1-2 分钟。E409 'Cannot publish over previously staged version' 的真意是「该版本已在发布飞行中」，正确动作是等，不是换版号。判据：等 60-90s 后查 tarball HTTP 码（200=已上传成功，只是还没进 versions[]），别信 npm 的退出码（E409 时它 exit 0）。我据错误推断连发 1.9.4/1.9.5/1.9.6 三个版号，浪费两个。

WHEN: npm publish 后立刻校验 registry、或见到 404/E409 想改版号重发时

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- npm publish 报 '+ pkg@ver' 后 registry 读到 404/E409 不等于发布失败：实测 1.9.4/1.9.5 均成功，只是传播延迟 1-2 分钟。E409 'Cannot publish over previously staged version' 的真意是「该版本已在发布飞行中」，正确动作是等，不是换版号。判据：等 60-90s 后查 tarball HTTP 码（200=已上传成功，只是还没进 versions[]），别信 npm 的退出码（E409 时它 exit 0）。我据错误推断连发 1.9.4/1.9.5/1.9.6 三个版号，浪费两个。
- 何时读：npm publish 后立刻校验 registry、或见到 404/E409 想改版号重发时

## 关联连接
- [[fanchao]] — 本页沉淀者
（提炼成 concepts 规律页后，在此挂双链到该页）
