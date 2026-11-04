/**
 * 圆角输入框的纯格式化函数（无宿主依赖，可单测）。
 *
 * 单独成文件的原因：hooks/pi-rounded-editor.ts 要 import `@earendil-works/pi-coding-agent`，
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

/**
 * 把一行边框文本换成「左圆角 + 中段 + 右圆角」，可见宽度保持原样。
 * 边框行内含 ANSI 时直接 slice 会切坏转义序列，所以先剥色、改字、再整行着色。
 *
 * label 贴在最右端；放不下就丢掉 label（宁可没有，也不让边框溢出折行）。
 */
export function roundBorder(
  line: string,
  fg: (s: string) => string,
  left: string,
  right: string,
  label = '',
): string {
  // 宽度按字符数算（不是显示宽度）。成立的前提：line 只含 ASCII 的 `─` 与空格
  // —— pi 的边框行正是如此。若将来边框里出现中日韩宽字符，这里要改用 visibleWidth。
  const plain = stripAnsi(line)
  if (plain.length === 0) return line
  // 原边框行宽 = width-2；两端圆角各占 1 列，合起来正好 width。
  let mid = plain
  // label 两侧各留 1 空格；放不下就不要 label。
  if (label && label.length + 2 < mid.length) {
    mid = mid.slice(0, mid.length - label.length - 2) + ' ' + label + ' '
  }
  return fg(left + mid + right)
}
