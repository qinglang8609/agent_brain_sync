/**
 * abs (agent-brain-sync) — Pi extension。
 * 纯触发: 会话生命周期事件 → 技术日志一行 (~/.abs/log/hooks.log, ABS_LOG_DIR 可覆盖)。fire-and-forget。
 * 纪律: hook 事件只进技术日志, 不进图谱 log.md (log.md 只收工作成果沉淀, 与 event.sh 同纪律)。
 * Pi 事件: session_start / session_shutdown (对应 host hook 的 SessionStart/SessionEnd)。
 * session_shutdown 额外触发 abs wrapup: 把当前项目未完成任务快照到 wrapup.log (跨会话收尾保险)。
 * agent_end 收尾注入: 本会话真改过文件 + .brain 今日无记录 → 注入一条收尾指令, 逼 agent 走收尾循环
 *   (被动记日志不够 —— 没人提醒就不会有人收尾)。每会话最多一次, 且已收尾后不再打扰。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { appendFile, mkdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
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
    // 注意: 这里是真实 TS, 不是生成代码的模板字符串。用拼接形式避免反斜杠逃逸歧义。
    return new RegExp("^## \\[" + today + " \\d{2}:\\d{2}\\]", "m").test(txt)
  } catch { return false }
}

export default function absPiHook(pi: ExtensionAPI): void {
  pi.on("session_start", () => logHook("session_start").catch(() => {}))

  // 收尾注入: 每个会话最多一次, 避免反复打扰。
  let teardownNudged = false
  let agentEndSeen = false
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
    if (await loggedToday(brain)) return // 今天已收尾过
    teardownNudged = true
    await logHook("agent_end:teardown-nudge").catch(() => {})
    try {
      pi.sendUserMessage(
        "[abs 收尾提醒] 本会话改过文件但 .brain/ 今天还没有记录。请立即走收尾循环：\n" +
        "1) 跑 abs load 看 Today 还有哪些未完成；\n" +
        "2) 实际做完漏登记的 abs todo done <id>，做到一半的 abs todo note <id> --note \"断点\"；\n" +
        "3) 值得留的经验 abs note \"...\"（宁少勿滥，能从代码 grep 到的不记）；\n" +
        "4) abs log \"完成 X：...\" 记一行工作成果，新页同步进 index。\n" +
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
