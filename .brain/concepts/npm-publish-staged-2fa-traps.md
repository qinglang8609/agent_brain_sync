---
tags: [concept]
id: npm-publish-staged-2fa-traps
author: fanchao
updated: 2026-11-18
status: active
---

# 概念：npm 发布的两个静默坑 —— staged publishing 与缓存旧包

## 触发场景
`npm publish` 打印成功、`npm view` 也看得出东西，但装上去的仍是旧内容；
或者发布返回 202 而不是 201，卡在等 2FA 证明。

## 坑一：首次发布新包名返回 `202 Accepted`（2026-10-09 实踩）
发布流程本身见 [[publish-pi-package-to-npm]]，本页只记这两个要命的坑。

**最重要的坑（2026-10-09 实踩）**：**npm 首次发布新包名返回 `202 Accepted`，不是 201** ——
卡在 **staged publishing 等 2FA 证明**。终端警告 `tokens that bypass 2FA are being restricted`；
`~/.npmrc` 里的 `_authToken` 正是被限制的方式。修法：`npm login --auth-type=web`（浏览器 2FA）后再发。
此时 `npm view` 看到的是占位包 `0.0.0-stage`，**别慌**，正式发布后会被取代。
若重发报 `409 Cannot publish over previously staged version`，换版本号绕：`npm version patch && npm publish`。

**2026-11-08 发 1.2.1/1.2.2 又踩一遍，另加两条**：

1. `npm publish` 打印 `+ pi-capsule-tools@1.2.1` **不代表真的上了 registry**。
   `curl registry.npmjs.org/pi-capsule-tools` 看 `versions` 和 `time.modified` 才算数。
   第一发卡 staged，几分钟后再发 409，换 1.2.2 绕过去；两个版本内容一致。
2. `pi install npm:pi-capsule-tools` 可能装到**旧内容的缓存包**（package.json 还是 1.2.0，
   md5 是旧源码），即使 registry 上 latest 已经是新版本。修法：
   `pi remove` 后 `npm cache clean --force`，再 `pi install npm:pi-capsule-tools@<明确版本>`，
   装完 **md5 对一下工作树**。别只看 `pi list` 有这一条。

## 验证
```bash
curl -s registry.npmjs.org/<包名> | jq '.versions | keys'      # 新版本号在里面才算上了
pi remove npm:<包名> && npm cache clean --force
pi install npm:<包名>@<明确版本>
md5 ~/Code/<某处>/<文件> ~/.pi/agent/npm/node_modules/<包名>/<文件>
```
判据三条同时成立才算发成功：registry 的 `versions` 里有新版本号、装版文件 md5 与工作树一致、
扩展真被加载（见 [[installed-pi-package-check]]）。只有 `pi list` 里能看到这一条**不算**。

## 关联连接
- [[publish-pi-package-to-npm]] — 包配置与发布流程本身
- [[installed-pi-package-check]] — 装上去之后怎么体检它真的加载了
- [[git-proxy-troubleshooting]] — 走代理推代码时的排查顺序
- [[fanchao]] — 本页沉淀者
