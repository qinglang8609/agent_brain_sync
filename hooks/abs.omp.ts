/**
 * abs (agent-brain-sync) — omp (oh-my-pi) extension。
 * 纯触发: 会话生命周期事件 → 技术日志一行 (~/.abs/log/hooks.log, ABS_LOG_DIR 可覆盖)。fire-and-forget。
 * 纪律: hook 事件只进技术日志, 不进图谱 log.md (log.md 只收工作成果沉淀, 与 event.sh 同纪律)。
 *
 * 与 hooks/abs.pi.ts 的关系: 本文件是**按 omp 实际 API 重写**的同功能扩展, 不是 pi 版的复制。
 * omp 与 pi 的差异（源码实地核对, 见 omp://extensions.md + agent-session.ts）:
 *   1. before_agent_start 事件只有 {prompt, images, systemPrompt: string[]}, **没有**
 *      systemPromptOptions.promptGuidelines。返回值 {systemPrompt?: string[]} 是**整体替换**
 *      (agent-session.ts:7867 setTurnSystemPromptOverride), 不是追加。
 *      → 故本文件必须「event.systemPrompt 基线 + 我们的段」拼接后整体返回。
 *      ⚠ 拼接而非重写基线: 基线含工具表/Rules/语境等宿主自己的内容, 丢一段就是静默失效。
 *   2. session_start 事件无 reason 字段 (pi 有 startup|reload|new|resume|fork) → 不再打 reason。
 *   3. agent_end 带 willContinue/awaitingAsyncWork —— 非终态 settle 之后还会继续,
 *      不能当"这轮真跑完"用于送达确认。
 *
 * 纪律同 pi 版（血泪教训, 别改回去）:
 *   已删除（2026-09-15）「写文件即任务开始 → 每轮注入登记提醒」; 已删除（2026-09-18）收尾注入。
 *   两次同一个根因: **往对话里插一句话本身就是设计错误, 不是频率问题**。
 *   故本文件**绝不调 sendUserMessage / sendMessage** —— 只改 system prompt 内容（静态段）。
 */
import type {
  ExtensionAPI,
  ExtensionContext,
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ToolCallEvent,
  ToolExecutionEndEvent,
  TurnEndEvent,
  AgentEndEvent,
  SessionStartEvent,
  SessionShutdownEvent,
  ExtensionUIContext,
} from "@oh-my-pi/pi-coding-agent"
import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"

// abs CLI 路径。安装时替换为 stableBinPath（全局优先），
// 但允许 ABS_BIN_PATH 覆盖 —— 测试需隔离到沙盒副本，开发机也可能同时有多份。
const ABS_BIN = process.env.ABS_BIN_PATH || "@@ABS_BIN@@"

/** 日志写入串行队列。
 *
 * 为何需要（2026-10-07 实测，pi 版同款）：logHook 是 fire-and-forget 且会并发调用，
 *   而「检查大小 → 重命名 → 写入」跨 await，两个并发调用会交错并**静默吃掉旧日志**。
 *   同族坑见 .brain/concepts/guard-check-then-set-across-await.md。
 * 修法：整段「轮转 + 写入」排进一条 promise 链，同一时刻只跑一个。 */
let logChain: Promise<void> = Promise.resolve()

async function logHook(evt: string): Promise<void> {
  const dir = process.env.ABS_LOG_DIR || join(homedir(), ".abs", "log")
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const stamp = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())
  const line = "[" + stamp + "] omp:" + evt + "\n"
  // 排队：前一步出错也不断链（catch 掉再继续），否则后续日志全丢。
  logChain = logChain
    .catch(() => {})
    .then(async () => {
      await mkdir(dir, { recursive: true })
      const file = join(dir, "hooks.log")
      await rotateIfTooBig(file)
      await appendFile(file, line)
    })
  return logChain
}

/** 日志轮转：hooks.log 是 append-only 热路径，无上限会无限长。
 *
 * 为何需要（pi 版 2026-10-07 实测）：轮转只写在 event.sh 里，而 omp/pi 走 TS 扩展这条路 ——
 *   **靠一个副本里的逻辑保护另一条路径，等于没保护**（实测日志已 1.22MB）。
 * 阈值与策略对齐 event.sh：ABS_LOG_MAX_BYTES 可覆盖；只留一份 .1。
 * 失败静默：轮转出任何错都不能弄坏日志写入本身。 */
async function rotateIfTooBig(file: string): Promise<void> {
  try {
    const max = Number(process.env.ABS_LOG_MAX_BYTES || 1048576) // 1 MiB
    const st = await stat(file)
    if (!(max > 0) || st.size <= max) return
    await rename(file, file + ".1")
  } catch {
    // 首次运行（文件不存在）/ 权限不足 / 重命名失败：都不拦日志写入
  }
}

/** 会话 id（作自动登记的幂等键，一会话一条）。取不到返回空串 —— 那时不登记，
 *  因为空键会让每条指令都"首次"，看板被刷爆。 */
function sessionIdFor(ctx: ExtensionContext): string {
  try {
    const id = ctx.sessionManager.getSessionId()
    return String(id || '').replace(/[^\w-]/g, '').slice(0, 16)
  } catch { return '' }
}

/** tool_call 事件的输入视图：`input` 是判别联合的窄类型，我们只按字符串键读几个字段
 *  （工具名随宿主 exposure 配置变，不能靠判别联合写死）。`in` 收窄后才取值。 */
function inputField(input: unknown, key: string): string {
  if (input && typeof input === 'object' && key in input) {
    const v = (input as Record<string, unknown>)[key]
    return typeof v === 'string' ? v : ''
  }
  return ''
}

/** 会改文件的工具名。用于判定「真的开始干活了」—— 排查类会话先跑一堆读命令，
 *  若用「第一次 tool_call」当判据，子项会被写在与任务无关的文件上。
 *  白名单必须按宿主实际用法穷举，漏一个就把功能静默关掉（含 bash：大量修改是经 bash 完成的）。 */
const WRITE_TOOL = /^(write|edit|apply_patch|patch|multiedit|notebookedit|bash|shell)$/i

/** bash 命令里没有写入迹象则不算「干活」—— 否则 `ls`/`git status` 也会记断点。 */
const BASH_WRITES = /(^|[^\w])(>|>>|sed\s+-i|tee\b|mkdir\b|rm\b|mv\b|cp\b|touch\b|cat\s*>)/

