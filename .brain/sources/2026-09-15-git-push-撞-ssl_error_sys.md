---
tags: [source, git, 发布, 代理, 坑]
id: 2026-09-15-git-push-撞-ssl_error_sys
author: fanchao
updated: 2026-09-15
status: draft
---

# 来源：git push 撞 SSL_ERROR_SYSCALL 时先降级 HTTP/1.1，不是清代理：本次发布实测——①.ipconfig…

TITLE: git push 撞 SSL_ERROR_SYSCALL 时先降级 HTTP/1.1，不是清代理：本次发布实测——①.ipconfig 里代理在另一台机器(192.168.0.114)，本机多网段(.69/.150/192.168.2.1)，.git/config 里的 http.proxy 报 'No route to host' 但 curl 走同一代理 200，说明 git 的路由解析与 curl 不同；②清掉 .git/config 代理改用 HTTPS_PROXY 环境变量后能 ls-remote 但 push 仍 SSL_ERROR_SYSCALL；③真解是 -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 —— 强制 HTTP/1.1 绕过 HTTP/2 的 TLS 复用问题，push 立即成功。另：npm publish 后 registry 秒级查不到是正常的(服务端 staging，本次约50s)，重复 publish 会 E409 'Cannot publish over previously staged version'——这不是失败，轮询 dist-tags 等它上线即可，别慌着改版本号重发。

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- git push 撞 SSL_ERROR_SYSCALL 时先降级 HTTP/1.1，不是清代理：本次发布实测——①.ipconfig 里代理在另一台机器(192.168.0.114)，本机多网段(.69/.150/192.168.2.1)，.git/config 里的 http.proxy 报 'No route to host' 但 curl 走同一代理 200，说明 git 的路由解析与 curl 不同；②清掉 .git/config 代理改用 HTTPS_PROXY 环境变量后能 ls-remote 但 push 仍 SSL_ERROR_SYSCALL；③真解是 -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 —— 强制 HTTP/1.1 绕过 HTTP/2 的 TLS 复用问题，push 立即成功。另：npm publish 后 registry 秒级查不到是正常的(服务端 staging，本次约50s)，重复 publish 会 E409 'Cannot publish over previously staged version'——这不是失败，轮询 dist-tags 等它上线即可，别慌着改版本号重发。

## 关联连接
- [[fanchao]] — 本页沉淀者
（提炼成 concepts 规律页后，在此挂双链到该页）
