// src/todo/common.js — 跨模块共用的常量与纯工具（无业务状态，无跨依赖）。

export const TODO_MAX_LINES = 60;

export const LOG_MAX_LINES = 2000;

export const INDEX_MAX_LINES = 200;

// ---------- 本地日期 ----------

export function today() {
  // 用本地时区取 YYYY-MM-DD（toISOString 是 UTC, 会跨天错一天）
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 本地日期时间 YYYY-MM-DD HH:MM（log 流水用）

export function localStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- 读取 todo.md ----------

export const SEC = {
  todo: 'Todo',
  done: 'Done',
  archived: 'Archived',   // Done 区内部的归档标记区（原 '### 归档'）
  undated: 'Undated',     // Done 区内部无完成日期的尾组（原 '### （未标日期）'）
};

/** 旧名 → 新名。供 `abs init --repair` 一次性迁移（幂等）。
 * 只改匹配整行的标题，不动正文；不做模糊替换（防误改正文里提到的旧名）。 */
// 分区标题归一（旧名 → 标准名）

export function trimBlank(arr) {
  const a = [...arr];
  while (a.length && !a[0].trim()) a.shift();
  while (a.length && !a[a.length - 1].trim()) a.pop();
  return a;
}

/** 叶子条目行：log 的 `## [时间] …` 条目、todo/index 的 `- …` 行。
 * 空行落在两个叶子条目之间 = 人为排版漂移，会随条目增长把文件撑成两倍行数。
 * 注意（踩坑）：标题行不算 —— `## Done` 与 `### 日期` 之间的空行是分区排版，
 * 删了会把 Done 区挤成一片（首版误删）。 */

export function sigOfLine(l) {
  return String(l).replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** 一行落在 todo.md 的哪个分区（`## Todo` / `## Done`）。
 *  返回 'Todo' | 'Done' | null。用于「按区判」—— Done/Archived 区的行不该按
 *  Todo 区的白名单判（日期分组、归档链接都是合法内容）。 */
export function todoSectionOf(lines, i) {
  for (let k = i; k >= 0; k--) {
    const m = String(lines[k]).match(/^##\s+(\S.*)$/);
    if (m) return m[1].trim();
  }
  return null;
}

/** 把一份文本里所有「违规行」的签名收成集合（供存量/新增比对）。
 *  只有三个根文件用得上；非目标文件直接返回空集。
 *  ★ 空行特殊：签名取「上下两行拼接」不可靠 —— 插入一行就会让空行的
 *   相邻行变样，导致存量空行被当成新引入（实测：cmdNote 插一行后，
 *   同一处空行的签名就对不上了）。所以空行只记一个存在标记：
 *   入库前就有「条目间空行」这个毛病 → 后续写入全放行（lint 报）。 */

export const REPORT_MARKERS = [
  /^\s{0,4}[-*]\s+\S/m, // 列表项
  /^\s{0,4}\d+[.)]\s+\S/m, // 有序列表
  /```/, // 代码块
  /^\s*\|.*\|\s*$/m, // 表格行
];

/** 数一个断点里有几个「句子」—— 断点是一件事，多句 = 在塞报告。
 *  分隔符只用**句末标点**（。！？!?）与带圈编号 ①②③。
 *  ★ 分号（；/;）**不算**分隔符：中文技术写作里它常用来连接同一个意思的两部分
 *  （「改到哪个文件；同类约束见 xx」），算成两句会误伤正常断点（实测：
 *  一条正常的「改到哪 + 同类约束 + 待确认」被判 3 句而拒绝写入）。
 *  为什么不用关键词表：关键词命中不稳（「功能/方案」正常描述也会出现），
 *  而「一句还是一段」是结构判据 —— 结构判据才可靠。 */

export function sentenceCount(s) {
  return String(s)
    .split(/[。！？!?]+|\s*[\u2460-\u2473]\s*/)
    .map((x) => x.trim())
    .filter(Boolean).length;
}

/** 「绝对不允许乱空行」（2026-10-05 用户定）：条目之间不能有空行。
 *  为什么必须拒而不只是修：旧实现是「自动删」（fixed.push('删除条目之间的空行')），
 *  但那是**默默改盘** —— 写进去的东西被改了而 AI 不知道，下次又写一遍。
 *  现在直接报错，让写入方自己写对。
 *  允许的位置：H1 与首个标签之间、标签与首条目之间、区与区之间（排版需要）。 */

/** 任务行：`- [ ] …` / `- [x] …`。
 *
 * 顶层任务：顶格（缩进 0）的 `- [ ]` 行。
 * 子任务：缩进的 `- [ ]` 行（标准 Markdown 嵌套列表，2 空格一层）。
 * 两者**都是任务行**（子任务可各自勾选）；层级的区分看缩进，不在本函数。
 *
 * 为何也收 `↳ [ ]`：2026-10-16 早上刚把断点任务升级成一等任务（存量数据里有），
 * 现在改用标准 md 嵌套列表，旧形态继续认（存量不能变“看不见”）。 */
export function isTaskLine(l) {
  // 先排旧式断点行：`↳ [ ] 断点: x` 形似任务行，但它带 `断点:` ⇒ 是子项文本，不是任务。
  if (/^\s*↳\s*\[[ x]\]\s*断点[:：]/.test(l)) return false;
  return /^\s*(?:-\s*\[[ x]\]|↳\s*\[[ x]\])/.test(l);
}

/** 一行是否任务附属行（子项）：缩进的 `- [ ]`，或旧的 `↳ …` 形态。
 *
 * 标准 md 下子项就是缩进的列表项 —— 它本身也是任务行（isTaskLine 为真），
 * 但**不单独成条**：它挂在父任务下，不占顶层 id、不参与 `abs todo done`。
 * 故 isChild 的判据是「有缩进」，不是「形态不同」。 */
export function isChildLine(l) {
  if (/^\s*↳/.test(l)) return true;          // 旧形态（含 `↳ [ ]` 断点任务）
  return /^\s+-\s*\[[ x]\]/.test(l);         // 缩进的 `- [ ]`（新形态）
}

// ---------- 子项行（标准 md 嵌套列表：缩进 2 空格 + `- [ ]`） ----------
/** 子项 = 挂在任务下的可勾条目（旧的「断点」就是一条子项）。
 *
 * 格式（2026-10-16 用户定）：标准 Markdown 嵌套列表，不搞自定义前缀。
 *   - [ ] [进行中] 主任务
 *     - [x] 已完成的子项
 *     - [ ] 还没做的子项
 * 旧格式 `↳ 断点: 内容` **继续承认**（存量数据不能坏），新写入一律用标准 md。 */
export const CHILD_INDENT = '  ';

/** 解析子项行 → { done, text, indent }；不是子项返回 null。
 * 两种形态都收：新的 `  - [ ] 内容` 与旧的 `  ↳ [ ] 断点: 内容` / `  ↳ 断点: 内容`。 */
export function parseChild(l) {
  const s = String(l || '');
  // 旧形态（↳ 开头）：剥掉 ↳ 与可选复选框及可选的 `断点:` 标签
  const old = s.match(/^(\s*)↳\s*(\[[ x]\])?\s*(?:断点[:：]\s*)?(.*)$/);
  if (old) {
    // 勾选看 ↳ 后的那个复选框；旧格式无勾 ⇒ false
    if (!old[3].trim()) return null;  // `↳ [ ]` 后面没内容 = 不是子项（是旧一等任务的空壳）
    return { done: old[2] === '[x]', text: old[3].trim(), indent: old[1].length };
  }
  // 新形态（缩进的 `- [ ]`）—— 必须缩进，否则那是顶层任务
  const m = s.match(/^(\s+)-\s*\[([ x])\]\s*(.*)$/);
  if (!m) return null;
  return { done: m[2] === 'x', text: m[3].trim(), indent: m[1].length };
}

/** 生成子项行（标准 md，统一入口 —— 格式只有这一个真源）。
 * indent 默认 2（挂在顶层任务下）；多层嵌套时传更深的值。 */
export function renderChild(text, { done = false, indent = CHILD_INDENT } = {}) {
  return `${indent}- ${done ? '[x]' : '[ ]'} ${text}`;
}

/** Todo 分区里「合法行」以外的东西 = 裸文本（总结/报告/清单）。
 *  为什么补这个判据（2026-10-11，同一个坑第三次复发）：
 *  闸门原来只认 `- [ ]` 任务行与 `↳ 断点:` 行，**其余行直接跳过**（无 else 分支）。
 *  于是把总结写成「紧跟任务行的裸文本行」就三层全部放行：闸门不看、形状规则不管、
 *  lint 只查断点行 —— 实测 .agents/.brain/todo.md 被塞进 10 行实施报告而 lint 报 0 问题。
 *  前面的修法都挂在「行的形态」上（先修超长断点、再修多句断点），换个形态就绕过。
 *  改成白名单：Todo 区里除了任务行/断点/空行/标题，别的都是非法。
 *  只在 `## Todo` 区生效 —— Done/Archived 区有日期分组与归档链接，判据不同。
 *  返回 false 才叫非法。 */
export function isAllowedTodoLine(l) {
  const t = l.trim();
  if (!t) return true;                        // 空行
  if (/^#{1,3}\s/.test(t)) return true;       // `## Todo` / `### …` 标题
  if (isTaskLine(l)) return true;             // 任务行
  if (isChildLine(l)) return true;            // ↳ 断点附属行
  return false;
}

/** 把 Done 区文本（bodyLines，不含 `## Done` 标题）解析成任务单元 [{ date, lines:[main,...children] }]。
 * 剥 `### 日期` 分组标题与空行；任务行下紧跟的 ↳ 行并入该单元。 */

export function daysAgo(n, from) {
  const [y, m, d] = String(from).split('-').map(Number);
  const t = new Date(y, m - 1, d);
  t.setDate(t.getDate() - n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/** 一行是否为未完成任务行（- [ ]）。 */

export function isPlaceholder(line) {
  const t = line.trim();
  if (!/^- \[[ x]\]/.test(t)) return false; // 只判任务行
  const body = t.replace(/^- \[[ x]\]\s*/, '').replace(/\(认领[^)]*\)/g, '').trim();
  return !body || /^(无|（无）|None|null)$/.test(body);
}
/** 在指定分区段落后插入一行任务；找不到分区则在文件末尾追加回退。写前惰性迁移老格式。 */

export function extractId(text) {
  // 先剥行首状态标记（`[进行中] <id>`），否则 id 会取成 "[进行中]"（2026-09-13 实测）。
  const t = String(text).replace(/^\[[^\]]+\]\s+/, '');
  const m = t.match(/^([A-Za-z][\w-]*)\b/);
  return m ? m[1] : null;
}

/** 提取 " — " 后的 note 部分（剥掉紧跟在 id 后的 `@author` 标记及尾部 `(认领 ...)`）。
 * 格式: `<id> @author — <note> (认领 date)`。@author 可选（旧行/未设置姓名时无）。 */

export function extractNote(text) {
  const i = String(text).indexOf(' — ');
  if (i === -1) return '';
  return String(text).slice(i + 3).replace(/\s*\(认领[^)]*\)\s*$/, '').trim();
}

/** 取整段 `(认领 …)`（含日期与可选的会话 id）。无则空串。
 * 为何要整段取：sid 塞在 `(认领 日期 <sid>)` 里，原位重建任务行时
 * 必须把原值原样搬回去，否则重复 start 会把 sid 与认领日期一起冲掉。
 * 用通配 `[^)]*` 而非写死日期格式 —— 尾部多一个 sid 也能吃到。 */
export function claimOf(text) {
  const m = String(text).match(/\(认领[^)]*\)/);
  return m ? m[0] : '';
}

/** 取 `(认领 …)` 里的会话 id（末尾那个非日期 token）。无则空串。
 * 形态：`(认领 2026-10-09)` 或 `(认领 2026-10-09 01a11eae)`。 */
export function sessionOf(text) {
  const c = claimOf(text);
  if (!c) return '';
  const parts = c.replace(/^[（(]认领\s*/, '').replace(/[）)]$/, '').trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

/** 提取 id 后的作者标记（无则空）。供 upsertTask 原位重建行时保留作者。
 * 两种形态都要认：
 *   - 新: `- [ ] ID [[fanchao]] — note`   (wikilink 到人页)
 *   - 旧: `- [ ] ID @fanchao — note`      (裸 at 标记, 历史行)
 * 旧行只在原位更新时按原形态保留, 不做批量回填(原文/现场已不在, 回填等于编造)。
 * 返回的是**纯姓名**（不含 [[ ]] 与 @），由调用方决定用什么形态重写。 */

export function extractAuthor(text) {
  const s = String(text);
  const link = s.match(/^\S+\s+\[\[([^\]]+)\]\]/);
  if (link) return link[1].trim();
  const at = s.match(/^\S+\s+@([\w\u4e00-\u9fff.-]+)/);
  return at ? at[1] : '';
}

/** 判断行里的作者标记是旧裸 `@name` 形态（保留旧形态，不擅自升级）。 */

export function isLegacyAuthorTag(text) {
  return !/^\S+\s+\[\[/.test(String(text)) && /^\S+\s+@/.test(String(text));
}

/**
 * 从任务行取出行首 id token（`- [ ] <id> …` 里的 <id>）。
 * 坑: 不能用 l.includes(id) 定位任务 —— 那是子串匹配，`T1` 会命中 `T11`（同理
 * TASK-1/TASK-10、fix-hook/fix-hook-2），导致 upsert 误判"已存在"而原地改写别的任务、
 * 新任务静默消失。必须取出 id token 做全等比对。
 * id 里可能混入零宽字符(历史瑕疵)，比对前先剥掉。
 */
