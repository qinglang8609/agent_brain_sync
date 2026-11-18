/**
 * abs 的 todo 面板 —— 独立 pi 扩展：把当前项目 .brain/todo.md 的未完成条目画在编辑器上方。
 *
 * 为什么单独一个扩展（2026-11-18 用户定）：这是纯粹的 pi UI，别的宿主用不上；
 * 混在 abs 的主扩展（abs.ts）里，改面板要看 1300 多行的会话 hook，改 hook 又怕碰坏面板。
 *
 * 与主扩展的关系：
 *   - 面板**只读** todo.md，不写任何东西（主扩展负责会话落盘、指引注入、图谱维护）。
 *   - 解析逻辑两边各有一份。这不是偷懒：两个扩展安装到 extensions/ 下是彼此独立的目录，
 *     跨目录 import 在装完之后就断了（同一理由见主扩展里 parseChild 的注释）。
 *     规则很小（两步正则），两边测试都盖。
 *   - 两份都会显示面板/看板，但**只有这里**调 ui.setWidget —— 主扩展不碰 UI 面板。
 *
 * 关掉：ABS_TODO_PANEL=0；限行：ABS_TODO_PANEL_MAX=<n>；不显示昵称：ABS_TODO_NICK=0。
 */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

// ---------------------------------------------------------------------------
// todo 面板（2026-10-03）：把 .brain/todo.md 的未完成任务显示在编辑器上方
// ---------------------------------------------------------------------------
// 纯展示层：只读 todo.md，不写任何东西。数据源就是 abs 自己的看板 —— 不做第二套状态。
// 与 rpiv-todo 的区别：那个把状态存会话 transcript（跨会话丢失），我们用磁盘文件（可续接）。
// 关掉即设 ABS_TODO_PANEL=0。
const PANEL_KEY = "todo-panel"

// 面板默认**不截断、不按作者过滤**（2026-11-16 用户定：面板要列 todo.md 里所有未完成任务）。
// 想限行数就设 ABS_TODO_PANEL_MAX（正整数）；作者归属改由行首 `[会话 xxx]` 标签体现。
const PANEL_MAX_ROWS = Number(process.env.ABS_TODO_PANEL_MAX || 0) || Number.POSITIVE_INFINITY

/** 本会话的昵称 —— 模块级（扩展重复注册时闭包变量不共享，同 agentEndSeen 的坑）。
 * 空串 = 未抽（或 ABS_TODO_NICK=0 关掉）。 */
let sessionNickname = ''

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

/** 抽一条昵称。传 rnd 便于测试注入；默认 Math.random。关掉：ABS_TODO_NICK=0。 */
/** 昵称池每条存成「emoji + 空格 + 正文」，展示时剥掉 emoji，只留正文（2026-11-04 用户要求）。 */
export function stripNicknameEmoji(s: string): string {
  // 循环剥：🏴‍☠️、😮‍💨 这类 ZWJ 组合 emoji 由多段拼成，只剥一次会剩下后半截。
  return s.replace(/^(?:\p{Extended_Pictographic}[\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]*)+[\s]*/u, '').trim()
}

export function pickNickname(rnd: () => number = Math.random): string {
  if (String(process.env.ABS_TODO_NICK || '') === '0') return ''
  const i = Math.min(USER_NICKNAMES.length - 1, Math.floor(rnd() * USER_NICKNAMES.length))
  return stripNicknameEmoji(USER_NICKNAMES[Math.max(0, i)])
}

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
/** 解析子项行（与 src/todo/common.js 的 parseChild 同规则，双份实现）。
 *
 * 为何不 import src：面板是宿主扩展，单独装到 ~/.pi/extensions/，与包内 src/ 不同目录
 * （装完就断了）。故两端各一份 —— 规则简单（两步正则），且两边测试都盖。
 * 标准 md：缩进的 `- [ ] 内容`。 */
/** 行首状态标记的四个词（任务行与子项共用；与 CLI 侧 common.js 的 TASK_STATES 同值）。
 *  两个扩展各自独立安装，所以这里再拄一份，不跨包 import。 */
const STATE_WORDS = ['滞留中', '讨论中', '搁置', '进行中']

