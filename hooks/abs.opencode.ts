/**
 * abs (agent-brain-sync) — Op​encode plugin。
 * 纯触发: 生命周期事件 → 技术日志一行 (~/.abs/log/hooks.log, ABS_LOG_DIR 可覆盖)。fire-and-forget。
 * 纪律: hook 事件只进技术日志, 不进图谱 log.md (log.md 只收工作成果沉淀, 与 event.sh 同纪律)。
 * Op​encode 事件: session.created / session.idle / session.deleted (idle = 每轮结束, 对应 pi 的 agent_end)。
 * 收尾注入已删除（2026-09-18）：曾用 session.idle + promptAsync 推一条收尾提醒, 用户实报
 *   「每次干活干一会就出来, 任务就中断了」。根因同 pi 侧: 主动往对话里插 turn = 打断,
 *   不是频率问题（2026-09-15 删登记注入时已得出同一结论）。保留 session.idle:seen 埋点。
 */
import { appendFile, mkdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
const server = async ({ directory }) => {
  // 本会话首次 idle 是否已埋点
  let idleSeen = false
  async function logHook(evt) {
    try {
      const dir = process.env.ABS_LOG_DIR || join(homedir(), ".abs", "log")
      const d = new Date()
      const pad = (n) => String(n).padStart(2, "0")
      const stamp = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())
      await mkdir(dir, { recursive: true })
      await appendFile(join(dir, "hooks.log"), "[" + stamp + "] opencode:" + evt + "\n")
    } catch {} // fire-and-forget: 永不阻塞宿主
  }

  // 定位当前项目的 .brain/：只看 cwd 本身，不向上搜索（防爬到家目录图谱）
  async function findBrain(cwd) {
    const d = cwd || process.cwd()
    try { const st = await stat(join(d, ".brain")); return st.isDirectory() ? join(d, ".brain") : null } catch { return null }
  }

  // 收尾注入已停用（2026-09-18）：promptAsync 会在每轮 idle 抢一个 turn，用户实报
  // 「每次干活干一会就出来, 任务就中断了」。wroteFiles / nudged / READONLY_CMD /
  // tool.execute.after / loggedToday 随注入一起删除（注入没了，它们已无消费方）。
  // 保留 session.idle:seen 埋点：区分「事件没触发」与「被守卫拦下」。
  return {
    event: async ({ event }) => {
      const type = event && event.type
      if (!type) return
      if (type === "session.created" || type === "session.deleted") {
        await logHook(type)
        // 新会话 = 重置埋点状态。坑(2026-09-13 pi 侧同构实测): 状态声明在 server 工厂闭包里,
        // 同一进程的第二个会话会继承上个会话的 true → 永久不再留痕。
        // pi 侧在 session_start 里重置; op​encode 的对应事件就是 session.created。
        if (type === "session.created") {
          idleSeen = false
        }
        return
      }
      if (type !== "session.idle") return // idle = 每轮结束, 不记日志(太吵), 只做可观测性埋点
      const cwd = directory || process.cwd()
      const brain = await findBrain(cwd)
      // 可观测性: 首次 idle 留一行痕(否则无法区分“事件没触发”与“被守卫拦下”)
      if (!idleSeen) {
        idleSeen = true
        await logHook(`session.idle:seen cwd=${cwd} brain=${brain || 'none'}`)
      }
    },
  }
}

export default {
  id: "abs",
  server,
}
@@MARK@@
