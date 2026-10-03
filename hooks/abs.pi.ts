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

/** “刚才调的是 todo 工具”标记 —— 由 tool_call 置位、tool_execution_end 消费。
 * 同样在模块级，理由同上（闭包 flag 在重复注册时不共享）。 */
let pendingTodoTool = false

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
// 工具名写 `abs_task`（不带 mcp__abs__ 前缀）—— 2026-10-03 审查发现：MCP 默认
// exposure=codemode，模型侧看到的就叫 abs_task；写错名字等于让模型去找不存在的工具。
const TODO_GUIDELINES = [
  'Use `abs_task` to track multi-step work **before** you start it, not after: on the first file edit of a task, call action "start" with a short id.',
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
  if (data.total === 0) return []
  const colorOf = (state: string): string => (state === '滞留中' ? 'muted' : state === '讨论中' ? 'dim' : 'accent')
  const lines: string[] = []
  // 上描边：一条深灰横线，把面板与上方内容分开。
  // 留 1 列余量 —— 终端对“恰好占满宽度”的行有时会折行（各终端行为不一致）。
  lines.push(fg('dim', '─'.repeat(Math.max(0, width - 1))))
  // 昵称附在作者名后（会话内固定，启动时随机抽）。
  const whoPart = who ? who + (nickname ? ` · ${nickname}` : '') : nickname
  const title = whoPart ? `📋 todo (${data.total}) — ${whoPart}` : `📋 todo (${data.total})`
  lines.push(clipToWidth(fg('accent', title), width))

  const lastIdx = data.rows.length - 1
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
async function refreshTodoPanel(ui: any, cwd: string): Promise<void> {
  if (String(process.env.ABS_TODO_PANEL || '') === '0') return
  if (!ui || typeof ui.setWidget !== 'function') return
  try {
    if (!(await hasBrain(cwd))) { ui.setWidget(PANEL_KEY, undefined); stopAnimTimer(); return }
    const md = await readFile(join(cwd, '.brain', 'todo.md'), 'utf8')
    const who = await currentUser()
    const data = parseOpenTasks(md, PANEL_MAX_ROWS, who)
    if (data.total === 0) { ui.setWidget(PANEL_KEY, undefined); stopAnimTimer(); return }
    // factory 形式：render(width) 每帧拿真实宽度 → 按宽度截断，不再断字。
    // 动画：phase 存在模块级，render 时读当前值；定时器只在本帧重绘，不重建 widget。
    let tuiRef: any = null
    ui.setWidget(
      PANEL_KEY,
      (tui: any, theme: any) => {
        tuiRef = tui
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
  } catch {
    try { ui.setWidget(PANEL_KEY, undefined) } catch {}
    stopAnimTimer()
  }
}

export default function absPiHook(pi: ExtensionAPI): void {
  // 埋点状态同上，故意声明在**模块级**（不在被反复调用的工厂函数里）。
  resetThrottle()

  pi.on("session_start", (event: any, ctx: any) => {
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
  pi.on("tool_call", (event: any) => {
    const name = String(event?.toolName || '')
    const input = event?.input || {}
    // 两种形态：① MCP 代理入口 mcp__abs + input.tool=abs_task；② 直接工具名 abs_task
    const target = String(input?.tool ?? input?.name ?? '')
    if (/abs_(task|board)/.test(name) || /abs_(task|board)/.test(target)) {
      pendingTodoTool = true
      logHook(`tool_call todo_tool name=${name} target=${target || '-'}`).catch(() => {})
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
    stopAnimTimer() // 面板没了，动画定时器必须一起停（否则残留定时器白刷已丢弃的 tui）
    snapshotWrapup((ctx && ctx.cwd) || process.cwd())
    logHook("session_shutdown").catch(() => {})
  })
}

@@MARK@@
