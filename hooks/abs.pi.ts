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
 *   别再加回来。素材锚点(before_agent_start/turn_end)随注入一起删除, 已无消费方。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { appendFile, mkdir, stat } from "node:fs/promises"
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

export default function absPiHook(pi: ExtensionAPI): void {
  // 埋点状态同上，故意声明在**模块级**（不在被反复调用的工厂函数里）。
  resetThrottle()

  pi.on("session_start", (event: any, _ctx: any) => {
    resetThrottle()
    return logHook("session_start").catch(() => {})
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