/** 这次 tool_call 是否算「真的动了文件」。 */
function isWriteCall(name: string, input: unknown): boolean {
  if (!WRITE_TOOL.test(name)) return false
  // bash 要额外甄别：只有带写入操作的命令才算
  if (/^(bash|shell)$/i.test(name)) return BASH_WRITES.test(inputField(input, 'command'))
  return true
}

/** 会话结束时快照当前项目滞留任务到 wrapup.log（detached fire-and-forget，wrapup 自身幂等去重）。
 *  cwd 用事件 ctx.cwd（当前项目），让 abs 在该目录定位 .brain/。 */
function snapshotWrapup(cwd: string): void {
  try {
    const child = spawn(process.execPath, [ABS_BIN, "wrapup"], {
      cwd: cwd || process.cwd(), stdio: "ignore", detached: true,
    })
    child.unref()
  } catch {} // fire-and-forget
}

/** 定位当前项目的 .brain/：只看 cwd 本身，不向上搜索（防爬到家目录图谱）。 */
async function findBrain(cwd: string): Promise<string | null> {
  const d = cwd || process.cwd()
  try { const st = await stat(join(d, ".brain")); return st.isDirectory() ? join(d, ".brain") : null } catch { return null }
}

// ---------------------------------------------------------------------------
// 模块级状态（不在工厂函数里）—— omp 工厂可能被重复调用（子会话 rebind 等），
// 闭包 flag 不共享；模块级在同一进程内只有一份。pi 版实测过「session_start 11 分钟触发 8 次」。
// ---------------------------------------------------------------------------
let agentEndSeen = false
let pendingTodoTool = false
let autoTaskSeen = false
const filesSeen = new Set<string>()
const FILES_SEEN_MAX = 8

/** tui/theme 在渲染回调里由宿主注入，omp 未导出其具体类型（`@oh-my-pi/pi-tui` 的 TUI 类
 *  与 theme 契约都只在渲染闭包内可用）。这里只声明我们**实际调用**的两个方法，
 *  比 `any` 精确：调错方法名会在编译期报错，而不是运行期静默失效。 */
interface RenderTui { requestRender?: () => void }
interface RenderTheme { fg: (color: string, s: string) => string }

/** 最近一次渲染拿到的 tui 引用。hidePanel 用它请求重绘 —— 面板消失时动画
 *  定时器已停，没有别的重绘通道（见 hidePanel 的坑注解）。 */
let lastTui: RenderTui | null = null

/** 会话边界重置埋点状态。
 *  不重置 → 同进程第二个会话继承 true 永久不留痕（pi 版 2026-09-13 实测过的坑）。 */
function resetThrottle(): void {
  agentEndSeen = false
  pendingTodoTool = false
}

/** 写类工具调用的文件路径：edit/write 直接取 input.path，bash 取命令里像路径的片段。 */
function touchedPath(input: unknown): string | null {
  for (const key of ['path', 'file_path', 'filename']) {
    const p = inputField(input, key)
    if (p.trim()) return p.trim()
  }
  const m = inputField(input, 'command').match(/(?:>>?|tee|sed -i[^ ]*)\s+([^\s|;&<>]+)/)
  return m ? m[1] : null
}

// ---------------------------------------------------------------------------
// todo 及时性：静态 system prompt 指引（omp 走「基线 + 段」整体替换通道）
// ---------------------------------------------------------------------------
// 与 pi 版的**分界线**（必须守住）：绝不 sendUserMessage —— 只改 system prompt 内容,
// 不新增消息、不抢 turn、不产生任何对话条目。历史两次注入（2026-09-15 / 09-18）都死于
// 「往对话里插话」, 与频率无关。用户知情后仍选择做静态指引, 理由: 「首轮一次性强提示」
// 这个形态确实没被试过。**不要因为「效果不理想」就反复改这几句** —— 要改的是机制。
//
// 关掉即设 ABS_TODO_GUIDE=0。
//
// 工具名**不能写死**（pi 版 2026-10-04 实报修正）：abs 走 MCP, 而 MCP 工具在模型侧的
// 名字随宿主的 exposure 配置变（代理入口 `mcp__abs` + tool 参数 / 直出 `mcp__abs__abs_task`
// / 直接 `abs_task`）。故写成「意图 + 名字规律」, 让模型按当前会话实际可见的形态自己挑。
const TODO_GUIDELINES = [
  'Use the abs task tool as soon as you receive instructions that involve changing this project — including investigation work where you read code or ask questions before any edit. Call it with action "start" and a short id before the work itself, not after. Skip it for pure questions about general knowledge, one-line answers, and conversation. (Tool name varies by host: `mcp__abs` with tool="abs_task", or `mcp__abs__abs_task`, or `abs_task` — use whichever form this session exposes.)',
  'Mark a task "done" immediately when it finishes — never batch completions at the end of a session.',
  'Before starting a task, record the checkpoint with action "note" (which file, which step) so a later session can resume.',
  'Never mark a task "done" when tests are failing, the implementation is partial, or an error is unresolved — keep it in progress and add a task for the blocker instead.',
  'Keep exactly one task in "进行中" at a time; when the user switches direction or drops a task, use action "state" with 搁置 (dropped/not doing it); 滞留中 for still-wanted-but-stuck; 讨论中 for still-open. If you finish one and another is ready, promote it explicitly.',
  'When completing, pick the honest conclusion via the `as` field: 落地 (built and verified) / 否决 (decided against, or built then reverted) / 仅方案 (designed only). A wrong conclusion makes the next session treat "considered" as "completed".',
  // 文档精简九条（用户 2026-10-22 定，原文见 skill 的「文档精简」一节）：管每一行写进 .brain 的文字。
  'Every line you write into .brain/ (todo rows, log rows, knowledge pages, session snapshots) must pass the nine-bullet doc-slimming rule in the abs skill: only what serves the topic (drop the rest), no unverified summaries, ordered and layered, plain declarative wording (no rhetorical questions, no guessing), no duplication (cite the other doc instead), terse prohibitions, nothing the user did not ask for, plain Chinese.',
]