/** 复选框记号 → 状态名（2026-11-16：状态写在记号里，`x` = 已完成不在表内）。 */
const MARK_STATE: Record<string, string> = { '-': '滞留中', '+': '讨论中', '~': '搁置', ' ': '进行中' }

/** 反向表：渲染兜底用（数据里没带 mark 时按状态推回记号，别画出 `[undefined]`）。 */
const STATE_MARK: Record<string, string> = { 滞留中: '-', 讨论中: '+', 搁置: '~', 进行中: ' ' }

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
// “进行中”行的迷你动画。
//
// 2026-10-03 用户要的是三个点依次点亮；2026-11-06 改成**单字符盲文 spinner**
// （用户原话：「●○○ 改成一个字符的、动画吧 放在 [进行中] 后面」）。
//
// 为何用盲文点阵而不是 ⠋⠙⠹ 之外的 ASCII 旋转符：
//   ⠿ 系符号在等宽字体里都是 1 列宽，且视觉上是个转动的方框，比 | / - \ 均匀。
/** 当前推理强度（off/minimal/low/…/max）。模块级，理由同上：widget factory 每帧重新调，
 *  拿不到 ctx，只能由事件回调先存好。2026-11-06 用户需求：面板主色跟推理强度走。 */
let effortLevel = ''

/** 档位 → pi 主题里那档 thinking 色（与输入框边框同一个来源）。
 *
 * 为何要向主题要（2026-11-09 用户要求「todo 上的颜色也跟着 pi 输入框的颜色」）：
 *   那七档色写在主题里（dark.json 的 okhsl），自己拄一份就会跟着主题改而跑偏。
 * 为何要抠一层正则：getFgAnsi() 返回的是整段 `\x1b[38;2;…m`，而面板内部用的是
 *   「色码串 + paintAnsi 自己包转义」那套，只能取里面的 `38;2;…`。
 * 空档位或主题不认这个 token → 返回空串，调用处回落到 C.desc。 */
