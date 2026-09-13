---
tags: [concept, mcp, install, 陈旧路径, 部署]
author: fanchao
updated: 2026-09-13
status: reviewed
---

# MCP 陈旧路径：只改自己写的那个文件不够

## 触发场景
换了安装路径（全局包取代 dev 目录、包改名、迁移目录）后，改了 abs 自己写的注册文件，
`abs install` 也重跑了 —— **但宿主仍按旧路径拉起 MCP**。

## ❌ 表现
注册"看起来对"（你自己那份写着新路径），实际跑的是别处的旧条目。无报错，只是行为不像新代码。

## 🛠 根因
`pi-mcp-adapter` 的 `hostConfigDiscovery` 会把 **9 个外部 store** 当权威读取：
`IMPORT_PATHS` + `AGENTS_GLOBAL_CONFIG_PATHS` + `GENERIC_GLOBAL_CONFIG_PATH`。
**其中任一处的 abs 条目指向旧路径，就会盖过 abs 自己写对的那份注册**——
先手权威 vs 后手权威，取决于读取顺序，不取决于谁写得对。

**判据：写入的"正确"不保证被读到；被读到的才算数。** 只改自己写的文件是漏的。

## ✅ 处置
1. 校正**所有会被读走的外部件**，不只自己写的那一个。
2. 校正逻辑挂 `runInstall` / `runUninstall` 层 —— 放进某个宿主 installer 里，
   单宿主 install/uninstall 会整段跳过，与宿主无关的动作就漏了。
3. 验证要看**宿主实际读到的值**，不是文件内容：
   ```bash
   # 逐处核对各 store 里的 abs 条目指向，而非只看 abs 写的那份
   grep -rn "agent_brain_sync\|abs" ~/.config/<adapter 相关 store>
   ```

## 关联连接
- [[agents-skills-not-ownerless]] — 同类：外部权威状态不止一处，且主从关系反直觉
- [[deploy-artifact-copies]] — "改一份不算改"的部署总则
- [[abs-install-layout]] — 四宿主安装器与落点
- [[AgentBrainSync]] — 项目实体页