/** 从 skill 里挑出的【硬规则】—— 只第一轮送, 与 load 同机会（同 pi 版方案 B）。 */
export const OPENING_RULES = [
  'This project has a .brain/ board. Before you touch any file or run any command for a task that changes this project, register it first with the abs task tool (action "start" + a short id). Read the first file only after that. A rough name is fine — the name can be fixed later, but an unregistered start cannot be recovered.',
  'Name it so it says what you are doing (e.g. fix-skill-trigger, oversize-exempt) — do not copy the user\'s wording; a greeting or a question is not a task name.',
  'Mark a task "done" as soon as that piece of work ends — do not batch. If you are more than two or three rounds in without a registration, you are already off the rails: register now.',
]

/** 段前缀 —— 用于每轮替换上一轮的旧段（内容会变, 不能用 includes 去重）。 */
const BOARD_MARK = '[看板] '
const LOAD_MARK = '[开工] '
const OPENING_MARK = '[开工规则] '
const SESSION_MARK = '[会话] '

/** 把当前看板拼成一段（对齐用）。
 *
 * 设计（用户 2026-10-05 定）：**只对齐, 不多说** —— 把「现在看板上有什么」摆在面前
 * 让 LLM 自己对照, 不写「记得登记」这类劝告（已证明会被忽略）。
 *
 * ★ 铁律（别改）：
 *   - **只用对齐, 不用技术手段替 LLM 发现 todo 问题。** 技术只负责「摆事实」。
 *   - **反复对齐, 不厌其烦**：不是一次性提示, 是**每一轮都摆**。别用节流去优化掉它。
 *   - **尺度：只说 todo.md 本身**。不夹带判断、不写劝告、不评价好坏。
 *   - **不做重任务**：不起进程、不 spawn、不写盘；只读一个本地文件。
 */
export function boardGuideline(md: string, who: string, touched: string[] = [], mySid = ''): string | null {
  const { total, rows } = parseOpenTasks(md, PANEL_MAX_ROWS, who)
  // 看板里有没有**任何**未完成条目（不分作者）。用来区分两种「过滤后为空」：
  //   没有 → 真的空看板（摆「空」这个事实 + 它是异常信号）
  //   有但都是别人的 → 不是我的看板（该静默, 别误导我去登记）
  const anyOpen = /^\s*- \[ \]/m.test(md)
  if (!total && anyOpen) return null
  const lines = rows.map((r) => {
    let tag = ''
    if (r.sid) tag = r.sid === mySid ? '[本会话] ' : `[会话 ${r.sid}] `
    const head = `  ${tag}${r.state ? `[${r.state}] ` : ''}${r.id}${r.desc ? ` — ${r.desc}` : ''}`
    // 子项带上（与面板同形），丢了等于对齐了也接不上
    if (!r.kids || !r.kids.length) return head
    return [head, ...r.kids.map((k) => `    - ${k.done ? '[x]' : '[ ]'} ${k.text}`)].join('\n')
  })
  const more = total > rows.length ? `  …另 ${total - rows.length} 条` : ''
  const touchLines = touched.length
    ? ['本会话改过:', ...touched.map((f) => `  ${f}`)]
    : []
  return [
    '当前 .brain/todo.md 看板（开工前对齐：正在做的算哪条？有新任务要加吗？有该删的吗？）:',
    // ★ 空看板不能只摆「（空）」——用户实报：看到「（空）」读成了「一切正常」,
    //   于是动手却没登记。故把事实说完整：本目录有图谱、但零未完成任务。
    // ⚠ 但**不得写劝告**（「请登记」「别忘了」）—— 只摆事实, 判断留给 LLM。
    ...(lines.length
      ? lines
      : ['  （空 —— 本目录有 .brain/ 图谱，但一条未完成任务都没有）']),
    ...(more ? [more] : []),
    ...touchLines,
  ].join('\n')
}

/** 本会话 id 摆给 LLM。为何：todo 行尾的 `(认领 日期 <sid>)` 需要 LLM 自己填,
 *  这样多会话并行时能看出哪条是谁在做。取不到 sid 时不注入（不写空值、不伪造）。 */
export function sessionGuideline(sid: string): string | null {
  if (!sid) return null
  return (
    `${SESSION_MARK}本会话 id = ${sid}。登记任务时带上它 —— ` +
    `MCP 工具：abs_task 的 session 参数；CLI：abs todo start <id> --session ${sid}。` +
    `任务行尾会记成 \`(认领 日期 ${sid})\`，这样多会话并行时能看出哪条是谁在做。`
  )
}

/**
 * 组装要返回的 systemPrompt：**基线 + 我们的段**（omp 是整体替换, 不是追加）。
 *
 * ★ 为何必须先剥旧段再接（不能用 includes 去重）：看板/load 的内容每轮会变,
 *   旧的快照若不删就会与新快照共存 → 对齐撒谎（LLM 看到已经不存在的任务）。
 * ★ 剥离只针对**我们自己打前缀的段** —— 绝不动基线里的任何一行。
 *   基线是宿主的完整 prompt（工具表/Rules/语境）, 丢一段就是静默失效。
 * 关掉即设 ABS_TODO_GUIDE=0（连同 board 段一起关）。
 */
export function buildSystemPrompt(
  base: string[],
  parts: { board?: string | null; load?: string | null; rules?: string | null; sid?: string },
): string[] {
  const guideOn = String(process.env.ABS_TODO_GUIDE || '') !== '0'
  const marks = [BOARD_MARK, LOAD_MARK, OPENING_MARK, SESSION_MARK]
  // 基线逐行保留；只丢掉「以我们前缀开头」的行（上一轮我们自己加的）。
  const kept = base.filter((line) => !marks.some((m) => line.startsWith(m)))
  if (!guideOn) return kept
  const added: string[] = []
  for (const g of TODO_GUIDELINES) added.push(g)
  if (parts.sid) {
    const sg = sessionGuideline(parts.sid)
    if (sg) added.push(sg)
  }
  if (parts.rules) added.push(OPENING_MARK + parts.rules)
  if (parts.board) added.push(BOARD_MARK + parts.board)
  if (parts.load) added.push(LOAD_MARK + parts.load)
  // 基线为空也不能返回空数组（那会清掉宿主 prompt）——理论上不会发生, 但返回 [] 是灾难性的,
  // 故空基线时原样返回 undefined 由调用方跳过（见 handler）。这里只保证「不会丢基线」。
  return [...kept, ...added]
}

