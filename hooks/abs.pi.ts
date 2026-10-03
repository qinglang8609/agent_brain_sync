/**
 * abs (agent-brain-sync) — Pi extension。
 * 纯触发: 会话生命周期事件 → 技术日志一行 (~/.abs/log/hooks.log, ABS_LOG_DIR 可覆盖)。fire-and-forget。
 * 纪律: hook 事件只进技术日志, 不进图谱 log.md (log.md 只收工作成果沉淀, 与 event.sh 同纪律)。
 * Pi 事件: session_start / session_shutdown (对应 host hook 的 SessionStart/SessionEnd)。
 * session_shutdown 额外触发 abs wrapup: 把当前项目未完成任务快照到 wrapup.log (跨会话收尾保险)。
 * agent_end 只留可观测性埋点(agent_end:seen), 不再向对话注入任何东西。
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

const ABS_BIN = "@@ABS_BIN@@"

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

/** 会话边界重置埋点状态。
 *  不重置 → 同进程第二个会话继承 true 永久不留痕（2026-09-13 实测过的坑）。 */
function resetThrottle(): void {
  agentEndSeen = false
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
const TODO_GUIDELINES = [
  'Use `mcp__abs__abs_task` to track multi-step work **before** you start it, not after: on the first file edit of a task, call action "start" with a short id.',
  'Mark a task "done" immediately when it finishes — never batch completions at the end of a session.',
  'Before starting a task, record the checkpoint with action "note" (which file, which step) so a later session can resume.',
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

function injectTodoGuidelines(options: any): boolean {
  if (String(process.env.ABS_TODO_GUIDE || '') === '0') return false
  const list: string[] = options.promptGuidelines || (options.promptGuidelines = [])
  for (const g of TODO_GUIDELINES) {
    if (!list.includes(g)) list.push(g)
  }
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

/** 解析 todo.md 的 ## Todo 区 —— 只收未完成行（- [ ]），Done 区与 ↳ 断点行不计。
 *
 * who 不为空时只收“我的任务”：行内有 [[who]] 的，或**完全没标作者**的
 * （老任务/手写的没标，漏掉比多显示更糟）。标了别人的则不收。 */
export function parseOpenTasks(md: string, max = PANEL_MAX_ROWS, who = ''): { total: number; rows: string[]; hidden: number } {
  const out: string[] = []
  let inTodo = false
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trimEnd()
    if (/^##\s+Todo\s*$/.test(line)) { inTodo = true; continue }
    if (/^##\s+/.test(line)) { inTodo = false; continue }
    if (!inTodo) continue
    // `- [ ] [状态] <id> …`；状态标记可能缺省
    const m = line.match(/^-\s+\[\s\]\s+(?:\[([^\]]+)\]\s+)?(\S+)\s*(.*)$/)
    if (!m) continue
    const state = m[1] || '进行中'
    const id = m[2]
    const body = m[3] || ''
    // 作者过滤：抽出所有 [[name]]，有作者且不含 who 则跳过
    const authors = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1])
    if (who && authors.length > 0 && !authors.includes(who)) continue
    // 剥掉作者标记（面板上碍眼且无信息量），再取 `—` 后正文并裁短。
    const desc = body
      .replace(/\[\[[^\]]+\]\]/g, '')
      .replace(/^\s*—\s*/, '')
      .replace(/\s*\(认领\s*\d{4}-\d{2}-\d{2}\)\s*$/, '')
      .trim()
    out.push(`[${state}] ${id}${desc ? ' — ' + desc.slice(0, 60) : ''}`)
  }
  return { total: out.length, rows: out.slice(0, max), hidden: Math.max(0, out.length - max) }
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

/** 读 todo.md 并渲染面板。失败/空则移除面板（不报错 —— 面板是装饰，不能影响主流程）。 */
async function refreshTodoPanel(ui: any, cwd: string): Promise<void> {
  if (String(process.env.ABS_TODO_PANEL || '') === '0') return
  if (!ui || typeof ui.setWidget !== 'function') return
  try {
    if (!(await hasBrain(cwd))) { ui.setWidget(PANEL_KEY, undefined); return }
    const md = await readFile(join(cwd, '.brain', 'todo.md'), 'utf8')
    const who = await currentUser()
    const { total, rows, hidden } = parseOpenTasks(md, PANEL_MAX_ROWS, who)
    if (total === 0) { ui.setWidget(PANEL_KEY, undefined); return }
    const title = who ? `📋 todo (${total}) — ${who}` : `📋 todo (${total})`
    const lines = [title, ...rows.map((r) => '  ' + r)]
    if (hidden > 0) lines.push(`  +${hidden} more`)
    ui.setWidget(PANEL_KEY, lines, { placement: 'aboveEditor' })
  } catch {
    try { ui.setWidget(PANEL_KEY, undefined) } catch {}
  }
}

export default function absPiHook(pi: ExtensionAPI): void {
  // 埋点状态同上，故意声明在**模块级**（不在被反复调用的工厂函数里）。
  resetThrottle()

  pi.on("session_start", (event: any, ctx: any) => {
    resetThrottle()
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

  // 面板刷新时机：turn_end（一轮一刷）。
  // 为何不挂 tool_execution_end：abs_task 走 MCP，每次工具调用后刷会白刷很多次；
  // 一轮结束足以让人看到“刚才做了什么”。
  pi.on("turn_end", (_event: any, ctx: any) => {
    refreshTodoPanel(ctx?.ui, (ctx && ctx.cwd) || process.cwd()).catch(() => {})
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
          logHook(`before_agent_start todo_guide=off reason=no_brain`).catch(() => {})
          return
        }
        const ok = injectTodoGuidelines(event?.systemPromptOptions)
        logHook(`before_agent_start todo_guide=${ok ? 'on' : 'off'} cwd=${cwd}`).catch(() => {})
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
    if (agentEndSeen) return
    agentEndSeen = true
    const cwd = (ctx && ctx.cwd) || process.cwd()
    const brain = await findBrain(cwd)
    await logHook(`agent_end:seen cwd=${cwd} brain=${brain || 'none'}`).catch(() => {})
  })

  pi.on("session_shutdown", (_e: any, ctx: any) => {
    snapshotWrapup((ctx && ctx.cwd) || process.cwd())
    logHook("session_shutdown").catch(() => {})
  })
}

@@MARK@@
