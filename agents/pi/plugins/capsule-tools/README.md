# pi-capsule-tools

把 pi 的工具调用渲染成**一行绿色胶囊**，`ctrl+o` 展开/折叠。

```
▸ bash   git status --short                                                    12ms
▸ read   src/index.ts:1-50                                                    3ms
▸ edit   src/foo.ts  +12 -3                                                   41ms
▸ bash   npm test  failed                                                     4.2s
```

整个工具块带绿色背景（失败转红底），由 pi 自己的 `toolSuccessBg`/`toolErrorBg` 上色，
跟随主题。行尾右对齐显示**耗时**，运行中的调用没有这个标签。

展开后（`ctrl+o` 或点击）分两层：先命令，再结果。

```
▸ bash   git status --short      12ms
命令
  git status --short
结果
   M src/foo.ts
  ?? src/bar.ts
```

第一行是调用行（pi 单独渲染），结果行只给正文 —— 早期版本结果行又画了一遍胶囊头，
展开后同一份命令会出现两次。

折叠态一行只占一个终端行，长的 bash / read 输出不展开就不占地方。

## 安装

**跟着 abs 一起装，不要单独 `pi install`。**

```bash
abs install --agent pi     # 把 capsule-tools.ts 写到 ~/.pi/agent/extensions/
abs uninstall --agent pi   # 一并删掉
```

装完 `/reload` 或重启 pi。改完源码重跑 `abs install` 就覆盖了（幂等）。

**为什么不再走 `pi install`**：那条路会在 `~/.pi/agent/settings.json` 的 `packages` 里
留一条指向本仓库的包记录（pi 存成相对路径），仓库一挪就失效。本插件隶属于 abs，
装与卸都走 abs 一条命令更省心。

**两条路只能选一条。** 两份同时加载会让**每个工具调用出现两层胶囊** ——
pi 按包身份与扩展路径分别去重，`~/.pi/agent/npm/node_modules/` 下的包和
`extensions/capsule-tools.ts` 是两个来源。从 npm 版切过来时先卸旧的那份：

```bash
pi remove npm:pi-capsule-tools        # 之前用 npm 装过就卸掉
abs install --agent pi                # 再由 abs 装上
```

### 想从 npm 装已发布版本

```bash
abs uninstall --agent pi          # 先清掉 abs 装的那份
pi install npm:pi-capsule-tools
```

这时装到 `~/.pi/agent/npm/node_modules/pi-capsule-tools/`。它和 abs 装的那份不能共存。

### 不要手工 cp

手工把 `capsule-tools.ts` 拷进 `~/.pi/agent/extensions/` 同样能跑，但那份副本没人管：
升级要自己记得覆盖，卸载要自己记得删。`abs install` 就是这件事的受控版本
（同一个位置、同一份内容，另外带上覆盖与卸载）。


## 覆盖范围

- **内置工具**：bash、powershell、read、edit、write、grep、find、ls —— 胶囊渲染。**执行逻辑完全不碰**。
- **context-mode**：`ctx_*` 全部胶囊渲染。`ctx_execute` 显语言 + 代码首行（给了 `file` 就显路径）；
  `ctx_search` / `ctx_batch` 显第一条并标 `+N`；`ctx_index` 显路径 / URL / 来源；
  `ctx_resume` 显 session 或 `#seq`；`ctx_purge` / `ctx_upgrade` 显目标或模式；
  `ctx_stats` / `ctx_doctor` 没参数，折叠行只留工具名。展开时 `命令` 段仍给完整参数（一行 JSON）。
- **MCP**：`mcp`（网关）和 `mcp__<server>`（命名空间/直连工具）—— 胶囊渲染，折叠行只放内层工具名（`abs_task`），报错时整行转红。pi-mcp-adapter 自己那套渲染会把调用参数和结果原文铺开，**报错时尤其长**，所以这里接管了它。展开时 `命令` 段给内层参数（一行 JSON）。
- **其他工具**（其他扩展的工具）：**不动**，保留它们自己的渲染。
- **think 折叠**：加载时如果用户 settings 里从没设过 `hideThinkingBlock`，补写成 `true`
  （think 默认折成一行，点击或 `ctrl+t` 展开）。已经设过的不动——手动关掉的不会被强行打开。
  写入对**下一次启动**生效；当前会话按 `ctrl+t` 立即折叠。

