/**
 * abs (agent-brain-sync) — Pi extension。
 * 纯触发: 会话生命周期事件 → 技术日志一行 (~/.abs/log/hooks.log, ABS_LOG_DIR 可覆盖)。fire-and-forget。
 * 纪律: hook 事件只进技术日志, 不进图谱 log.md (log.md 只收工作成果沉淀, 与 event.sh 同纪律)。
 * Pi 事件: session_start / session_shutdown (对应 host hook 的 SessionStart/SessionEnd)。
 * session_shutdown 额外触发 abs wrapup: 把当前项目未完成任务快照到 wrapup.log (跨会话收尾保险)。
 * agent_end 只留可观测性埋点(agent_end:seen), 不再向对话注入任何东西。
 * 另在 agent_end 确认开局 load 段「送达」（loadPending → loadInjected，2026-10-06 方案 A）：
 *   注入点在 before_agent_start（prompt 提交后、agent loop 前），此刻对话还没发出去；
 *   若在那时就置位，被 ESC/中断的那轮会把一次性标记烧掉，之后永远不再注入（日志实证）。
 *   故标记只在 agent_end 置 —— 没走完就下轮补。
 * 且标记按 **cwd** 记（load 内容取自 cwd/.brain/）—— 会话级单值会让一个目录
 *   拿到 load 后、其它目录全被永久跳过（2026-10-06 用户实报，日志有干净复现）。
 *
 * 已删除（2026-09-15）：「写文件即任务开始 → 每轮注入登记提醒」。实报「pi 里一直报 Follow-up」。
 * 已删除（2026-09-18）：收尾注入本身（agent_end + sendUserMessage deliverAs=followUp）。
 *   实报「每次干活干一会出来, 任务就中断了」。两次同一个根因：
 *   **往对话里插一句话本身就是设计错误，不是频率问题** —— 改守卫(每轮→每会话)治不了它。
 *   别再加回来（指 sendUserMessage 注入；静态 system prompt 内容不在此列，见下方 todo 指引）。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { appendFile, mkdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"

// abs CLI 路径。安装时替换为 stableBinPath（全局优先），
// 但允许 ABS_BIN_PATH 覆盖 —— 测试需隔离到沙盒副本，开发机也可能同时有多份。
const ABS_BIN = process.env.ABS_BIN_PATH || "@@ABS_BIN@@"

async function logHook(evt: string): Promise<void> {
  const dir = process.env.ABS_LOG_DIR || join(homedir(), ".abs", "log")
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const stamp = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())
  const line = "[" + stamp + "] pi:" + evt + "\n"
  await mkdir(dir, { recursive: true })
  await appendFile(join(dir, "hooks.log"), line)
}

// 会话结束时快照当前项目滞留任务到 wrapup.log（detached fire-and-forget，wrapup 自身幂等去重不刷屏）。
// cwd 用事件 ctx.cwd（当前项目），让 abs 在该目录定位 .brain/。

/** 会话 id（作自动登记的幂等键，一会话一条）。取不到返回空串 —— 那时不登记，
 *  因为空键会让每条指令都"首次"，看板被刷爆。 */
function sessionIdFor(ctx: any): string {
  try {
    const id = ctx?.sessionManager?.getSessionId?.()
    return String(id || '').replace(/[^\w-]/g, '').slice(0, 16)
  } catch { return '' }
}

/** 会改文件的工具名。用于判定「真的开始干活了」—— 排查类会话先跑一堆读命令，
 *  若用「第一次 tool_call」当判据，断点会被写在与任务无关的文件上。
 *
 * 为何含 bash：大量修改是经 bash 完成的（heredoc / sed -i / > 重定向），
 * 漏掉它 = 纯 bash 会话永远不记断点（见 concept opencode-inject-channel-verdict
 * 的同源教训：白名单必须按宿主实际用法穷举，漏一个就把功能静默关掉）。
 */
const WRITE_TOOL = /^(write|edit|apply_patch|patch|multiedit|notebookedit|bash|shell)$/i

/** bash 命令里没有写入迹象则不算「干活」—— 否则 `ls`/`git status` 也会记断点。 */
const BASH_WRITES = /(^|[^\w])(>|>>|sed\s+-i|tee\b|mkdir\b|rm\b|mv\b|cp\b|touch\b|cat\s*>)/

/** 这次 tool_call 是否算「真的动了文件」。 */
function isWriteCall(name: string, input: any): boolean {
  if (!WRITE_TOOL.test(String(name || ''))) return false
  // bash 要额外甄别：只有带写入操作的命令才算
  if (/^(bash|shell)$/i.test(String(name || ''))) {
    return BASH_WRITES.test(String(input?.command ?? ''))
  }
  return true
}

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

/** agent_end 埋点状态。
 *
 * 为何在**模块级**而不在 absPiHook() 里（2026-09-17 实测）：扩展会被重复注册
 * （session_start 11 分钟内触发 8 次），每次注册都新建一份闭包 → flag 不共享。
 * 模块级状态在同一进程内只有一份，注册多少次都共享。
 *
 * agentEndSeen = 本会话已留过 seen 痕（可观测性，每会话一次）
 */
let agentEndSeen = false

/** “刚才调的是 todo 工具”标记 —— 由 tool_call 置位、tool_execution_end 消费。
 * 同样在模块级，理由同上（闭包 flag 在重复注册时不共享）。 */
let pendingTodoTool = false

/** 本会话是否已记过自动任务断点。模块级（重复注册时闭包 flag 不共享 —— 同 agentEndSeen 的坑）。
 *  只记第一次写文件，不是每次都记：断点是「记到哪」不是流水账。 */
let autoTaskSeen = false

/** 本会话动过的文件（去重，最多记 FILES_SEEN_MAX 个）。
 *
 * ★ 定位（用户 2026-10-05 定，别改）：这**是「摆事实」，不是「发现问题」**。
 *   它只把我自己刚干过的事（改过哪些文件）与看板并列摆出来，
 *   **不判断这些改动算不算任务、不提醒、不追踪、不逼登记**。
 *   是否意识到「我干的和看板对不上」、要不要补记 —— 全部由 LLM 自己反思。
 *
 * 为何不挂在「改文件/一轮结束」两个时机：那两个钩子改不了 system prompt
 *   （tool_call/agent_end 拿不到 systemPromptOptions，只有 before_agent_start 有）；
 *   而 sendUserMessage 插话已被否决（打断用户）。故记在这里、下轮带出。
 *
 * 今日最大的教训：**不要用技术手段替 LLM 发现 todo 问题。**
 *   一侧（摆事实）有效，另一侧（替它发现）十二次全败。详见 concept remind-vs-gate。 */
const filesSeen = new Set<string>()
const FILES_SEEN_MAX = 8

/** 写类工具调用的文件路径：edit/write 直接取 input.path，bash 取命令里像路径的片段。 */
function touchedPath(name: string, input: any): string | null {
  const p = input?.path ?? input?.file_path ?? input?.filename
  if (typeof p === 'string' && p.trim()) return p.trim()
  // bash 的写入靠命令字符串抻出路径（重定向/ sed -i / tee 等）
  const cmd = String(input?.command ?? '')
  const m = cmd.match(/(?:>>?|tee|sed -i[^ ]*)\s+([^\s|;&<>]+)/)
  return m ? m[1] : null
}

/** 最近一次渲染拿到的 tui 引用。hidePanel 用它请求重绘 —— 面板消失时动画
 *  定时器已停，没有别的重绘通道（见 hidePanel 的坑注解）。 */
let lastTui: any = null

/** 会话边界重置埋点状态。
 *  不重置 → 同进程第二个会话继承 true 永久不留痕（2026-09-13 实测过的坑）。 */
