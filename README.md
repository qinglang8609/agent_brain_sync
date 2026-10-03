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
| pi | `~/.pi/agent/extensions/abs.ts` | `~/.pi/agent/mcp-adapter.json` `mcpServers.abs` | `~/.pi/agent/skills/` |

> **skill 规则**：`skill/` 下每个含 `SKILL.md` 的子目录 = 一个 skill，
> **目录名即安装名**（须与 frontmatter `name` 一致，否则 pi 会告警）。
> 新增 skill 只需建目录，无需改代码。

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

### pi：编辑器上的 todo 面板

pi 宿主额外多一层 UI（其它宿主没有）：**编辑器上方常驻一块 todo 面板**，直接读当前项目 `.brain/todo.md`。

```
─────────────────────────────────────────────────
📋 todo (3) — fanchao · ☕ 靠咖啡续命
├─ [进行中] some-task ●●○ — 干活中
│  ↳ 断点: hooks/abs.pi.ts:120
├─ [滞留中] waiting — 等外部输入
└─ [进行中] another ●●● — …
```

- **只显示未完成**，Done 归计数不占位（数量在标题里）
- **按当前使用者过滤**：显示 `[[我]]` 的 + 没标作者的（老任务/手写），别人的不显示
- **断点行 `↳` 挂在父任务下**；`├─` / `└─` 表结构
- **「进行中」带三点动画**`○○○ → ●●○ → ●●●`（250ms/帧）—— 一眼看出哪条在跑
- **实时刷新**：我调 `abs_task` / `abs_board` 后立即重画，不用等我讲完话
- **上描边与输入框同色满宽**（主题色 `thinkingOff`，跟 pi 输入框的边框一致）
- 窄终端按显示宽度截断（CJK 计 2 列），不溢出

**每次启动随机昵称**（132 条，附在作者名后）—— 每次打开 pi 换一条；池子分三批：
日常作息吃喝摸鱼 / 职场抱怨 / 自嘲（`编程全靠蒙`、`AI救我狗命`）。

| 环境变量 | 作用 |
|---|---|
| `ABS_TODO_PANEL=0` | 关掉面板 |
| `ABS_TODO_NICK=0` | 关掉随机昵称 |
| `ABS_TODO_GUIDE=0` | 关掉 system prompt 里的 todo 登记指引 |

> **设计取舍**：面板是**纯展示层**，只读 `todo.md` 不写任何东西，也不建第二套状态 ——
> 数据源就是 abs 自己的看板（磁盘文件，跨会话可续接）。所以没有折叠快捷键、没有依赖图，
> 只有 ~50 行渲染代码；对比 rpiv-todo 的 ~1800 行（它把状态存会话 transcript，新会话会丢）。
>
> 另一层是**触发指引**：扩展往 system prompt 的 Guidelines 段注入 3 条静态条目
> （动手前 `start` / 完成立刻 `done` / 断点及时 `note`）。这是**静态 prompt 内容**，
> 不是往对话里插消息 —— 本项目删过两次「插话式提醒」（会抢 turn 打断用户）。

### 项目里开一次

```bash
cd 你的项目
abs init          # 建 .brain/ 图谱，只需一次
```

### 日常命令

```bash
abs load                       # 开机读状态（Rules + 图谱计数 + 看板 + 最近流水）
abs todo                       # 看板 Todo / Done（行首带状态标记）

abs todo add     TASK-1 --note "要做什么"
abs todo note    TASK-1 --note "改到 X 文件 L40"   # 实时断点
abs todo state   TASK-1 --note "进行中|讨论中|滞留中"   # 改行首状态标记
abs todo done    TASK-1

abs note "一句话经验" --tags 坑,docker    # 经验暂存 → sources/
abs log "完成 X"                          # 记一行流水；abs log 无参 = 查看
abs query <词>                            # 检索图谱（多词 OR）；已被推翻的经验默认隐藏（--all 可看）
abs resolve <页名或id>                    # 反查页面路径（页改名后 id 不变）
abs supersede <页名> [--by <新页>]        # 标记经验已失效（不删文件，保留历史；query 默认不再返回）
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
> **作者名要填真的**：`tester` / `foo` / `aaa` 这类占位名会被拒 —— 因为 `{user}` 是全局单值，
> 填错会污染之后所有项目的 `[[作者]]` 标记（`aaa` 这类堆字也拒，但 `oo`/`ee` 这种两字母缩写放行）。
> `abs load` 对已落盘的占位名会给出警告，提示改回真名。
> **升级后分区名自动归一**：`abs load` 每次都会顺手核对 `index/log/todo` 三文件结构，旧的分区名（如 `# 🗂 图谱索引` → `# 🗂 Graph Index`）会被自动改回标准；缺分区自动补建，无头文件只提醒不自动改。

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

> ⚠️ 改完源码（尤其 `skill/*/SKILL.md`、`src/`）后**必须 `abs install --yes` 重扇出**，否则宿主还在跑旧副本 —— 版本号与代码会脱节。发布用 `npm version patch`（自动打 tag），别手改 `package.json` 的 version；发布后 `npm view` 有缓存延迟，必要时 `npm cache clean --force` 再验。

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
├── src/userconfig.js  使用者姓名配置（作者标记；占位名如 tester/foo 会被拒）
├── src/wrapup.js   Stop 收尾快照/归档
├── hooks/event.sh  hook 模板
├── hooks/abs.pi.ts pi 扩展模板（含 todo 面板 / 随机昵称 / 常驻指引）
├── skill/<名称>/SKILL.md  技能（每个子目录 = 一个 skill，装到各智能体）
└── test/           单测（400+，node:test）
```

MIT
