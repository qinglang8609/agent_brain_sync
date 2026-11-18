# rounded-editor

pi 的输入框换成一个四角圆角、左右带竖线的框；右下角显示「上下文占用 / 上限 模型名 · 推理档位」。

```
╭─ ⠇ Working ──────────────────────────────────────────╮
│ 帮我把这个文件里的路径改掉                              │
│                                                      │
╰────────────────── 8.0%/1.0M deepseek-v4.1-flash · H ─╯
```

装好之后输入框下方的 footer 两行（路径/git/token、MCP/扩展状态）会被隐藏，信息压到右下角那一串里。

## 怎么装

它由 `abs install` 一起装到 `~/.pi/agent/extensions/rounded-editor/`（`index.ts` + `format.ts`
两个文件放同一个目录），pi 启动时按扩展目录加载。装完 `/reload` 或重启 pi 生效。

不想要它：`abs uninstall --agent pi` 会把整个目录删掉；只想临时关掉，就把
`~/.pi/agent/extensions/rounded-editor/` 移走 —— 它是纯样式，删了不影响 abs 的记忆功能。

**为什么必须是「目录 + index.ts」**：pi 会把 `extensions/` 下每个顶层 `.ts` 都当独立扩展，
并要求默认导出工厂函数。把纯函数文件平铺成 `format.ts` 会让 pi 启动直接报
`does not export a valid factory function`（2026-11-04 实报）。子目录只加载 `index.ts`，
helper 文件不参与扫描。

## 目录里有什么

| 文件 | 作用 |
| --- | --- |
| `index.ts` | 扩展入口：接管输入框组件、覆写 `render()`、订阅事件刷新状态 |
| `format.ts` | 纯格式化函数（边框、状态文本、宽度计算），不依赖 pi，可单测 |

## 实现要点

**为什么要覆写 `render()`**：pi 的 `Editor.render()` 只画上下两条 `─`，每行是「左 padding + 文本 + 右 padding」，
源码注释明写 `no side borders`。左右竖线要逐行拼，没有单独的钩子，只能接管整个 `render()`。

做法是调 `super.render(width - 2)` 拿到原结果（光标、滚动、自动补全原样保留），
再给上下边换圆角、给正文行两端各包一根 `│`。不复制 pi 的内部逻辑 —— pi 改光标或滚动时这里会自动跟住。

**颜色**：边框和框内文字都用 pi 给编辑器设好的 `editor.borderColor`（即原版那七档 thinking 色）。
这样 `/theme`、切档位、切 bash 模式时 pi 自己会换色并重绘，这里不用另建一套色表。

**working 状态为什么在上面框里**：`setEditorComponent` 的第四个参数传 `embedWorkingStatus: true`，
pi 会把 `⠇ Working` 和动画嵌进上边框 —— 就是 pi 原本的样子，这里不搬不改字。
（2026-11-09 定案；此前试过搬到右下角、正文最右列、右上角单字符，都被否了。）

**自动补全行不套竖线**：补全菜单排在底边之下、自带内容宽度，套上竖线会错位，所以原样透传。

## 右下角那串字怎么算

`format.ts` 的 `buildStatus(usage, modelId, level)` 拼出 `8.0%/1.0M 模型名 · H`：

- 百分比与上限来自 pi 的 `ctx.getContextUsage()`
- 模型名只留最后一段并去掉日期后缀（`deepseek/deepseek-v4.1-flash` → `deepseek-v4.1-flash`）
- 推理档位压成一个大写字母。不用首字母是因为 minimal / medium / max 三个都是 M：

| 档位 | off | minimal | low | medium | high | xhigh | max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 字母 | O | N | L | M | H | X | MX |

**什么时候刷新**：`render()` 拿不到 `ctx`，所以状态由事件回调维护。订阅的事件是
`turn_end`、`message_end`、`tool_execution_end`、`model_select`、`thinking_level_select`、
`session_compact`、`session_compact_failed`。

其中压缩那两个是 2026-11-16 补的：`/compact`、阈值触发、溢出恢复都会直接改掉上下文占用，
但它们既不是一轮对话结束、也不一定紧跟 `message_end` —— 少了这两个事件，压缩后右下角的
数字会一直停在压缩前的旧值，要等下一轮结束才对。

## 已知限制

- **光标色、输入框背景、聚焦外发光管不了**：那是 pi 在组件内部画的，扩展只能改自己拼出来的字符。
- **鼠标点击展开/聚焦做不到**：pi 的 regular 模式把鼠标事件交给终端，只有 `tuiMode: "fullscreen"`
  才把事件路由给组件。

## 测试

纯函数部分有单测：`data/test/pi-rounded-format.test.js`，覆盖模型名压短、token 短写、
档位字母、状态文本拼装、ANSI 宽度与圆角框宽度守恒。跑 `npm test` 即可。

`index.ts` 本身没有自动化测试 —— 它需要真 pi 运行时（`@earendil-works/pi-coding-agent`），
测试进程里没有这个包，这也是把纯函数抽到 `format.ts` 的原因。