function resetThrottle(): void {
  agentEndSeen = false
  pendingTodoTool = false
}

// ---------------------------------------------------------------------------
// todo 及时性验证（2026-10-03）：静态 system prompt 指引
// ---------------------------------------------------------------------------
// 待验证假设：abs 的 todo「不及时」不是工具问题，是**触发机制**问题 ——
// `abs_task` 的指引只存在于工具 description 里，模型常忽略；而 pi 原生工具的
// `promptGuidelines` 会进 system prompt 的 Guidelines 段，每轮都在。
//
// 与历史两次失败做法的**分界线**（必须守住）：
//   删掉的两次都是 `sendUserMessage(deliverAs:"followUp")` —— **往对话里插话**，
//   抢走一个 turn、打断用户。本次是**静态 prompt 内容**：不新增消息、不抢 turn、
//   不产生任何对话条目，只是连同其它 Guidelines 一起渲染进 system prompt。
//   若将来要扩展，也绝不能退化成插话。
//
// 关掉即设 ABS_TODO_GUIDE=0。
//
// 工具名**不能写死**（2026-10-04 实报修正）：abs 走 MCP，而 MCP 工具在模型侧的
// 名字随宿主的 exposure 配置变，至少三种实测形态 ——
//   ① pi-mcp-adapter 的 namespace 模式：顶层只有代理入口 `mcp__abs`，
//      子工具名要作为 `tool` 参数传（namespace-tools.ts 只注册 mcp__<server> 一个）。
//   ② 内建 MCP 直出：工具名就是 `mcp__abs__abs_task`。
//   ③ codemode / 直出形态：子工具直接叫 `abs_task`。
// 上一版写死 `abs_task` → 在 ① 下模型去找一个不存在的顶层工具，指引等于空转
// （表现：嘴上说"先登记"，实际没落盘）。故改成描述**意图 + 名字规律**，
// 让模型按当前会话实际可见的形态自己挑，不去猜死一个。
const TODO_GUIDELINES = [
  // ① 锚点（2026-10-05 照 rpiv-todo 改写）：原写 `on the first file edit of a task` ——
  //   实测太晚：那一刻注意力全在"要改什么"上，没人会想起登记。用户实报两次
  //   （"侦察阶段全漏"、另一个 pi 会话干脆没登）。rpiv-todo 挂在
  //   `immediately after receiving new instructions`（收到指令时）—— 早得多，且
  //   侦察/只读工作（读代码、问需求）也落在"收到指令"之后，能被盖住。
  'Use the abs task tool as soon as you receive instructions that involve changing this project — including investigation work where you read code or ask questions before any edit. Call it with action "start" and a short id before the work itself, not after. Skip it for pure questions about general knowledge, one-line answers, and conversation. (Tool name varies by host: `mcp__abs` with tool="abs_task", or `mcp__abs__abs_task`, or `abs_task` — use whichever form this session exposes.)',
  // ② 完成即结：不许攒
  'Mark a task "done" immediately when it finishes — never batch completions at the end of a session.',
  // ③ 断点：跨会话接力靠它
  'Before starting a task, record the checkpoint with action "note" (which file, which step) so a later session can resume.',
  // ④ 反例（照 rpiv-todo）：明确什么情况【不许】标完成 —— 只给正向要求时，
  //   模型倾向于把"我以为做完了"当成完成，结语失真会污染下个会话的判断。
  'Never mark a task "done" when tests are failing, the implementation is partial, or an error is unresolved — keep it in progress and add a task for the blocker instead.',
  // ⑤ 唯一进行中（同 rpiv-todo）：看板要能回答"现在在做什么"，多的应转走。
  'Keep exactly one task in "进行中" at a time; when the user switches direction or drops a task, use action "state" with 搁置 (dropped/not doing it); 滞留中 for still-wanted-but-stuck; 讨论中 for still-open. If you finish one and another is ready, promote it explicitly.',
  // ⑥ 结语要真实：三种结语各有含义，别一律写落地。
  'When completing, pick the honest conclusion via the `as` field: 落地 (built and verified) / 否决 (decided against, or built then reverted) / 仅方案 (designed only). A wrong conclusion makes the next session treat "considered" as "completed".',
]

/** 当前项目是否有 .brain 图谱 —— 有才加指引（没图谱的项目里这指引是噪音）。
 *
 * 为何不用工具名判断（2026-10-03 两次实测都错）：
 *   ① event.systemPromptOptions.selectedTools 在 handler 里是**基线值**，真实表要等
 *      handler 之后（agent-session.js:1573）才回填 → 实测 tools=31 无 abs。
 *   ② 改用 pi.getActiveTools() 仍为假 —— MCP 默认 exposure=codemode，工具**本就
 *      不进 active 工具表**（且 pi 的 MCP 是懒连接，实测提示 "lazy: from cache, not
 *      connected yet"）。
 * 结论：判断「abs 能不能用」不该看工具注册表，直接看**项目有没有 .brain/**。 */
async function hasBrain(cwd: string): Promise<boolean> {
  try {
    const st = await stat(join(cwd || process.cwd(), '.brain'))
    return st.isDirectory()
  } catch {
    return false
  }
}

/** 已**确认送达**过 load 的目录集合（本会话内）。
 * “只第一次”：开工那一刻把全套状态摆一次（Rules/图谱/滞留/最近 log），
 * 之后靠看板段每轮对齐 —— 不重复塞 load（它是全量，每轮塞会随图谱无界膨胀）。
 * 在 session_start 清空（同 filesSeen）。
 *
 * ★ 语义一：是「LLM 真看到了」，不是「我跑过了」（2026-10-06 用户拍板方案 A）。
 *   病根：原实现注入完立刻置位，但注入发生在 `before_agent_start`（prompt 提交之后、
 *   agent loop 之前）—— 此时对话**还没发出去**。ESC/中断掉的那轮，标记已烧且不回滚，
 *   后续全部 skip。日志实证（~/.abs/log/hooks.log 07:06-07:09 一段）：
 *     session_start → load_guide=on → 之后连续 skip
 *   修正：只在 `agent_end`（这轮真跑完）置位；中断则保持未置 → 下轮自动补。
 *   **不要再改回「注入时直接置位」** —— 那就是把「没走完就补」重新关掉。
 *
 * ★ 语义二：**按目录分，不是会话级单值**（2026-10-06 用户实报后修的第二个 bug）。
 *   load 的内容来自 `cwd/.brain/`，**每个目录不同**；而原实现只有一份布尔值。
 *   后果：任一目录拿到过 load，**其它所有目录被永久跳过**。日志实证（一次干净复现）：
 *     07:40:08 session_start
 *     07:40:10 before_agent_start load_guide=on   cwd=~/.agents   ← 注入
 *     07:40:17 agent_end load_delivered           cwd=~/.agents   ← 置位
 *     07:40:43 before_agent_start load_guide=skip cwd=agent_brain_sync ← ✗ 被跳过
 *   而 pi 一个会话里 `turn_end` 会在多个 cwd 间交替（多个项目目录同时挂着）。
 *   **不要再改回单个布尔量** —— 一改回去就重现「在 A 说过话，B 再也看不到 load」。 */
const loadInjected = new Set<string>()

/** 本轮已注入 load、正等 `agent_end` 确认送达的 **cwd**（见 loadInjected 的注解）。
 *  与 loadInjected 的分工：这是「抛出去了」，那是「对方接到了」。
 *  空串 = 无待确认（不用 null，避免每次都要判空类型）。 */
let loadPending = ''

/** 本会话是否已送过首轮硬规则（只为日志可观测，不参与注入判断 —— 那个由 loadInjected 守）。
 *  每会话重置（session_start），同 loadInjected。 */
let openingRulesLogged = false