export function thinkingAnsiOf(theme: any, level: string | null | undefined): string {
  const lvl = String(level || '').trim().toLowerCase()
  if (!lvl) return ''
  const token = `thinking${lvl[0].toUpperCase()}${lvl.slice(1)}`
  try {
    const m = String(theme?.getFgAnsi?.(token) || '').match(/\x1b\[([0-9;]+)m/)
    return m ? m[1] : ''
  } catch {
    return ''
  }
}

/** 用色码串包一段文字（如 `paint('38;2;16;185;129', 'x')`）；空串原样返回。 */
export function paintAnsi(ansi: string, text: string): string {
  return ansi ? `\x1b[${ansi}m${text}\x1b[39m` : text
}

/** 去掉 ANSI 转义序列（\x1b[...m 等），否则宽度计算会把颜色码也算进去。 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

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

function parseChildLine(l: string): { done: boolean; text: string; indent: number; state: string | null; mark: string } | null {
  // 只认标准 md 缩进子项（2026-10-20 旧箭头写法已废弃）。
  // 旧行由 CLI 侧 migrateLegacyChild 在读写时迁移掉，面板拿到的已是新格式。
  const m = String(l || '').match(/^(\s+)-\s*\[([ x\-+~])\]\s*(.*)$/)
  if (!m) return null
  // 子项与任务同形：状态写在复选框里（[ ] 进行中 / [-] 滞留中 / [+] 讨论中 / [~] 搁置）。
  // 默认的进行中不单独出标签（面板上 `[ ]` 已经说明了），所以只有非默认态才给 state。
  // 旧写法的 `[状态] ` 文本前缀仍读（迁移期兼容）。
  const s = m[3].match(/^\[([^\]]+)\]\s*(.*)$/)
  const legacy = s && STATE_WORDS.includes(s[1]) ? s[1] : null
  const state = legacy ?? (m[2] === ' ' ? null : MARK_STATE[m[2]] ?? null)
  return { done: m[2] === 'x', mark: m[2], text: (legacy ? s![2] : m[3]).trim(), indent: m[1].length, state }
}

/** 解析 todo.md —— 只收未完成行（记号不是 `x`）。
 *
 * who 不为空时只收“我的任务”：行内有 [[who]] 的，或**完全没标作者**的
 * （老任务/手写的没标，漏掉比多显示更糟）。标了别人的则不收。
 *
 * 子项行（缩进的 `- [ ]`）归属到它上一条任务，不单独成条。 */
export function parseOpenTasks(md: string, max = PANEL_MAX_ROWS, who = ''): {
  total: number
  rows: { state: string; mark: string; id: string; desc: string; kids: { done: boolean; text: string; state: string | null; mark: string }[]; sid: string }[]
  hidden: number
} {
  // 两阶段：先无过滤地按序解析（子项归属需要“上一条”是原文里真正的前一条），
  // 再按作者过滤。若边解析边过滤，被滤掉的条目下方的子项会挂到它上面那一条
  // —— 实测：别人任务的子项会显示在我的任务下面（2026-10-03 审查发现）。
  type Row = { state: string; mark: string; id: string; desc: string; kids: { done: boolean; text: string; state: string | null; mark: string }[]; authors: string[]; sid: string }
  const parsed: Row[] = []
  // 已完成（[x]）或非任务行下面的缩进子项，不能挂到上一条**未完成**任务上 ——
  // 2026-11-16 真机实测：test-abs-board 后面跟着一串已完成任务的子项，面板把它们
  // 全画成了它的子项。判据只看「上一条可上板的任务」是否真的是当前父行。
  let kidsAllowed = false
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trimEnd()
    // 2026-11-16 起 todo.md 没有分区（只剩 H1 + 一条列表），标题行一律不参与。
    if (/^#{1,6}\s/.test(line)) { kidsAllowed = false; continue }
    // 子项行（标准 md：缩进的 `- [ ]`）→ 挂到上一条任务。
    // 子项可多条、可各自勾选（2026-10-16 用户定）。
    const kid = parseChildLine(line)
    if (kid && kid.indent > 0) {
      const last = parsed[parsed.length - 1]
      if (last && kidsAllowed) last.kids.push(kid)
      continue
    }
    // 未完成任务行：状态写在复选框里（[ ] 进行中 / [-] 滞留中 / [+] 讨论中 / [~] 搁置）。
    // [x] 是已完成，不上未完成面板；旧写法的 `[状态] ` 文本前缀仍读（迁移期兼容）。
    // 新格式：`- [记号] [id 标题] [YYYY-MM-DD HH:MM] [[作者]] [会话id]`
    // 新格式：`- [记号] [YYYY-MM-DD HH:MM] [id 短标题] [[作者]] 详情 [会话id]`
    const mRaw = line.match(/^\s*-\s*\[([ x\-+~])\]\s*(?:\[(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\]\s*)?\[([^\]]+)\]\s*(?:\[\[([^[\]]+)\]\]|@[\w\u4e00-\u9fff.-]+)?\s*([\s\S]*)$/)
    // `[进行中]` 这类旧状态前缀不是标题 → 走老格式兜底
    const m = mRaw && !['进行中', '讨论中', '滞留中', '搁置'].includes((mRaw[3] || '').trim()) ? mRaw : null
    // 老格式兜底（存量文件还没归一，面板也要能看）：`[状态] id [[作者]] — 描述 (认领 日期 sid)`
    if (!m) {
      const lg = line.match(/^\s*-\s*\[([ x\-+~])\]\s*(?:\[(进行中|讨论中|滞留中|搁置)\]\s*)?(\S+)\s*(.*)$/)
      if (!lg) { kidsAllowed = false; continue }
      const markL = lg[1] === 'x' ? 'x' : (lg[1] !== ' ' ? lg[1] : ({ 进行中: ' ', 讨论中: '+', 滞留中: '-', 搁置: '~' }[lg[2] || '进行中'] || ' '))
      kidsAllowed = markL !== 'x'
      const bodyL = (lg[4] || '').replace(/\s*\((?:认领|完成)[^)]*\)/g, '').replace(/\s*【[^】]*】\s*$/, '')
      const authorsL = [...bodyL.matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1])
      const sidL = (String(line).match(/\((?:认领|完成)\s*\d{4}-\d{2}-\d{2}\s+([\w-]+)\)/) || [])[1] || ''
      const descL = bodyL.replace(/\[\[[^\]]+\]\]/g, '').replace(/^\s*—\s*/, '').trim()
      if (markL !== 'x') {
        parsed.push({ state: MARK_STATE[markL] || '进行中', mark: markL, id: lg[3], desc: descL, kids: [], authors: authorsL, sid: sidL })
      }
      continue
    }
    if (m[1] === 'x') { kidsAllowed = false; continue }
    const mark = m[1]
    kidsAllowed = true
    const head = (m[3] || '').trim()
    const sp = head.indexOf(' ')
    const id = sp === -1 ? head : head.slice(0, sp)
    const body = sp === -1 ? '' : head.slice(sp + 1).trim()
    const author = (m[4] || '').trim()
    const authors = author ? [author] : []
    // 详情里若有行尾方括号且像会话 id，就当 sid；否则整体都是详情
    const rest = (m[5] || '').trim()
    const tail = rest.match(/\[([^[\]]*)\]\s*$/)
    const sid = tail && /^[0-9a-z]{6,}(?:-[0-9a-z]+)+$/i.test(tail[1].trim()) ? tail[1].trim() : ''
    const desc = sid ? rest.slice(0, tail.index).trim() : rest
    parsed.push({ state: MARK_STATE[mark] || '进行中', mark, id, desc: body || desc, kids: [], authors, sid })
  }
  // 2026-11-16：不再按作者过滤（`who` 保留参数只为兼容调用方/测试）
  const rows = parsed.map(({ state, mark, id, desc, kids, sid }) => ({ state, mark, id, desc, kids, sid }))
  const limit = Number.isFinite(max) && max > 0 ? max : rows.length
  return { total: rows.length, rows: rows.slice(0, limit), hidden: Math.max(0, rows.length - limit) }
}

