/**
 * abs (agent-brain-sync) — Op​encode plugin。
 * 纯触发: 生命周期事件 → 技术日志一行 (~/.abs/log/hooks.log, ABS_LOG_DIR 可覆盖)。fire-and-forget。
 * 纪律: hook 事件只进技术日志, 不进图谱 log.md (log.md 只收工作成果沉淀, 与 event.sh 同纪律)。
 * Op​encode 事件: session.created / session.idle / session.deleted (idle = 每轮结束, 对应 pi 的 agent_end)。
 * 收尾注入: session.idle 且本会话真改过文件 + .brain 今日无记录 → promptAsync 推 agent 走收尾循环。
 *
 * 登记注入 (2026-09-15 用户定): 写文件 = 任务开始的机械信号。
 *   旧设计只在 idle(轮末) 提醒收尾 —— 那时用户已想结束, AI 只想收尾不想登记。
 *   故 tool.execute.after 检测到**项目文件**写入即注入登记提示(不等 idle):
 *     · 频繁没关系 —— 每次写都提醒(用户明确要求)
 *     · 判据 = 整个项目, 但**排除 .brain/ 自身**(写图谱是记录行为, 不是任务)
 *     · 文案明说「纯讨论可跳过」—— 不逼 AI 造任务
 */
import { appendFile, mkdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
const server = async ({ client, directory }) => {
  // 本会话是否真改过文件 (由 tool.execute.after 观测)
  let wroteFiles = false
  let nudged = false
  let idleSeen = false
  // 当前 session id（由事件里拿）—— 收尾注入需要它找到会话。
  let currentSessionID = ""
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

  // 判定"今天是否收尾过": 只认【工作成果】条目(kind=dev)，行头 '## [YYYY-MM-DD HH:MM] [[name]] dev |'。
  // 坑1: 曾用裸日期 substring, 正文/任务行里任何一处提到今天就把 nudge 永久压掉(守卫形同虚设)。
  // 坑2(2026-09-13 实测, pi 侧先修): `abs note` 也写 log.md(kind=note),
  //     旧判据只看「今天有没有行」会把「沉淀了一条经验」误判成「已收尾」→ 整天不再提醒。
  //     三宿主(pi/CC/op​encode)判据必须一致 —— 见 [[hook-throttle-alignment]]。
  async function loggedToday(brain) {
    try {
      const txt = await readFile(join(brain, "log.md"), "utf8")
      const d = new Date()
      const pad = (n) => String(n).padStart(2, "0")
      const today = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
      return new RegExp("^## \\[" + today + " \\d{2}:\\d{2}\\] (?:\\[[^\\]]+\\]\\] )?dev \\|", "m").test(txt)
    } catch { return false }
  }


  const TEARDOWN_MSG =
    "[abs] 本会话改过文件，.brain/ 今日无记录。\n" +
    "这条是信息不是命令：该登记/沉淀就登记，没有可沉淀的直接回一句「无可沉淀」，不用凑。\n" +
    "先看任务：本会话做完的事有没有进看板？（abs todo / abs todo done <id>；干到一半 abs todo note <id> --note 断点）\n" +
    "再看沉淀：经验/坑 → abs note \"...\"；成果流水 → abs log \"...\""

  // bash 里只跑查询类命令不算改文件 (与 pi 侧 READONLY_CMD 同义, 但生成代码里要写进模板串)
  const READONLY_CMD = /^\s*(ls|cat|grep|rg|find|head|tail|wc|git\s+(status|log|diff|show|branch)|pwd|which|echo|node\s+-v|npm\s+(ls|view)|curl)\b/




  return {
    // 观测真实写操作: write/edit/patch 类工具成功即标记。
    // 坑: 曾漏掉 bash —— op​encode 里很多修改是经 bash(heredoc/sed) 完成的, 纯 bash 会话
    //     永远不置位 wroteFiles, 于是收尾提醒静默不发。与 pi 侧 WRITE_TOOLS 保持一致。
    "tool.execute.after": async ({ tool, args }) => {
      const t = String(tool || "").toLowerCase()
      const a = args || {}
      if (["write", "edit", "patch", "multiedit", "apply_patch"].includes(t)) {
        wroteFiles = true
        return
      }
      // bash 里只有非只读命令算改文件(ls/cat/git status 之类不算)
      if (t === "bash") {
        const cmd = String(a.command || a.cmd || "")
        if (cmd && !READONLY_CMD.test(cmd)) wroteFiles = true
      }
    },

    event: async ({ event }) => {
      const type = event && event.type
      if (!type) return
      if (type === "session.created" || type === "session.deleted") {
        await logHook(type)
        // session.created / idle 等事件带 sessionID —— 存下来供 tool.execute.after 用
        const sid = event.properties && event.properties.sessionID
        if (sid) currentSessionID = String(sid)
        // 新会话 = 重置节流状态。坑(2026-09-13 pi 侧同构实测): 状态声明在 server 工厂闭包里,
        // 同一进程的第二个会话会继承上个会话的 true → 永久不再提醒(后半场全部静默)。
        // pi 侧在 session_start 里重置; op​encode 的对应事件就是 session.created。
        if (type === "session.created") {
          wroteFiles = false
          nudged = false
          idleSeen = false
        }
        return
      }
      if (type !== "session.idle") return // idle = 每轮结束, 不记日志(太吵), 只做收尾判定
      const sid0 = event.properties && event.properties.sessionID
      if (sid0) currentSessionID = String(sid0)
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