/** load 子进程超时（ms）。卡住不能拖死开工 —— 到点杀子进程并当失败（下次不再重试）。
 * 2s：本机 load 实测 ~50-100ms，2s 已是“明显不对”的阈值。 */
const LOAD_GUIDE_TIMEOUT_MS = 2000

/** 看板快照在 guidelines 里的前缀 —— 用于每轮替换上轮快照（内容会变，不能用 includes 去重）。 */
const BOARD_MARK = '[看板] '

/** 把当前看板拼成 Guidelines 里的一段（对齐用）。
 *
 * 设计（用户 2026-10-05 定）：**只对齐，不多说** —— 把「现在看板上有什么」摆在
 * 面前让 LLM 自己对照，不写「记得登记」这类劝告（那些已证明会被忽略）。
 *
 * ★ 铁律（2026-10-05 用户定，别改）：
 *   - **只用对齐，不用技术手段替 LLM 发现 todo 问题。**
 *     今天最大的收获：技术只负责「摆事实」，不负责「发现问题、提醒、追踪、逼补记」。
 *     让 LLM 自己看到、自己反思、自己决定 —— 这是唯一活下来的方向。
 *   - **反复对齐，不厌其烦**：不是一次性提示，是**每一轮都摆**。
 *     用户原话：「对齐永远是反反复复的对齐，不厌其烦」。
 *     别用节流/去重/「刚说过就不重复」去优化掉它 —— 反复就是它的工作方式。
 *   - **尺度：只说 todo.md 本身**。不夹带判断、不写劝告、不评价好坏。
 *     只把「看板上现在有什么」摆出来。
 *   - **是否添加/完成/删除/转状态，全部由 LLM 自己判断** —— 不替它决定，
 *     不自动登记、不自动完成、不写看板。
 *   - **不做重任务**：不起进程、不 spawn、不写盘；只读一个本地文件。
 *   理由：前 12 次尝试都失败，根因是「让不掌握判据的一方启动动作」。
 *   判据在 LLM 手里，这里只负责保证它**每轮都看得见**。
 *   详见 concept remind-vs-gate（对齐必做 + 门禁兜底）。
 *
 * 与以前删掉的两种注入的本质区别：那不调 sendUserMessage（不插话、不抢 turn），
 * 只改 system prompt 内容 —— 和静默的 TODO_GUIDELINES 走同一个通道。
 *
 * 看板为空时仍然输出 —— 但**不能只摆「（空）」**（2026-10-06 用户实报后改）：
 *   实报：在 ~ 目录干活，看板 Todo 区是空的，模型看到「（空）」读成了「一切正常」，
 *   于是动手却没登记。日志里 todo_guide=on / load_guide=on 都是真的 ——
 *   **但「注入了」不等于「起作用了」**。空看板摆成一行「（空）」，传达不出「不对齐」。
 *   故空看板时要把**事实 + 后果**摆出来：你正在开工，而看板一片空白，这就是该登记没登记。
 *   （仍然不替 LLM 做决定、不自动登记 —— 只把事实摆清楚，判断还是它的。）
 *
 * 仍然静默的情形：无图谱/读失败（readBoardForGuide 捕不到 todo.md）；
 *   **以及看板里全是别人的任务**（那不是空，是「这看板不是我在用」——
 *   摆个「（空）」会误导成「我可以去登记」，跟真的空看板不是一回事）。 */
export function boardGuideline(md: string, who: string, touched: string[] = []): string | null {
  const { total, rows } = parseOpenTasks(md, PANEL_MAX_ROWS, who)
  // 看板里有没有**任何**未完成条目（不分作者）。用来区分两种“过滤后为空”：
  //   没有 → 真的空看板（摆「空」这个事实 + 它是异常信号）
  //   有但都是别人的 → 不是我的看板（该静默，别误导我去登记）
  const anyOpen = /^\s*- \[ \]/m.test(md)
  if (!total && anyOpen) return null
  const lines = rows.map((r) => {
    // desc 为空时不拖空破折号（MCP 登记只给 id 的常见情形）。
    const head = `  ${r.state ? `[${r.state}] ` : ''}${r.id}${r.desc ? ` — ${r.desc}` : ''}`
    // 断点必须带上：它就是「改到哪一步」，丢了等于对齐了也接不上。
    return r.note ? `${head}\n    ↳ ${r.note}` : head
  })
  const more = total > rows.length ? `  …另 ${total - rows.length} 条` : ''
  // 本会话动过的文件 —— 与看板并列摆出，让 LLM 自己对照（不判断算不算任务）。
  const touchLines = touched.length
    ? ['本会话改过:', ...touched.map((f) => `  ${f}`)]
    : []
  return [
    '当前 .brain/todo.md 看板（开工前对齐：正在做的算哪条？有新任务要加吗？有该删的吗？）:',
    // ★ 空看板不能只摆「（空）」——用户 2026-10-06 实报：看到「（空）」读成了「一切正常」，
    //   于是动手却没登记（日志证实 todo_guide=on、load_guide=on，即「看见了，照样不做」）。
    //   故把事实说完整：本目录有图谱、但零未完成任务。
    // ⚠ 但**不得写劝告**（「请登记」「别忘了」）—— 知识库 remind-vs-gate 记了 12 次全败，
    //   且本文件自己的用例就在守这条（不得夹带劝告）。只摆事实，判断留给 LLM。
    ...(lines.length
      ? lines
      : ['  （空 —— 本目录有 .brain/ 图谱，但一条未完成任务都没有）']),
    ...(more ? [more] : []),
    ...touchLines,
  ].join('\n')
}

/** 开工第一轮注入 load 全文（只一次）。
 *
 * ★ 用户 2026-10-06 定：「打开 pi 说第一句话就自动 abs load」，且**只第一轮**。
 *   痛点：我开工时手上什么都没有（Rules/图谱/上会话滞留/最近 log 全缺），
 *   得靠用户提醒「abs」我才去 load —— 今天这场活就是这么漏掉登记的。
 *
 * 为何只第一轮（与看板段的反复对齐是两件事）：
 *   - 看板：小而关键，**每轮都摆**（反复对齐，不厌其烦）。
 *   - load：全量（实测 ~2.7k 字符），**只在开工那一次**。若每轮塞，
 *     会违反项目 Rule「读取侧输出不得随规模增长」—— 图谱越大 prompt 越肿。
 *
 * 为何走 ABS_BIN 跑子进程（而非 import 源码）：hook 是被**单文件复制**到
 *   ~/.pi/agent/extensions/abs.ts 的，那里没有 ../src/ —— import 源码必炸。
 *   ABS_BIN 是 install 时烧进来的稳定入口路径，本文件 wrapup 已在用同一路子。
 *
 * 与删掉的自动登记「每轮 spawn」的差别：**只第一轮一次**，不是每轮。
 *   每轮 spawn 才是卡顿的根因（见 auto-todo-register-design）。
 *
 * 与删掉的两次注入的差别：那两次是 sendUserMessage（往对话里插话、抢 turn）；
 * 本函数只改 system prompt 内容，与 TODO_GUIDELINES / 看板段同一通道。
 *
 * 失败静默：跑子进程/读盘出任何错都不弄坏对话（返回 null）。 */
async function readLoadForGuide(cwd: string): Promise<string | null> {
  try {
    const out = await new Promise<string | null>((resolvePromise) => {
      let buf = ''
      const c = spawn(process.execPath, [ABS_BIN, 'load'], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      })
      // 超时保护：load 卡住不能拖住开工（子进程永不返回 = 会话永远开不动）。
      const t = setTimeout(() => { try { c.kill() } catch {} resolvePromise(null) }, LOAD_GUIDE_TIMEOUT_MS)
      c.stdout.on('data', (d) => (buf += d))
      c.on('error', () => { clearTimeout(t); resolvePromise(null) })
      c.on('close', (code) => {
        clearTimeout(t)
        resolvePromise(code === 0 && buf.trim() ? buf.trim() : null)
      })
    })
    return out
  } catch {
    return null
  }
}