// ---------------------------------------------------------------------------
// 面板（把 .brain/todo.md 的未完成任务显示在编辑器上方）
// ---------------------------------------------------------------------------
// 纯展示层：只读 todo.md, 不写任何东西。数据源就是 abs 自己的看板（磁盘文件, 跨会话可续接）。
// 关掉即设 ABS_TODO_PANEL=0。
const PANEL_KEY = "abs-todo-panel"
const PANEL_MAX_ROWS = 10

// 标题后缀昵称池（每次**启动会话**随机抽一条, 会话内保持不变）。
// 不能每帧随机（panel 每帧都重渲染, 那样会疯狂闪烁）。
const USER_NICKNAMES = [
  '🛌 昼伏夜出型', '😴 沾枕头就醒', '🌙 熬夜当修仙', '⏰ 闹钟十连败', '🧟 永远睡不醒',
  '☕ 靠咖啡续命', '🧋 靠奶茶续命', '🍚 干饭第一名', '🥘 吃辣只敢微辣', '🍳 炸厨房常客',
  '🥗 间歇性减肥', '🍜 深夜爱放毒', '🧊 冰镇式养生', '⌨️ 键盘上摸鱼', '🐟 划水大师',
  '💻 复制粘贴大师', '🚽 带薪上厕所', '🕕 到点就跑', '📅 明天再说吧', '🐷 坚决不加班',
  '😇 表面在微笑', '🤯 内心已掀桌', '💸 月月过路财神', '🏦 隐形负翁', '🤑 转发锦鲤求暴富',
  '📉 钱包越来越瘦', '🛒 购物车首富', '📱 网上冲浪选手', '🛸 意念回复专家', '📞 电话一响就慌',
  '🙈 已读绝不回', '🤝 只管埋头夹菜', '📝 收藏从不用', '📚 学了就忘', '🧠 记忆力七秒',
  '🔋 1%才去充电', '🛍️ 拆快递狂魔', '🧳 云旅游专家', '🏋️ 办卡只去洗澡', '🚶 步数常年垫底',
  '💇 秃飞猛进', '🏴‍☠️ 飞翔荷兰人', '🐌 蜗牛速度选手', '🦥 躺平专业户', '🎮 打完这把就睡',
  '🍿 吃瓜第一线', '🔍 搜索两小时', '🧩 爱钻牛角尖', '💤 梦里也在编程', '🚀 明早一定做',
  '🧘 边熬夜边养生', '📺 刷剧不眨眼', '🎧 单曲循环中',
  '🫠 靠不住选手', '🧯 专业背锅侠', '🪑 会议室钉子户', '📎 工具人本人', '🫥 存在感为零',
  '🥄 打杂一把好手', '🧮 人形Excel', '📋 需求搬运工', '🔧 万能补丁匠', '🗣️ 会议两小时',
  '💬 一言不合拉会', '📊 对齐一整天', '🌀 讨论没结论', '🎯 追需求成瘾', '📝 纪要孤儿',
  '🔥 排期永远紧', '⏳ 催到怀疑人生', '🌃 下班天已黑', '📆 周末待命', '🚨 临时插需求',
  '🧨 上线前改需求', '📈 汇报全靠编', '🎤 PPT大师', '🤡 背锅第一名', '🫡 收到马上办',
  '🙃 领导说得对', '👏 掌声最热烈', '🏓 甩锅乒乓球', '🙋 不背锅侠', '📮 抄送战斗机',
  '🧊 已读不回群', '🔕 消息免打扰', '🪫 电量剩5%', '🧓 入行即养老', '🫩 心力耗尽',
  '😮‍💨 叹气专业户', '🪦 激情已入土', '📤 简历常年挂着', '🧳 随时准备跑路', '💼 骑驴找马中',
  '🪙 谈薪谈不动', '🥲 涨薪等明年',
  '🎲 编程全靠蒙', '🙏 AI救我狗命', '🐛 Bug制造机', '🔮 玄学调参', '📿 面向祈祷编程',
  '🩹 补丁摞补丁', '🤞 能跑就行', '🗿 代码能跑别动', '🎰 随机数人生', '🧙 咒语背诵者',
  '📖 文档从不看', '⌨️ 只会复制粘贴', '🫠 菜得安详', '🥹 菜狗本狗', '🐣 刚会写Hello',
  '🧸 删库跑路预备', '🪫 脑子已关机', '🫥 假装很忙', '🎭 专业演技派', '🃏 气氛组组长',
  '🧊 情绪稳定到麻木', '🐟 摸鱼终身成就', '🛋️ 沙发项目经理', '📺 带薪看视频', '🍵 带薪养生',
  '💤 工位睡神', '⏳ 明日复明日', '🗓️ 周报最后写', '📉 进度条倒退', '🕳️ 坑是自己挖的',
  '🧨 技术债主', '💀 穷得响叮当', '📵 社交电池耗尽', '🍼 成年巨婴', '🪞 镜子前叹气',
  '🧦 袜子不成对', '🥲 笑着活下去',
]

/** 本会话的昵称 —— 模块级（工厂重复调用时闭包变量不共享）。空串 = 未抽（或 ABS_TODO_NICK=0 关掉）。 */
let sessionNickname = ''

/** 抽一条昵称。传 rnd 便于测试注入；默认 Math.random。关掉：ABS_TODO_NICK=0。 */
export function pickNickname(rnd: () => number = Math.random): string {
  if (String(process.env.ABS_TODO_NICK || '') === '0') return ''
  const i = Math.min(USER_NICKNAMES.length - 1, Math.floor(rnd() * USER_NICKNAMES.length))
  return USER_NICKNAMES[Math.max(0, i)]
}

/** 解析 todo.md 的 ## Todo 区 —— 只收未完成行（- [ ]），Done 区不计。
 *
 * who 不为空时只收「我的任务」：行内有 [[who]] 的，或**完全没标作者**的
 * （老任务/手写的没标，漏掉比多显示更糟）。标了别人的则不收。 */