## 各工具显示什么

| 工具 | 头部 | 尾部 |
|---|---|---|
| `bash` | 命令首行 | `failed`（命令返回非 0 时） |
| `powershell` | 同 `bash`（pi 里两者共用一套渲染） | `failed` |
| `read` | 路径 + `:起-止` 行号 | — |
| `edit` | 路径 | `+新增 -删除`（从 diff 数） |
| `write` | 路径 | — |
| `grep` | 搜索模式 | — |
| `find` | 模式 / 路径 | — |
| `ls` | 路径 | — |
| `ctx_execute` | 语言 + 代码首行；给了 `file` 就显路径 | — |
| `ctx_search` | 第一个查询词，多了标 `+N` | `failed` |
| `ctx_batch` | 第一条命令，多了标 `+N` | `failed` |
| `ctx_index` | 路径 / URL / 来源 | `failed` |
| `ctx_resume` | session，其次 `#seq` | `failed` |
| `ctx_purge` | session / source / `project` | `failed` |
| `ctx_upgrade` | 模式 | `failed` |
| `ctx_stats`、`ctx_doctor` | 无参数，只留工具名 | `failed` |
| `mcp` | 内层工具名，其次网关动作（`status` / `install`…） | `failed` |
| `mcp__<server>` | 内层工具名（`abs_task`） | `failed` |

运行中会显示 `running…` / `reading…` 之类的状态尾；结束后状态尾让位给右对齐的耗时
（`12ms` / `1.2s` / `1m05s`，取自 pi 渲染上下文的 `durationMs`）。终端太窄放不下耗时就直接不画，
命令优先。

展开后正文固定两层：`命令` 段原样给出完整命令（头部那行是截断过的），`结果` 段给工具输出，
失败时这一段标题带上 `failed`。

### 运行中和失败时的动效

| 状态 | 头部箭头 | 工具名 | 命令 |
|---|---|---|---|
| 运行中 | `◐◓◑◒` 绿色转轮，90ms 一帧 | 紫 | 绿 |
| 完成 | `▸` 绿 | 紫 | 绿 |
| 失败 | `▸` 红 | 红 | 绿 |

转轮和胶囊同为绿色（`success`）—— 只有失败才换成红，所以红色一出现就只意味着出错，
不会与动效混淆。（早期版本把转轮做成青色 `accent`，和胶囊基调不一致，已改。）

字形原来用盲文点阵 `⠋⠙⠹…`（U+28xx）。在 Herdr / 部分 macOS 终端上，盲文字符会掉进回退字体，
渲染宽度明显大于一格，整行每 90ms 抖一下。改成广泛支持的 `◐◓◑◒`，代价是只有 4 帧（原来是 10 帧）。

转轮只在工具真正运行期间转：结果一到（或报错）就停，箭头变回 `▸`，避免「冻住一半的转轮“看起来还在想”。失败只把箭头和工具名染红，命令保持绿色，红色才读得出是状态标记而不是整行变红。

实现上有两个容易踩的地方：

- 转轮组件通过 `ctx.state` 在 call/result 两行之间传递。`lastComponent` 是**按行分开**的（call 行和 result 行各一份），result 行根本看不到 call 行的组件，用它会得到一个永远不停的转轮。
- HTML 导出也会跑这套渲染器。导出的 `renderResult` 总是 `isPartial: false`，所以导出时转轮会被启动后立即停掉；一旦停表被写漏，每次导出的工具调用都会漏一个永远在跑的定时器。
- 背景色和 `renderShell: "self"` 的关系容易读反：pi 的默认外壳会给整个工具块套 `Box` + `toolSuccessBg` 背景，设成 self 反而会绕过它。这块绿底是 pi 外壳给的，扩展只画前景色（运行中转轮与命令为绿，失败时箭头和工具名转红）。
- 行被截断时 `truncateToWidth` 会插一个**完整 SGR 重置**（`\x1b[0m`）在 `…` 前面，这个重置连背景一起清掉，于是 `…` 往后就成了终端本色。修法是截断后把行背景（`theme.getBgAnsi("toolSuccessBg")`）重新贴回每个重置后面。这个坑只在命令长到要截断时才出现，宽终端下看不见。