/** 自动建图谱（无 .brain 时）。返回是否成功建出了 .brain/。
 *
 * ★ 用户 2026-10-06 拍板方案 A：**任何目录都建**（含 ~、含临时目录）。
 *   曾考虑「只对有 .git/package.json 的目录建」—— 被用户否定：
 *   用户认定 ~ 这种也是项目，而 ~ 没有 .git，按项目标志判会误伤。
 *
 * 幂等且安全：init 遇到已有内容一律不动（见 `abs init --help` 的「--repair 只补缺不覆盖」），
 *   所以重复调用无副作用；并且只在 hasBrain 为假时才调。
 *
 * 为何走子进程而非 import 源码：hook 被单文件复制到 ~/.pi/agent/extensions/，
 *   那里没有 ../src/ —— 与 readLoadForGuide 同一原因。
 *
 * 超时用同一个 LOAD_GUIDE_TIMEOUT_MS：建图谱就是写几个小文件，卡住即异常。
 * 失败静默：无权限/只读盘等不能弄坏对话（返回 false，调用方会再查一次 hasBrain 兜底）。 */
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

/** 读看板拼成对齐段。失败/无图谱/看板空都返 null（静默降级，绝不阻断对话）。 */
async function readBoardForGuide(cwd: string): Promise<string | null> {
  try {
    const md = await readFile(join(cwd, '.brain', 'todo.md'), 'utf8')
    return boardGuideline(md, await currentUser(), [...filesSeen])
  } catch {
    return null
  }
}

/** 注入 todo 指引。静态 6 条（行为要求） + 实时看板（对齐用）—— 两者职责不同：
 * 静态条说「该怎么做」，看板说「现在是什么」。 */
export function injectTodoGuidelines(options: any, board?: string | null): boolean {
  if (String(process.env.ABS_TODO_GUIDE || '') === '0') return false
  const list: string[] = options.promptGuidelines || (options.promptGuidelines = [])
  for (const g of TODO_GUIDELINES) {
    if (!list.includes(g)) list.push(g)
  }
  // 看板内容每轮会变（任务增减/状态转换），不能用 includes 去重 —— 先删上轮的旧快照再推。
  // ★ 必须先删：board 为 null（看板空了/全完成）时同样要删 ——
  //   曾只在 board 非空时删，结果看板清空后旧快照残留在 prompt 里，
  //   LLM 会继续看到已经不存在的任务（对齐撒谎）。
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].startsWith(BOARD_MARK)) list.splice(i, 1)
  }
  if (board) list.push(BOARD_MARK + board)
  return true
}

/** 开局 load 段在 guidelines 里的前缀（与看板段区分，两者都挤 promptGuidelines）。 */
const LOAD_MARK = '[开工] '

/** 从 skill 里挑出的【硬规则】—— 只第一轮送，与 load 同机会。
 *
 * ★ 用户 2026-10-06 拍板方案 B：不动 skill 全文（~200 行），只把管「登记」的 3 条硬规矩搬过来。
 *
 * 为何不做 A（首轮塞 skill 全文）：撞项目 Rule「读取侧输出不得随规模增长」——
 *   每次开会话都多塞 200 行，而其中大部分（图谱组织/容量纪律/tesardown 流程）
 *   只在真正做 abs 维护时才用得上。
 *
 * 与【常驻 6 条】TODO_GUIDELINES 的区别（两者职责不同，别合并）：
 *   - 6 条常驻：行为要求，每轮都在（看板对齐用）。
 *   - 这 3 条：**只在开工第一轮出现一次** —— 因为它们是「开工那一刻」的触发器，
 *     每次都说等于噪音（历史教训：静态指引有痕 414 次、行为 0 变化）。
 *
 * ⚠ 必读的实证背景（别当作「这次会有用」）：
 *   知识库 remind-vs-gate 记了 12 次尝试全败 —— 「提醒 LLM」这一类全死于
 *   「看见了，照样不做」（静态指引有痕 414 次）。本方案属于该类。
 *   用户知情后仍然选择做，理由：「首轮显式送完整规则」这个形态确实没被试过
 *   （历史试的是「一直挂着」和「关键词触发」，与「首轮一次性强提示」不同）。
 *   所以：**不要因为「效果不理想」就反复改这几句** —— 那正是用户说的死循环。
 *   要改的是机制（找「不做就过不去」的关卡），不是把提醒写得更用力。 */
export const OPENING_RULES = [
  // ① skill「新需求受理协议」+「开工前先登记」的核心：先登记，再动手。
  //   为何强调「第一个文件」：实测漏登记都发生在「先读代码再说」的天真开工上。
  'This project has a .brain/ board. Before you touch any file or run any command for a task that changes this project, register it first with the abs task tool (action "start" + a short id). Read the first file only after that. A rough name is fine — the name can be fixed later, but an unregistered start cannot be recovered.',
  // ② 名字要「说清在干什么」，不抄用户原话（实测抄出来的是「我已经重启测试一下」这种开场白）。
  'Name it so it says what you are doing (e.g. fix-skill-trigger, oversize-exempt) — do not copy the user\'s wording; a greeting or a question is not a task name.',
  // ③ 「不攒」：一段活干完立刻 done，宁可拆小。
  'Mark a task "done" as soon as that piece of work ends — do not batch. If you are more than two or three rounds in without a registration, you are already off the rails: register now.',
]

/** 硬规则段的前缀（与 [开工] load 段 / [看板] 段区分）。 */
const OPENING_MARK = '[开工规则] '

/** 注入首轮硬规则（只第一轮，由调用方的 loadInjected 守）。与 load 段同一通道。
 * 关掉即设 ABS_OPENING_RULES=0。 */
export function injectOpeningRules(options: any): boolean {
  if (String(process.env.ABS_OPENING_RULES || '') === '0') return false
  const list: string[] = options.promptGuidelines || (options.promptGuidelines = [])
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].startsWith(OPENING_MARK)) list.splice(i, 1)
  }
  list.push(OPENING_MARK + OPENING_RULES.join(' '))
  return true
}

/** 注入开局 load 全文。与看板段同一个通道（静态 system prompt 内容）。
 * 只第一次调（由调用方的 loadInjected 守）；这里只管推入，不自己去重。 */
export function injectLoadGuideline(options: any, text: string): boolean {
  if (String(process.env.ABS_LOAD_GUIDE || '') === '0') return false
  if (!text) return false
  const list: string[] = options.promptGuidelines || (options.promptGuidelines = [])
  // 先删旧的：理论上只会调一次，但重入/session 重置边界上不该堆叠。
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].startsWith(LOAD_MARK)) list.splice(i, 1)
  }
  list.push(LOAD_MARK + text)
  return true
}

// ---------------------------------------------------------------------------
// todo 面板（2026-10-03）：把 .brain/todo.md 的未完成任务显示在编辑器上方
// ---------------------------------------------------------------------------
// 纯展示层：只读 todo.md，不写任何东西。数据源就是 abs 自己的看板 —— 不做第二套状态。
// 与 rpiv-todo 的区别：那个把状态存会话 transcript（跨会话丢失），我们用磁盘文件（可续接）。
// 关掉即设 ABS_TODO_PANEL=0。
const PANEL_KEY = "abs-todo-panel"
const PANEL_MAX_ROWS = 10

