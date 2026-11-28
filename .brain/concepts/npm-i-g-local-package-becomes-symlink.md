---
tags: [concept, 发布, npm, 安装, 实测]
id: npm-i-g-local-package-becomes-symlink
author: fanchao
updated: 2026-11-27
status: active
layer: 4
anchors: []
---

# 概念：在仓库目录里 `npm i -g .`，全局装的是指向仓库的符号链接

## 触发场景
改完本地代码，想让本机命令用上它，顺手在仓库里跑 `npm i -g .`。

## 现象
全局包目录里落下的不是一份副本，而是一个指回仓库的符号链接，依赖也从仓库的
`node_modules` 解析。命令确实用的是新代码，但它不是「装好的独立包」——
仓库一挪、一删，全局命令就废；判断「装没装成功」时也容易被它骗过去（看起来一切正常）。

2026-11-27 实测（本仓库）：
```
~/.nvm/.../lib/node_modules/@fanchao8609/agent_brain_sync -> ../../Code/agent_brain_sync
stat -f "%i" 两个路径 → 103237101（同一个 inode）
```

## 做法
要一份真实的独立安装：先打包，再装包文件。

```bash
npm pack                      # 产出 xxx-2.2.0.tgz
npm i -g ./xxx-2.2.0.tgz      # 装的是副本，不是链接
# 或者直接装已发布的版本（tarball 传播到 registry 需要几分钟）
npm i -g <包名>@2.2.0
```

判据（装完就查）：`readlink -f $(which abs)` 落在全局 `node_modules/<包名>/` 里，
且它与仓库里同一文件**不是**同一个 inode。

## 关联连接
- [[fanchao]] — 记录者