## 发布

> **本目录没有自己的 git 仓库。** 2026-11-18 起本插件并入 abs（agent_brain_sync）仓库，
> 原来的 `.git` 已移除；GitHub 上的
> [pi-capsule-tools](https://github.com/qinglang8609/pi-capsule-tools) 仓库停在
> `232758f`（v1.3.1）不再更新。
>
> 它**不在 abs 的 npm 包里** —— 上一层仓库的 `package.json` 用 `files` 排除了本目录，
> 发布仍走本目录自己的 `package.json`。

```bash
npm version patch    # 自动打 tag —— tag 落在 agent_brain_sync 仓库，不在 pi-capsule-tools 仓库
npm run pack:check   # 预览产物（只应含 capsule-tools.ts + README.md）
npm publish
```

`keywords` 里的 `pi-package` 让包能被 [Pi 包画廊](https://pi.dev/packages) 发现。

发布后 `npm view` 有缓存延迟，必要时 `npm cache clean --force` 再验。

### 依赖约定

pi 自带 `@earendil-works/pi-coding-agent` / `pi-tui` / `pi-ai` / `pi-agent-core` / `typebox`，
所以它们必须放在 **`peerDependencies`**，**不能进 `dependencies`** —— 放进 dependencies 会物理拷一份、
绕过 pi 的扩展模块映射，产生重复的类与注册表。

## 测试

```bash
npm run check        # 全量
npm run typecheck    # tsc --strict
```

单独跑：

```bash
node --experimental-strip-types check.ts           # 宽度/折行/缓存
node --experimental-strip-types rows-check.ts      # 双行 bug + 工具名头
node --experimental-strip-types resolve-check.ts   # 渲染器真的接管了吗
node --experimental-strip-types real-data-check.ts # 用真实工具结果测
```

`resolve-check.ts` 是关键那个 —— 它按 pi 的方式走一遍解析器链，断言内置工具都落到胶囊渲染器上，
且未知工具正确透传。**「改了但没效果」这类回归只有它能拦住。**

注意它加载的是 **pi 实际装的那份**（`~/.pi/agent/npm/node_modules/`）。当那份不是当前工作区时，
它会打一行 `SKIP` 直接过 —— 那是为了不让旧安装卡住本地测试，**不代表跑过了**。

`real-data-check.ts` 用 pi 真实工具的 `execute()` 输出来断言。其余测试的结果对象都是手造的，
所以一旦胶囊读了 pi 根本不设的键（历史上读过 `details.exitCode` 和 `details.addedLines`），
**测试和实现会一起猜错、一直绿**。新加的显示逻辑请往这里加断言。

动效相关断言在 `animation-check.ts`，它真的 `await` 定时器：断言转轮会前进、会请求重画、结束后不再重画、失败时只有箭头和工具名变红，以及**通过 `ctx.state` 的交接**和**导出后不漏定时器**——后两条是拿真实解析器跑的，写错交接渠道会立刻被抓。

## 目录里的文件

| 文件 | 作用 |
| --- | --- |
| `capsule-tools.ts` | 主实现。npm 包里只有它和 README |
| `check.ts` / `rows-check.ts` / `resolve-check.ts` / `real-data-check.ts` / `animation-check.ts` | 自检脚本，作用见上一节 |
| `docs/plans/` | 当初发 npm 包、修审计问题时的方案，历史留档 |
| `package.json` | 包身份，只在从 npm 装时才用得上（`pi.extensions` 指向本目录的 `capsule-tools.ts`）。走 `abs install` 时不读它 |

## 性能

展开态正文在构造后不再变，所以换行结果按宽度缓存，同一宽度下重复渲染是零成本
（实测 200 行输出渲染 2000 次约 0.4ms，命中缓存）。折叠态的结果行直接返回一个共享的空组件，
不再每次新建 `Text` 并扫描整段输出。

## 已知限制

- **鼠标点击展开做不到（当前配置下）**。pi 的 regular 模式把鼠标事件交给终端，组件收不到点击。
  只有 `tuiMode: "fullscreen"` 才会把事件路由给组件（`MouseRegion`），代价是失去终端原生滚动回看。
- 展开/折叠用 pi 的 `expanded` 标志，当前绑在 **`ctrl+o`**。
