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
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildStatus, roundBorder, shortenModel, thinkingColorToken } from './format.ts'
// 昵称池跟 todo 面板共用一份 —— 2026-11-07 用户要求把「作者名 · 随机语」从面板
// 搬到输入框左下角，两边必须用同一个池才叫「搬」。
// 为何用 ../abs.ts：安装后两者分别在 ~/.pi/agent/extensions/abs.ts 与
// extensions/abs-rounded-editor/index.ts，相对路径稳定。
// 代价：删掉 abs.ts 会让本扩展导入失败 —— 可接受，因为 abs.ts 是主扩展，
// 输入框样式是它的附属；单独删主扩展就不是合法使用形态了。
import { pickNickname } from '../abs.ts'

const SIDE = '│'

/** 右上角状态文本，如 `8.0%/1.0M deepseek-v4.1-flash`。render() 拿不到 ctx，故由事件回调维护。 */
let statusLabel = ''

/** 左下角标签：`fanchao · 昵称`（2026-11-07 用户要求从面板搬到这里）。
 *  session_start 时算一次 —— 不能每帧抽，否则每帧重绘就是个疯狂滚动的老虎机。
 *  空串 = 不显示（无用户名也无昵称时）。 */
let cornerLabel = ''

/** 当前推理强度（off/minimal/low/medium/high/xhigh/max）。render() 拿不到 ctx，同样这里存。
 *  用途：输入文字随推理强度变色（2026-11-06 用户需求）。 */
let effortLevel = ''

/** 取当前主题实例的 getter。
 *
 * ★ 为何不能把主题从构造函数里拿：pi 传给编辑器了的是 `getEditorTheme()`，
 *  那对象只有 `{ borderColor, selectList }`，**没有 `fg`** —— 直接用它上色会静默无效
 *  （不报错，只是没颜色）。真正带 fg 的是 `ctx.ui.theme`（interactive-mode 的 getter）。
 * ★ 为何存 getter 而不是存实例：`/theme` 切主题后 ctx.ui.theme 返回**新实例**，
 *  存旧实例会継续用旧主题的色板。 */
let themeGetter: (() => any) | null = null

export class RoundedEditor extends CustomEditor {
  render(width: number): string[] {
    if (width < 4) return super.render(width)
    // 内容窄 2 列，给左右竖线让位。
    const lines = super.render(width - 2)
    if (lines.length < 2) return lines

    const borderColor = (this as any).borderColor?.bind(this)
    const wrap = (s: string) => (borderColor ? borderColor(s) : s)
    // 文字色 = 推理强度色；off（或取不到）时为空 → 不着色，用终端默认前景色。
    const token = thinkingColorToken(effortLevel)
    const themeNow = themeGetter?.()
    const effortFg =
      token && typeof themeNow?.fg === 'function' ? (s: string) => themeNow.fg(token, s) : null
    const out: string[] = []

    // 上边框：原本是整行 `─`（含 working 图标与滚动提示），两端换圆角，右端贴状态。
    out.push(roundBorder(lines[0], wrap, '╭', '╮', statusLabel))
    // 下边框在原结果的倒数第 (1 + 自动补全行数) 位 —— 补全菜单排在它后面。
    const autocompleteHeight = (this as any).renderedAutocompleteHeight ?? 0
    const bottomIdx = lines.length - 1 - autocompleteHeight

    for (let i = 1; i < bottomIdx; i++) {
      const body = lines[i]
      // 推理强度色染**输入文字**（2026-11-06 用户）。边框不动 —— 边框本来就是 pi 按
      // 同一档强度上的色（interactive-mode 的 updateEditorBorderColor），两者自然同色。
      // 整行包裹而不逐字：光标由 \x1b[7m 反转标记，与前景色互不干扰；
      // 输入框内容是用户手打的纯文本，行内不会有 reset 把后半行冲掉。
      out.push(wrap(SIDE) + (effortFg ? effortFg(body) : body) + wrap(SIDE))
    }
    // 下边框：作者名 + 昵称贴左侧（2026-11-07 用户要求）。
    out.push(roundBorder(lines[bottomIdx], wrap, '╰', '╯', '', cornerLabel))
    // 自动补全行原样透传（不套竖线）。
    for (let i = bottomIdx + 1; i < lines.length; i++) out.push(lines[i])
    return out
  }
}

/** 读出作者名：与 abs.pi.ts 的 currentUser 同规则（ABS_USER > ~/.abs/config.json）。
 *  不在该文件导出 currentUser 是因为它依赖更多模块级状态，且本处只需这两行。 */
async function readUser(): Promise<string> {
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

/** 算出左下角标签：`fanchao · 昵称`。缺哪段就省哪段，都为空格返回空串（不画）。 */
async function refreshCornerLabel(): Promise<void> {
  try {
    const who = await readUser()
    const nick = pickNickname()
    cornerLabel = [who, nick].filter(Boolean).join(' · ')
  } catch {
    cornerLabel = ''
  }
}

/** 刷新右上角状态文本（每次渲染前由事件与定时器调用）。 */
function refreshStatus(ctx: any): void {
  try {
    statusLabel = buildStatus(ctx?.getContextUsage?.(), ctx?.model?.id ?? '')
  } catch {
    statusLabel = shortenModel(ctx?.model?.id ?? '')
  }
  refreshEffort(ctx)
}

/** 读出当前推理强度。`ctx.thinkingLevel` 是 pi 官方给扩展的入口（effective level）。 */
function refreshEffort(ctx: any): void {
  try {
    effortLevel = String(ctx?.thinkingLevel || '')
  } catch {
    effortLevel = ''
  }
}

export default function piRoundedEditor(pi: any): void {
  pi.on('session_start', (_event: unknown, ctx: any) => {
    if (!ctx?.ui?.setEditorComponent) return
    // 主题 getter（带 fg 的那个）—— 见 themeGetter 注释。
    themeGetter = () => ctx.ui?.theme
    refreshStatus(ctx)
    // 左下角标签：每次会话开一次（含 reload/new/resume），会话内固定不变。
    // 与面板旧的昵称行为一致 —— 用户要的是「搬过去」，不是改规则。
    refreshCornerLabel()
      .then(() => ctx.ui?.requestRender?.())
      .catch(() => {})
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

  // 切推理强度时重刷输入框文字色（2026-11-06 用户需求）。
  // 为何不能只靠 session_start 那一次：/model 的强度档位、Alt+T 之类的切换不改会话，
  // 不重建编辑器也就不会重新读 effortLevel —— 文字会停在旧色。
  pi.on('thinking_level_select', (_event: any, ctx: any) => {
    refreshEffort(ctx)
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
