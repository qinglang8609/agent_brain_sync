---
tags: [archive, task-memo]
id: log-2026-10-16-release-1.18.0-omp
updated: 2026-10-16
---

# 任务随手记：release-1.18.0-omp

━━ release-1.18.0-omp 的过程笔记（不上看板；任务结束后随 sessions 留存）
- 2026-10-16 18:59 任务: 发布 1.18.0 并推送远端。

为何发: 工作区 19 个文件未提交(上一会话 16:03 做的)，线上 npm 最新 1.17.2、本地 package.json 也还是 1.17.2。两批改动都未发布:
  1) omp 成为第 5 宿主: src/hosts.js 加 omp 定义; hooks/abs.omp.ts 新模板; src/install.js 加安装逻辑; bin/abs.js 帮助文本; README; test/{hosts,install,plugin-behavior}
  2) 断点任务修复: `↳ [ ] <id>` 从「静默死区」升级为一等任务(能 done/note/state、上面板); 涉及 src/todo/{common,structure,tasks,archive}.js + src/store.js + hooks/abs.pi.ts + test/store

版本号: 走 minor → 1.18.0(新宿主=新功能; 线上 1.17.2)

已核对: npm test 598/598 通过; npm run lint 0 错; 真机 ~/.omp/agent/extensions/abs.ts 已装(16:14); ~/.omp/agent/mcp.json 里 abs 已注册

步骤: 改 package.json version → commit → tag v1.18.0 → push → npm publish → abs update 刷新五宿主
- 2026-10-16 19:07 卡点(2026-10-16): push 失败 —— 代理 CONNECT tunnel failed 503。不是认证问题: 钥匙串已锁(-25308 非交互读不到凭证)，但你手动推也是 503；代理常驻在 127.0.0.1:1082 且 git 已配好指向它，是代理到 github 的隧道建不起来(节点/规则/上游问题)。SSH 路(22 与 443)也被代理拦断，走不通。

本地已就绪: commit 21b3ec1(feat omp+断点任务) / ebaf96a(release 1.18.0) / efc0aab(brain 清源); tag v1.18.0 已打; 领先远端 5 个提交; npm test 598/598; lint 0。

待执行(需代理恢复可直连 github): git push origin main && git push origin v1.18.0 && npm publish && abs update
