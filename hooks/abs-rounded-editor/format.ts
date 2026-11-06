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
export function thinkingColorToken(level: string | null | undefined): string {
  const l = String(level || '').trim()
  if (!l || l === 'off') return ''
  return 'thinking' + l[0].toUpperCase() + l.slice(1)
}

/**
 * 把一行边框文本换成「左圆角 + 左标签 + 中段 + 右圆角」，可见宽度保持原样。
 * 边框行内含 ANSI 时直接 slice 会切坏转义序列，所以先剥色、改字、再整行着色。
 *
 * leftLabel 贴在圆角之后（如 `╭ fanchao · 昵称 ───── ╮`），右侧先剥掉 1 个 `─`
 * 再用 ` leftLabel ` 填上 —— 宽度严格不变（靠空格凑，不靠增减划线）。
 * 右侧 label 贴最右端。哪个放不下就丢掉哪个（宁可没有，也不让边框溢出折行）。
 */
export function roundBorder(
  line: string,
  fg: (s: string) => string,
  left: string,
  right: string,
  label = '',
  leftLabel = '',
): string {
  // 宽度按字符数算（不是显示宽度）。成立的前提：line 只含 ASCII 的 `─` 与空格
  // —— pi 的边框行正是如此。若将来边框里出现中日韩宽字符，这里要改用 visibleWidth。
  const plain = stripAnsi(line)
  if (plain.length === 0) return line
  // 原边框行宽 = width-2；两端圆角各占 1 列，合起来正好 width。
  // 注意：line 本身已去掉两端圆角位，故 mid 宽度 = plain.length。
  let mid = plain

  // 右 label 先做（从右端拿 `─` 换），再做左侧 —— 否则两侧都从右端切，位置会互相错。
  // label 两侧各留 1 空格；放不下就不要 label。
  if (label && label.length + 2 < mid.length) {
    mid = mid.slice(0, mid.length - label.length - 2) + ' ' + label + ' '
  }

  // 左 label 插到**最左端**（圆角之后），即 working 图标之前。
  // ★ 从**中间**剥等长的 `─`，不能从右端剥 —— 右端可能已经是右 label，
  //   再从右端切就会把它末尾拼掉（2026-11-07 实测：「8.0%/1.0M m」变成「8.0」）。
  // 前面多占「1 空格 + label + 1 空格」，就在尾巴之前切掉同样多。
  // 两侧各留 1 空格：否则 `╰fanchao` 贴死圆角，看着像缺了一角。
  if (leftLabel) {
    const need = leftLabel.length + 2
    // 右 label 已占的尾巴宽度：保留它，从它之前切。
    const tailLen = label && label.length + 2 < mid.length ? label.length + 2 : 0
    if (need + tailLen < mid.length) {
      mid = ' ' + leftLabel + ' ' + mid.slice(0, mid.length - need - tailLen) + mid.slice(mid.length - tailLen)
    }
  }
  return fg(left + mid + right)
}
