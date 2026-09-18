/**
 * abs (agent-brain-sync) — Pi extension。
 * 纯触发: 会话生命周期事件 → 技术日志一行 (~/.abs/log/hooks.log, ABS_LOG_DIR 可覆盖)。fire-and-forget。
 * 纪律: hook 事件只进技术日志, 不进图谱 log.md (log.md 只收工作成果沉淀, 与 event.sh 同纪律)。
 * Pi 事件: session_start / session_shutdown (对应 host hook 的 SessionStart/SessionEnd)。
 * session_shutdown 额外触发 abs wrapup: 把当前项目未完成任务快照到 wrapup.log (跨会话收尾保险)。
 * agent_end 收尾注入: 本会话真改过文件 + .brain 今日无记录 → 注入一条收尾指令, 逼 agent 走收尾循环
 *   (被动记日志不够 —— 没人提醒就不会有人收尾)。每会话最多一次, 且已收尾后不再打扰。
 *
 * 素材累积 (B+C, 2026-09-13 用户定): 话题在会话中途连续产生, 而收尾提醒只在会话末尾——
 *   用一次性提醒追持续事件 = 记录率 7% (14 条话题只落 1 条)。故在能机械观察的锚点上累积素材:
 *     - before_agent_start (用户发话 = 天然话题边界) → 记用户原话
 *     - turn_end (每轮结束) → 记改过哪些文件
 *   累积在**内存**(下方 sessionNotes), 收尾时拼进注入提示 —— **不落盘**。
 *
 * 已删除（2026-09-15）：曾加过一个「写文件即任务开始 → 每轮注入登记提醒」的功能。
 *   已发布到 1.8.0 后用户实报「pi 里一直报 Follow-up」，判 C 整个删掉。
 *   教训：每次改文件就往对话里插一句话，本身就是设计错误，不是频率问题 ——
 *   改守卫（从每轮一次改成每会话一次）治不了它。别再加回来。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { appendFile, mkdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { spawn } from "node:child_process"

const ABS_BIN = "@@ABS_BIN@@"

// 素材累积锚点：会话内存里累积，收尾时拼进注入提示。**不落盘、不 spawn、不然上下文**。
// 预算：只留最近几条（收尾回忆只需线索，不需全史）。
const NOTES_MAX = 12
const NOTE_LEN = 120
const sessionNotes: string[] = []

function addNote(kind: string, text: string): void {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_LEN)
  if (!clean) return
  sessionNotes.push(`${kind}: ${clean}`)
  if (sessionNotes.length > NOTES_MAX) sessionNotes.shift()
}

/** 把本会话素材拼成一段（收尾注入用）。无素材则空字符串。
 * 用途：让 AI 据线索**归纳**话题，而不是凭记忆回想整场对话（那正是 7% 记录率的原因）。 */
function notesBlock(notes: string[]): string {
  if (!notes.length) return ""
  return "   本会话素材（hook 机械记录，供归纳）\n" +
    notes.map((n) => "     · " + n).join("\n") + "\n"
}

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

// ---- 收尾注入判定 ----
// 真改过文件的工具（read/grep/ls 不算, 那些不产生可沉淀的产出）
const WRITE_TOOLS = new Set(["write", "edit", "multi_edit", "apply_patch", "bash"])
// bash 里只跑查询类命令不算改文件
const READONLY_CMD = /^\s*(ls|cat|grep|rg|find|head|tail|wc|git\s+(status|log|diff|show|branch)|pwd|which|echo|node\s+-v|npm\s+(ls|view)|curl)\b/

function hasWriteWork(toolResults: any[]): boolean {
  for (const r of toolResults || []) {
    const name = String(r?.toolName || "")
    if (!WRITE_TOOLS.has(name)) continue
    if (r?.isError) continue
    if (name === "bash") {
      const cmd = String(r?.input?.command ?? r?.args?.command ?? "")
      if (READONLY_CMD.test(cmd)) continue
    }
    return true
  }
  return false
}

