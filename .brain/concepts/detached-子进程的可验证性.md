---
tags: [concept, hook, 验证, 子进程]
id: detached-子进程的可验证性
author: fanchao
updated: 2026-11-05
status: active
layer: 3
kind: gotcha
---

# detached 子进程要单独验：路径能调不等于会话关时会落

`spawn(..., { detached: true })` + `unref()` 的意思是「我退出后你还得活着把事做完」。
这个语义**不会因为命令本身能跑就自动成立**，得单独验一次。

## 触发场景

- hook 在会话关闭时 fire-and-forget 起一个子进程
- 你验证过「手工跑这条命令能成功」
- 于是认为功能可用

## ❌ 表现

2026-11-05 之前，会话页落页这件事只有三类证据：

| 证据 | 证明了什么 | 没证明什么 |
|---|---|---|
| 单元测试 | `cmdIngest()` 函数逻辑对 | hook 会不会调它 |
| hook 测试（假 abs 入口） | `session_shutdown` 里 spawn 了什么参数 | 真 abs 跑起来会不会成 |
| 手工跑那条命令 | 「这条命令能跑通」 | 父进程退出后子进程还活着吗 |

三类加起来仍然缺一环：**会话窗口真的关掉时，那个 detached 进程有没有把活干完。**

实测还踩到一次真失败：hook 12:23 装好、全局包 12:27 才重装，
12:24 那次真实关闭会话调的是一个当时不存在的命令 —— fire-and-forget 把错误全吞了，
日志里只有 `session_shutdown` 一行，没有任何失败痕迹。

## 🛠 怎么验

**照 hook 的做法原样跑一遍，包括 detached 和父进程退出。**

```bash
# ① 正常调用（证明命令 + 参数对）
node -e "
const { spawn } = require('node:child_process');
const c = spawn(process.execPath, [ABS, 'ingest','--auto','--session','abcd1111'], {
  cwd: PROJ, stdio: 'ignore', detached: true });
c.unref();
"
sleep 2 && ls $PROJ/.brain/sessions/

# ② 父进程立即退出（证明 unref 真的没把子进程带走）
node -e "
const { spawn } = require('node:child_process');
const c = spawn(process.execPath, [ABS, 'ingest','--auto','--session','dddd1111'], {
  cwd: PROJ, stdio: 'ignore', detached: true });
c.unref();
process.exit(0);        // ← 关键：不等子进程
"
sleep 2 && ls $PROJ/.brain/sessions/
```

两条都过，才算「关会话时它会落页」。

## 为什么这类证据容易漏

**fire-and-forget 的设计目标就是「失败也不影响主流程」**，所以它必然吞掉所有错误。
好处是不卡用户，代价是**失败和成功在日志上长得一样**。

判据：凡是 `stdio: 'ignore'` + `detached` + `catch {}` 的调用点，
都不能靠「没报错」推断成功。要么落盘留痕（本次是落出页本身），要么显式自检。

## 验证

```bash
# 实测 2026-11-05，两个场景都过
① 正常 detached 调用 → session-2026-11-05-sabcd1111.md
② 父进程立即退出   → session-2026-11-05-sdddd1111.md
```

## 关联连接

- [[npm-global-is-symlink]] — 同一轮的另一半：产物是拷贝还是软链，决定了改完要不要重装
- [[读改写要加锁]] — 姊妹页：子进程跑完了，它们写的数据还不能互相覆盖
- [[别用猜的用已有的标识]] — hook 传 sid 而非 --last，也是这条链路上的修复
- [[host-plugin-silent-failure]] — 装上≠加载≠触发的完整清单
- [[fanchao]] — 本页沉淀者