// 标题后缀昵称池（2026-10-03 用户提供）—— 每次**启动会话**随机抽一条，会话内保持不变。
// 不能每帧随机（panel 每帧都重渲染，那样会疯狂闪烁）。
const USER_NICKNAMES = [
  '🛌 昼伏夜出型',
  '😴 沾枕头就醒',
  '🌙 熬夜当修仙',
  '⏰ 闹钟十连败',
  '🧟 永远睡不醒',
  '☕ 靠咖啡续命',
  '🧋 靠奶茶续命',
  '🍚 干饭第一名',
  '🥘 吃辣只敢微辣',
  '🍳 炸厨房常客',
  '🥗 间歇性减肥',
  '🍜 深夜爱放毒',
  '🧊 冰镇式养生',
  '⌨️ 键盘上摸鱼',
  '🐟 划水大师',
  '💻 复制粘贴大师',
  '🚽 带薪上厕所',
  '🕕 到点就跑',
  '📅 明天再说吧',
  '🐷 坚决不加班',
  '😇 表面在微笑',
  '🤯 内心已掀桌',
  '💸 月月过路财神',
  '🏦 隐形负翁',
  '🤑 转发锦鲤求暴富',
  '📉 钱包越来越瘦',
  '🛒 购物车首富',
  '📱 网上冲浪选手',
  '🛸 意念回复专家',
  '📞 电话一响就慌',
  '🙈 已读绝不回',
  '🤝 只管埋头夹菜',
  '📝 收藏从不用',
  '📚 学了就忘',
  '🧠 记忆力七秒',
  '🔋 1%才去充电',
  '🛍️ 拆快递狂魔',
  '🧳 云旅游专家',
  '🏋️ 办卡只去洗澡',
  '🚶 步数常年垫底',
  '💇 秃飞猛进',
  '🏴‍☠️ 飞翔荷兰人',
  '🐌 蜗牛速度选手',
  '🦥 躺平专业户',
  '🎮 打完这把就睡',
  '🍿 吃瓜第一线',
  '🔍 搜索两小时',
  '🧩 爱钻牛角尖',
  '💤 梦里也在编程',
  '🚀 明早一定做',
  '🧘 边熬夜边养生',
  '📺 刷剧不眨眼',
  '🎧 单曲循环中',
  // ── 职场抱怨（2026-10-03 第二批）──
  '🫠 靠不住选手',
  '🧯 专业背锅侠',
  '🪑 会议室钉子户',
  '📎 工具人本人',
  '🫥 存在感为零',
  '🥄 打杂一把好手',
  '🧮 人形Excel',
  '📋 需求搬运工',
  '🔧 万能补丁匠',
  '🗣️ 会议两小时',
  '💬 一言不合拉会',
  '📊 对齐一整天',
  '🌀 讨论没结论',
  '🎯 追需求成瘾',
  '📝 纪要孤儿',
  '🔥 排期永远紧',
  '⏳ 催到怀疑人生',
  '🌃 下班天已黑',
  '📆 周末待命',
  '🚨 临时插需求',
  '🧨 上线前改需求',
  '📈 汇报全靠编',
  '🎤 PPT大师',
  '🤡 背锅第一名',
  '🫡 收到马上办',
  '🙃 领导说得对',
  '👏 掌声最热烈',
  '🏓 甩锅乒乓球',
  '🙋 不背锅侠',
  '📮 抄送战斗机',
  '🧊 已读不回群',
  '🔕 消息免打扰',
  '🪫 电量剩5%',
  '🧓 入行即养老',
  '🫩 心力耗尽',
  '😮‍💨 叹气专业户',
  '🪦 激情已入土',
  '📤 简历常年挂着',
  '🧳 随时准备跑路',
  '💼 骑驴找马中',
  '🪙 谈薪谈不动',
  '🥲 涨薪等明年',
  // ── 自嘲（2026-10-03 第三批）──
  '🎲 编程全靠蒙',
  '🙏 AI救我狗命',
  '🐛 Bug制造机',
  '🔮 玄学调参',
  '📿 面向祈祷编程',
  '🩹 补丁摞补丁',
  '🤞 能跑就行',
  '🗿 代码能跑别动',
  '🎰 随机数人生',
  '🧙 咒语背诵者',
  '📖 文档从不看',
  '⌨️ 只会复制粘贴',
  '🫠 菜得安详',
  '🥹 菜狗本狗',
  '🐣 刚会写Hello',
  '🧸 删库跑路预备',
  '🪫 脑子已关机',
  '🫥 假装很忙',
  '🎭 专业演技派',
  '🃏 气氛组组长',
  '🧊 情绪稳定到麻木',
  '🐟 摸鱼终身成就',
  '🛋️ 沙发项目经理',
  '📺 带薪看视频',
  '🍵 带薪养生',
  '💤 工位睡神',
  '⏳ 明日复明日',
  '🗓️ 周报最后写',
  '📉 进度条倒退',
  '🕳️ 坑是自己挖的',
  '🧨 技术债主',
  '💀 穷得响叮当',
  '📵 社交电池耗尽',
  '🍼 成年巨婴',
  '🪞 镜子前叹气',
  '🧦 袜子不成对',
  '🥲 笑着活下去',
]

/** 本会话的昵称 —— 模块级（扩展重复注册时闭包变量不共享，同 agentEndSeen 的坑）。
 * 空串 = 未抽（或 ABS_TODO_NICK=0 关掉）。 */
let sessionNickname = ''

/** 抽一条昵称。传 rnd 便于测试注入；默认 Math.random。关掉：ABS_TODO_NICK=0。 */
export function pickNickname(rnd: () => number = Math.random): string {
  if (String(process.env.ABS_TODO_NICK || '') === '0') return ''
  const i = Math.min(USER_NICKNAMES.length - 1, Math.floor(rnd() * USER_NICKNAMES.length))
  return USER_NICKNAMES[Math.max(0, i)]
}

/** 解析 todo.md 的 ## Todo 区 —— 只收未完成行（- [ ]），Done 区不计。
 *
 * who 不为空时只收“我的任务”：行内有 [[who]] 的，或**完全没标作者**的
 * （老任务/手写的没标，漏掉比多显示更糟）。标了别人的则不收。
 *
 * 断点行（缩进的 ↳）归属到它上一条任务，不单独成条。 */
export function parseOpenTasks(md: string, max = PANEL_MAX_ROWS, who = ''): {
  total: number
  rows: { state: string; id: string; desc: string; note: string }[]
  hidden: number
} {
  // 两阶段：先无过滤地按序解析（断点归属需要“上一条”是原文里真正的前一条），
  // 再按作者过滤。若边解析边过滤，被滤掉的条目下方的断点会挂到它上面那一条
  // —— 实测：别人任务的断点会显示在我的任务下面（2026-10-03 审查发现）。
  type Row = { state: string; id: string; desc: string; note: string; authors: string[] }
  const parsed: Row[] = []
  let inTodo = false
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trimEnd()
    if (/^##\s+Todo\s*$/.test(line)) { inTodo = true; continue }
    if (/^##\s+/.test(line)) { inTodo = false; continue }
    if (!inTodo) continue
    // 断点行：`  ↳ 断点: …`（缩进）→ 挂到上一条任务
    const note = line.match(/^\s+↳\s*断点:\s*(.*)$/)
    if (note) {
      const last = parsed[parsed.length - 1]
      if (last && !last.note) last.note = note[1].trim()
      continue
    }
    // `- [ ] [状态] <id> …`；状态标记可能缺省
    const m = line.match(/^-\s+\[\s\]\s+(?:\[([^\]]+)\]\s+)?(\S+)\s*(.*)$/)
    if (!m) continue
    const state = m[1] || '进行中'
    const id = m[2]
    const body = m[3] || ''
    const authors = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1])
    // 剥掉作者标记（面板上碍眼且无信息量），再取 `—` 后正文
    const desc = body
      .replace(/\[\[[^\]]+\]\]/g, '')
      .replace(/^\s*—\s*/, '')
      .replace(/\s*\(认领\s*\d{4}-\d{2}-\d{2}\)\s*$/, '')
      .trim()
    parsed.push({ state, id, desc, note: '', authors })
  }
  const mine = who
    ? parsed.filter((r) => r.authors.length === 0 || r.authors.includes(who))
    : parsed
  const rows = mine.map(({ state, id, desc, note }) => ({ state, id, desc, note }))
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

