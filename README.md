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

**目前只支持 pi 一个宿主**（2026-11-18 起）。claude-code / codex / opencode / omp 的接入
曾经写完并跑通，已按用户要求从树里移除 —— 装到不用的宿主上只会往那边配置文件塞 hook/MCP 条目。

```bash
abs install                       # 装 pi
abs install --no-mcp              # 只装 hook + skill，不要 MCP
```

装了什么：

| 宿主 | hook | MCP | skill |
|---|---|---|---|
| pi | `~/.pi/agent/extensions/abs.ts` | `~/.pi/agent/mcp-adapter.json` `mcpServers.abs` | `~/.pi/agent/skills/` |

> **skill 规则**：`agents/shared/skills/` 下每个含 `SKILL.md` 的子目录 = 一个 skill，
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

pi 宿主额外多一层 UI：**编辑器上方常驻一块 todo 面板**，直接读当前项目 `.brain/todo.md`。

```
─────────────────────────────────────────────────
📋 todo (3) — fanchao · ☕ 靠咖啡续命
├─ [进行中] some-task ●●○ — 干活中
│  - [ ] agents/pi/hook/abs.pi.ts:120
├─ [滞留中] waiting — 等外部输入
└─ [进行中] another ●●● — …
```

- **只显示未完成**，Done 归计数不占位（数量在标题里）
- **按当前使用者过滤**：显示 `[[我]]` 的 + 没标作者的（老任务/手写），别人的不显示
- **子项（缩进的 `- [ ]`）挂在父任务下**；`├─` / `└─` 表结构
- **子项可各自勾选**：`  - [ ] 一句话` → `  - [x] 一句话`；全部勾上才能 `done` 父任务
- **「进行中」带三点动画**`○○○ → ●●○ → ●●●`（250ms/帧）—— 一眼看出哪条在跑
- **实时刷新**：我调 `abs_task` 后立即重画，不用等我讲完话
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
abs todo note    TASK-1 --note "改到 X 文件 L40"   # 追加一条子项（标准 md 嵌套列表，可多条）
abs todo child-done   TASK-1 [--n 2]             # 勾子项（n=第几条，缺省最后一条）
abs todo child-undone TASK-1 [--n 2]             # 取消勾（勾错了退回）
abs todo memo    TASK-1 "随手记一段（可多句，不上看板）"   # 任务笔记 → sessions/；无参=查看
abs todo state   TASK-1 --note "滞留中|讨论中|搁置|进行中"      # 改状态（记号写在复选框里）
abs todo state   TASK-1 --note "滞留中" --n 2                 # 改第 2 条子项的状态（子项也能标四态）
abs todo done    TASK-1

abs note "一句话经验" --tags 坑,docker    # 经验暂存 → sources/
abs log "完成 X"                          # 记一行流水；abs log 无参 = 查看
abs query <词>                            # 检索图谱（多词 OR 扫全 .brain/）；已被推翻的经验默认隐藏（--all 可看）
abs capture [--layer 1-6] [--kind …] "一句话"  # 按七层判层后落到位（L7 用 abs note；--kind: gotcha|decision|tradeoff|howto）
abs ingest --list                       # 列出还没落页的会话（只读，不写盘）
abs ingest <会话文件或 id>                 # 把一场 pi 会话摘要并进当天的 log-<日期>.md（## 会话 <id8> 段）
abs resolve <页名或id>                    # 反查页面路径（页改名后 id 不变）
abs supersede <页名> [--by <新页>]        # 标记经验已失效（不删文件，保留历史；query 默认不再返回）
abs status                                # 当前项目 + 图谱概要
abs lint                                  # 体检：死链/孤岛/超尺寸/堆积
abs rule                                  # 列出 index.md 的 ## Rules 硬规则
abs rule add "一句话"                     # 追加一条硬规则（违反会丢数据/静默失效级的）
abs config show                           # 查看使用者姓名（标记作者用）
abs config set user <名字>                # 设置作者名 → ~/.abs/config.json
abs todo restore [--dry-run]              # 把历史归档进 sessions/ 的任务全量拿回看板（一次性）
abs update                                # 升级到最新版并刷新 pi 的 hook/skill
```

> `abs todo start` 与 `abs todo add` 等价（都登记任务）。
> **看板结构（2026-11-16 起）**：`todo.md` 只有 H1 + 一条列表，不分 `## Todo`/`## Done`，
> 全部按时间倒序（未完成用认领日期、已完成用完成日期），最新的在最上面。
> 状态写在复选框里：`[-]` 滞留中 / `[+]` 讨论中 / `[~]` 搁置 / `[ ]` 进行中 / `[x]` 已完成。
> 已完成的行全部留在看板上，不再归档压缩；旧分区、旧日期分组、旧 `- [[log-日期]] 完成任务 N 条`
> 会在 `abs load` 或任意写操作时自动归一。
> **子项就是标准 Markdown 嵌套列表**：任务下缩进 2 空格的同形行，可多条、可各自勾选；
> 面板按缩进画树线。
> 旧版的 `↳ 断点:` 写法已在 1.20.0 移除；存量会在 `abs load` 或任意写操作时
> 自动迁移成标准子项（内容一条不丢），不需要手工改。
> 任务 id 不能含空格（用连字符），含空格会被明确拒掉。
> 旧版 `abs task ...` / `abs board` 已废，打它们会报「未知命令」并退出码 1。
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

