---
tags: [concept, install]
updated: 2026-09-09
status: active
---

# 概念：abs 全局安装形态 = npm link 单一真源

## 触发场景
用户要"装到系统全局"，同时 hook/MCP 也需要稳定代码路径。

## 🛠 形态
1. `cd abs && npm link` → 全局 `abs` 命令（symlink 回开发目录，`npm unlink -g abs` 可撤）。
2. hook 脚本（`~/.abs/hooks/<agent>/`）烧死两条绝对路径：`NODE_BIN`（node 可执行）+ `ABS_BIN`（abs.js 绝对路径）——**不依赖 PATH、不依赖 exec 位**。
3. MCP 注册 `mcpServers.abs = { command: node, args: [abs.js] }`，同样绝对路径。
4. skill 拷贝到 `~/.claude/skills/abs-agent-brain-sync/`（内容快照，重装更新）。

## 关键点
全局命令、hook、MCP 三者经 realpath 汇聚到**同一份开发目录代码**——改代码即时全局生效，无需重装（重装只刷 hook 模板与 skill 快照）。
nvm 切 node 大版本时 NODE_BIN 失效 → 重跑 `abs install` 刷新。

## 知识冲突（演进）
本文的「npm link 单一真源」是**开发期**形态。**产品模式**已改为发布到 npm registry、`npm install -g @fanchao8609/agent_brain_sync` 正式全局装——hook/MCP 烧的绝对路径指向发布包而非开发目录。两者差异见 [[npm-publish-flow]]（坑 5：link 与发布包抢 bin）。hook 烧绝对路径、nvm 切换重装这两个机制在两种形态下**不变**。

## 共存：不覆盖宿主既有 hook（四宿主通病）
装 abs 前宿主可能已有别的 hook 框架（如 moshi-hook）。install **绝不能** `hooks[ev] = [abs]` 覆盖——那会顶掉别人。正确做法（Cl​aude/Co​dex 已实现）：
1. 读既有配置 → 按事件 `filter(entryHasAbs)` 去掉旧 abs 条目（幂等，重装不叠加）
2. `[...kept, { hooks: [{ type: 'command', command: script }] }]` 追加
3. uninstall 只删 abs 条目，**无共存才整删该事件**

### Co​dex hooks.json 形态坑（曾导致安装崩溃）
Co​dex 的 `~/.co​dex/hooks.json` 真实形态是**对象**：`{hooks: {EventName: [{matcher?, hooks:[{type,command}]}]}}`，与 Cl​aude `settings.json` 同形——**不是**扁平数组 `[{event, command}]`。按扁平数组写会在已存在的文件上 `cfg.hooks.filter is not a function` 崩溃。要点：
- 写前先读并**合并**（该文件可能已存在）；
- 碰到历史扁平数组形态要**迁移**成对象，不能丢弃（丢用户 hook）；
- **卸载侧必须同样处理两种形态**，否则对象形态的 hook 永远删不掉。

## skill 布局与代码版本必须同版本（半升级 = 两头都坑）
`skill/` 布局与读它的代码是一对，**分属两个版本就会静默失效**。1.8.2 只有写死的扁平
`skill/SKILL.md`；1.8.3 改为「每个含 SKILL.md 的子目录 = 一个 skill」并遍历发现（`ALL_SKILLS`）。
中间态（半升级）两种都坑：

| 形态 | 表现 | 为什么难查 |
|---|---|---|
| 旧代码 + 新布局（**实报**） | `ENOENT .../skill/SKILL.md` | 报的路径**当前版本里根本不存在** → 把人引去查源码白跑一轮 |
| 新代码 + 扁平旧布局 | `ALL_SKILLS = []` → **静默装 0 个 skill** | 一句不说；`readdirSync` 只看 `isDirectory`，`SKILL.md` 是文件被跳过 |

**根因**：目录布局与读取代码的改动没绑定在同一版本。判据 —— **改布局必须与改读取方同一个 commit**。

**修法**（1.8.4 起）：`ALL_SKILLS` 构建完**判空并显式报错**，带包版本 + 检测到的布局 + 修复命令。
『包内一个 skill 都没有』永远不是正常态。见 `src/install.js` 的 `ALL_SKILLS` IIFE 尾部。

**遇到该报错的处置**：`npm i -g @fanchao8609/agent_brain_sync@latest && abs install`（幂等，可安全重跑）。
旧版代码本身改不动，所以旧版只会照旧甩那个扁平路径 —— **守卫只治「新代码 + 旧布局」**。

## 自我管理命令必须齐全（install / uninstall / update / --version）

只做 `install`/`uninstall` 而漏了 `update`/`--version` 会直接坑用户：
用户的心智模型是“abs 自己管自己”，升级路径断了就只能自己知道去跑 `npm i -g`。
实际反馈：“在另一台机器上 update，没发现新版本” —— 根因是 **`abs update` 命令根本不存在**
（跑它输出 `未知命令: update`），**不是缓存/代理问题**。

`abs update` 正确行为：`npm view` 查最新 → 对比当前 → 有新版则 `npm i -g @latest`
→ **自动重跑 install 刷新四宿主 hook/skill**（hook 烧的是绝对路径+模板快照，不刷新就用不上新代码）；
网络/代理失败时给明确的手动命令，不要默默失败。

**诊断教训**：“命令看不到新版本”先分两类：**实现不存在** vs **数据/网络不对**。
先跑一遍那条命令看真实输出，再去查代理/缓存。

## 关联连接
- [[AgentBrainSync]] — 安装器实现（src/install.js）
- [[npm-publish-flow]] — 产品模式发布全流程（scoped 改名/2FA/link 清理）
- [[agents-skills-not-ownerless]] — skill 落点归属：~/.agents/skills/ 属 skills CLI，只读检测
- [[mcp-stale-paths-multi-store]] — MCP 注册的陈旧路径校正（外部 store 会盖过）
- [[silent-data-loss-diagnosis]] — 静默失效的通用识别法：先分清「没写入」还是「写了没人读」
