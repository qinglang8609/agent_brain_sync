/**
 * abs (agent-brain-sync) — Op​encode plugin。
 * 纯触发: 生命周期事件 → 技术日志一行 (~/.abs/log/hooks.log, ABS_LOG_DIR 可覆盖)。fire-and-forget。
 * 纪律: hook 事件只进技术日志, 不进图谱 log.md (log.md 只收工作成果沉淀, 与 event.sh 同纪律)。
 * Op​encode 事件: session.created / session.idle / session.deleted (idle = 每轮结束, 对应 pi 的 agent_end)。
 * 收尾注入: session.idle 且本会话真改过文件 + .brain 今日无记录 → promptAsync 推 agent 走收尾循环。
 */
import { appendFile, mkdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join, dirname } from "node:path"

const server = async ({ client, directory }) => {
  // 本会话是否真改过文件 (由 tool.execute.after 观测)
  let wroteFiles = false
  let nudged = false
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

  // 判定"今天是否收尾过": 必须匹配 log.md 的条目头 '## [YYYY-MM-DD HH:MM]'。
  // 坑: 曾用裸日期 substring(includes('2026-09-10')), 结果正文/任务行里任何一处
  //     提到今天就能把 nudge 永久压掉(误判为已收尾), 守卫形同虚设。
  async function loggedToday(brain) {
    try {
      const txt = await readFile(join(brain, "log.md"), "utf8")
      const d = new Date()
      const pad = (n) => String(n).padStart(2, "0")
      const today = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
      return new RegExp("^## \\[" + today + " \\d{2}:\\d{2}\\]", "m").test(txt)
    } catch { return false }
  }

  const TEARDOWN_MSG =
    "[abs 收尾提醒] 本会话改过文件但 .brain/ 今天还没有记录。请立即走收尾循环：\n" +
    "1) 跑 abs load 看 Today 还有哪些未完成；\n" +
    "2) 实际做完漏登记的 abs todo done <id>，做到一半的 abs todo note <id> --note \"断点\"；\n" +
    "3) 值得留的经验 abs note \"...\"（宁少勿滥，能从代码 grep 到的不记）；\n" +
    "4) abs log \"完成 X：...\" 记一行工作成果，新页同步进 index。\n" +
    "简洁执行，不要复述本条提醒。若本次确实没有可沉淀产出，直接回一句\"无可沉淀\"即可。"

  // bash 里只跑查询类命令不算改文件 (与 pi 侧 READONLY_CMD 同义, 但生成代码里要写进模板串)
  const READONLY_CMD = /^\s*(ls|cat|grep|rg|find|head|tail|wc|git\s+(status|log|diff|show|branch)|pwd|which|echo|node\s+-v|npm\s+(ls|view)|curl)\b/

  return {
    // 观测真实写操作: write/edit/patch 类工具成功即标记。
    // 坑: 曾漏掉 bash —— op​encode 里很多修改是经 bash(heredoc/sed) 完成的, 纯 bash 会话
    //     永远不置位 wroteFiles, 于是收尾提醒静默不发。与 pi 侧 WRITE_TOOLS 保持一致。
    "tool.execute.after": async ({ tool, args }) => {
      const t = String(tool || "").toLowerCase()
      if (["write", "edit", "patch", "multiedit", "apply_patch"].includes(t)) {
        wroteFiles = true
        return
      }
      // bash 里只有非只读命令算改文件(ls/cat/git status 之类不算)
      if (t === "bash") {
        const cmd = String((args && (args.command || args.cmd)) || "")
        if (cmd && !READONLY_CMD.test(cmd)) wroteFiles = true
      }
    },

    event: async ({ event }) => {
      const type = event && event.type
      if (!type) return
      if (type === "session.created" || type === "session.deleted") {
        await logHook(type)
        return
      }
      if (type !== "session.idle") return // idle = 每轮结束, 不记日志(太吵), 只做收尾判定
      const cwd = directory || process.cwd()
      const brain = await findBrain(cwd)
      // 可观测性: 首次 idle 无条件留一行痕(否则无法区分“事件没触发”与“被守卫拦下”)
      if (!idleSeen) {
        idleSeen = true
        await logHook(`session.idle:seen cwd=${cwd} brain=${brain || 'none'}`)
      }
      if (nudged || !wroteFiles) return
      const sessionID = event.properties && event.properties.sessionID
      if (!sessionID) return
      if (!brain) return // 无图谱=不在这项目沉淀, 不打扰
      if (await loggedToday(brain)) return // 今天已收尾过
      nudged = true
      await logHook("session.idle:teardown-nudge")
      try {
        await client.session.promptAsync({
          path: { id: sessionID },
          query: { directory: cwd },
          body: { parts: [{ type: "text", text: TEARDOWN_MSG }] },
        })
      } catch {} // 注入失败不阻塞宿主
    },
  }
}

export default {
  id: "abs",
  server,
}
@@MARK@@