/** 按显示宽度截断（自己实现，不 import @earendil-works/pi-tui）。
 *
 * 为何不直接用 pi-tui 的 truncateToWidth（2026-10-03 实测）：那是 pi 内部 alias，
 * 裸包名只在 pi 的 jiti loader 下能解析 —— 测试环境用原生 node 加载扩展会
 * ERR_MODULE_NOT_FOUND（实测挂了 6 个测试）。依赖宿主内部 alias 太脆。
 *
 * 宽度规则：CJK/全角记 2 列，其余记 1 列。足够让面板不溢出（不能处理 emoji ZWJ 序列，
 * 但面板里没有—— todo 内容是任务名与说明）。 */
function dispWidth(s: string): number {
  let w = 0
  let i = 0
  while (i < s.length) {
    const m = /^\x1b\[[0-9;]*m/.exec(s.slice(i))
    if (m) { i += m[0].length; continue }
    const cp = s.codePointAt(i) || 0
    const ch = String.fromCodePoint(cp)
    i += ch.length
    // 常见全角/CJK 区间（足以覆盖中文任务名）
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f64f) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff)
    w += wide ? 2 : 1
  }
  return w
}

/** 去掉 ANSI 转义序列（\x1b[...m 等），否则宽度计算会把颜色码也算进去。 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

/** 控宽截断：超宽则尾部换省略号（省略号算 1 列）。
 *
 * 注意：入参可能含 ANSI 颜色码（我们的 head 就是 fg() 拼的）。颜色码占 0 列，
 * 必须先剥掉再量宽 —— 否则每行都会被误判超宽而截断。
 * 截断后不再恢复颜色（该行尾会失去颜色，但省略号前的内容色仍在）—— 可接受，
 * 因为只有超长行才会走到这里。 */
