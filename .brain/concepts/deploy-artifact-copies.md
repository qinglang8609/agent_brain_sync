---
tags: [concept, 部署, 插件, hook, 双副本, 重启]
updated: 2026-09-10
status: reviewed
---

# hook/插件的部署产物：有三份，改一份不算改

## 触发场景
改了 hook 脚本或插件源码，测试全绿、`git commit` 完成，**但真机上行为一点没变**——
或者更糟：真机在跑一份你以为早就删掉的旧代码。

## 核心事实：产物有三份，彼此不联动

```
① 仓库源码            <repo>/src/install.js, hooks/event.sh
      │  abs install 渲染 + 拷贝
      ▼
② 宿主侧落点          ~/.abs/hooks/<agent>/abs-*.sh        (shell hook)
                      ~/.config/opencode/plugins/abs.ts      (TS plugin)
                      ~/.pi/agent/extensions/abs.ts          (TS extension)
      │  进程启动时读入内存
      ▼
③ 运行中的宿主进程    已加载的插件/hook 代码（内存快照）
```

另外还有**第四份**容易忘的：

```
④ 全局 npm 安装副本    $(npm root -g)/@fanchao8609/agent_brain_sync/
                      ← `abs` 命令实际执行的是这一份，不是 ①
```

## 本次两度踩坑（真实记录）

### 坑 1：`abs` 命令跑的是全局副本，不是仓库
仓库里新加了 `abs teardown-check`，但 `abs teardown-check` 报
`未知命令` —— 因为 `abs` 指向 `$(npm root -g)/...`，那是**独立的另一份拷贝**。

**后果**：在真机会话里测一份已修好的代码，却看不到任何变化，误以为修复无效。

**修法**：改完仓库后必须重新部署（`npm i -g .` 或 `abs install`），
否则你在验的是一个不存在的版本。

### 坑 2：删掉插件文件 ≠ 插件失效
`probe-oc.ts` 已从磁盘删除，但它**仍在每次 `session.idle` 注入消息** ——
因为正在运行的进程**启动时就把插件读进内存了**，磁盘没了照常执行。

**后果**：形成 idle 死循环（注入 → 新 turn → 再 idle → 再注入），
烧掉大量 token；排查时看到"文件已删却仍有行为"，极易怀疑人生。

**修法**：**重启宿主/服务**。删文件只影响下次启动。

## ✅ 部署检查清单
1. 改仓库 → 重新渲染到宿主落点（`abs install`）
2. 全局命令也变了 → 重装全局副本（`npm i -g .`）
3. 插件/hook 改动 → **重启宿主**（进程内存里的旧代码不会自己消失）
4. 验证时明确"我验的是哪一份"——**用绝对路径跑目标产物**，别靠 `PATH` 里的同名命令
5. 排查"行为异常但代码看着对" → 先确认 ② 和 ③ 是不是你以为的那一份

## 为什么这类坑特别贵
它**不报错、不崩溃**，只是"行为不变"或"行为诡异"，于是你会去怀疑逻辑、怀疑并发、
怀疑宿主机制——**方向全错**。和 [[silent-data-loss-diagnosis]] 同族：
证据（我在跑哪份代码）没确认之前，所有推理都建立在流沙上。

## 关联连接
- [[abs-install-layout]] — 四宿主安装器与各落点路径
- [[agents-skills-not-ownerless]] — skill 扇出的落点归属（别写 ~/.agents/skills/）
- [[mcp-stale-paths-multi-store]] — MCP 注册会被多个外部 store 盖过
- [[host-plugin-silent-failure]] — 装上≠加载≠触发（本页是它的"部署侧"兄弟）
- [[silent-data-loss-diagnosis]] — 同族：先确认事实，再推理
- [[opencode-inject-channel-verdict]] — 本次 probe 污染就是在该实验中被发现的
- [[AgentBrainSync]] — 项目实体页