/** 最近一次渲染拿到的 tui 引用。hidePanel 用它请求重绘 —— 面板消失时动画
 *  定时器已停，没有别的重绘通道（见 hidePanel 的坑注解）。 */
let lastTui: any = null

export function renderPanelLines(
  data: { total: number; rows: { state: string; id: string; desc: string; kids?: { done: boolean; text: string; state?: string | null }[] }[]; hidden: number },
  who: string,
  width: number,
  fg: (color: string, s: string) => string,
  nickname = '',
  effortColor = '',
): string[] {
  // ★ 空看板不再直接返回空数组（2026-10-06 用户要求：「即便 todo 没有列表，也要在 pi 上显示」）。
  //   理由与看板段一致：面板是「机制在不在」的常驻指示，进去就看不见 = 不知道机制活着。
  //   下面仍要画框和标题，所以这里只是不再提前 return。
  //
  // ★ 文字色跟推理强度走（2026-11-09 用户要求「面板上的文字颜色要与输入框推理强度一致」）：
  //   标题、树线、任务 id、描述、子项、`+N more` 全用档位色（effortColor，由调用处从主题取）。
  //   ★ 四个状态标签（滞留中/讨论中/搁置/进行中）**保留各自语义色**，不跟档位走 ——
  //     用户选的方案：否则四态只能靠文字看，一眼分不出。别再顺手把它们也统一了。
  //   描述色 C.desc 降为「取不到档位色时的兼底」（主题没这个 token / 模型不支持推理）。
  // 历史（勿重走）：2026-11-08 曾定过「现代暗色方案：标题橙、树线蓝灰、描述次灰」，已作废。
  const C = {
    // 面板大标题回到擱置橙 #F59E0B（2026-11-09 用户试过灰白，看完要回橙；沿用 2026-11-08 的定）。
    // 任务行的 id/描述**不用**这个色 —— 它们跟档位色跑。
    title: '38;2;245;158;11',
    task: '38;2;226;232;240',
    desc: '38;2;148;163;184',
    doing: '38;2;16;185;129',
    talk: '38;2;59;130;246',
    hold: '38;2;245;158;11',
    stuck: '38;2;139;92;246',
  }
  const stateAnsi = (st: string): string =>
    st === '进行中' ? C.doing : st === '讨论中' ? C.talk : st === '搁置' ? C.hold : st === '滞留中' ? C.stuck : C.task
  const paint = (ansi: string, t: string) => paintAnsi(ansi, t)
  // 面板文字色 = 调用处从主题取的档位色；取不到（主题没这个 token / 模型不支持推理）回落描述灰。
  // 提到循环外：标题与 `+N more` 也在用它。
  const eff = effortColor || C.desc
  const lines: string[] = []
  // 上描边行已删除（2026-11-04 用户要求「去掉上边框」）。
  // 历史：那行曾用 `thinkingOff` 对齐 pi 输入框描边色（排查三轮才定色）。
  // 首行现在是标题行。
  //
  // 标题带着作者名与昵称（2026-11-07 用户要求还原）：曾搬到输入框左下角，
  // 用户实测「在输入框这里很难看」，又搬回来 —— 前因：9d628ba 那次搬出去，本次搬回来。
  const whoPart = who ? who + (nickname ? ` · ${nickname}` : '') : nickname
  const title = whoPart ? `Todo (${data.total}) — ${whoPart}` : `Todo (${data.total})`
  // 标题也顶最左（2026-11-04 用户）。旧代码曾在空看板时多缩 1 格，2026-11-06 空看板
  // 已整块不显示（见 refreshTodoPanel），那个分支没意义了。
  lines.push(clipToWidth(paint(C.title, title), width))

  const lastIdx = data.rows.length - 1
  data.rows.forEach((t, i) => {
    // `└─` 只给最后一条 —— 不管它有没有子项。
    // （2026-10-03 审查修正：原条件 `i === lastIdx && !t.note` 会让“末条带子项”时
    //  全篇没有 └─ 收尾，子项行的 │ 又延伸到视觉底部，看起来像列表被截断。）
    const isLast = i === lastIdx
    const branch = isLast ? '└─' : '├─'
    // 进行中的行曾带圆圈动画（2026-11-08 用户定：「这个动画没啥用」，整个去掉）。
    // 去掉后 [进行中] 靠状态色区分，不再额外消耗一次 200ms 重绘。
    // 2026-11-16 用户定：行首画**文件里那个记号**（[ ] / [-] / [+] / [~]），后面跟状态名。
    // 面板是 todo.md 的只读视图 —— 记号就是文件里的字符，扫一眼就能对上是哪一行。
    const box = paint(eff, `[${t.mark ?? STATE_MARK[t.state] ?? ' '}] `)
    const stPart = paint(stateAnsi(t.state), `[${t.state}]`)
    const head = `${paint(eff, branch)} ${box}${stPart} ${paint(eff, t.id)}`
    const desc = t.desc ? ' ' + paint(eff, `— ${t.desc}`) : ''
    lines.push(clipToWidth(head + desc, width))
    if (t.kids && t.kids.length) {
      // 子项：标准 md 嵌套列表 → 画成树
      //   ├─ [ ] 子项一
      //   └─ [x] 子项二
      // 树线前缀 = 父任务的 │（非末条）或空格（末条），与父任务分支对齐。
      // 勾过的用删除线区分（颜色已统一为档位色），未勾不着修饰。
      const stem = isLast ? '  ' : paint(eff, '│ ')
      const n = t.kids.length
      t.kids.forEach((k, ki) => {
        const kb = ki === n - 1 ? '└─' : '├─'
        // 子项与任务同形：画文件里的记号；非默认状态（滞留/讨论/搁置）再补一个状态名。
        const kbox = paint(eff, `[${k.mark ?? (k.done ? 'x' : STATE_MARK[k.state ?? ''] ?? ' ')}]`) +
          (k.state && k.state !== '进行中' ? ' ' + paint(stateAnsi(k.state), `[${k.state}]`) : '')
        // 勾过的子项靠删除线区分（颜色已统一为档位色，不再降灰）
        const ktext = k.done ? `\x1b[9m${paint(eff, k.text)}\x1b[29m` : paint(eff, k.text)
        lines.push(clipToWidth(`${stem} ${paint(eff, kb)} ${kbox} ${ktext}`, width))
      })
    }
  })

  if (data.hidden > 0) lines.push(clipToWidth(paint(eff, `  +${data.hidden} more`), width))
  return lines
}