export function parseOpenTasks(md: string, max = PANEL_MAX_ROWS, who = ''): {
  total: number
  rows: { state: string; id: string; desc: string; kids: { done: boolean; text: string }[]; sid: string }[]
  hidden: number
} {
  // 两阶段：先无过滤地按序解析（子项归属需要「上一条」是原文里真正的前一条），
  // 再按作者过滤。若边解析边过滤，被滤掉的条目下方的子项会挂到它上面那一条。
  type Row = { state: string; id: string; desc: string; kids: { done: boolean; text: string }[]; authors: string[]; sid: string }
  const parsed: Row[] = []
  let inTodo = false
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trimEnd()
    if (/^##\s+Todo\s*$/.test(line)) { inTodo = true; continue }
    if (/^##\s+/.test(line)) { inTodo = false; continue }
    if (!inTodo) continue
    // 子项行（标准 md：缩进的 `- [ ]`）→ 挂到上一条任务
    const kid = parseChildLine(line)
    if (kid && kid.indent > 0) {
      const last = parsed[parsed.length - 1]
      if (last) last.kids.push(kid)
      continue
    }
    // `- [ ] [状态] <id> …`；状态标记可能缺省。
    // 只认 `- [ ]`（2026-10-20 旧 `↳ [ ]` 写法已废弃）。
    // 子项任务必须显示 —— 它就是一等待任务（写得进去、看得见、能 done）。
    const m = line.match(/^\s*-\s*\[ \]\s*(?:\[([^\]]+)\]\s*)?(\S+)\s*(.*)$/)
    if (!m) continue
    const state = m[1] || '进行中'
    const id = m[2]
    const body = m[3] || ''
    const authors = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1])
    // 会话 id 要单独抽出来（多会话并行时靠它区分自己的/别人的）。
    // 正则必须**先锚住日期再取后面的 token** —— 用宽松的 `[^)]*?\s(\S+)` 会把日期本身当成 sid。
    const sid = (body.match(/\(认领\s*\d{4}-\d{2}-\d{2}\s+([\w-]+)\)/) || [])[1] || ''
    const desc = body
      .replace(/\[\[[^\]]+\]\]/g, '')
      .replace(/^\s*—\s*/, '')
      .replace(/\s*\(认领[^)]*\)\s*$/, '')
      .trim()
    parsed.push({ state, id, desc, kids: [], authors, sid })
  }
  const mine = who
    ? parsed.filter((r) => r.authors.length === 0 || r.authors.includes(who))
    : parsed
  const rows = mine.map(({ state, id, desc, kids, sid }) => ({ state, id, desc, kids, sid }))
  return { total: rows.length, rows: rows.slice(0, max), hidden: Math.max(0, rows.length - max) }
}

/** 当前使用者名（读 ~/.abs/config.json 的 user，ABS_USER 环境变量优先）。
 * 读不到返回空串 —— 那时不做作者过滤（宁可全显示，也别因配置缺失而面板空白）。 */
async function currentUser(): Promise<string> {
  const env = String(process.env.ABS_USER || '').trim()
  if (env) return env
  try {
    const dir = process.env.ABS_CONFIG_DIR || join(homedir(), '.abs')
    const raw = await readFile(join(dir, 'config.json'), 'utf8')
    const u = JSON.parse(raw).user
    return typeof u === 'string' ? u.trim() : ''
  } catch {
    return ''
  }
}

/** 按显示宽度截断（自己实现，不 import 宿主 tui 包）。
 *  依赖宿主内部 alias 太脆 —— pi 版实测在测试环境会 ERR_MODULE_NOT_FOUND。
 *  宽度规则：CJK/全角记 2 列，其余记 1 列。 */
/** 解析子项行（与 src/todo/common.js 的 parseChild 同规则，双份实现 —— 见 pi 版说明）。 */
function parseChildLine(l: string): { done: boolean; text: string; indent: number } | null {
  // 只认标准 md 缩进子项（2026-10-20 旧箭头写法已废弃）。
  // 旧行由 CLI 侧 migrateLegacyChild 在读写时迁移掉，面板拿到的已是新格式。
  const m = String(l || '').match(/^(\s+)-\s*\[([ x])\]\s*(.*)$/)
  if (!m) return null
  return { done: m[2] === 'x', text: m[3].trim(), indent: m[1].length }
}

function dispWidth(s: string): number {
  let w = 0
  let i = 0
  while (i < s.length) {
    const m = /^\x1b\[[0-9;]*m/.exec(s.slice(i))
    if (m) { i += m[0].length; continue }
    const cp = s.codePointAt(i) || 0
    const ch = String.fromCodePoint(cp)
    i += ch.length
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff)
    w += wide ? 2 : 1
  }
  return w
}

