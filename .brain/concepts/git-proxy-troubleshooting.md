---
tags: [concept]
id: git-proxy-troubleshooting
author: fanchao
updated: 2026-10-19
status: active
---

# 概念：git push 走代理失败的排查顺序

## 触发场景
`git push` / `git clone` 报连不上、超时，而机器上配了代理（`http.proxy` 或 `http_proxy`）。
典型现象是 `Failed to connect to 127.0.0.1 port 1082`。

## ❌ 表现
重试无效，或者「curl 明明能通」但 git 不通，容易被误判成网络间歇性故障。

## 🛠 解法
**根因分三种，排查顺序比重试更重要。**

**代理坑升级版（2026-10-10）—— 排查顺序比重试更重要**：

`git push` 报 `Failed to connect to 127.0.0.1 port 1082` 时，先分清是哪一种：

1. **代理根本没开**：`nc -z 127.0.0.1 1082` 不通。直接试直连：
   `git -c http.proxy= -c https.proxy= ls-remote origin HEAD`。
   若直连也超时（exit 124）→ GitHub 被墙，**这是外部阻塞，重试无意义**，别因此给用户报"间歇性失败"。
2. **换了代理地址但 git 不认**：`~/.gitconfig` 里的 `http.proxy` 是 **file 配置，
   优先级高于 `http_proxy` 环境变量** —— 所以 `http_proxy=... git push` 会被旧值覆盖，
   仍去连 127.0.0.1。必须用命令行覆盖（优先级最高）：
   `git -c http.proxy=http://新地址:端口 -c https.proxy=... push`。
3. **端口通但 git 连不上**：`nc -z` 成功、甚至 `curl -x` 能拿到 200，但 git 报
   `after 1 ms: Couldn't connect`。这是代理**不支持 CONNECT 隧道**（常用于只做 HTTP 转发的
   代理）。git 必须走 CONNECT，curl 不一定 —— **「curl 能通」不能证明 git 能通**。

> 教训：`nc -z` 只证明端口开着，不证明能当 git 代理用。判据要拿 git 自己的命令测。


## 验证
```bash
nc -z 127.0.0.1 1082                                                    # 端口是否开着
git -c http.proxy= -c https.proxy= ls-remote origin HEAD                # 直连能不能通
git -c http.proxy=http://新地址:端口 -c https.proxy=... push            # 换代理用命令行覆盖
```

判据：`nc -z` 只证明端口开着，**不证明能当 git 代理用**（还得支持 CONNECT 隧道）。
最终判据要拿 git 自己的命令测。

## 关联连接
- [[publish-pi-package-to-npm]] — 发布流程里遇到推代码失败的场景
- [[fanchao]] — 本页沉淀者
