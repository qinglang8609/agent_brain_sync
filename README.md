# abs — agent-brain-sync 跨会话 AI 编码记忆

跨会话记忆的机械落盘：**hook 纯触发 → CLI/MCP 读写 → markdown 图谱（`.brain/`，可进 git）**。
让每个会话不再无状态——经验/进度/踩坑有统一落点，重开不"失忆"。
参考 [ai-memory](https://github.com/akitaonrails/ai-memory) 的接入机制，砍掉全部重引擎。

> npm 发布名 `@fanchao8609/agent_brain_sync`（因 `agent-brain-sync` 已存在、相似名被 npm 拦截）；全局命令 `abs`（包名与命令名独立）。

## 架构

```
hook (宿主事件, 纯触发) ──▶ abs log (一行技术流水, fire-and-forget, 不阻塞)
agent (会话中)          ──▶ MCP (abs_load/abs_board/abs_task/…) ──▶ 读写 .brain/
人   (终端)             ──▶ abs CLI 同一套读写
```

- **唯一真源**: `<项目>/.brain/`（index/todo/log + concepts/entities/sources/syntheses/sessions）
- **多项目隔离**: 任何读写先从 cwd 向上找最近 `.brain/`（代码写死，MCP 无状态，各会话各归各位）
- **三层分工**:
  - **hook（机械层）**：宿主生命周期事件 → 只写技术日志（`~/.abs/log/`），不碰图谱 todo/log.md
  - **CLI/MCP（实时层）**：任务/经验实时落盘（`abs task start/note/blocked/done`、`abs note`）
  - **skill（自觉层）**：深提炼（sources→concepts）+ 收尾循环（详见 skill/SKILL.md）
- **并发写保护**: 所有 .brain 读改写经 `lock.editFile`（`open wx` 原子锁 + 排队等锁 + SKIP 哨兵），跨进程(CLI/MCP/hook)同写不覆盖丢更新

## 安装

### 方式一：npm 全局安装（产品模式，推荐）

```bash
npm install -g @fanchao8609/agent_brain_sync
abs install                    # 交互式选智能体（或 --agent 指定）
```

### 方式二：从源码（开发）

```bash
git clone <repo> && cd <repo> && npm install
node bin/abs.js install        # 或先 npm link 使 `abs` 全局可用
```

### 安装到宿主（hook + MCP + skill）

```bash
abs install                     # 全部: claude-code codex opencode pi
abs install --agent claude-code # 只装 Claude Code (MCP+hook+skill)
abs install --agent claude-code --no-mcp   # 只 hook+skill

abs uninstall --agent claude-code   # 卸载（只删 abs 装的，保留其它共存 hook）
abs uninstall                        # 全部
```

安装内容：
| 宿主 | hook | MCP | skill |
|---|---|---|---|
| claude-code | `~/.claude/settings.json` hooks（与 moshi-hook 等**共存追加**，不覆盖） | settings.json `mcpServers.abs` (stdio) | `~/.claude/skills/abs-agent-brain-sync/` |
| codex | `~/.codex/hooks.json` | config.toml `[mcp_servers.abs]` | `~/.codex/skills/` |
| opencode | `~/.config/opencode/plugins/abs.ts` | opencode.json mcp.abs | skills/ |
| pi | `~/.pi/agent/extensions/abs.ts` | extension 内桥接 | skills/ |

幂等：重复安装=更新；写入前自动备份；卸载只删 abs 的条目、保留其它共存 hook。

## 项目里用

```bash
abs init          # 项目根建 .brain/ 图谱（一次）
abs load          # 开机读状态（index 路线 + todo 看板 + 最近 log）
abs todo          # 看板（Today/Backlog/Blocked/Done）
abs task start   TASK-1 --note "做什么"        # 登记（幂等）
abs task note    TASK-1 --note "改到X文件L40"  # 实时断点（↳ 断点: 行，幂等）
abs task blocked TASK-1 --note "卡点原因"      # 碰壁移 Blocked
abs task done    TASK-1                        # 完成归位 Done
abs note "经验一句话" --tags 坑,docker          # 经验实时暂存 → sources/
abs log "完成X：…"   # 记一行工作成果流水；abs log 无参=查看 log.md
abs query <词>    # 检索图谱（多词 OR）
abs lint          # 图谱体检（死链/孤岛/超尺寸/堆积/index 漏列）
abs status        # 当前项目 + 图谱概要
```

实时化分工：**hook 自动记技术流水；任务/经验经 CLI/MCP 实时落盘（每个任务边界立即调）；
深提炼（sources→concepts）归收尾自觉层，工具不替你判断什么值得沉淀。** 详见 `skill/SKILL.md`。

## 核心能力

- **并发写保护（lock）**: `.brain` 是"读-改-整写回"，跨进程并发会互相覆盖。`src/lock.js` 用同目录 `.lock` 文件 `open('wx')` 原子抢占 + 排队等锁（预算 30s，指数退避）+ `SKIP` 哨兵，把 todo/index/log 的写串行化，避免丢失更新。
- **统一读写收口（brainio）**: `src/brainio.js` 提供 `readBrain / writeBrain / appendBrain / createBrainFile`——所有需读写 .brain 文档的地方统一走它，写自动带 lock 防并发（新代码遵循此入口）。
- **收尾自动化**: Stop 时 hook 在 `~/.abs/log/wrapup.log` 留 wrapup 提醒；下会话开头走"收尾循环"（对账 todo / 沉淀经验 / 修 index/log）。
- **多宿主共存**: install 分区合并追加，不会顶掉同事件的其它 hook（如 moshi-hook）。

## 开发

```bash
npm test          # 全量 110+ 单测（四层: CLI/install/MCP/hook + lock/brainio）
npm run pack:check  # 预览 npm 发布产物（files 白名单）
```

## 目录

```
agent_brain_sync/
├── bin/abs.js      CLI 入口
├── bin/mcp.js      MCP server (stdio, 官方 SDK, 窄工具面)
├── src/index.js    图谱定位（向上找最近 .brain/）
├── src/lock.js     .brain 并发写保护（原子锁 + 排队 + SKIP）
├── src/brainio.js  统一读写收口（readBrain/writeBrain/appendBrain）
├── src/todo.js     todo.md 分区读写
├── src/store.js    CLI 命令实现 (init/load/todo/task/log/query/lint/status/…)
├── src/hosts.js    四宿主接入定义
├── src/install.js  安装/卸载向导（分区共存合并）
├── hooks/event.sh  hook 模板（纯触发 → 技术日志 + Stop wrapup 提醒）
├── skill/SKILL.md  技能（安装到各智能体）
└── test/           单测（node:test，零外部测试依赖）
```