function clipToWidth(s: string, width: number): string {
  if (width <= 0) return ''
  if (dispWidth(stripAnsi(s)) <= width) return s
  const keep = width - 1
  let out = ''
  let w = 0
  let i = 0
  // 逐字符扫描，遇到 ANSI 序列原样跳过（不计宽）
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
// ---------------------------------------------------------------------------
// “进行中”行的迷你动画（2026-10-03 用户需求）：三个小符号依次由空心变实心。
// 帧宽固定 3 列 —— 宽度不变才不会让面板每帧抖动（这也是不用 ⠋⠙⠹ 那种 spinner 的原因：
// 那个只闪一个符，用户明确要的是“三个点依次点亮”）。
// 平铺 6 帧：亮→全亮→退回（呼吸感），而不是全亮后硬跳回全空。
const TODO_ANIM_FRAMES = ['○○○', '●○○', '●●○', '●●●', '●●○', '●○○']
const TODO_ANIM_MS = 250

/** 动画相位（每 tick +1）。模块级 —— 同 agentEndSeen，闭包 flag 在重复注册时不共享。 */
let animPhase = 0
let animTimer: ReturnType<typeof setInterval> | undefined

/** 启动/保持动画定时器。重复调用不会叠加（已存在则不动）。
 * getTui 是为了每 tick 拿**当前**的 tui 引用 —— widget 可能因刷新被重建，
 * 持旧的引用会调到一个已被丢弃的 renderer。 */
function startAnimTimer(getTui: () => any): void {
  if (animTimer) return
  animTimer = setInterval(() => {
    animPhase++
    try { getTui()?.requestRender?.() } catch {}
  }, TODO_ANIM_MS)
  // 别阻止进程退出（扩展是宿主进程的一分子，定时器不该吊住事件循环）
  ;(animTimer as any)?.unref?.()
}

function stopAnimTimer(): void {
  if (animTimer) { clearInterval(animTimer); animTimer = undefined }
}

/** 取当前动画帧（phase 每 tick +1，由定时器驱动）。非进行中的行不传 phase（不显示）。 */
export function todoAnimFrame(phase: number): string {
  const n = TODO_ANIM_FRAMES.length
  const i = ((Math.floor(phase) % n) + n) % n
  return TODO_ANIM_FRAMES[i]
}

export function renderPanelLines(
  data: { total: number; rows: { state: string; id: string; desc: string; note: string }[]; hidden: number },
  who: string,
  width: number,
  fg: (color: string, s: string) => string,
  animPhase = -1,
  nickname = '',
): string[] {
  // ★ 空看板不再直接返回空数组（2026-10-06 用户要求：「即便 todo 没有列表，也要在 pi 上显示」）。
  //   理由与看板段一致：面板是「机制在不在」的常驻指示，进去就看不见 = 不知道机制活着。
  //   下面仍要画框和标题，所以这里只是不再提前 return。
  const colorOf = (state: string): string => (state === '搁置' ? 'dim' : state === '滞留中' ? 'muted' : state === '讨论中' ? 'dim' : 'accent')
  const lines: string[] = []
  // 上描边：用 `thinkingOff` —— 跟 Pi 输入框描边**完全同一个色**。
  // 排查过程（2026-10-03 用户两轮反馈）：
  //   ① 用 dim = okhsl(229 8% 56%) → 用户说“太亮”（比输入框亮 7%）
  //   ② 改 border = okhsl(231 57% 65%) → 用户说“怎么是蓝色的”（高饱和度蓝紫）
  //   ③ 真相：输入框的描边是 theme.getThinkingBorderColor(level)，level=off 时
  //      就是 thinkingOff = okhsl(229 8% 49%)（纯灰低饱和）。
  // 教训：看到“跟宿主某个 UI 元素一致”的需求，必须去宿主源码查那个元素
  // **实际**用了哪个主题色，不能按名字猜（border 听着像框线，其实不是输入框那个）。
  // 满宽（不 -1）—— 对齐 pi 自己的 DynamicBorder.render：`"─".repeat(Math.max(1, width))`。
  // 曾写 width-1 怕折行，但 pi 自己就满宽画，用户实报“右侧缺一小块”。
  // 且我们传入的 fg() 包了一层 ANSI，ANSI 不占列宽，不会因此溢出。
  lines.push(fg('thinkingOff', '─'.repeat(Math.max(1, width))))
  // 昵称附在作者名后（会话内固定，启动时随机抽）。
  const whoPart = who ? who + (nickname ? ` · ${nickname}` : '') : nickname
  const title = whoPart ? `📋 todo (${data.total}) — ${whoPart}` : `📋 todo (${data.total})`
  lines.push(clipToWidth(fg('accent', title), width))

  const lastIdx = data.rows.length - 1
  // 空看板：标题下摆一行事实（与 system prompt 里的看板段同口径）。
  // 只摆事实、不写劝告 —— 「记得登记」那类已被 13 次尝试证明无效（见 OPENING_RULES 注解）。
  if (data.total === 0) {
    lines.push(clipToWidth(`  ${fg('dim', '（无未完成任务）')}`, width))
    return lines
  }
  data.rows.forEach((t, i) => {
    // `└─` 只给最后一条 —— 不管它有没有断点。
    // （2026-10-03 审查修正：原条件 `i === lastIdx && !t.note` 会让“末条带断点”时
    //  全篇没有 └─ 收尾，断点行的 │ 又延伸到视觉底部，看起来像列表被截断。）
    const isLast = i === lastIdx
    const branch = isLast ? '└─' : '├─'
    // 进行中的行带一个小动画（其余行不加，避免满屏都在跳）
    const anim = t.state === '进行中' && animPhase >= 0 ? ' ' + fg('accent', todoAnimFrame(animPhase)) : ''
    const head = `${fg('dim', branch)} ${fg(colorOf(t.state), `[${t.state}]`)} ${fg('text', t.id)}${anim}`
    const desc = t.desc ? ` ${fg('dim', '—')} ${fg('muted', t.desc)}` : ''
    lines.push(clipToWidth(head + desc, width))
    if (t.note) {
      // 断点行：挂在父任务下。末条时用空格对齐（└─ 下方无续）；否则用 │ 延伸。
      const cont = isLast ? '  ' : fg('dim', '│ ')
      lines.push(clipToWidth(`${cont} ${fg('dim', '↳ ' + t.note)}`, width))
    }
  })

  if (data.hidden > 0) lines.push(clipToWidth(fg('dim', `  +${data.hidden} more`), width))
  return lines
}
/** 隐藏面板。**必须主动 requestRender** —— 否则数据清了、屏幕还留着旧画面。
 *
 * 坑(2026-10-05 用户实报): 任务全标完后面板不消失, 按 ESC 或重启才正常。
 * 根因: 唯一的重绘入口是动画定时器里的 requestRender, 而"任务全完成"恰好让
 *   needAnim=false → stopAnimTimer() → 从此没有任何人请求重绘 → 屏幕冻结在旧帧。
 * 即"消失"这个动作本身把它自己的重绘通道关掉了。
 * 故消失路径要自己 requestRender 一次。 */
function hidePanel(ui: any): void {
  try { ui.setWidget(PANEL_KEY, undefined) } catch {}
  stopAnimTimer()
  try { lastTui?.requestRender?.() } catch {}
}

async function refreshTodoPanel(ui: any, cwd: string): Promise<void> {
  if (String(process.env.ABS_TODO_PANEL || '') === '0') return
  if (!ui || typeof ui.setWidget !== 'function') return
  try {
    if (!(await hasBrain(cwd))) { hidePanel(ui); return }
    const md = await readFile(join(cwd, '.brain', 'todo.md'), 'utf8')
    const who = await currentUser()
    const data = parseOpenTasks(md, PANEL_MAX_ROWS, who)
    // 任务为空**也显示面板**（摆一行「（无未完成任务）」），只有无图谱才隐藏。
    // 曾写 data.total === 0 → hidePanel；用户 2026-10-06 要求改掉。
    // factory 形式：render(width) 每帧拿真实宽度 → 按宽度截断，不再断字。
    // 动画：phase 存在模块级，render 时读当前值；定时器只在本帧重绘，不重建 widget。
    let tuiRef: any = null
    ui.setWidget(
      PANEL_KEY,
      (tui: any, theme: any) => {
        tuiRef = tui
        lastTui = tui   // 供 hidePanel 在"无动画"时也能请求重绘
        return {
          render: (width: number) =>
            renderPanelLines(
              data,
              who,
              width,
              (c: string, s: string) => theme.fg(c, s),
              animPhase,
              sessionNickname,
            ),
          invalidate: () => {},
        }
      },
      { placement: 'aboveEditor' },
    )
    // 只在真有“进行中”任务时跑定时器 —— 否则白刷 CPU（无动画可播）。
    const needAnim = data.rows.some((t) => t.state === '进行中')
    if (needAnim) startAnimTimer(() => tuiRef)
    else stopAnimTimer()
    // ★ 无动画时得自己刷一帧（2026-10-06）。
    //   旧代码靠“任务清空→hidePanel”顺带 requestRender；现在空看板不隐藏了，
    //   若这里不主动刷，从“有任务”变成“无任务”时屏幕会冻结在旧帧
    //   （标题还写着旧计数）—— 与 2026-10-05 那个静默 bug 同一族。
    //   仍在 needAnim 时不用管：定时器每帧会刷。
    if (!needAnim) try { lastTui?.requestRender?.() } catch {}
  } catch {
    hidePanel(ui)
  }
}

export default function absPiHook(pi: ExtensionAPI): void {
  // 埋点状态同上，故意声明在**模块级**（不在被反复调用的工厂函数里）。
  resetThrottle()

  pi.on("session_start", (event: any, ctx: any) => {
    // 新会话 = 重新登记：不重置则同进程的第二个会话永远不再落断点
    autoTaskSeen = false
    filesSeen.clear() // 同理：新会话的文件痕迹不能带到下个会话
    loadInjected.clear() // 同：新会话的每个目录都要重新摆一次开局状态
    loadPending = ''     // 同：上一会话末轮未完的“待确认”不得带到新会话
    openingRulesLogged = false // 同：首轮硬规则的日志标记每会话重算
    resetThrottle()
    // 本会话的随机昵称 —— 在这里抽一次（不是每帧抽，否则面板会疯狂闪）。
    // 每次 session_start（startup/reload/new/resume/fork）重抽 → “每次打开 pi 都是随机的”。
    sessionNickname = pickNickname()
    logHook(`session_start nickname=${sessionNickname || '(off)'}`).catch(() => {})
    // 启动/重载时就画出面板（reason=startup|reload|new|resume|fork）。
    // 时序：pi 在 session_start 时已给 ctx.ui（无 UI 时是 noOp，调了不报错），
    // 但设 setWidget 需真的 TUI —— 故用 hasUI 挡一下并留痕，便于判定“没显示”的原因。
    const cwd = (ctx && ctx.cwd) || process.cwd()
    if (ctx && ctx.hasUI) {
      refreshTodoPanel(ctx.ui, cwd)
        .then(() => logHook(`session_start panel drawn reason=${event?.reason}`).catch(() => {}))
        .catch(() => logHook(`session_start panel error reason=${event?.reason}`).catch(() => {}))
    } else {
      logHook(`session_start panel skipped no_ui reason=${event?.reason}`).catch(() => {})
    }
    return logHook("session_start").catch(() => {})
  })

  // 面板实时刷新（两事件配合）—— 为何不能只用其中一个：
  //   实测（2026-10-03）MCP 工具在 tool_execution_end 里的 toolName 是代理入口名
  //   `mcp__abs`，**不是子工具名**，且该事件不带 args → 无法从它分辨是不是 abs_task。
  //   而 tool_call 带 input，能从里面认出目标工具，但它在**执行前**触发（此刻 todo.md 还没变）。
  // 故：tool_call 认出“刚才调的是 todo 工具”→ 置标记；tool_execution_end 看到标记就刷 → 清标记。
  // 始终保留 turn_end 兜底（实测每条 assistant 消息都触发，约 4 秒一次）。
  // 标记在模块级（重复注册时闭包 flag 不共享 —— 见 agentEndSeen 的注解）。
  pi.on("tool_call", (event: any, ctx: any) => {
    const name = String(event?.toolName || '')
    const input = event?.input || {}
    // 两种形态：① MCP 代理入口 mcp__abs + input.tool=abs_task；② 直接工具名 abs_task
    const target = String(input?.tool ?? input?.name ?? '')
    if (/abs_(task|board)/.test(name) || /abs_(task|board)/.test(target)) {
      pendingTodoTool = true
      logHook(`tool_call todo_tool name=${name} target=${target || '-'}`).catch(() => {})
    }
    // 自动登记断点（2026-10-05）：真的动文件时，把「改到哪个」记进本会话的自动任务。
    // 为何不用「第一次 tool_call」：排查类会话先跑一堆读命令，断点会落在无关文件上。
    // 写类工具只留一行痕（可观测），不 spawn、不写看板 —— 见上面的删除说明。
    if (!autoTaskSeen && isWriteCall(name, input)) {
      autoTaskSeen = true
      const sid = sessionIdFor(ctx)
      logHook(`tool_call first_write name=${name} sid=${sid || '-'}`).catch(() => {})
    }
    // 记下动过的文件（去重）—— 下一轮对齐时摆给 LLM（见 filesSeen 注释）。
    // 每轮都记（不限首次）：一轮里改多个文件都要能看到。
    if (isWriteCall(name, input)) {
      const p = touchedPath(name, input)
      if (p && filesSeen.size < FILES_SEEN_MAX) filesSeen.add(p)
    }
  })

  pi.on("tool_execution_end", (_event: any, ctx: any) => {
    if (!pendingTodoTool) return
    pendingTodoTool = false
    logHook(`tool_execution_end panel refresh after todo tool`).catch(() => {})
    refreshTodoPanel(ctx?.ui, (ctx && ctx.cwd) || process.cwd()).catch(() => {})
  })

  pi.on("turn_end", (_event: any, ctx: any) => {
    const cwd = (ctx && ctx.cwd) || process.cwd()
    logHook(`turn_end panel refresh cwd=${cwd}`).catch(() => {})
    refreshTodoPanel(ctx?.ui, cwd).catch(() => {})
  })

  // todo 及时性验证（2026-10-03）：往 system prompt 的 Guidelines 段追加静态条目。
  // 不新增消息、不抢 turn、不产生对话条目 —— 与删掉的两次注入做法本质不同（见文件头）。
  // 留一行日志：否则「有没有生效」只能凭感觉，无法验证。
  pi.on("before_agent_start", (event: any, ctx: any) => {
    const cwd = (ctx && ctx.cwd) || process.cwd()
    // 异步 handler：pi 会 await（emitBeforeAgentStart 是 await 的），故可以查盘。
    return (async () => {
      try {
        if (!(await hasBrain(cwd))) {
          // 无图谱 → 自动建一个（2026-10-06 用户拍板方案 A：任何目录都建）。
          // 为何是 A 而非「只对有 .git 的目录建」：用户明确认定 ~ 这种也算项目，
          //   而 ~ 没有 .git/package.json —— 按项目标志判会把它排除掉，与需求相反。
          // 子进程跑（与 readLoadForGuide 同一路子）：hook 是被单文件复制到
          //   ~/.pi/agent/extensions/ 的，那里没有 ../src/，不能 import 源码。
          // 幂等：init 自带「结构不完整报明细」，已有内容一律不动（见 abs init --help）。
          // 失败静默：建不出来（无权限/只读盘）不该弄坏对话，只是本轮不注入。
          const inited = await autoInit(cwd)
          logHook(`before_agent_start auto_init=${inited ? 'ok' : 'fail'} cwd=${cwd}`).catch(() => {})
          if (!(await hasBrain(cwd))) {
            logHook(`before_agent_start todo_guide=off reason=no_brain`).catch(() => {})
            return
          }
        }
        const ok = injectTodoGuidelines(event?.systemPromptOptions, await readBoardForGuide(cwd))
        // 开学每个目录垫一次 load 全文（同目录只一次；之后靠上面那个看板段反复对齐）。
        // 注意这里**不置 loadInjected** —— 注入点只是在 prompt 提交后、agent loop 前，
        // 对话还没发出去；此刻置位会让被中断的那轮白烧掉标记（见 loadInjected 注解）。
        let loadState = 'skip'
        if (!loadInjected.has(cwd)) {
          const loadText = await readLoadForGuide(cwd)
          // 首轮硬规则（方案 B，2026-10-06）—— 与 load 同一机会（同目录只一次）。
          // 为何挂在这里而不另设 flag：两者都是「开工那一刻只说一次」，
          //   且共用「送达确认」语义 —— 若这轮被中断，下轮两者一起重送，不会一个送一个不送。
          const rulesOn = injectOpeningRules(event?.systemPromptOptions)
          if (loadText) {
            injectLoadGuideline(event?.systemPromptOptions, loadText)
            loadPending = cwd // 送达确认交给 agent_end
            loadState = 'on'
          } else {
            loadState = 'empty'
            loadInjected.add(cwd) // 失败也不重试：不每轮白查一次盘
          }
          if (rulesOn) openingRulesLogged = true
        }
        // 【临时取证 2026-10-06】seen= 把 Set 内容原样打出来：
        //   真实环境里 agent_brain_sync 从未 load_delivered 却 still skip → 与「按 cwd 分」矛盾。
        //   靠这行区分：Set 空（→ 判断写错）vs Set 里已有该 cwd（→ 有东西提前加进去了）。
        //   定位并修好后删掉这行。
        logHook(`before_agent_start todo_guide=${ok ? 'on' : 'off'} load_guide=${loadState} opening_rules=${openingRulesLogged ? 'on' : 'skip'} seen=[${[...loadInjected].join(',')}] pending=[${loadPending}] cwd=${cwd}`).catch(() => {})

        // 自动登记已整体移除（2026-10-05 用户实报两点）：
        //   ① 卡顿 —— agent_end 每轮 spawn 一个 node 进程
        //   ② 看板冒出大量 `auto-TBD-xxx — 待命名` 占位
        // 结论: hook 只留【可观测痕迹】，不写看板、不起进程。登记回到 agent 主动调 abs task。
        // 教训见 concept auto-todo-register-design 的"为什么最后删掉自动登记"一节。
      } catch (e: any) {
        logHook(`before_agent_start error=${e?.message || 'unknown'}`).catch(() => {})
      }
    })()
  })

  // 收尾注入已停用（2026-09-18）：sendUserMessage(deliverAs:"followUp") 会在每轮
  // agent_end 抢一个 follow-up turn，用户实报「每次干活干一会出来, 任务就中断了」。
  //
  // 为何是删除而非调参：这跟 2026-09-15 删掉「写文件即注入登记提醒」是同一个错
  // ——「往对话里插一句话」本身就不是频率问题（见文件头）。每轮弹、每会话弹、
  // 每项目弹，都还是在打断用户。故不再有 teardownNudged/inFlight/loggedToday 判据。
  // 只保留 agent_end:seen 埋点：区分「事件没触发」与「被守卫拦下」。
  pi.on("agent_end", async (_event: any, ctx: any) => {
    const cwd = (ctx && ctx.cwd) || process.cwd()
    const brain = await findBrain(cwd)
    // 可观测性: 每会话首次留一行痕（区分"事件没触发"与"被守卫拦下"）。
    if (!agentEndSeen) {
      agentEndSeen = true
      await logHook(`agent_end:seen cwd=${cwd} brain=${brain || 'none'}`).catch(() => {})
    }
    // 送达确认（2026-10-06 方案 A）：走到这里 = 这轮真跑完了 → 才算“LLM 看到了”。
    // 中断/ESC 掉的那轮不会到 agent_end → 该 cwd 入不了集合 → 下轮自动补注入。
    // 这是**唯一**该写 loadInjected 的地方（别挪回 before_agent_start）。
    if (loadPending) {
      loadInjected.add(loadPending)
      const done = loadPending
      loadPending = ''
      await logHook(`agent_end load_delivered cwd=${done} seen=[${[...loadInjected].join(',')}]`).catch(() => {})
    }
    // 每轮 spawn 已删除（2026-10-05 用户实报"卡顿"）：agentEndSeen 一旦置位，
    // 下面那个条件就恒真 → 每轮结束都起一个 node 进程，纯属白烧。
    // 断点改由 agent 在用 abs_task 时自己写（那时它本来就在跑，不额外起进程）。
  })

  pi.on("session_shutdown", (_e: any, ctx: any) => {
    stopAnimTimer() // 面板没了，动画定时器必须一起停（否则残留定时器白刷已丢弃的 tui）
    snapshotWrapup((ctx && ctx.cwd) || process.cwd())
    logHook("session_shutdown").catch(() => {})
  })
}

@@MARK@@