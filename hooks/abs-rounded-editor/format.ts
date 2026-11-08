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
 * 推理强度 → 主题色 token。空串表示「不上色，沿用默认色」。
 *
 * 规则：`thinking` + 首字母大写，正好对上主题里的 thinkingMinimal…thinkingMax 七档。
 * 为什么 off 返回空串而不是 `thinkingOff`：主题给 thinkingOff 的是接近背景的暗灰
 * （dark.json: `okhsl(229 8% 49%)`），拿它去染文字会看不清。用户 2026-11-06 定的是
 * 「off 时保持默认色」。
 *
 * ★ 同一份逻辑在 hooks/abs.pi.ts 里也有一份（`effortColorToken`）。不抽公共模块是故意的：
 *   安装后 `abs.ts` 与 `abs-rounded-editor/` 是两个可独立删除的扩展，抽成共享文件会让
 *   「删掉输入框样式目录」连带把 todo 面板搞崩。
 */
export const EFFORT_COLOR: Record<string, { rgb: string; ansi256: number }> = {
  max: { rgb: '197;205;220', ansi256: 189 },
  xhigh: { rgb: '168;182;204', ansi256: 152 },
  high: { rgb: '150;166;198', ansi256: 110 },
  medium: { rgb: '122;138;160', ansi256: 110 },
  low: { rgb: '94;108;132', ansi256: 103 },
  minimal: { rgb: '70;82;106', ansi256: 240 },
}

export function effortAnsi(level: string | null | undefined, colorMode = 'truecolor'): string {
  const g = EFFORT_COLOR[String(level || '').trim().toLowerCase()]
  if (!g) return ''
  return colorMode === 'truecolor' ? `38;2;${g.rgb}` : `38;5;${g.ansi256}`
}

/** 「搁置」橙 #F59E0B —— 与 todo 面板的 `搁置` 标签同色（abs.pi.ts 的 `C.hold`）。
 *  用途（2026-11-08 用户要求）：输入框上边框的 working 状态与右上角状态文字。
 * ★ 色值在 abs.pi.ts 里也有一份，不抽公共模块是故意的（见 EFFORT_COLOR 的注释）。 */
export const HOLD_COLOR = { rgb: '245;158;11', ansi256: 214 }

export function holdAnsi(colorMode = 'truecolor'): string {
  return colorMode === 'truecolor' ? `38;2;${HOLD_COLOR.rgb}` : `38;5;${HOLD_COLOR.ansi256}`
}

/** 上边框最左那段「working 状态」（如 `⠼ Working`）。
 *
 * 为何要单独把它抠出来（2026-11-08 用户要求它和状态文字同色）：那段由 pi 的
 *   WorkingStatusIndicator 画、夹在 `── ` 与后续虚线之间（见 pi 的 custom-editor
 *   `renderTopBorder`），而 roundBorder 会先剥掉整行的色再重新上色，
 *   不能靠「它原本的颜色」认它。判据取形状：开头 `─+ ` 之后、下一个 `─` 之前的那段。
 *
 * 排除 `↑ N more` / `↓ N more`（pi 自己的滚动提示）：那不是 working 状态，
 *   染成橙色就是错色。 */
export function leadSpanOf(plain: string): string {
  const m = String(plain).match(/^─+ ([^─]+?) ?─/)
  if (!m) return ''
  const text = m[1]
  return /[↑↓]/.test(text) ? '' : text
}

/** 用 effortAnsi 的结果包一段文字；空串原样返回（off 时不着色）。 */
export function paintAnsi(ansi: string, text: string): string {
  return ansi ? `\x1b[${ansi}m${text}\x1b[39m` : text
}

/** 把一行边框文本换成「左圆角 + 左标签 + 中段 + 右圆角」，**显示宽度**保持原样。
 * 边框行内含 ANSI 时直接 slice 会切坏转义序列，所以先剥色、改字、再整行着色。
 *
 * ★ 宽度一律按 textWidth（CJK = 2 列）算，不按字符数 —— 标签里的中文昵称
 *   按字符数算会少算一半，多出的宽度把右下角圆角挤到屏幕外（2026-11-07 实报）。
 *
 * leftLabel 贴在左圆角之后；label 贴最右端。哪个放不下就丢掉哪个
 * （宁可没有，也不让边框溢出折行）。
 *
 * opts.leadFg / opts.labelFg（2026-11-08 用户要求）：只给「working 状态那段」
 *   和「右标签」换个色，其余（圆角、虚线）仍用 fg。不传 opts 时整行一个色，
 *   与旧行为逐字相同。
 */
export function roundBorder(
  line: string,
  fg: (s: string) => string,
  left: string,
  right: string,
  label = '',
  leftLabel = '',
  opts: { leadFg?: (s: string) => string; labelFg?: (s: string) => string } = {},
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
  return paintSpans(left + mid + right, fg, [
    // working 段从**开头**找（它就在最左）；右标签从**末尾**找
    // （万一同一串又出现在左边，不能把左边那个也染成标签色）。
    [leadSpanOf(plain), opts.leadFg, 'first'],
    [label, opts.labelFg, 'last'],
  ])
}

/** 把 out 里的几个区间换成各自的色，其余整段用 fg。区间按位置排序、重叠则跳过。
 *  为何不用「拼段」实现：标签与 working 段的字符是从 mid 里苹/插进去的，
 *  只有拿到最终串才能准确定位（直接拼段会在 dropCols 后错位）。 */
function paintSpans(
  out: string,
  fg: (s: string) => string,
  spans: [string, ((s: string) => string) | undefined, 'first' | 'last'][],
): string {
  const found: [number, number, (s: string) => string][] = []
  for (const [text, paint, side] of spans) {
    if (!text || !paint) continue
    const i = side === 'last' ? out.lastIndexOf(text) : out.indexOf(text)
    if (i === -1) continue
    found.push([i, i + text.length, paint])
  }
  found.sort((a, b) => a[0] - b[0])
  let res = ''
  let pos = 0
  for (const [s, e, paint] of found) {
    if (s < pos) continue
    if (s > pos) res += fg(out.slice(pos, s))   // 空片段不上色，免得留下空色码对
    res += paint(out.slice(s, e))
    pos = e
  }
  if (pos < out.length) res += fg(out.slice(pos))
  return res
}
