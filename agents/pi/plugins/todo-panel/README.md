# todo-panel

把当前项目 `.brain/todo.md` 的未完成条目画在 pi 编辑器上方，**只读不写**。

```
Todo (3) — fanchao · ☕ 靠咖啡续命
├─ [ ] [进行中] some-task — 干活中
│  ├─ [x] 子项做完了
│  └─ [ ] 子项还没做
└─ [~] [搁置] later-task — 以后再说
```

空看板时不显示（2026-11-06 用户定：一行占着编辑器上方是纯噪音）。

## 怎么装

它由 `abs install` 一起装到 `~/.pi/agent/extensions/todo-panel/`，装完 `/reload` 生效。
不想要就 `abs uninstall --agent pi`。

| 环境变量 | 作用 |
| --- | --- |
| `ABS_TODO_PANEL=0` | 关掉面板 |
| `ABS_TODO_PANEL_MAX=<n>` | 最多显示几条（其余显示 `+N more`） |
| `ABS_TODO_NICK=0` | 标题里不显示昵称 |
| `ABS_USER` / `~/.abs/config.json` 的 `user` | 标题里的作者名 |

## 为什么是独立扩展

2026-11-18 从 abs 主扩展（`abs.ts`）里拆出来的：这是纯 pi UI，别的宿主用不上；
混在主扩展里时，改面板要看 1300 多行的会话 hook，改 hook 又怕碰坏面板。

拆开后两边各管一摊：

| 谁 | 干什么 |
| --- | --- |
| `todo-panel`（本插件） | 只画面板：读 `todo.md`、`ui.setWidget`、按事件重绘 |
| `abs.ts`（主扩展） | 会话落盘、图谱维护、往 system prompt 注入看板与提醒 |

**解析逻辑两边各有一份**，不是偷懒：两个扩展装到 `extensions/` 下是彼此独立的目录，
跨目录 `import` 在装完就断了（同一理由见主扩展里 `parseChildLine` 的注释）。规则很短
（两步正则），两边测试都盖。

## 什么时候重绘

`render()` 拿不到 `ctx`，所以数据由事件回调喂进来：

| 事件 | 为什么需要它 |
| --- | --- |
| `session_start` | 首次绘制；顺带抽本次会话的随机昵称 |
| `tool_call` | 认出「刚调的是 `abs_task`」—— MCP 代理入口在 `tool_execution_end` 里只报 `mcp__abs`，认不出子工具名 |
| `tool_execution_end` | 标记在 → 重刷（此时 `todo.md` 已改完） |
| `turn_end` | 兜底（每条 assistant 消息都触发，约 4 秒一次） |
| `thinking_level_select` | 面板主色跟推理档位走 |

**隐藏面板时必须自己 `requestRender`**：重绘没有定时器兜底，少一处就静默冻结在旧帧
（2026-10-05 实报：任务全标完后面板不消失，要按 ESC 或重启才正常）。

## 已知限制

- **不做任何写入**。面板是纯展示层，不建第二套状态，也不自动登记任务。
- **作者过滤已取消**（2026-11-16）：`who` 参数留着只为兼容调用方，现在谁的未完成条都显示。

## 测试

`data/test/plugin-behavior.test.js` 里的「pi 扩展 todo 面板 解析与渲染」一组，
覆盖解析（作者/子项归属/已完成过滤/宽度截断）、渲染（树线、四态标记、配色回落）、
重绘（清空后隐藏且仍请求重绘）、档位色接线。走 `npm run test` 即可。
