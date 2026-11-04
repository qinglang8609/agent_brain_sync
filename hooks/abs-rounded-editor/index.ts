/**
 * 圆角四边框输入框 + 右上角状态（pi 扩展）。
 *
 * 需求（2026-11-04 用户）：
 *   ① 输入框左右都有竖线、四角圆角
 *   ② working 不单独占一行，只在上边框显示运行图标（embedWorkingStatus）
 *   ③ 上边框最右侧显示「上下文百分比/上限 模型名」，如 `8.0%/1.0M deepseek-v4.1-flash`
 *   ④ 输入框下方原有 footer 两行全部隐藏
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

/** 右上角状态文本，如 `8.0%/1.0M deepseek-v4.1-flash`。render() 拿不到 ctx，故由事件回调维护。 */
let statusLabel = ''

export class RoundedEditor extends CustomEditor {
  render(width: number): string[] {
    if (width < 4) return super.render(width)
    // 内容窄 2 列，给左右竖线让位。
    const lines = super.render(width - 2)
    if (lines.length < 2) return lines

    const borderColor = (this as any).borderColor?.bind(this)
    const wrap = (s: string) => (borderColor ? borderColor(s) : s)
    const out: string[] = []

    // 上边框：原本是整行 `─`（含 working 图标与滚动提示），两端换圆角，右端贴状态。
    out.push(roundBorder(lines[0], wrap, '╭', '╮', statusLabel))
    // 下边框在原结果的倒数第 (1 + 自动补全行数) 位 —— 补全菜单排在它后面。
    const autocompleteHeight = (this as any).renderedAutocompleteHeight ?? 0
    const bottomIdx = lines.length - 1 - autocompleteHeight

    for (let i = 1; i < bottomIdx; i++) {
      out.push(wrap(SIDE) + lines[i] + wrap(SIDE))
    }
    out.push(roundBorder(lines[bottomIdx], wrap, '╰', '╯'))
    // 自动补全行原样透传（不套竖线）。
    for (let i = bottomIdx + 1; i < lines.length; i++) out.push(lines[i])
    return out
  }
}

/** 刷新右上角状态文本（每次渲染前由事件与定时器调用）。 */
function refreshStatus(ctx: any): void {
  try {
    statusLabel = buildStatus(ctx?.getContextUsage?.(), ctx?.model?.id ?? '')
  } catch {
    statusLabel = shortenModel(ctx?.model?.id ?? '')
  }
}

export default function piRoundedEditor(pi: any): void {
  pi.on('session_start', (_event: unknown, ctx: any) => {
    if (!ctx?.ui?.setEditorComponent) return
    refreshStatus(ctx)
    // 第四个参数 embedWorkingStatus: true —— working 状态进上边框，不再单独占一行。
    ctx.ui.setEditorComponent(
      (tui: any, theme: any, keybindings: any) =>
        new RoundedEditor(tui, theme, keybindings, { embedWorkingStatus: true }),
    )
    // ④ 隐藏输入框下方的 footer 两行（路径/git/token、MCP/扩展状态），信息并入右上角。
    ctx.ui.setFooter?.(() => ({ render: () => [], invalidate() {} }))
  })

  // 切模型时更新右上角名字（/model、Ctrl+P 都走这个事件）。
  pi.on('model_changed', (_event: any, ctx: any) => {
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
