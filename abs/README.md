# abs (agent-brain-sync)

跨会话记忆的机械落盘：**hook 纯触发 → CLI 读写 → markdown 图谱（`.brain/`，进 git）**。
Node MCP 提供窄工具面（定位项目 + 读/记状态）。参考 [ai-memory](https://github.com/akitaonrails/ai-memory) 的接入机制，砍掉全部重引擎。

## 架构

```
hook (宿主事件, 纯触发) ──▶ abs log (一行流水, fire-and-forget)
agent (会话中)          ──▶ MCP (abs_load/abs_board/abs_task/…) ──▶ 读写 .brain/
人   (终端)             ──▶ abs CLI 同一套读写
```

- **唯一真源**: `<项目>/.brain/`（index/todo/log + concepts/entities/...）
- **多项目隔离**: 任何读写先从 cwd 向上找最近 `.brain/`（代码写死，MCP 无状态，各会话各归各位）
- **hook 只写 log**，不写 todo（todo 由 agent/人主动登记，防刷屏）

## 安装

```bash
cd abs && npm install

# 交互式选择智能体（或 --agent 全装一个）
node bin/abs.js install                     # 全部: claude-code codex opencode pi
node bin/abs.js install --agent claude-code # 只装 Claude Code (MCP+hook+skill)
node bin/abs.js install --agent claude-code --no-mcp   # 只 hook+skill

# 卸载（只删自己装的）
node bin/abs.js uninstall --agent claude-code
node bin/abs.js uninstall                   # 全部
```

安装内容：
| 宿主 | hook | MCP | skill |
|---|---|---|---|
| claude-code | `~/.claude/settings.json` hooks (4 事件→`~/.abs/hooks/` 脚本) | settings.json `mcpServers.abs` (stdio) | `~/.claude/skills/abs-agent-brain-sync/` |
| codex | `~/.codex/hooks.json` | `~/.codex/config.toml [mcp_servers.abs]` | `~/.codex/skills/` |
| opencode | `~/.config/opencode/plugins/abs.ts` | `opencode.json` mcp.abs (local) | `~/.config/opencode/skills/` |
| pi | `~/.pi/agent/extensions/abs.ts` | extension 内桥接 | `~/.pi/agent/skills/` |

幂等：重复安装=更新；写入前自动备份（`.abs-bak-YYYY-MM-DD`）；卸载只删 abs 的条目。

## 项目里用

```bash
abs init          # 项目根建 .brain/ 图谱（一次）
abs load          # 开机读状态（index/todo/log）
abs board         # 看板
abs task start   TASK-1 --note "做什么"        # 登记
abs task note    TASK-1 --note "改到X文件L40"  # 实时断点（↳ 断点: 行，幂等）
abs task blocked TASK-1 --note "卡点原因"      # 碰壁移 Blocked
abs task done    TASK-1                        # 完成归位 Done
abs note "经验一句话" --tags 坑,docker          # 经验实时暂存 → sources/
abs query <词>    # 检索图谱（多词 OR）
abs lint          # 图谱体检（死链/孤岛/超尺寸/堆积/index 漏列）
abs status        # 当前项目 + 图谱概要
```

实时化分工：**hook 自动记 log 流水；任务/经验经 CLI/MCP 实时落盘（每个任务边界立即调）；
深提炼（sources→concepts）仍归收尾自觉层。** 详见 `skill/SKILL.md` 分工节。

或直接在会话里说："abs load"、"继续上次的任务"。

## 目录

```
abs/
├── bin/abs.js      CLI 入口
├── bin/mcp.js      MCP server (stdio, 官方 SDK, 5 个窄工具)
├── src/index.js    图谱定位（向上找最近 .brain/）
├── src/todo.js     todo.md 读写
├── src/store.js    CLI 命令实现 (init/load/board/task/log/status)
├── src/hosts.js    四宿主接入定义
├── src/install.js  安装/卸载向导
├── hooks/event.sh  hook 模板（纯触发 → abs log）
└── skill/SKILL.md  精简 skill（安装到各智能体）
```