/** 隐藏面板。**必须主动 requestRender** —— 否则数据清了、屏幕还留着旧画面。
 *
 * 坑(2026-10-05 用户实报): 任务全标完后面板不消失, 按 ESC 或重启才正常。
 * 根因: 当时唯一的重绘入口是动画定时器里的 requestRender，而"任务全完成"恰好让
 *   needAnim=false → 停定时器 → 从此没有任何人请求重绘 → 屏幕冻结在旧帧。
 * 动画已拆（2026-11-08），定时器不再存在，但这个坑改头换面仍然成立：
 * 重绘只能由事件主动请求，少一处就静默冻结。
 */
function hidePanel(ui: any): void {
  try { ui.setWidget(PANEL_KEY, undefined) } catch {}
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
    // ★ 无任务就不显示面板（2026-11-06 用户要求，**推翻了 2026-10-06 的旧决定**）。
    //   旧决定是「即便 todo 没有列表，也要在 pi 上显示」，理由：面板是「机制在不在」的
    //   常驻指示，看不见就不知道机制活着。用户 2026-11-06 把它改回来了：
    //   「当没有任务的时候 就别显示 todo 面板了」—— 一行占着编辑器上方是纯噪音。
    //   **不要再改回「空看板也显示标题行」** —— 那就是用户刚提掉的东西。
    //   （想知道机制活没活看别处：abs load 的流水、~/.abs/log/hooks.log。）
    if (data.total === 0) { hidePanel(ui); return }
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
              sessionNickname,
              // 面板主色跟 pi 输入框一致：从主题现取当前档位的 thinking 色（2026-11-09 用户要求）。
              thinkingAnsiOf(theme, effortLevel),
            ),
          invalidate: () => {},
        }
      },
      { placement: 'aboveEditor' },
    )
    // 动画去掉后（2026-11-08），每次刷新都得自己请求重绘 ——
    // 没有定时器兜底了，漏这一句屏幕会冻结在旧帧（标题还写着旧计数）。
    try { lastTui?.requestRender?.() } catch {}
  } catch {
    hidePanel(ui)
  }
}

