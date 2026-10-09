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

export function isTaskLine(l) {
  return /^\s*- \[[ x]\]/.test(l);
}
/** 判断一行是否为任务附属行（↳ 开头）。 */

export function isChildLine(l) {
  return /^\s*↳/.test(l);
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