/** 去掉 ANSI 转义序列，否则宽度计算会把颜色码也算进去。 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

/** 控宽截断：超宽则尾部换省略号（省略号算 1 列）。颜色码占 0 列，必须先剥掉再量宽。 */
function clipToWidth(s: string, width: number): string {
  if (width <= 0) return ''
  if (dispWidth(stripAnsi(s)) <= width) return s
  const keep = width - 1
  let out = ''
  let w = 0
  let i = 0
  while (i < s.length) {
    const m = /^\x1b\[[0-9;]*m/.exec(s.slice(i))
    if (m) { out += m[0]; i += m[0].length; continue }
    const cp = s.codePointAt(i) || 0
    const ch = String.fromCodePoint(cp)
    i += ch.length
    const cw = dispWidth(ch)
    if (w + cw > keep) break
    out += ch
    w += cw
  }
  return out + '…'
}

// 「进行中」行的迷你动画：三个小符号依次由空心变实心。
// 帧宽固定 3 列 —— 宽度不变才不会让面板每帧抖动。
const TODO_ANIM_FRAMES = ['○○○', '●○○', '●●○', '●●●', '●●○', '●○○']
const TODO_ANIM_MS = 250

/** 动画相位（每 tick +1）。模块级 —— 闭包 flag 在重复注册时不共享。 */
let animPhase = 0
let animTimer: ReturnType<typeof setInterval> | undefined

/** 启动/保持动画定时器。重复调用不会叠加（已存在则不动）。
 * getTui 是为了每 tick 拿**当前**的 tui 引用 —— widget 可能因刷新被重建。 */
function startAnimTimer(getTui: () => RenderTui | null): void {
  if (animTimer) return
  animTimer = setInterval(() => {
    animPhase++
    try { getTui()?.requestRender?.() } catch {}
  }, TODO_ANIM_MS)
  animTimer.unref?.()
}

function stopAnimTimer(): void {
  if (animTimer) { clearInterval(animTimer); animTimer = undefined }
}

/** 取当前动画帧。非进行中的行不传 phase（不显示）。 */
export function todoAnimFrame(phase: number): string {
  const n = TODO_ANIM_FRAMES.length
  const i = ((Math.floor(phase) % n) + n) % n
  return TODO_ANIM_FRAMES[i]
}

export function renderPanelLines(
  data: { total: number; rows: { state: string; id: string; desc: string; kids?: { done: boolean; text: string }[] }[]; hidden: number },
  who: string,
  width: number,
  fg: (color: string, s: string) => string,
  animPhase = -1,
  nickname = '',
): string[] {
  // ★ 空看板不返回空数组：面板是「机制在不在」的常驻指示，进去就看不见 = 不知道机制活着。
  const colorOf = (state: string): string => (state === '搁置' ? 'dim' : state === '滞留中' ? 'muted' : state === '讨论中' ? 'dim' : 'accent')
  const lines: string[] = []
  // 上描边用 `thinkingOff` —— 与输入框描边同一个色（pi 版排查三轮才确认：不能按名字猜主题色）。
  // 满宽（不 -1）—— 对齐宿主自己的 DynamicBorder.render。
  lines.push(fg('thinkingOff', '─'.repeat(Math.max(1, width))))
  const whoPart = who ? who + (nickname ? ` · ${nickname}` : '') : nickname
  const title = whoPart ? `📋 todo (${data.total}) — ${whoPart}` : `📋 todo (${data.total})`
  lines.push(clipToWidth(fg('accent', title), width))

  const lastIdx = data.rows.length - 1
  // 空看板：标题下摆一行事实。只摆事实、不写劝告。
  if (data.total === 0) {
    lines.push(clipToWidth(`  ${fg('dim', '（无未完成任务）')}`, width))
    return lines
  }
  data.rows.forEach((t, i) => {
    // `└─` 只给最后一条 —— 不管它有没有子项（否则末条带子项时全篇没有收尾）。
    const isLast = i === lastIdx
    const branch = isLast ? '└─' : '├─'
    const anim = t.state === '进行中' && animPhase >= 0 ? ' ' + fg('accent', todoAnimFrame(animPhase)) : ''
    // 复选框 `[ ]`：面板是 todo.md 的只读视图，就该长成 todo 原貌。
    const box = fg('dim', '[ ]')
    const head = `${fg('dim', branch)} ${box} ${fg(colorOf(t.state), `[${t.state}]`)} ${fg('text', t.id)}${anim}`
    const desc = t.desc ? ` ${fg('dim', '—')} ${fg('muted', t.desc)}` : ''
    lines.push(clipToWidth(head + desc, width))
    if (t.kids && t.kids.length) {
      // 子项：标准 md 嵌套列表 → 画成树
      const stem = isLast ? '  ' : fg('dim', '│ ')
      const n = t.kids.length
      t.kids.forEach((k, ki) => {
        const kb = ki === n - 1 ? '└─' : '├─'
        const kbox = fg('dim', k.done ? '[x]' : '[ ]')
        const ktext = fg(k.done ? 'dim' : 'muted', k.text)
        lines.push(clipToWidth(`${stem} ${fg('dim', kb)} ${kbox} ${ktext}`, width))
      })
    }
  })

  if (data.hidden > 0) lines.push(clipToWidth(fg('dim', `  +${data.hidden} more`), width))
  return lines
}

/** 隐藏面板。**必须主动 requestRender** —— 否则数据清了、屏幕还留着旧画面。
 *  坑（pi 版 2026-10-05 实报）：唯一的重绘入口是动画定时器，而「任务全完成」恰好
 *  让 needAnim=false → stopAnimTimer() → 从此没人请求重绘 → 屏幕冻结。
 *  即「消失」这个动作把它自己的重绘通道关掉了。 */
function hidePanel(ui: ExtensionUIContext | undefined): void {
  try { ui?.setWidget(PANEL_KEY, undefined) } catch {}
  stopAnimTimer()
  try { lastTui?.requestRender?.() } catch {}
}

async function refreshTodoPanel(ui: ExtensionUIContext | undefined, cwd: string): Promise<void> {
  if (String(process.env.ABS_TODO_PANEL || '') === '0') return
  if (!ui || typeof ui.setWidget !== 'function') return
  try {
    if (!(await hasBrain(cwd))) { hidePanel(ui); return }
    const md = await readFile(join(cwd, '.brain', 'todo.md'), 'utf8')
    const who = await currentUser()
    const data = parseOpenTasks(md, PANEL_MAX_ROWS, who)
    let tuiRef: RenderTui | null = null
    ui.setWidget(
      PANEL_KEY,
      (tui: RenderTui, theme: RenderTheme) => {
        tuiRef = tui
        lastTui = tui   // 供 hidePanel 在「无动画」时也能请求重绘
        return {
          render: (width: number) =>
            renderPanelLines(data, who, width, (c: string, s: string) => theme.fg(c, s), animPhase, sessionNickname),
          invalidate: () => {},
        }
      },
      { placement: 'aboveEditor' },
    )
    // 只在真有「进行中」任务时跑定时器 —— 否则白刷 CPU。
    const needAnim = data.rows.some((t) => t.state === '进行中')
    if (needAnim) startAnimTimer(() => tuiRef)
    else stopAnimTimer()
    // 无动画时得自己刷一帧，否则从「有任务」变成「无任务」时屏幕冻结在旧帧。
    if (!needAnim) try { lastTui?.requestRender?.() } catch {}
  } catch {
    hidePanel(ui)
  }
}

/** 当前项目是否有 .brain 图谱 —— 有才加指引（没图谱的项目里这指引是噪音）。
 *
 * 为何不按工具名判断（pi 版两次实测都错）：systemPromptOptions.selectedTools 在 handler
 * 里是基线值；MCP 工具默认不入 active 工具表（懒连接）。判「abs 能不能用」只看 .brain/。 */
async function hasBrain(cwd: string): Promise<boolean> {
  try {
    const st = await stat(join(cwd || process.cwd(), '.brain'))
    return st.isDirectory()
  } catch {
    return false
  }
}

/** 自动建图谱（无 .brain 时）。返回是否成功建出了 .brain/。
 *
 * 用户 2026-10-06 拍板方案 A：**任何目录都建**（含 ~、含临时目录）。
 * 幂等且安全：init 遇到已有内容一律不动。子进程跑（扩展被单文件复制, 没有 ../src/）。 */
async function autoInit(cwd: string): Promise<boolean> {
  try {
    return await new Promise<boolean>((resolvePromise) => {
      const c = spawn(process.execPath, [ABS_BIN, 'init'], {
        cwd,
        stdio: ['ignore', 'ignore', 'ignore'],
        env: { ...process.env },
      })
      const t = setTimeout(() => { try { c.kill() } catch {} resolvePromise(false) }, LOAD_GUIDE_TIMEOUT_MS)
      c.on('error', () => { clearTimeout(t); resolvePromise(false) })
      c.on('close', (code) => { clearTimeout(t); resolvePromise(code === 0) })
    })
  } catch {
    return false
  }
}

/** load 子进程超时（ms）。卡住不能拖死开工 —— 到点杀子进程并当失败（下次不再重试）。
 * 2s：本机 load 实测 ~50-100ms，2s 已是「明显不对」的阈值。 */
const LOAD_GUIDE_TIMEOUT_MS = 2000

/** 开工第一轮注入 load 全文（只一次）。
 *
 * 用户 2026-10-06 定：「打开宿主说第一句话就自动 abs load」，且**只第一轮**。
 * 为何只第一轮：load 是全量（实测 ~2.7k 字符）；若每轮塞会违反项目 Rule
 * 「读取侧输出不得随规模增长」—— 图谱越大 prompt 越肿。看板段则相反（小而关键, 每轮都摆）。
 * 为何走 ABS_BIN 跑子进程（而非 import 源码）：扩展被单文件复制，那儿没有 ../src/。
 * 失败静默：跑子进程/读盘出任何错都不弄坏对话（返回 null）。 */
async function readLoadForGuide(cwd: string): Promise<string | null> {
  try {
    return await new Promise<string | null>((resolvePromise) => {
      let buf = ''
      const c = spawn(process.execPath, [ABS_BIN, 'load'], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      })
      const t = setTimeout(() => { try { c.kill() } catch {} resolvePromise(null) }, LOAD_GUIDE_TIMEOUT_MS)
      c.stdout.on('data', (d) => (buf += d))
      c.on('error', () => { clearTimeout(t); resolvePromise(null) })
      c.on('close', (code) => {
        clearTimeout(t)
        resolvePromise(code === 0 && buf.trim() ? buf.trim() : null)
      })
    })
  } catch {
    return null
  }
}

