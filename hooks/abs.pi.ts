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
 * 登记提醒 (2026-09-15 用户定): 写文件 = 任务开始的机械信号。
 *   旧设计只在 agent_end 提醒收尾 —— 但那时用户已想结束, AI 只想收尾不想登记;
 *   且「任务何时开始」只有写文件那一刻清楚, 事后回忆必漏。
 *   故 turn_end 检测到**项目文件**写入即注入登记提示(不等 agent_end):
 *     · 频繁没关系 —— 每轮改文件都提醒(用户明确要求), 用 nudgeCount 防同一轮重复
 *     · 判据 = 整个项目, 但**排除 .brain/ 自身**(写图谱不是任务, 是记录行为)
 *     · 文案明说「纯讨论可跳过」—— 不逼 AI 造任务(否则会长出假条目污染看板)
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

// 写文件 = 任务开始的机械信号。
// 注: `abs note` / `abs log` 也会写文件 —— 但那是**记录行为**不是任务，
// 所以要排除 .brain/ 自身（否则每落一条经验都弹一次登记提醒，纯噪音）。
// ponytail: 用路径前缀判，不解析项目根（子目录/软链场景可能漏判；
// 漏判的代价只是少提醒一次，不丢数据）。
const BRAIN_PATH = /\.brain[\/]/;

function isProjectWrite(p: string | undefined, cmd?: string): boolean {
  if (cmd !== undefined) return !READONLY_CMD.test(cmd); // bash: 非只读就算
  if (!p) return false;
  return !BRAIN_PATH.test(String(p));
}

/** 从一轮的 toolResults 里抽出「改过的项目文件」。排除 .brain/ 自身。 */
function projectWrites(toolResults: any[]): string[] {
  const out = new Set<string>();
  for (const r of toolResults || []) {
    const name = String(r?.toolName || "");
    if (!WRITE_TOOLS.has(name)) continue;
    if (r?.isError) continue;
    if (name === "bash") {
      const cmd = String(r?.input?.command ?? r?.args?.command ?? "");
      if (!isProjectWrite(undefined, cmd)) continue;
      out.add("bash: " + cmd.slice(0, 60));
      continue;
    }
    const f = r?.input?.file_path ?? r?.args?.file_path ?? r?.input?.path ?? r?.args?.path;
    if (isProjectWrite(f ? String(f) : undefined)) out.add(String(f));
  }
  return [...out];
}

