# abs — agent-brain-sync

**跨会话 AI 编码记忆。** 让 AI 会话不再「重开就失忆」：任务进度、经验、踩坑都落盘到项目里的 markdown 图谱，下一个会话开机能直接读回来。

- 图谱纯 markdown，放在项目根 `.brain/`，**可以进 git**，人和 AI 读同一份
- 多项目自动隔离：只在当前目录找 `.brain/`，不向上穿透
- 并发安全：CLI / MCP / hook 同时写不会互相覆盖

npm 包名 `@fanchao8609/agent_brain_sync`，全局命令 **`abs`**。

---

## 安装

```bash
npm install -g @fanchao8609/agent_brain_sync
abs install
```

`abs install` 会交互式让你勾选智能体；也可以直接指定：

```bash
abs install --agent pi            # 只装 pi
abs install                       # 全部: claude-code / codex / opencode / pi
abs install --agent pi --no-mcp   # 只装 hook + skill，不要 MCP
```

装了什么：

| 宿主 | hook | MCP | skill |
|---|---|---|---|
| claude-code | `~/.claude/settings.json` hooks | `mcpServers.abs` (stdio) | `~/.claude/skills/abs-agent-brain-sync/` |
| codex | `~/.codex/hooks.json` | config.toml `[mcp_servers.abs]` | `~/.codex/skills/` |
| opencode | `~/.config/opencode/plugins/abs.ts` | opencode.json mcp.abs | skills/ |
| pi | `~/.pi/agent/extensions/abs.ts` | extension 内桥接 | skills/ |

- **幂等**：重复安装 = 更新，写入前自动备份
- **共存**：追加式合并，不会顶掉你这个事件上的其它 hook
- 装完**重启宿主**才生效

从源码跑（开发用）：

```bash
git clone <repo-url> && cd agent_brain_sync
npm install && npm link        # 之后全局就有 abs
```

---

## 怎么用

### 项目里开一次

```bash
cd 你的项目
abs init          # 建 .brain/ 图谱，只需一次
```

### 日常命令

```bash
abs load                       # 开机读状态（路线 + 看板 + 最近流水）
abs todo                       # 看板 Today / In Progress / Blocked / Done

abs todo add     TASK-1 --note "要做什么"
abs todo note    TASK-1 --note "改到 X 文件 L40"   # 实时断点
abs todo blocked TASK-1 --note "卡在哪"
abs todo done    TASK-1

abs note "一句话经验" --tags 坑,docker    # 经验暂存 → sources/
abs log "完成 X"                          # 记一行流水；abs log 无参 = 查看
abs query <词>                            # 检索图谱（多词 OR）
abs status                                # 当前项目 + 图谱概要
abs lint                                  # 体检：死链/孤岛/超尺寸/堆积
abs rule                                  # 列出 index.md 的 ## Rules 硬规则
abs rule add "一句话"                     # 追加一条硬规则（违反会丢数据/静默失效级的）
abs config show                           # 查看使用者姓名（标记作者用）
abs config set user <名字>                # 设置作者名 → ~/.abs/config.json
abs todo archive                          # 归档 Done 区旧日期组（默认留近 3 天）
abs update                                # 升级到最新版并刷新四宿主 hook/skill
```

> `abs todo start` 与 `abs todo add` 等价（都登记任务）。
> 旧版 `abs task ...` / `abs board` 已改名，会报错并提示新写法。
> `abs wrapup` / `abs teardown-check` 是 hook 内部命令，无需手动调用。
> **升级后分区名自动归一**：`abs load` 每次都会顺手核对 `index/log/todo` 三文件结构，旧的英文/中文分区名（如 `## 当前路线 (Roadmap)` → `## Roadmap`、`# 🗂 图谱索引` → `# 🗂 Graph Index`）会被自动改回标准；缺分区自动补建，无头文件只提醒不自动改。

### 工作流

- **hook 自动**：宿主生命周期事件写技术流水到 `~/.abs/log/`
- **实时层（你/AI 手动）**：任务和经验在边界处立刻用 `abs todo` / `abs note` 落盘
- **收尾层**：`abs wrapup` 在 Stop 时快照未完成任务；下个会话开头对账 todo、沉淀经验、修 index

---

## 更新

```bash
abs update
```

查 npm 最新版 → 升级 → 自动重刷四个宿主的 hook/skill（hook 里烧的是绝对路径，升级后必须重装，`abs update` 帮你做了）。完事重启宿主。

手动方式：

```bash
npm i -g @fanchao8609/agent_brain_sync@latest
abs install    # 重新刷 hook/skill
```

> ⚠️ 改完源码（尤其 `skill/SKILL.md`、`src/`）后**必须 `abs install --yes` 重扇出**，否则宿主还在跑旧副本 —— 版本号与代码会脱节。发布用 `npm version patch`（自动打 tag），别手改 `package.json` 的 version；发布后 `npm view` 有缓存延迟，必要时 `npm cache clean --force` 再验。

---

## 卸载

```bash
abs uninstall                      # 全部宿主
abs uninstall --agent pi           # 只卸 pi
npm uninstall -g @fanchao8609/agent_brain_sync
```

只删 abs 自己装的条目，**保留其它共存 hook**。

**注意**：卸载**不会**删项目里的 `.brain/`——那是你的知识资产，要删自己 `rm -rf .brain`。

---

## 开发

```bash
npm test           # 全部单测（node:test，零外部测试依赖）
npm run pack:check # 预览 npm 发布产物
```

## 目录

```
agent_brain_sync/
├── bin/abs.js      CLI 入口
├── bin/mcp.js      MCP server (stdio)
├── src/index.js    图谱定位（只认当前目录的 .brain/）+ 全局技术日志目录
├── src/lock.js     并发写保护（原子锁 + 排队 + SKIP）
├── src/todo.js     todo.md 分区读写
├── src/store.js    CLI 命令实现
├── src/hosts.js    四宿主接入定义
├── src/install.js  安装/卸载（分区共存合并）
├── src/userconfig.js  使用者姓名配置（作者标记）
├── src/wrapup.js   Stop 收尾快照/归档
├── hooks/event.sh  hook 模板
├── skill/SKILL.md  技能（装到各智能体）
└── test/           单测
```

MIT