/** 定位当前项目的 .brain/：只看 cwd 本身，不向上搜索（防爬到家目录图谱）。 */
async function findBrain(cwd: string): Promise<string | null> {
  const d = cwd || process.cwd()
  try { const st = await stat(join(d, ".brain")); return st.isDirectory() ? join(d, ".brain") : null } catch { return null }
}

/**
 * .brain/log.md 今天有记录吗? 有=已收尾, 不再打扰。
 * 必须匹配条目头 '## [YYYY-MM-DD HH:MM]' —— 裸日期 substring 会被正文里任意一处
 * 今天的日期误命中, 导致"已收尾"误判、nudge 永不触发。
 */
async function loggedToday(brain: string): Promise<boolean> {
  try {
    const txt = await readFile(join(brain, "log.md"), "utf8")
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, "0")
    const today = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
    // 只认**工作成果**条目（kind=dev），不能只看“今天有没有行”。
    // 坑（2026-09-13 实测）：`abs note` 也写 log.md（kind=note），
    // 旧判据 (^## [今天 HH:MM]) 把“沉淀了一条经验”当成“今天已收尾”→
    // 整天不再提醒 → 会话后半场全部漏登。
    // 行格式: `## [YYYY-MM-DD HH:MM] [[name]] dev | 内容`。
    return new RegExp("^## \\[" + today + " \\d{2}:\\d{2}\\] (?:\\[\\[[^\\]]+\\]\\] )?dev \\|", "m").test(txt)
  } catch { return false }
}


/** 收尾注入的节流状态。
 *
 * 为何在**模块级**而不在 absPiHook() 里（2026-09-17 实测）：扩展会被重复注册
 * （session_start 11 分钟内触发 8 次），每次注册都新建一份闭包 → flag 不共享 →
 * 实测同会话 5 分钟注入 6 次。模块级状态在同一进程内只有一份，注册多少次都共享。
 *
 * teardownNudged  = 本会话已注入过（终态，session_start 才重置）
 * teardownInFlight = 正在判定中（抢在 await 之前置位，堵住并发重入）
 * agentEndSeen    = 本会话已留过 seen 痕（可观测性，同样每会话一次）
 */
let teardownNudged = false
let teardownInFlight = false
let agentEndSeen = false

/** 会话边界重置节流（session_start 与注册时都调）。
 *  不重置 → 同进程第二个会话继承 true 永久静默（2026-09-13 实测过的坑）。 */
function resetThrottle(): void {
  teardownNudged = false
  teardownInFlight = false
  agentEndSeen = false
}