export default function absPiHook(pi: ExtensionAPI): void {
  // 收尾注入的节流状态。声明在**外层** + 在 session_start 里重置：
  // 否则同一进程的第二个会话会继承上一个会话的 true，永久不再提醒
  // （2026-09-13 实测：同一天多个会话时后半场全部静默）。
  let teardownNudged = false
  let agentEndSeen = false
  // 登记提醒节流：只需防**同一轮内**重复注入（一个 turn_end 只提醒一次）。
  // 跨轮不去重 —— 用户明确要「频繁一点」：同一文件改第二回仍是新任务进展，
  // 该提醒。曾经用「文件列表」当去重键 → 同一文件再改就永不提醒（实测 step②失败）。
  let lastNudgedTurn = -1
  let turnSeq = 0

  pi.on("session_start", () => {
    teardownNudged = false
    agentEndSeen = false
    lastNudgedTurn = -1
    turnSeq = 0
    return logHook("session_start").catch(() => {})
  })

  // ---- 素材锚点（不烧上下文、不注入消息、不 spawn、不落盘）----
  // 用户发话 = 天然的话题边界。这是 C 路线：你说的每句话都是一个锚点。
  pi.on("before_agent_start", async (event: any, _ctx: any) => {
    addNote("user", String(event?.prompt || ""))
  })

  // 每轮结束 = 这轮干了什么（改了哪些文件）。机械事实，供收尾时回忆。
  // 同时：写文件 = 任务开始 → **立刻**提醒登记（不等 agent_end）。
  pi.on("turn_end", async (event: any, ctx: any) => {
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

    // ---- 登记提醒：项目文件被写 = 任务已经开始 ----
    const touched = projectWrites(event?.toolResults || [])
    if (!touched.length) return
    const me = ++turnSeq
    if (me === lastNudgedTurn) return // 同一轮不重复（turn_end 理论上只来一次，防御）
    lastNudgedTurn = me
    const cwd = (ctx && ctx.cwd) || process.cwd()
    if (!(await findBrain(cwd))) return // 无图谱 = 不在这项目沉淀，不打扰
    await logHook(`turn_end:register-nudge files=${touched.length}`).catch(() => {})
    try {
      pi.sendUserMessage(
        "[abs 登记提醒] 本轮改了项目文件，说明有任务在进行。\n" +
        "改了：" + touched.slice(0, 6).join(", ") + (touched.length > 6 ? ` 等 ${touched.length} 个` : "") + "\n" +
        "若这属于某个任务，立刻登记（别等到会话结束才回忆——那时必漏）：\n" +
        "  · 新任务: abs todo add <id> --note \"做什么\"\n" +
        "  · 已有任务: abs todo note <id> --note \"改到哪/下一步\"\n" +
        "  · 纯讨论/调研/改图谱自身 → 无需登记，回「跳过」即可。\n" +
        "简洁执行，不要复述本条提醒。",
        { deliverAs: "followUp" },
      )
    } catch {}
  })
  // 收尾注入: 每个会话最多一次, 避免反复打扰。
  pi.on("agent_end", async (event: any, ctx: any) => {
    if (teardownNudged) return
    const cwd = (ctx && ctx.cwd) || process.cwd()
    const brain = await findBrain(cwd)
    // 可观测性: 本会话首次 agent_end 无条件留一行痕。
    // 没有它就无法区分三种状态: ①事件没触发 ②触发了但被守卫拦下 ③真注入了。
    if (!agentEndSeen) {
      agentEndSeen = true
      // 带上 cwd 与命中的 brain —— 否则事后无法解释“为何这条 nudge 会出现”
      await logHook(`agent_end:seen cwd=${cwd} brain=${brain || 'none'}`).catch(() => {})
    }
    if (!brain) return // 无图谱=不在这项目沉淀, 不打扰
    if (!hasWriteWork(event?.messages ? collectToolResults(event.messages) : [])) return
    // 今日已收尾 → 只在**本会话还没真正干事**时才静默。
    // 旧行为：今天 log 有一行就整天闭口 —— 于是收尾之后的产出全部没人提醒。
    // 注意不能用 sessionNotes.length 当判据：用户每说一句话就会 push 一条，
    // 那会让 nudge 每轮都触发（噪音）。判据保持「今天已收尾」但配合下面的笔记消费。
    if (await loggedToday(brain)) return
    teardownNudged = true
    await logHook("agent_end:teardown-nudge").catch(() => {})
    // 素材交给 AI 后清空：同一会话再触发时不该重复喂旧料。
    const notes = sessionNotes.splice(0, sessionNotes.length)
    try {
      pi.sendUserMessage(
        "[abs 收尾提醒] 本会话改过文件但 .brain/ 今天还没有记录。请立即走收尾循环：\n" +
        "1) 跑 abs load 看 Todo 还有哪些未完成；\n" +
        "2) 实际做完漏登记的 abs todo done <id>，做到一半的 abs todo note <id> --note \"断点\"；\n" +
        "3) 值得留的经验 abs note \"...\"（宁少勿滥，能从代码 grep 到的不记）；\n" +
        "4) abs log \"完成 X：...\" 记一行工作成果，新页同步进 index。\n" +
        notesBlock(notes) +
        "简洁执行，不要复述本条提醒。若本次确实没有可沉淀产出，直接回一句\"无可沉淀\"即可。",
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