/** 读看板拼成对齐段。失败/无图谱/看板空都返 null（静默降级，绝不阻断对话）。 */
async function readBoardForGuide(cwd: string, mySid = ''): Promise<string | null> {
  try {
    const md = await readFile(join(cwd, '.brain', 'todo.md'), 'utf8')
    return boardGuideline(md, await currentUser(), [...filesSeen], mySid)
  } catch {
    return null
  }
}

/** 已**确认送达**过 load 的目录集合（本会话内）。
 *
 * ★ 语义一：是「LLM 真看到了」，不是「我跑过了」（用户 2026-10-06 拍板方案 A）。
 *   病根：原实现注入完立刻置位，但注入发生在 agent loop 之前 —— 此时对话**还没发出去**。
 *   中断掉的那轮标记已烧且不回滚 → 后续全部 skip。修正：只在 `agent_end` 置位。
 *   **不要再改回「注入时直接置位」**。
 *
 * ★ 语义二：**按目录分，不是会话级单值**。load 内容来自 `cwd/.brain/`，每个目录不同。
 *   后果：任一目录拿到过 load，其它所有目录被永久跳过（pi 版日志实证）。
 *   **不要再改回单个布尔量**。
 *
 * ⚠ omp 差异：agent_end 带 willContinue/awaitingAsyncWork —— 非终态 settle 之后还会继续。
 *   但那不影响本机制：它只关心「这轮是否至少完整走到了 agent_end」。非终态仍是走到了。 */
const loadInjected = new Set<string>()

/** 本轮已注入 load、正等 `agent_end` 确认送达的 cwd。空串 = 无待确认。 */
let loadPending = ''

/** 最近一次算好的 systemPrompt 组装结果 —— 供测试注入/断言（生产路径不读）。 */
export function _lastBuiltForTest(): string[] | null {
  return _lastBuilt
}
let _lastBuilt: string[] | null = null

