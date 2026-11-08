/**
 * 圆角输入框的纯格式化函数（无宿主依赖，可单测）。
 *
 * 单独成文件的原因：hooks/abs-rounded-editor/index.ts 要 import `@earendil-works/pi-coding-agent`，
 * 测试进程里没有这个包；把纯函数抽出来才能直接 import 断言。
 */

/** 把模型 id 压短：只留最后一段，去掉日期后缀。deepseek/deepseek-v4.1-flash → deepseek-v4.1-flash */
export function shortenModel(id: string): string {
  if (!id) return ''
  const tail = id.split('/').pop() || id
  return tail.replace(/-\d{8}$/, '')
}

/** 把 token 数压成 1.0M / 280k 这种短写。 */
export function shortTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '?'
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(n)
}

/** 拼右上角状态：`8.0%/1.0M 模型名`。缺哪段就省哪段。 */
export function buildStatus(usage: any, modelId: string): string {
  const parts: string[] = []
  if (usage && usage.percent != null) parts.push(`${usage.percent.toFixed(1)}%`)
  if (usage && usage.contextWindow) parts.push(`/${shortTokens(usage.contextWindow)}`)
  const model = shortenModel(modelId)
  return [parts.join(''), model].filter(Boolean).join(' ')
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

/** 终端显示宽度：CJK/全角记 2 列，其余记 1 列。
 *
 * ★ 为何必需（2026-11-07 用户实报「输入框右下角底下的线冒出来了」）：
 *   之前 roundBorder 按**字符数**算宽度，而左下角标签里有中文昵称
 *   （如「转发锦鲤求暴富」7 个汉字实际占 14 列）—— 少算了 7 列，
 *   多出的宽度就把右下角圆角挤出了屏幕。
 *   右侧状态栏一直没出问题是因为它只有 ASCII。
 *
 * 与 abs.pi.ts 的 dispWidth 同规则，但不共享（两个扩展各自独立安装）。 */
export function textWidth(s: string): number {
  const plain = stripAnsi(s)
  let w = 0
  for (const ch of plain) {
    const cp = ch.codePointAt(0) || 0
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

/** 从尾部去掉 n 列。边框行只由 ASCII `─`（U+2500，各 1 列）与空格组成，
 *  每字符 1 列，故直接按字符截。
 *  ★ 不要在这里用宽字符判断 —— 之前写 `cp >= 0x1100` 把 U+2500 当成了 2 列，
 *    导致削掉一半、边框变长（2026-11-07 踩过）。 */
function dropCols(s: string, n: number): string {
  if (n <= 0) return s
  return s.slice(0, Math.max(0, s.length - n))
}

/**
 * 推理强度 → 面板与输入框的主色（2026-11-07 用户需求）。
 *  色值起于用户 2026-11-07 给的六档灰蓝，之后用户要求「xhigh/high 再亮一点，往下都稍亮」，
 *  按**同色相**（H≈219°）提亮度得到现在这组：
 *    max #ACB8CD(不动) · xhigh #9CABC7 · high #8D97AA · medium #747E93
 *    low #656F83 · minimal #586171
 *  提亮前用户给的原值：xhigh #95A5C3 · high #768298 · medium #697387 · low #5C6577 · minimal #505867
 *  色相是用户挑的灰蓝（不是绿），换色只许按用户给的值改，别拿主题色或自己的审美去替换。
 *  off / 未知 → 空串，表示「不上色，沿用默认色」—— 用户 2026-11-06 定过：推理关着就保持原样。
 *
 * 为何自己拼 ANSI 而不是走 theme.fg：fg() 只认主题里的 token 名，主题那七档色相跟这组不一样。
 * 终端支持 24 位色就给 38;2，否则退到 256 色板里的一档（见 ansi256）。
 *  ★ 256 色板里没有这种灰蓝：只能退到灰阶档（250/249/247/244/243/241），保住“一档比一档暗”、
 *    丢掉蓝调 —— 24 位色终端才是标称效果。
 *
 * ★ 同一份逻辑在 hooks/abs.pi.ts 里也有一份（`effortAnsi`）。不抽公共模块是故意的：
 *   安装后 `abs.ts` 与 `abs-rounded-editor/` 是两个可独立删除的扩展，抽成共享文件会让
 *   「删掉输入框样式目录」连带把 todo 面板搞崩。
 */
export const EFFORT_COLOR: Record<string, { rgb: string; ansi256: number }> = {
  max: { rgb: '238;242;248', ansi256: 255 },
  xhigh: { rgb: '221;228;240', ansi256: 254 },
  high: { rgb: '200;210;228', ansi256: 189 },
  medium: { rgb: '176;187;208', ansi256: 146 },
  low: { rgb: '152;164;190', ansi256: 110 },
  minimal: { rgb: '128;144;176', ansi256: 110 },
}

/** 边框用：同色相压暗降饱和 —— 文字要能读，边框要不抢眼（2026-11-08 用户反馈）。 */
export const EFFORT_BORDER: Record<string, { rgb: string; ansi256: number }> = {
  max: { rgb: '122;134;158', ansi256: 103 },
  xhigh: { rgb: '108;120;146', ansi256: 60 },
  high: { rgb: '94;106;134', ansi256: 60 },
  medium: { rgb: '82;94;120', ansi256: 60 },
  low: { rgb: '70;82;106', ansi256: 60 },
  minimal: { rgb: '58;70;92', ansi256: 60 },
}

export function effortAnsi(level: string | null | undefined, colorMode = 'truecolor'): string {
  const g = EFFORT_COLOR[String(level || '').trim().toLowerCase()]
  if (!g) return ''
  return colorMode === 'truecolor' ? `38;2;${g.rgb}` : `38;5;${g.ansi256}`
}


export function effortBorderAnsi(level: string | null | undefined, colorMode = 'truecolor'): string {
  const g = EFFORT_BORDER[String(level || '').trim().toLowerCase()]
  if (!g) return ''
  return colorMode === 'truecolor' ? `38;2;${g.rgb}` : `38;5;${g.ansi256}`
}

/** 用 effortAnsi 的结果包一段文字；空串原样返回（off 时不着色）。 */
export function paintAnsi(ansi: string, text: string): string {
  return ansi ? `\x1b[${ansi}m${text}\x1b[39m` : text
}

/**
 * 把一行边框文本换成「左圆角 + 左标签 + 中段 + 右圆角」，**显示宽度**保持原样。
 * 边框行内含 ANSI 时直接 slice 会切坏转义序列，所以先剥色、改字、再整行着色。
 *
 * ★ 宽度一律按 textWidth（CJK = 2 列）算，不按字符数 —— 标签里的中文昵称
 *   按字符数算会少算一半，多出的宽度把右下角圆角挤到屏幕外（2026-11-07 实报）。
 *
 * leftLabel 贴在左圆角之后；label 贴最右端。哪个放不下就丢掉哪个
 * （宁可没有，也不让边框溢出折行）。
 */
export function roundBorder(
  line: string,
  fg: (s: string) => string,
  left: string,
  right: string,
  label = '',
  leftLabel = '',
): string {
  const plain = stripAnsi(line)
  if (plain.length === 0) return line
  // mid 是两端圆角之间的那段；总宽 = 1(左圆角) + mid 宽 + 1(右圆角)。
  let mid = plain

  // 右 label 先做（从右端拿 `─` 换），再做左侧 —— 否则两侧都从右端切，位置会互相错。
  // 注意：剥掉 **lw** 列后接 ` label `，两者宽度相等，故总宽不变。
  if (label) {
    const lw = textWidth(label) + 2
    if (lw < textWidth(mid)) mid = dropCols(mid, lw) + ' ' + label + ' '
  }

  // 左 label 插到最左端（圆角之后，即 working 图标之前）。
  // ★ 从**中间**剥等长的 `─`，不能从右端剥 —— 右端可能已经是右 label，
  //   再从右端切就会把它末尾拼掉（实测：「8.0%/1.0M m」变成「8.0」）。
  // 两侧各留 1 空格：否则 `╰fanchao` 贴死圆角，看着像缺了一角。
  if (leftLabel) {
    const lw = textWidth(leftLabel) + 2
    // 右 label 已占的尾巴宽度：保留它，从它之前切。
    const tailLen = label && textWidth(label) + 2 < textWidth(mid) ? textWidth(label) + 2 : 0
    if (lw + tailLen < textWidth(mid)) {
      const body = dropCols(mid.slice(0, mid.length - tailLen), lw)
      mid = ' ' + leftLabel + ' ' + body + mid.slice(mid.length - tailLen)
    }
  }
  return fg(left + mid + right)
}