export default function absPiHook(pi: ExtensionAPI): void {
  // 收尾注入的节流状态。故意声明在**模块级**（不在被反复调用的工厂函数里），
  // 因为**扩展会被重复注册**：实测 session_start 在 11 分钟内触发 8 次
  // （2026-09-17 00:07:58 一口气 3 次）。注册几份就得到几份独立闭包，
  // 各自的 flag 彼此看不见 → “每会话一次”变成“每实例一次” → 实测同会话 5 分钟注入 6 次。
  // 模块级状态在同一进程内共享，注册多少次都只有一份。
  resetThrottle()

  pi.on("session_start", (event: any, _ctx: any) => {
    resetThrottle()
    return logHook("session_start").catch(() => {})
  })

  // ---- 素材锚点（不烧上下文、不注入消息、不 spawn、不落盘）----
  // 用户发话 = 天然的话题边界。这是 C 路线：你说的每句话都是一个锚点。
  pi.on("before_agent_start", async (event: any, _ctx: any) => {
    addNote("user", String(event?.prompt || ""))
  })

  // 每轮结束 = 这轮干了什么（改了哪些文件）。机械事实，供收尾时回忆。
  pi.on("turn_end", async (event: any, _ctx: any) => {
    const files = new Set<string>()
    for (const r of event?.toolResults || []) {
      const name = String(r?.toolName || "")
      if (!WRITE_TOOLS.has(name)) continue
      if (r?.isError) continue
      const f = r?.input?.file_path ?? r?.args?.file_path ?? r?.input?.path ?? r?.args?.path
      if (f) files.add(String(f))
      else if (name === "bash") {
        const cmd = String(r?.input?.command ?? r?.args?.command ?? "")
        if (!READONLY_CMD.test(cmd)) files.add("bash: " + cmd.slice(0, 60))
      }
    }
    if (files.size) addNote("tool", [...files].join(", "))
  })

  // 收尾注入: 每个会话最多一次, 避免反复打扰。
  //
  // 坑（2026-09-17 实测定根因）：原实现是「先检查 flag → 若干 await → 才置位」，
  // 而 agent_end **每轮 run 结束都触发**（官方 docs/extensions.md:569：它不等于会话结束，
  // Pi 之后还可能继续跑 follow-up）。并发的多次调用因此**全部先通过 `if (nudged) return`**，
  // 之后才各自置位 → 一起注入。实测同会话 5 分钟内注入 6 次，全日志 55 次。
  // 修法：进函数**第一个动作**就抢占（置位在任何 await 之前），失败再把标志放回。
  // 这样“检查+设置”之间没有让出点，并发调用只有一个能赢。
  pi.on("agent_end", async (event: any, ctx: any) => {
    if (teardownNudged || teardownInFlight) return
    teardownInFlight = true
    // 从这里往下任何提前 return 都必须解除 in-flight（否则本次会话永久不再提醒）。
    const release = () => { teardownInFlight = false }
    const cwd = (ctx && ctx.cwd) || process.cwd()
    const brain = await findBrain(cwd)
    // 可观测性: 本会话首次 agent_end 无条件留一行痕。
    // 没有它就无法区分三种状态: ①事件没触发 ②触发了但被守卫拦下 ③真注入了。
    if (!agentEndSeen) {
      agentEndSeen = true
      // 带上 cwd 与命中的 brain —— 否则事后无法解释“为何这条 nudge 会出现”
      await logHook(`agent_end:seen cwd=${cwd} brain=${brain || 'none'}`).catch(() => {})
    }
    if (!brain) return release() // 无图谱=不在这项目沉淀, 不打扰
    if (!hasWriteWork(event?.messages ? collectToolResults(event.messages) : [])) return release()
    // 今日已收尾 → 只在**本会话还没真正干事**时才静默。
    // 旧行为：今天 log 有一行就整天闭口 —— 于是收尾之后的产出全部没人提醒。
    // 注意不能用 sessionNotes.length 当判据：用户每说一句话就会 push 一条，
    // 那会让 nudge 每轮都触发（噪音）。判据保持「今天已收尾」但配合下面的笔记消费。
    if (await loggedToday(brain)) return release()
    teardownNudged = true
    teardownInFlight = false
    await logHook("agent_end:teardown-nudge").catch(() => {})
    // 素材交给 AI 后清空：同一会话再触发时不该重复喂旧料。
    const notes = sessionNotes.splice(0, sessionNotes.length)
    try {
      pi.sendUserMessage(
        "[abs] 本会话改过文件，.brain/ 今日无记录。\n" +
        "这条是信息不是命令：该登记/沉淀就登记，没有可沉淀的直接回一句「无可沉淀」，不用凑。\n" +
        "先看任务：本会话做完的事有没有进看板？（abs todo / abs todo done <id>；干到一半 abs todo note <id> --note 断点）\n" +
        "再看沉淀：经验/坑 → abs note \"...\"；成果流水 → abs log \"...\"" +
        notesBlock(notes),
        { deliverAs: "followUp" },
      )
    } catch {}
  })

  pi.on("session_shutdown", (_e: any, ctx: any) => {
    snapshotWrapup((ctx && ctx.cwd) || process.cwd())
    logHook("session_shutdown").catch(() => {})
  })
}

/** agent_end 的 event.messages 里翻出 toolResult 消息。 */
function collectToolResults(messages: any[]): any[] {
  const out: any[] = []
  for (const m of messages || []) {
    if (m && m.role === "toolResult") out.push(m)
  }
  return out
}
@@MARK@@