export default function absOmpExtension(pi: ExtensionAPI): void {
  // 埋点状态同上，故意声明在**模块级**（不在被反复调用的工厂函数里）。
  resetThrottle()

  pi.on("session_start", (_event: SessionStartEvent, ctx: ExtensionContext) => {
    // 新会话 = 重新登记：不重置则同进程的第二个会话永远不再落子项
    autoTaskSeen = false
    filesSeen.clear()    // 同理：新会话的文件痕迹不能带到下个会话
    loadInjected.clear() // 同：新会话的每个目录都要重新摆一次开局状态
    loadPending = ''     // 同：上一会话末轮未完的「待确认」不得带到新会话
    resetThrottle()
    // 本会话的随机昵称 —— 在这里抽一次（不是每帧抽，否则面板会疯狂闪）。
    sessionNickname = pickNickname()
    logHook(`session_start nickname=${sessionNickname || '(off)'}`).catch(() => {})
    // 启动时就画出面板。时序：omp 在 session_start 时已给 ctx.ui（无 UI 时是 noOp）。
    // ⚠ omp 的 session_start 事件**没有 reason 字段**（pi 有）—— 别照抄 pi 版的 reason= 。
    const cwd = (ctx && ctx.cwd) || process.cwd()
    if (ctx && ctx.hasUI) {
      refreshTodoPanel(ctx.ui, cwd)
        .then(() => logHook(`session_start panel drawn`).catch(() => {}))
        .catch(() => logHook(`session_start panel error`).catch(() => {}))
    } else {
      logHook(`session_start panel skipped no_ui`).catch(() => {})
    }
    return logHook("session_start").catch(() => {})
  })

  // 面板实时刷新（两事件配合）—— 为何不能只用其中一个：
  //   tool_execution_end 里的 toolName 是代理入口名 `mcp__abs`，**不是子工具名**，且不带 args；
  //   而 tool_call 带 input，能从里面认出目标工具，但它在**执行前**触发（此刻 todo.md 还没变）。
  // 故：tool_call 认出「刚才调的是 todo 工具」→ 置标记；tool_execution_end 看到标记就刷 → 清标记。
  // 始终保留 turn_end 兜底。
  pi.on("tool_call", (event: ToolCallEvent, ctx: ExtensionContext) => {
    const name = String(event.toolName || '')
    const input: unknown = event.input
    // 两种形态：① MCP 代理入口 mcp__abs + input.tool=abs_task；② 直接工具名 abs_task
    const target = inputField(input, 'tool') || inputField(input, 'name')
    if (/abs_(task|board)/.test(name) || /abs_(task|board)/.test(target)) {
      pendingTodoTool = true
      logHook(`tool_call todo_tool name=${name} target=${target || '-'}`).catch(() => {})
    }
    // 自动登记子项：真动文件时把「改到哪个」记进本会话（可观测埋点，不写看板）。
    if (!autoTaskSeen && isWriteCall(name, input)) {
      autoTaskSeen = true
      const sid = sessionIdFor(ctx)
      logHook(`tool_call first_write name=${name} sid=${sid || '-'}`).catch(() => {})
    }
    // 记下动过的文件（去重）—— 下一轮对齐时摆给 LLM（摆事实，不替它判断）。
    if (isWriteCall(name, input)) {
      const p = touchedPath(input)
      if (p && filesSeen.size < FILES_SEEN_MAX) filesSeen.add(p)
    }
  })

  pi.on("tool_execution_end", (_event: ToolExecutionEndEvent, ctx: ExtensionContext) => {
    if (!pendingTodoTool) return
    pendingTodoTool = false
    logHook(`tool_execution_end panel refresh after todo tool`).catch(() => {})
    refreshTodoPanel(ctx.ui, ctx.cwd).catch(() => {})
  })

  pi.on("turn_end", (_event: TurnEndEvent, ctx: ExtensionContext) => {
    logHook(`turn_end panel refresh cwd=${ctx.cwd}`).catch(() => {})
    refreshTodoPanel(ctx.ui, ctx.cwd).catch(() => {})
  })

  // 往 system prompt 注入静态指引 —— **omp 的通道与 pi 不同**：
  //   omp 返回 {systemPrompt: string[]} 是**整体替换**（不是 pi 的追加式 guidelines），
  //   故必须「event.systemPrompt 基线 + 我们的段」拼接后整体返回。
  // 不新增消息、不抢 turn、不产生对话条目。
  pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx: ExtensionContext): Promise<BeforeAgentStartEventResult | undefined> => {
    const cwd = ctx.cwd
    try {
      const base: string[] = Array.isArray(event.systemPrompt) ? event.systemPrompt : []
      // 基线为空 → 直接跳过注入。返回 { systemPrompt: [...] } 会清掉宿主自己的 prompt,
      // 宁可这一轮不注入（静默降级）, 也不能把宿主的工具表/Rules 弄丢（那是灾难性静默失效）。
      if (base.length === 0) {
        logHook(`before_agent_start skip reason=empty_base cwd=${cwd}`).catch(() => {})
        return
      }
      if (!(await hasBrain(cwd))) {
        // 无图谱 → 自动建一个（用户拍板方案 A：任何目录都建）。
        const inited = await autoInit(cwd)
        logHook(`before_agent_start auto_init=${inited ? 'ok' : 'fail'} cwd=${cwd}`).catch(() => {})
        if (!(await hasBrain(cwd))) {
          logHook(`before_agent_start todo_guide=off reason=no_brain`).catch(() => {})
          return
        }
      }
      const sidNow = sessionIdFor(ctx)
      const board = await readBoardForGuide(cwd, sidNow)
      // 开局每个目录垫一次 load 全文 + 首轮硬规则（同目录只一次；之后靠看板段反复对齐）。
      // 注意这里**不置 loadInjected** —— 注入点只在 agent loop 前，对话还没发出去；
      // 此刻置位会让被中断的那轮白烧掉标记。
      let loadState = 'skip'
      let loadText: string | null = null
      let rules: string | null = null
      if (!loadInjected.has(cwd)) {
        loadText = await readLoadForGuide(cwd)
        rules = String(process.env.ABS_OPENING_RULES || '') === '0' ? null : OPENING_RULES.join(' ')
        if (loadText) {
          loadPending = cwd // 送达确认交给 agent_end
          loadState = 'on'
        } else {
          loadState = 'empty'
          loadInjected.add(cwd) // 失败也不重试：不每轮白查一次盘
        }
      }
      const built = buildSystemPrompt(base, { board, load: loadText, rules, sid: sidNow })
      _lastBuilt = built
      logHook(`before_agent_start todo_guide=${board ? 'on' : 'off'} load_guide=${loadState} session_guide=${sidNow ? 'on' : 'off'} base=${base.length} out=${built.length} seen=[${[...loadInjected].join(',')}] pending=[${loadPending}] cwd=${cwd}`).catch(() => {})
      // 只在真的改了 prompt 时才返回替换（否则让宿主走原路径，减少无谓覆盖）。
      const changed = built.length !== base.length || built.some((l, i) => l !== base[i])
      return changed ? { systemPrompt: built } : undefined
    } catch (e: unknown) {
      logHook(`before_agent_start error=${e instanceof Error ? e.message : 'unknown'}`).catch(() => {})
      return undefined
    }
  })

  // 只保留可观测性埋点（区分「事件没触发」与「被守卫拦下」）+ load 送达确认。
  // **绝不在这里注入任何东西** —— 收尾注入已于 2026-09-18 删除（往对话里插话会打断用户）。
  pi.on("agent_end", async (_event: AgentEndEvent, ctx: ExtensionContext) => {
    const cwd = ctx.cwd
    const brain = await findBrain(cwd)
    if (!agentEndSeen) {
      agentEndSeen = true
      await logHook(`agent_end:seen cwd=${cwd} brain=${brain || 'none'}`).catch(() => {})
    }
    // 送达确认：走到这里 = 这轮至少完整跑到了 agent_end → 才算「LLM 看到了」。
    // 中断/ESC 掉的那轮不会到 agent_end → 该 cwd 入不了集合 → 下轮自动补注入。
    // 这是**唯一**该写 loadInjected 的地方（别挪回 before_agent_start）。
    if (loadPending) {
      loadInjected.add(loadPending)
      const done = loadPending
      loadPending = ''
      await logHook(`agent_end load_delivered cwd=${done} seen=[${[...loadInjected].join(',')}]`).catch(() => {})
    }
  })

  pi.on("session_shutdown", (_e: SessionShutdownEvent, ctx: ExtensionContext) => {
    stopAnimTimer() // 面板没了，动画定时器必须一起停（否则残留定时器白刷已丢弃的 tui）
    snapshotWrapup(ctx.cwd)
    logHook("session_shutdown").catch(() => {})
  })
}

@@MARK@@
