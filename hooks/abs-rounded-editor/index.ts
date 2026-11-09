/**
 * 圆角四边框输入框 + 右上角状态（pi 扩展）。
 *
 * 需求（2026-11-04 用户）：
 *   ① 输入框左右都有竖线、四角圆角
 *   ② 右下角显示「上下文百分比/上限 模型名」，如 `8.0%/1.0M deepseek-v4.1-flash`
 *   ③ 输入框下方原有 footer 两行全部隐藏
 *
 * 2026-11-09 定案（用户来回试过好几版）：
 *   ① working 状态交给 pi 嵌在上边框（`embedWorkingStatus: true`）—— 就是 pi 原本那个样子：
 *      左上角 `⠇ Working` + 动画，颜色随整行走框线色。本扩展**不搬不改字**。
 *      试过并作废的：搬到右下角居中、正文最右一列、右上角单字符 —— 用户看完都要回左上角。
 *   ② 边框**和框内文字**都用 pi 给的 `editor.borderColor`（即原版那七档 thinking 色）。
 *
 * 为什么要覆写 render()：
 *   pi 的 Editor.render() 只画上下两条 `─`，每行是「左 padding + 文本 + 右 padding」，
 *   源码注释明写 `no side borders`。左右竖线逐行拼，没有单独钩子，只能接管整个 render。
 *
 * 做法：调 super.render(width - 2) 拿原结果（光标、滚动、自动补全原样保留），
 *   再给上下边换成圆角、给内容行两端各包一根 `│`。
 *   不复制 pi 内部逻辑，pi 改光标/滚动时本扩展自动跟住。
 *
 * 注意：自动补全菜单行排在底边之下、且自带内容宽度，不套竖线（否则菜单被框住会错位）。
 */
import { CustomEditor } from '@earendil-works/pi-coding-agent'
import { buildStatus, roundBorder, shortenModel } from './format.ts'

const SIDE = '│'

/** 右下角状态文本，如 `8.0%/1.0M deepseek-v4.1-flash · H`。render() 拿不到 ctx，故由事件回调维护。 */
let statusLabel = ''

/** 当前推理档位（off/minimal/…/max）。也只是为了拼状态文字 —— 边框颜色是 pi 自己上的。 */
let effortLevel = ''

export class RoundedEditor extends CustomEditor {
  render(width: number): string[] {
    if (width < 4) return super.render(width)
    // 内容窄 2 列，给左右竖线让位。
    const lines = super.render(width - 2)
    if (lines.length < 2) return lines

    // 边框颜色直接用 pi 给编辑器设好的那个（2026-11-09 用户要求「完全对齐原版」）：
    //   pi 的 interactive-mode 在 updateEditorBorderColor() 里把 editor.borderColor 设成
    //   theme.getThinkingBorderColor(档位)，bash 模式另给一套 —— 直接复用就等于原版那套
    //   （含 off 的暗灰），而且 /theme、切档、切 bash 模式时 pi 自己会换并请求重绘。
    //   光标色 / 输入框背景 / 聚焦外发光是 pi 内部画的，接管不了。
    const border = (this as any).borderColor
    const wrap = typeof border === 'function' ? border.bind(this) : (s: string) => s
    const out: string[] = []

    // 上边框：原本是整行 `─`（含 pi 嵌进来的 working 状态与滚动提示），两端换圆角。
    // working 就是 pi 嵌的那个样子（左上角 `⠇ Working` + 动画），不搬不改字（2026-11-09 定稿）。
    // 整行会被 roundBorder 重上一次框线色，所以它跟边框同色。
    out.push(roundBorder(lines[0], wrap, '╭', '╮'))
    // 下边框在原结果的倒数第 (1 + 自动补全行数) 位 —— 补全菜单排在它后面。
    const autocompleteHeight = (this as any).renderedAutocompleteHeight ?? 0
    const bottomIdx = lines.length - 1 - autocompleteHeight

    // 正文行：两端各包一根竖线，文字也上推理色（2026-11-09 用户要求「输入框文字颜色与推理一致」）。
    // 先剥掉 pi 原生文字色再包 —— 否则内层色码会提前收色，看着像只有前半行有颜色。
    for (const body of lines.slice(1, bottomIdx)) {
      out.push(wrap(SIDE) + wrap(body.replace(/\x1b\[[0-9;]*m/g, '')) + wrap(SIDE))
    }
    // 下边框（2026-11-07 还原：左下角的 fanchao·昵称已去掉 —— 用户嫌难看，
    // 回 todo 面板标题；roundBorder 的 leftLabel 参数保留备用）。
    // 状态文字（`31.8%/1.0M 模型名`）2026-11-09 从右上角搬到右下角，颜色跟框线一致
    // （用户当日先要搁置橙、看完又要改回推理色 —— 以最新为准）。
    out.push(roundBorder(lines[bottomIdx], wrap, '╰', '╯', statusLabel))
    // 自动补全行原样透传（不套竖线）。
    for (let i = bottomIdx + 1; i < lines.length; i++) out.push(lines[i])
    return out
  }
}

/** 刷新右下角状态文本（每次渲染前由事件与定时器调用）。 */
function refreshStatus(ctx: any): void {
  try {
    effortLevel = String(ctx?.thinkingLevel || '')
  } catch {
    effortLevel = ''
  }
  try {
    statusLabel = buildStatus(ctx?.getContextUsage?.(), ctx?.model?.id ?? '', effortLevel)
  } catch {
    statusLabel = shortenModel(ctx?.model?.id ?? '')
  }
}

export default function piRoundedEditor(pi: any): void {
  pi.on('session_start', (_event: unknown, ctx: any) => {
    if (!ctx?.ui?.setEditorComponent) return
    refreshStatus(ctx)
    // 第四个参数 embedWorkingStatus: true —— working 状态进上边框，不单独占一行（2026-11-09 用户定案）。
    // 颜色不用管：pi 嵌入时用 editor.borderColor，本扩展又把整行重上一次框线色，两边同为档位色。
    ctx.ui.setEditorComponent(
      (tui: any, theme: any, keybindings: any) =>
        new RoundedEditor(tui, theme, keybindings, { embedWorkingStatus: true }),
    )
    // ③ 隐藏输入框下方的 footer 两行（路径/git/token、MCP/扩展状态），信息并入右下角。
    ctx.ui.setFooter?.(() => ({ render: () => [], invalidate() {} }))
  })

  // 切模型时更新右上角名字（/model、Ctrl+P、cycle 都走这个事件）。
  // ★ pi 实际发的事件名是 model_select（dist/core/agent-session.js _emitModelSelect），
  //   之前监听的 model_changed 在 pi 里不存在，刷新从未触发 —— 2026-11-07 修复。
  pi.on('model_select', (_event: any, ctx: any) => {
    refreshStatus(ctx)
    ctx?.ui?.requestRender?.()
  })

  // 切推理强度：档位字母要跟着变（边框色是 pi 自己换并重绘的，不用管）。
  pi.on('thinking_level_select', (_event: any, ctx: any) => {
    refreshStatus(ctx)
    ctx?.ui?.requestRender?.()
  })

  // 上下文占用随每轮对话变化 —— 轮次结束与消息结束时刷新。
  for (const ev of ['turn_end', 'message_end', 'tool_execution_end']) {
    pi.on(ev, (_event: any, ctx: any) => {
      refreshStatus(ctx)
      ctx?.ui?.requestRender?.()
    })
  }
}