查 npm 最新版 → 升级 → 自动重刷五个宿主的 hook/skill（hook 里烧的是绝对路径，升级后必须重装，`abs update` 帮你做了）。完事重启宿主。

手动方式：

```bash
npm i -g @fanchao8609/agent_brain_sync@latest
abs install    # 重新刷 hook/skill
```

> ⚠️ 改完源码（尤其 `agents/shared/skills/*/SKILL.md`、`code/`）后**必须重扇出**，否则宿主还在跑旧副本 —— 版本号与代码会脱节。脚本/CI 里跑 `abs install --yes`（只装 pi）。发布用 `npm version patch`（自动打 tag），别手改 `package.json` 的 version；发布后 `npm view` 有缓存延迟，必要时 `npm cache clean --force` 再验。

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

设计与规范在 [`docs/`](docs/README.md)（按功能分类，每份一件事）。

## 目录

```
agent_brain_sync/
├── code/                    核心实现，不知道“宿主”这回事
│   ├── index.js             图谱定位（只认当前目录的 .brain/）+ 全局技术日志目录
│   ├── store.js             CLI 命令聚合入口
│   ├── lock.js              并发写保护（原子锁 + 排队 + SKIP）
│   ├── lint.js              图谱体检（死链/孤岛/超尺寸/堆积；同类问题折叠计数）
│   ├── query.js             检索知识页（多词 OR）
│   ├── relevant.js          相关页推荐（按“当前在干什么”挑该读的页）
│   ├── codegraph.js         借本机 CodeGraph 取“代码影响面”，写回图谱
│   ├── hosts.js             宿主接入定义（唯一知道有哪几个宿主的地方）
│   ├── userconfig.js        使用者姓名配置（作者标记；占位名如 tester/foo 会被拒）
│   ├── wrapup.js            Stop 收尾快照/归档
│   ├── todo/                看板读写 + 格式闸门（每个文件管一件事）
│   ├── brain/               图谱装载与维护（init/load/ingest/layers/shape/rules/capture/maintain/summon）
│   └── install/             安装调度器（index.js）+ 宿主无关的共用层（shared.js）
├── agents/                  宿主相关
│   ├── shared/skills/<名称>/SKILL.md  技能（一份，将来多宿主也是同一份）
│   └── pi/                  pi：{hook} 扩展模板、{install} 安装逻辑、{ui} 样式、{plugins} 独立插件
│       └── plugins/rounded-editor/   圆角四边框输入框
│       └── plugins/todo-panel/       编辑器上方的 todo 面板
│       └── plugins/capsule-tools/    工具调用折叠胶囊（独立 npm 包，不进本包）
├── data/                    数据，不进 npm 包
│   ├── test/                单测（node:test，零外部测试依赖）
│   └── fixtures/            测试用的固定数据
├── bin/abs.js               CLI 入口
├── bin/mcp.js               MCP server (stdio)
├── scripts/                 构建期脚本（语法检查、SKILL 引用门禁、fuzz）
├── docs/                    长文档（索引见 docs/README.md，不进 npm 包）
└── .githooks/               pre-commit（语法+图谱 lint）/ pre-push（全量测试）
```

新增宿主：建 `agents/<宿主>/{hook,install}/`，在 `code/hosts.js` 登记事件与落点，
再在 `code/install/index.js` 的 `INSTALLERS` 表里挂上就完事 —— 不用改其它宿主的文件。

`agents/pi/ui/` 留给 pi 的前端样式（目前唯一的样式在 `agents/pi/plugins/rounded-editor/`，
它和扩展挂载是一个整体，没拆开）。

`agents/pi/plugins/` 下每个子目录是一个**独立的 pi 插件**，各自有 README。
`abs install` 会把它们全都装进 `~/.pi/agent/extensions/`：目录里有 `index.ts` 的装成子目录
（多文件扩展，只有 index.ts 是入口），有 `<目录名>.ts` 的装成单文件。新增插件只需建一个目录，
安装器与测试都按目录现读，不用改代码。

其中 `capsule-tools` 同时是单独发 npm 的包，`package.json` 的 `files` 已把它排除在本包之外 ——
改它别指望本包的版本号带出去。

MIT