// ============================ 扩展入口 ============================
// 事件与主扩展同一套语义（那边也在刷面板数据，这里只负责画）：
//   session_start      首次绘制；抽昵称、记下推理档位
//   tool_call          认出「刚调的是 todo 工具」→ 置标记（MCP 代理入口只在这里能认出子工具名）
//   tool_execution_end 标记在 → 刷（此时 todo.md 已改完）
//   turn_end           兜底刷（实测每条 assistant 消息都触发，约 4 秒一次）
//   thinking_level_select  面板主色跟着档位走
let pendingTodoTool = false

export default function absTodoPanel(pi: ExtensionAPI): void {
  pi.on('session_start', (_event: any, ctx: any) => {
    // 每次 session_start（startup/reload/new/resume/fork）重抽 → 每次打开 pi 都是随机的。
    sessionNickname = pickNickname()
    effortLevel = String((ctx && ctx.thinkingLevel) || '')
    // pi 在 session_start 时已给 ctx.ui（无 UI 时是 noOp），但 setWidget 要真 TUI。
    if (!ctx || !ctx.hasUI) return
    refreshTodoPanel(ctx.ui, (ctx && ctx.cwd) || process.cwd()).catch(() => {})
  })

  pi.on('tool_call', (event: any, _ctx: any) => {
    const name = String(event?.toolName || '')
    const input = event?.input || {}
    // 两种形态：① MCP 代理入口 mcp__abs + input.tool=abs_task；② 直接工具名 abs_task
    const target = String(input?.tool ?? input?.name ?? '')
    if (/abs_(task|board)/.test(name) || /abs_(task|board)/.test(target)) pendingTodoTool = true
  })

  pi.on('tool_execution_end', (_event: any, ctx: any) => {
    if (!pendingTodoTool) return
    pendingTodoTool = false
    refreshTodoPanel(ctx?.ui, (ctx && ctx.cwd) || process.cwd()).catch(() => {})
  })

  pi.on('turn_end', (_event: any, ctx: any) => {
    refreshTodoPanel(ctx?.ui, (ctx && ctx.cwd) || process.cwd()).catch(() => {})
  })

  pi.on('thinking_level_select', (event: any, ctx: any) => {
    effortLevel = String(event?.level || (ctx && ctx.thinkingLevel) || '')
    refreshTodoPanel(ctx?.ui, (ctx && ctx.cwd) || process.cwd()).catch(() => {})
  })
}
