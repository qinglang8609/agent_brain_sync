---
tags: [concept, skill, 部署, 所有权, install]
author: fanchao
updated: 2026-09-13
status: active
---

# 别写 ~/.agents/skills/：它不是无主目录，是 skills CLI 的规范存储

## 触发场景
设计安装器「把 skill 扇出到各宿主」时，看到 `~/.agents/skills/` 下躺着一份内容相同的副本，
直觉判断"无主残留、可以清理/可以顺手覆盖更新"。**这个判断两头都错。**

## ❌ 表现
两种翻车方向：
1. **写进去** —— 绕过 lockfile 直接落文件，下次 skills CLI `sync` 会把它当野生副本覆盖/清掉，
   你以为装好了，实际被静默还原（典型 [[deploy-artifact-copies]] 形态）。
2. **删掉** —— 把别人的规范存储当成自己的残留副本清掉，破坏 skills CLI 的状态。

## 🛠 根因与判据
`~/.agents/skills/` 是 **skills CLI**（`npx skills`，状态在 `~/.agents/.skill-lock.json`）
的**规范存储位置**；各宿主的 `skills/` 目录只是它 **fan-out 的目标**。主从关系与直觉相反。

判"这是不是手工 cp 的残留副本"要看**三个证据**，缺一不可：
- `~/.agents/.skill-lock.json` 的 `skills` 字段**为空**（CLI 没认领它）
- 目录 mtime 与**某次 `abs install` 同秒**
- 内容与源**逐字节相同**

三者同时成立才是残留；否则那是 CLI 的地盘。

## ✅ 处置
- **只读检测 + 告警 + 给清理命令**，绝不代劳写入或删除。
- 与宿主无关的动作必须挂在 `runInstall` / `runUninstall` 层 —— 塞进某个宿主 installer 里，
  单宿主 install/uninstall 时会整段跳过（同 [[deploy-artifact-copies]] 的"多副本"教训）。

## 关联连接
- [[deploy-artifact-copies]] — 同族：产物多份、改一份不算改
- [[skill-rewrite-residual-old-methods]] — 重写 skill 时的同类残留（旧方法成悬空引用）
- [[abs-install-layout]] — 四宿主安装器与各落点路径
- [[mcp-stale-paths-multi-store]] — 同类：外部权威状态不止一处
- [[AgentBrainSync]] — 项目实体页
