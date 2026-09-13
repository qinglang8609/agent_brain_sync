// src/todo.js — todo.md 读写。CLI 的核心纯读写层（被 MCP 转接、可被 hook 直接调）。
// 格式沿用 SKILL.md 契约：Backlog → Today / In Progress → Blocked → Done，半成品 `↳ 断点:`。
import { promises as fs } from 'node:fs';
import { brainPath } from './index.js';
import { editFile, SKIP } from './lock.js';

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
export async function readTodo(brainRoot) {
  const p = brainPath(brainRoot, 'todo.md');
  let text;
  try {
    text = await fs.readFile(p, 'utf8');
  } catch {
    return ''; // 尚未创建，按空处理（不在此创建，避免读操作写文件）
  }
  const norm = normalizeTodo(text);
  const grouped = groupDoneSection(norm); // 平铺旧 Done → 按日期分组（幂等）
  if (grouped !== text) {
    // 惰性迁移也是写：走锁，避免与并发写互相覆盖（锁内 re-read 已是权威最新内容）
    await editFile(p, (cur) => (cur === text ? { text: grouped } : SKIP));
    return grouped;
  }
  return text;
}

export async function ensureTodo(brainRoot) {
  const p = brainPath(brainRoot, 'todo.md');
  // 缺失才建模板；经锁写盘保证原子性（避免与并发 editFile 读到半写内容）
  await editFile(p, (cur) => (cur === null ? { text: todoTemplate() } : SKIP));
  return p;
}

/** 分区名常量（单一真源）。改名时只改这里 —— 之前散在 20+ 处，一改就漏。
 * 旧名（中文）留在 LEGACY_SECTION_RENAMES 作迁移用。 */
export const SEC = {
  backlog: 'Backlog',
  today: 'Today / In Progress',
  blocked: 'Blocked',
  done: 'Done',
  // 分区（话题树总看板）：讨论层面的话题状态机，与「要落实的事」（Backlog/Today）分层。
  // 讨论出话题 → 记分区；成熟到要动手 → 才落一行任务。
  // 中文标题「分区」比 Topic 更直白；LEGACY 里把英文 Topic 也归一过来。
  topics: 'Topics',
  archived: 'Archived',   // Done 区内部的归档标记区（原 '### 归档'）
  undated: 'Undated',     // Done 区内部无完成日期的尾组（原 '### （未标日期）'）
};

/** 旧名 → 新名。供 `abs init --repair` 一次性迁移（幂等）。
 * 只改匹配整行的标题，不动正文；不做模糊替换（防误改正文里提到的旧名）。 */
// 分区标题归一（英文 Topic / 话题 都归一到「分区」）
export const LEGACY_SECTION_RENAMES = [
  // H1（文件标题）
  ['# 🗂 图谱索引', '# 🗂 Graph Index'],
  ['# 🗒 操作日志', '# 🗒 Activity Log'],
  ['# 📋 Todo 看板', '# 📋 Todo Board'],
  // ## 分区
  ['## Done（只留近期，旧的迁 log.md/快照）', '## Done'],
  ['## Topic', '## Topics'],
  ['## 话题', '## Topics'],
  ['## 话题树', '## Topics'],
  ['## 分区', '## Topics'],
  // ### 区内分组标题
  ['### 归档', '### Archived'],
  ['### （未标日期）', '### Undated'],
];

/** 把文件里的旧分区名就地改成新名（只改匹配整行的标题，不动正文）。
 * 返回 { text, changed:[旧名→新名] }。幂等：已改过的再跑 changed 为空。 */
export function renameLegacySections(text) {
  const lines = String(text ?? '').split('\n');
  const changed = [];
  const out = lines.map((l) => {
    const t = l.trim();
    for (const [oldN, newN] of LEGACY_SECTION_RENAMES) {
      if (t === oldN) { changed.push(`${oldN} → ${newN}`); return newN; }
    }
    return l;
  });
  return { text: out.join('\n'), changed };
}

export function todoTemplate() {
  // 由 rebuildStructure 生成，保证“模板”与“重排结果”逐字节一致
  // （否则 load 会把新建的模板又重排一次 = 无意义的写盘）。
  // 注意（2026-09-13 踩坑）：rebuildStructure 的 order 要**带 `## ` 前缀**，
  // 而 TODO_SECTIONS 是裸名（两者用途不同，不能复用 —— 曾误传裸名导致
  // 生成出没有 `##` 的裸标题行，模板直接损坏、Backlog 分区消失）。
  return rebuildStructure(
    ['# 📋 Todo Board', ...TODO_SECTIONS.map((s) => `## ${s}`)].join('\n'),
    { h1: '# 📋 Todo Board', order: TODO_SECTIONS.map((s) => `## ${s}`) },
  ).text;
}

/** 分区分区（话题树）：**置顶** —— 回答「我们在做什么、分了几叉、哪些已死」。
 * 设计取舍（2026-09-13 用户定）：讨论轨道与执行轨道必须分开。
 * 实测教训：一轮会话讨论了 14 条话题线，而 todo 只能反映 1 条（记录率 7%）——
 * 因为话题一旦「已结论/已证伪」就不该再占待办位，但也不该消失。
 * 故：分区置顶存话题状态（含已证伪），Backlog/Today 只存「要动手的事」。 */
export const TODO_SECTIONS = ['Topics', 'Backlog', 'Today / In Progress', 'Blocked', 'Done'];

/** 结构重建（B 档）：以标准分区表为准重排整个文件。
 *
 * 规则（保证内容不丢、不挪错）：
 *   1. 按 spec.order 顺序输出标准分区，每个分区下放**归属于它**的内容行；
 *   2. 归属判定：按行所处的原分区归入对应标准分区；旧名先按 spec.renames 归一；
 *   3. **非标准分区**（人自加的，如 `## 备忘`）→ 内容连同它自己的标题一起**原样保留在末尾**，
 *      绝不合入已有标准分区（机器不知道它的语义，猜错就是挪错内容）；
 *   4. 自由正文（不属于任何分区的行，如 H1 后的说明句）保留在 H1 之后；
 *   5. 幂等：已是标准结构 → 输出逐字节相同。
 *
 * 返回 { text, changed }；changed 为空的描述列表（空=无需改盘）。 */
export function rebuildStructure(text, spec) {
  const s = String(text ?? '');
  const lines = s.split('\n');
  const h1At = lines.findIndex((l) => l.trim().startsWith('# '));
  const bodyStart = h1At === -1 ? 0 : h1At + 1;
  const bucket = new Map();   // 标准分区名 -> 内容行
  const extras = [];          // [{ title, lines }] 非标准分区，原样保留到末尾
  const preamble = [];        // H1 与第一个 ## 之间的自由正文
  let curStd = null;          // 当前在的标准分区名（null = 前言）
  let curExtra = null;        // 当前在的额外分区对象
  for (let i = bodyStart; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{2,3}\s/.test(l)) {
      const t = l.trim();
      const renamed = (spec.renames?.find(([o]) => o === t) || [, t])[1];
      if (spec.order.includes(renamed)) {
        curStd = renamed;
        curExtra = null;
        if (!bucket.has(curStd)) bucket.set(curStd, []);
      } else {
        curExtra = { title: renamed, lines: [] };
        extras.push(curExtra);
        curStd = null;
      }
      continue;
    }
    if (curExtra) curExtra.lines.push(l);
    else if (curStd) bucket.get(curStd).push(l);
    else preamble.push(l);
  }
  const out = [spec.h1];
  const pre = trimBlank(preamble);
  if (pre.length) out.push('', ...pre);
  // 空分区之间不插空行（否则每次首跑都会“把空行加进去”而写盘一次，
  // 而 load 是好读命令 —— 不该因纯排版差异去改文件）。
  // 有内容的第一个分区与前言之间保留一个空行（排版），其余紧凑。
  for (const [idx, name] of spec.order.entries()) {
    const body = trimBlank(bucket.get(name) || []);
    if (body.length || (idx === 0 && pre.length)) out.push('', name, ...body);
    else out.push(name);
  }
  for (const e of extras) {
    const body = trimBlank(e.lines);
    out.push('', e.title);
    if (body.length) out.push(...body);
  }
  const next = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
  return { text: next, changed: next === s ? [] : ['结构按标准重排'] };
}

/** 去掉首尾空行，不动中间（保留用户的分段）。 */
function trimBlank(arr) {
  const a = [...arr];
  while (a.length && !a[0].trim()) a.shift();
  while (a.length && !a[a.length - 1].trim()) a.pop();
  return a;
}

export function normalizeTodo(text) {
  const lines = text.split('\n');
  const has = (name) => lines.some((l) => l.trim() === `## ${name}`);
  if (has('Backlog') || has('Today / In Progress')) return text; // 已是新格式
  if (!has('In Progress') && !has('Todo')) return text;          // 不是老格式，不动
  const out = ['# 📋 Todo Board'];
  const grab = (name) => {
    const items = [];
    let inSec = false;
    for (const l of lines) {
      if (l.startsWith('## ')) { inSec = l.trim() === `## ${name}`; continue; }
      if (inSec && l.trim() && !isPlaceholder(l)) items.push(l);
    }
    return items;
  };
  const done = grab('Done');
  const blocked = grab('Blocked');
  const inprog = grab('In Progress');
  const todo = grab('Todo');
  out.push('## Backlog', ...todo.length ? todo : []);
  out.push('## Today / In Progress', ...inprog.length ? inprog : []);
  out.push('## Blocked', ...blocked.length ? blocked : []);
  out.push('## Done', ...done.length ? done : []);
  return out.join('\n');
}

/** 从已完成任务行提取 `(完成 YYYY-MM-DD)` 日期；无则返回 ''。兼容中英文括号。 */
export function doneDateOf(line) {
  const m = String(line).match(/\(完成\s*(\d{4}-\d{2}-\d{2})[^)]*\)/);
  return m ? m[1] : '';
}

// ---------- Done 结语契约 ----------
// 为什么需要: `[x]` 原本同时表示「真落地」「评估后不做」「仅设计过」三种完全不同的状态，
// 读的人(下一个会话/未来的自己)无法区分。实测翻车: 读 daemon 条的 [x] 当成已落地，
// 实际它跑通后被撤销、代码全删 —— 基于假记录得出「daemon 是过配项」的错误结论。
// 结论: 图谱的价值取决于「可被信任」，一条状态失真的记录比一百条冗长记录的危害大一个量级。
export const DONE_KINDS = ['落地', '否决', '仅方案'];

/** 从 Done 任务行提取结语标记；无标记返回 ''。 */
export function doneKindOf(line) {
  const m = String(line).match(/【(落地|否决|仅方案)】/);
  return m ? m[1] : '';
}

/** 追写结语到任务行：插在 `(完成 …)` 之前，幂等（已有则原位替换）。 */
export function withDoneKind(line, kind) {
  if (!kind) return line;
  const base = String(line).replace(/【(落地|否决|仅方案)】/g, '').replace(/\s{2,}/g, ' ').trimEnd();
  const i = base.lastIndexOf(' (完成 ');
  if (i === -1) return `${base} 【${kind}】`;
  return `${base.slice(0, i)} 【${kind}】${base.slice(i)}`;
}

/** 判断一行是否为任务行（- [x] / - [ ]，允许缩进）。 */
function isTaskLine(l) {
  return /^\s*- \[[ x]\]/.test(l);
}
/** 判断一行是否为任务附属行（↳ 开头）。 */
function isChildLine(l) {
  return /^\s*↳/.test(l);
}

/** 把 Done 区文本（bodyLines，不含 `## Done` 标题）解析成任务单元 [{ date, lines:[main,...children] }]。
 * 剥 `### 日期` 分组标题与空行；任务行下紧跟的 ↳ 行并入该单元。 */
function parseDoneUnits(bodyLines) {
  const units = [];
  let cur = null;
  for (const l of bodyLines) {
    if (/^### /.test(l.trim()) || l.trim() === '') { cur = null; continue; } // 分组标题/空行断开会话
    if (isTaskLine(l)) {
      cur = { date: doneDateOf(l), lines: [l] };
      units.push(cur);
    } else if (isChildLine(l) && cur) {
      cur.lines.push(l); // 附属行挂到上一个任务
    }
  }
  return units;
}

/** 按 (完成 date) 分组 Done 任务单元并重建文本行：新日期在前，未标日期归尾组。
 * 同组内保持输入顺序（幂等）。返回不含 `## Done` 标题的主体行。 */
function renderDoneGroups(units) {
  const byDate = new Map();
  const undated = [];
  for (const u of units) {
    if (!u.date) undated.push(u);
    else {
      if (!byDate.has(u.date)) byDate.set(u.date, []);
      byDate.get(u.date).push(u);
    }
  }
  const dates = [...byDate.keys()].sort().reverse(); // 新日期在前
  const out = [];
  for (const d of dates) out.push(`### ${d}`, '', ...byDate.get(d).flatMap((u) => u.lines), '');
  if (undated.length) out.push(`### ${SEC.undated}`, '', ...undated.flatMap((u) => u.lines), '');
  return out;
}

/** 把 Done 区从「全量行」折叠为「按日期计数」，供 `abs load` / `abs todo` 这类
 * 给人（和 AI 上下文）看的视图用。
 *
 * 坑: 这两个命令此前直接 `todo.trim()` 全量打印，而 Done 区**无上限增长** ——
 * 本仓库一处就占 load 输出的 68.8%（19.6KB/28.4KB）。长历史机器上直接把
 * 上下文塞满（实报：「另一台机器 abs load 塞了 40%」）。
 * 这与 hooks.log / wrapup.log 同类问题（那两处有轮转），故这里只给计数，
 * 要看明细用 `abs todo` 加 `--full`，或直接看 todo.md / 归档页。
 *
 * `### 归档` 区（历史的「归档 N 条」标记行）体积小且是长期引用，原样保留。
 * 返回 { text, doneCount }；text 不含 `## Done` 标题行。 */
export function collapseDone(text) {
  const lines = String(text).split('\n');
  const di = lines.findIndex((l) => l.startsWith('## Done'));
  if (di === -1) return { text: String(text).trim(), doneCount: 0 };
  const head = lines.slice(0, di);
  const rest = lines.slice(di + 1);
  const { groupLines, archiveLines } = splitDoneBody(rest);
  const units = parseDoneUnits(groupLines);
  // 按日期归组计数（新日期在前），未标日期的归尾
  const byDate = new Map();
  let undated = 0;
  for (const u of units) {
    if (!u.date) undated++;
    else byDate.set(u.date, (byDate.get(u.date) || 0) + 1);
  }
  const counts = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([d, n]) => `${d} ${n} 条`);
  if (undated) counts.push(`未标日期 ${undated} 条`);
  // 只列最近 MAX_DONE_DATE_LINES 个日期组：日期组本身也随历史增长（实测 300 条跨 28 天
  // 会把 load 输出从 660B 拉到 1203B）。载入视图只需"最近做了多少"，早期历史看归档页。
  const MAX_DONE_DATE_LINES = 7;
  const shown = counts.slice(0, MAX_DONE_DATE_LINES);
  if (counts.length > MAX_DONE_DATE_LINES) {
    const rest = counts.length - MAX_DONE_DATE_LINES;
    shown.push(`… 另有 ${rest} 个更早日期组（abs todo --full 看全量）`);
  }
  const doneLines = units.length
    ? [`## Done（${units.length} 条，按日期折叠）`, ...shown.map((c) => `- ${c}`)]
    : ['## Done（0 条）'];
  const out = [...head, ...doneLines, '', ...archiveLines].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, doneCount: units.length };
}

/** 归档标记区标题。它在 Done 区内部、日期分组之后，形如：
 *   ### Archived
 *   - [[2026-09-10-todo归档]] 完成任务 10 条
 * 这区不是任务行，不能被 parseDoneUnits 吃挂，否则 markDone 重建 Done 时会把它丢掉。
 * 故先切出去当"不透明区域"原样保留。 */
const ARCHIVE_HEADING = `### ${SEC.archived}`;

/** 把 Done 主体行切成 { groupLines, archiveLines }：把 `### 归档` 区当"不透明块"原样保留。
 * 注意不能简单"从标题切到文件尾" —— 否则一旦有日期组落在归档区之后（手改/旧数据），
 * 它会被当不透明内容除在分组之外，永远不参与归档。故只取到下一个 ###/## 标题为止。 */
function splitDoneBody(bodyLines) {
  const ai = bodyLines.findIndex((l) => l.trim() === ARCHIVE_HEADING);
  if (ai === -1) return { groupLines: bodyLines, archiveLines: [] };
  let end = ai + 1;
  while (end < bodyLines.length && !/^#{2,3} \S/.test(bodyLines[end].trim())) end++;
  return {
    groupLines: [...bodyLines.slice(0, ai), ...bodyLines.slice(end)],
    archiveLines: bodyLines.slice(ai, end),
  };
}

/** 合并归档标记行：**每天一行** `- [[<日期>-todo归档]] 完成任务 N 条`。
 * 计数按 slug **累计**（同一天分两批归档时叠加，否则标记行与归档页实际内容不符）；
 * 已存在的其他天的标记行原样保留。返回含标题的行数组。 */
function mergeArchiveLines(existing, entries) {
  const out = existing.length ? [...existing] : [ARCHIVE_HEADING];
  while (out.length && !out[out.length - 1].trim()) out.pop();
  for (const { slug, count } of entries) {
    const i = out.findIndex((l) => l.includes(`[[${slug}]]`));
    const prev = i !== -1 ? Number((out[i].match(/完成任务 (\d+) 条/) || [])[1] || 0) : 0;
    const line = `- [[${slug}]] 完成任务 ${prev + count} 条`;
    if (i !== -1) out[i] = line;
    else out.push(line);
  }
  out.push('');
  // 标记行按日期倒序（与 Done 日期组同风格：新的在上）。
  // 否则顺序 = 归档先后，多次归档后读起来是乱的（如 08/09/07）。
  const dateOf = (l) => (String(l).match(/(\d{4}-\d{2}-\d{2})/) || [''])[0];
  const body = out.slice(1).filter((l) => l.trim());
  body.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  return [out[0], ...body, ''];
}

/** 本地日期减 n 天（YYYY-MM-DD）。纯字符串入出，避免时区漂移。 */
function daysAgo(n, from) {
  const [y, m, d] = String(from).split('-').map(Number);
  const t = new Date(y, m - 1, d);
  t.setDate(t.getDate() - n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/** 一行是否为未完成任务行（- [ ]）。 */
function isUndoneLine(l) {
  return /^\s*- \[ \]/.test(l);
}

/**
 * 把 Done 区里"可归档"的日期组摘出来，并追回归档标记行。**纯函数**（不碰磁盘）。
 * 规则（用户定）：
 *   ① 只保留近 keepDays 天（含今天）；更早的才归档。
 *   ② 某一天只要还有未完成（- [ ]）任务，**整天都不归档**（不拆半天）。
 *   ③ 每**天**归一个文件，slug 为 `<日期>-todo归档`（由 slugFor 给），本函数只负责
 *      从 todo 文本里移除 + 在 Done 区尾部的 `### 归档` 区**每天记一行**
 *      `- [[<日期>-todo归档]] 完成任务 N 条`。
 * 无日期组（### （未标日期））无法判天数，**保守不归档**。
 * @returns {{text:string, archived:{date:string,lines:string[],slug:string,count:number}[], skipped:{date:string,reason:string}[], count:number}}
 */
export function archiveDoneInText(text, { keepDays = 3, from = today(), slugFor = (d) => `${d}-todo归档` } = {}) {
  const lines = String(text || '').split('\n');
  const di = lines.findIndex((l) => l.startsWith('## Done'));
  if (di === -1) return { text, archived: [], skipped: [], count: 0 };
  const head = lines.slice(0, di + 1);
  const { groupLines, archiveLines } = splitDoneBody(lines.slice(di + 1));
  const units = parseDoneUnits(groupLines);
  if (!units.length) return { text, archived: [], skipped: [], count: 0 };

  const keep = Math.max(1, Number(keepDays) || 3);
  // 保留 cutoff..from 这 keep 天；比 cutoff 更早的才归档
  const cutoff = daysAgo(keep - 1, from);

  const byDate = new Map();
  const undated = [];
  for (const u of units) {
    if (!u.date) { undated.push(u); continue; }
    if (!byDate.has(u.date)) byDate.set(u.date, []);
    byDate.get(u.date).push(u);
  }

  const archived = [];
  const skipped = [];
  const keepUnits = [...undated];
  if (undated.length) skipped.push({ date: '(未标日期)', reason: '无完成日期，无法判断天数（保守不归档）' });

  for (const date of [...byDate.keys()].sort()) {
    const us = byDate.get(date);
    if (date >= cutoff) { keepUnits.push(...us); continue; }        // ① 近 N 天：保留
    const undone = us.filter((u) => isUndoneLine(u.lines[0]));
    if (undone.length) {                                            // ② 有未完成：整天不归档
      skipped.push({ date, reason: `有 ${undone.length} 条未完成，整天不归档` });
      keepUnits.push(...us);
      continue;
    }
    const gLines = us.flatMap((u) => u.lines);                       // ③ 可归档
    archived.push({
      date,
      lines: gLines,
      slug: slugFor(date),
      count: gLines.filter((l) => /^\s*- \[x\]/.test(l)).length,
    });
  }

  if (!archived.length) return { text, archived: [], skipped, count: 0 };

  const count = archived.reduce((n, g) => n + g.count, 0);
  const entries = archived.map((g) => ({ slug: g.slug, count: g.count }));
  const rebuilt = [...head, ...renderDoneGroups(keepUnits), ...mergeArchiveLines(archiveLines, entries)];
  return { text: rebuilt.join('\n').replace(/\n+$/, '\n'), archived, skipped, count };
}

/** 归档页正文（按日期分组，原文保留）。供首次建页与同日追写复用。 */
export function renderArchiveBody(groups) {
  const out = [];
  for (const g of groups) out.push(`### ${g.date}`, '', ...g.lines, '');
  return out.join('\n').replace(/\n+$/, '\n');
}

/** 归档页全文（带 frontmatter）。**每天一个文件**，故只收一组。 */
export function renderArchivePage({ group }) {
  const { date, lines } = group;
  const n = lines.filter((l) => /^\s*- \[x\]/.test(l)).length;
  const head = [
    '---',
    'tags: [todo-archive, 历史]',
    `updated: ${date}`,
    'status: reviewed',
    '---',
    '',
    `# Todo 归档 — ${date}`,
    '',
    `> 从 \`.brain/todo.md\` 的 Done 区迁出（该区只保留近期）。本页含 ${date} 的 ${n} 条已完成任务。`,
    '> 原文完整保留（含 `↳ 断点/卡点`），查"某任务当时做到哪"看这里。',
    '',
  ];
  return head.join('\n') + '\n' + renderArchiveBody([group]) + '\n';
}

/** 幂等：把 todo 全文里平铺的旧 Done 区按日期分组（新日期在前，未标日期归尾）。
 * 已是分组态(### date)则原样返回——惰性迁移用，避免每次读都动文件。 */
export function groupDoneSection(text) {
  const lines = String(text || '').split('\n');
  const di = lines.findIndex((l) => l.startsWith('## Done'));
  if (di === -1) return text;
  const body = lines.slice(di + 1);
  const first = body.find((l) => l.trim());
  if (first && /^### /.test(first.trim())) return text; // 已分组，幂等不动
  const { groupLines, archiveLines } = splitDoneBody(body); // 归档标记区原样保留
  const units = parseDoneUnits(groupLines);
  if (!units.length) return text;
  return [...lines.slice(0, di + 1), ...renderDoneGroups(units), ...archiveLines]
    .join('\n').replace(/\n+$/, '\n');
}

/** 把 moved 单元（已完成任务行+附属行）放入 Done 区并整体按日期分组重建。
 * 供 markDone 用，锁内一次完成「归位 + 分组」。无 Done 区则文件尾补建。 */
export function insertDoneGrouped(text, movedLines) {
  const date = doneDateOf(movedLines[0]) || today();
  const lines = String(text || '').split('\n');
  const di = lines.findIndex((l) => l.startsWith('## Done'));
  const newUnit = { date, lines: movedLines };
  if (di === -1) {
    const header = '## Done（只留近期，旧的迁 log.md/快照）';
    return [...lines, '', header, '', ...renderDoneGroups([newUnit])].join('\n').replace(/\n+$/, '\n');
  }
  const head = lines.slice(0, di + 1);
  const body = lines.slice(di + 1);
  const { groupLines, archiveLines } = splitDoneBody(body); // 归档标记区原样保留
  // 新完成单元置前：同日期组内新在最上（renderDoneGroups 按 encounter 顺序保持，日期再倒序排）
  const units = [newUnit, ...parseDoneUnits(groupLines)];
  return [...head, ...renderDoneGroups(units), ...archiveLines].join('\n').replace(/\n+$/, '\n');
}

// 占位/空任务行（老模板的 "（无）"/"无"/纯 - [ ]）不迁移
function isPlaceholder(line) {
  const t = line.trim();
  if (!/^- \[[ x]\]/.test(t)) return false; // 只判任务行
  const body = t.replace(/^- \[[ x]\]\s*/, '').replace(/\(认领[^)]*\)/g, '').trim();
  return !body || /^(无|（无）|None|null)$/.test(body);
}
/** 在指定分区段落后插入一行任务；找不到分区则在文件末尾追加回退。写前惰性迁移老格式。 */
export async function addTask(brainRoot, { section, text }) {
  const p = await ensureTodo(brainRoot);
  await editFile(p, (orig) => ({ text: insertTask(orig, section, text) }));
  return { file: p, text };
}

/** 纯函数：把任务行插到分区标题后。供 editFile mutator 复用（upsert 也用它）。 */
function insertTask(orig, section, text) {
  const base = normalizeTodo(orig);
  const lines = base.split('\n');
  const header = `## ${section}`;
  let idx = lines.findIndex((l) => l.startsWith(header));
  if (idx === -1) {
    lines.push('', header, `- [ ] ${text}`);
  } else {
    // 在该分区标题后、下一个分区标题前插入
    let insertAt = idx + 1;
    while (insertAt < lines.length && !lines[insertAt].startsWith('## ')) insertAt++;
    lines.splice(insertAt, 0, `- [ ] ${text}`);
  }
  return lines.join('\n');
}

/** 任务行解析：`- [ ] <id> — note (认领 date)` / 附属断点行 `↳ 断点:`。 */
export function parseTaskLine(line) {
  const m = line.match(/^- \[( |x)\] (.*?)(?: — (.*?))? \(?(认领|完成 \d{4}-\d{2}-\d{2}[^)]*)?\)?$/);
  return m; // 保守解析；不匹配返回 null（附属行等）
}

/** 幂等登记：同 id 已有未完成任务行则原位更新（新 note/新认领日期），否则插入。 */
export async function upsertTask(brainRoot, { section, text }) {
  const p = await ensureTodo(brainRoot);
  const id = extractId(text);
  const note = extractNote(text);
  const out = await editFile(p, (orig) => {
    const base = normalizeTodo(orig);
    const lines = base.split('\n');
    // 在所有分区中找该 id 对应的未完成任务行（Done 的已完成行不重复动）；全等比对
    const idx = findTaskLine(lines, id);
    if (idx !== -1) {
      // 原位更新：保留断点附属行 + 原@作者，只换任务行本体
      const raw = lines[idx].replace(/^- \[ \] /, '');
      const author = extractAuthor(raw);
      const legacy = isLegacyAuthorTag(raw); // 旧行保持旧形态，不静默改写
      const oldNote = extractNote(raw);
      const merged = note && oldNote && oldNote.startsWith(note) ? `${note}${oldNote.slice(note.length)}` : note || oldNote;
      const at = author ? ` ${legacy ? '@' + author : '[['
        + author + ']]'}` : '';
      const newLine = `- [ ] ${id}${at}${merged ? ' — ' + merged : ''} (认领 ${today()})`;
      lines[idx] = newLine;
      return { text: lines.join('\n'), updated: true };
    }
    return { text: insertTask(base, section, text), updated: false };
  });
  return out.updated
    ? { file: p, text, updated: true }
    : { file: p, text, updated: false };
}

/** 从任务文本提取幂等键（行首 id，如 TASK-1 / T-2 / fix-hook）。 */
export function extractId(text) {
  const m = String(text).match(/^([A-Za-z][\w-]*)\b/);
  return m ? m[1] : null;
}

/** 提取 " — " 后的 note 部分（剥掉紧跟在 id 后的 `@author` 标记及尾部 `(认领 ...)`）。
 * 格式: `<id> @author — <note> (认领 date)`。@author 可选（旧行/未设置姓名时无）。 */
export function extractNote(text) {
  const i = String(text).indexOf(' — ');
  if (i === -1) return '';
  return String(text).slice(i + 3).replace(/\s*\(认领[^)]*\)\s*$/, '').trim();
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
export function idOfTaskLine(line) {
  if (!line || !line.startsWith('- [ ]')) return null;
  const m = line.match(/^- \[ \] (\S+)/);
  return m ? m[1].replace(/\u200b/g, '') : null;
}

/** 定位 id 对应的未完成任务行下标；附属断点行（↳ 开头）不算任务行。
 *  全等比对，不用 includes（否则 T1 会误命中 T11）。 */
export function findTaskLine(lines, id) {
  if (!id) return -1;
  const want = String(id).replace(/\u200b/g, '');
  return lines.findIndex((l) => idOfTaskLine(l) === want);
}

/** 实时断点: 在 id 任务行下原位补/换 `↳ 断点:` 附属行（不挪任务位置）。 */
export async function setBreakpoint(brainRoot, { id, text }) {
  const p = await ensureTodo(brainRoot);
  const bp = `  ↳ 断点: ${text}`;
  const res = await editFile(p, (orig) => {
    const lines = orig.split('\n');
    const idx = findTaskLine(lines, id);
    if (idx === -1) return SKIP;
    if (lines[idx + 1] && lines[idx + 1].trimStart().startsWith('↳ 断点:')) {
      lines[idx + 1] = bp; // 幂等: 更新原附属行
    } else {
      lines.splice(idx + 1, 0, bp);
    }
    return { text: lines.join('\n'), ok: true };
  });
  return res === SKIP
    ? { ok: false, msg: `(未找到含 "${id}" 的未完成任务行)` }
    : { ok: true, msg: `✓ 断点已落 → ${id}\n  ${bp.trim()}` };
}

/** 实时碰壁: 任务行原位勾成 blocked 语义（移入 Blocked 区 + 附原因）。 */
export async function moveBlocked(brainRoot, { id, reason }) {
  const p = await ensureTodo(brainRoot);
  const res = await editFile(p, (orig) => {
    const lines = orig.split('\n');
    const idx = findTaskLine(lines, id);
    if (idx === -1) return SKIP;
    const taskLine = lines[idx];
    const kept = [];
    const moved = [taskLine];
    for (let i = 0; i < lines.length; i++) {
      if (i === idx) {
        while (i + 1 < lines.length && lines[i + 1].trimStart().startsWith('↳')) moved.push(lines[++i]);
        continue;
      }
      kept.push(lines[i]);
    }
    const bIdx = kept.findIndex((l) => l.startsWith('## Blocked'));
    if (reason) moved.push(`  ↳ 卡点: ${reason}`);
    const out = bIdx === -1
      ? [...kept, '## Blocked', ...moved]
      : [...kept.slice(0, bIdx + 1), ...moved, ...kept.slice(bIdx + 1)];
    return { text: out.join('\n'), ok: true };
  });
  return res === SKIP
    ? { ok: false, msg: `(未找到含 "${id}" 的未完成任务行)` }
    : { ok: true, msg: `✓ 已标阻塞 → Blocked 区: ${id}${reason ? `\n  卡点: ${reason}` : ''}` };
}

// ---------- 看板输出 ----------
export async function boardText(brainRoot, textOverride, { full = false } = {}) {
  const text = textOverride !== undefined ? textOverride : await readTodo(brainRoot);
  const head = `📂 abs → 项目: ${brainRoot}`;
  if (!text.trim()) return `${head}\n\n（todo.md 为空，先 abs todo add 登记任务）`;
  // Done 区折叠：它无上限增长，全量打印会把上下文塞满（见 collapseDone 注释）
  const body = full ? text.trim() : collapseDone(text).text;
  const hint = full ? '' : '\n\n（Done 只给计数；看明细: abs todo --full）';
  return `${head}\n\n${body}${hint}`;
}

// ---------- 分区（话题树） ----------
// 设计动机（2026-09-13 实测教训）：一轮长会话讨论了 14 条话题线，而看板只能反映 1 条
// （记录率 7%）——因为「已结论/已证伪」的话题不该再占待办位，但也不该消失（否则下个
// 会话重走死路）。故把「讨论轨道」独立成 `## 分区`：话题带状态，与「执行轨道」
// （Backlog/Today）分层。讨论出话题 → 记分区；成熟到要动手 → 才落一行任务。

/** 话题状态（与执行轨道共享的语义，但用于话题层面）。 */
export const TOPIC_STATES = ['进行中', '已结论', '已否决', '待验证', '已落地', '未落地'];

/** 终止态：这些话题**不该留在 Topics 区**（用户定：只放正在讨论的）。
 * 理由：树的价值是「当前在哪」；死话题会把活话题淹掉。
 * 归档去向：结论写进 sources/（abs note），那里可检索、不挤占 load 首屏。
 *
 * 2026-09-13 修正：`未落地`/`待验证` **也算离开 Topics**。
 * 先前误把它们当“活跃”留在树上 → 结果 #8（方案已定、等客户端配合）/#3.4（等数据）
 * 长期挂在“正在讨论”里变成僵尸。它们的真实语义是**暂停**（等人/等数据），
 * 应落 Backlog/Blocked 当成任务追踪，而不是冒充“当前话题”。 */
export const TOPIC_CLOSED_STATES = ['已结论', '已否决', '已落地', '待验证', '未落地'];

/** 从 Topics 区移除一个话题（含其父指针行）。终止态话题用 —— 树只留活跃话题。 */
export function removeTopicLine(text, id) {
  const lines = String(text ?? '').split('\n');
  const { at, lines: seg } = topicLines(lines.join('\n'));
  if (at === -1) return text;
  const rel = seg.findIndex((l) => {
    const t = parseTopicLine(l);
    return t && t.id === id;
  });
  if (rel === -1) return text;
  const abs = at + 1 + rel;
  const drop = 1 + (/^\s*└─\s*父:/.test(lines[abs + 1] || '') ? 1 : 0);
  lines.splice(abs, drop);
  return lines.join('\n');
}

/** 话题行格式（刻意做得极简、可手写可机器解析）：
 *   - [ ] #12 [[name]] 减少决策步往返 [进行中] — 结论
 *   - [x] #11 [[name]] 任务拆分       [已否决] — 子任务必 miss
 *       └─ 父: #9
 * 缩进 = 父子关系（纯缩进即树，不引入新语法）；[[name]] = 登记人（与 todo 行同约定）。
 *
 * 解析要点（2026-09-13 踩坑）：状态标记是**末尾** `[状态]`，不能用非贪婪匹配 ——
 * 否则标题含 `[` 时会被第一个 `[` 截断。故：先切结论，再从剩余尾部抽状态。 */
const TOPIC_RE = /^(\s*)- \[( |x)\]\s+(#[\w.]+)\s+(.*)$/;
const TOPIC_STATE_TAIL = /\s*\[([^\]]+)\]\s*$/;
const TOPIC_AUTHOR = /^\[\[([^\]]+)\]\]\s*/;

/** 解析一行话题。返回 null 表示不是话题行（普通任务行/正文行）。 */
export function parseTopicLine(line) {
  const m = String(line).match(TOPIC_RE);
  if (!m) return null;
  const [, indent, box, id, rest] = m;
  const body = rest.trim();
  // 顺序很重要（2026-09-13 踩坑）：先切结论、再抽状态。
  // 若颠倒，`… [已否决] — 结论` 的末尾是结论而非状态，会抽不到状态。
  // 结论分隔：` — ` / ` -- `（全角/半角破折号、双连字符）
  let head = body;
  let conclusion = '';
  const sep = body.match(/\s(?:—|--)\s/);
  if (sep) {
    head = body.slice(0, sep.index).trim();
    conclusion = body.slice(sep.index + sep[0].length).trim();
  }
  // 抽作者标记（紧跟 id 后的 [[name]]）
  let author = null;
  const am = head.match(TOPIC_AUTHOR);
  if (am) {
    author = am[1];
    head = head.slice(am[0].length).trim();
  }
  // 从 head 尾部抽 [状态]；只有识别为已知状态名才切除，否则归回标题
  let state = null;
  const st = head.match(TOPIC_STATE_TAIL);
  if (st && TOPIC_STATES.includes(st[1])) {
    state = st[1];
    head = head.slice(0, st.index).trim();
  }
  return {
    indent: indent.length,
    done: box === 'x',
    id,
    author,
    title: head,
    state: state || (box === 'x' ? '已结论' : '进行中'),
    conclusion,
  };
}

/** 渲染一行话题（与 parseTopicLine 互逆，便于测试）。
 * 结论用 ` — ` 分隔（与 parseTopicLine 的 sep 规则对称），否则回读时会把结论
 * 误并回标题（先前实测：`#1 … [已否决] 六条…` → 标题被截断、状态被误读）。 */
export function renderTopicLine(t) {
  const ind = ' '.repeat(t.indent || 0);
  const closed = ['已结论', '已否决', '已落地'].includes(t.state);
  const b = closed ? 'x' : t.done ? 'x' : ' ';
  const who = t.author ? ` ${`[[${t.author}]]`}` : '';
  const head = `${ind}- [${b}] ${t.id}${who} ${t.title} [${t.state}]`;
  return t.conclusion ? `${head} — ${t.conclusion}` : head;
}

/** 取 `## 分区` 区段的行（不含标题）。 */
export function topicLines(text) {
  const lines = String(text ?? '').split('\n');
  const at = lines.findIndex((l) => l.trim() === `## ${SEC.topics}`);
  if (at === -1) return { at: -1, lines: [] };
  let end = at + 1;
  while (end < lines.length && !/^## /.test(lines[end])) end++;
  return { at, lines: lines.slice(at + 1, end) };
}

/** 幂等登记/更新一个话题。同 id 已存在则原位更新（标题/状态/结论），否则按缩进插入。 */
export function upsertTopicLine(text, { id, title, state, conclusion, indent = 0, author = null }) {
  const lines = String(text ?? '').split('\n');
  const { at, lines: seg } = topicLines(lines.join('\n'));
  const existing = seg.findIndex((l) => {
    const t = parseTopicLine(l);
    return t && t.id === id;
  });
  // 作者：优先新值，否则沿用已存在的行（“只改状态”不该把登记人抹掉）
  const prev = existing === -1 ? null : parseTopicLine(seg[existing]);
  const rendered = renderTopicLine({
    id, title, state, conclusion, indent: prev ? prev.indent : indent,
    author: author || prev?.author || null,
  });
  if (at === -1) {
    // 无分区 → 补建在**最前**（Topics 是总览，必须先被看到）。
    // 坑（2026-09-13 实测）：曾插到 `## Done` 之前 → 反而排在 Backlog/Today 之后，
    // 与「置顶」意图相反。正确位置 = H1/前言之后的第一个分区位。
    let insertAt = 0;
    while (insertAt < lines.length && !/^## /.test(lines[insertAt])) insertAt++;
    lines.splice(insertAt, 0, `## ${SEC.topics}`, rendered, '');
    return { text: lines.join('\n'), changed: ['新增 Topics 区'] };
  }
  if (existing !== -1) {
    const abs = at + 1 + existing;
    if (lines[abs] === rendered) return { text, changed: [] };
    lines[abs] = rendered;
  } else {
    let insertAt = at + 1;
    while (insertAt < lines.length && !/^## /.test(lines[insertAt])) insertAt++;
    // 插到该分区末尾（去掉尾部空行，保持紧凑）
    while (insertAt - 1 > at && !lines[insertAt - 1].trim()) insertAt--;
    lines.splice(insertAt, 0, rendered);
  }
  return { text: lines.join('\n'), changed: [`话题 ${id} → ${state}`] };
}

/** 把话题从 Topics 区**移进**指定分区（默认 Today），保留同一个 id。
 *
 * 模型根基（2026-09-13 用户定）：话题有生命周期，Topics 不是终点而是**入口**。
 * 「讨论」与「执行」是**同一件事的两态**，不是两份记录——所以是**移动**（带同 id），
 * 不是复制。这样 `#1.2` 从话题变成任务后，仍然能一路追到 Done。
 *
 * 落单格式用普通任务行（与 todo 同构），以便复用看板/归档/lint 全套；
 * 原话题的**结论**捎带过去（丢了就没上下文）。
 * 返回新文本；话题不存在则原样返回。 */
export function promoteTopic(text, id, section = SEC.today) {
  const src = String(text ?? '');
  const nodes = topicTree(src);
  const node = nodes.find((n) => n.id === id);
  if (!node) return { text: src, changed: [] };
  let out = removeTopicLine(src, id);
  const lines = out.split('\n');
  const at = lines.findIndex((l) => l.trim() === `## ${section}`);
  if (at === -1) return { text: src, changed: [] };   // 目标分区不存在 → 不动（不猜）
  let end = at + 1;
  while (end < lines.length && !/^## /.test(lines[end])) end++;
  while (end - 1 > at && !lines[end - 1].trim()) end--;
  const who = node.author ? ` [[${node.author}]]` : '';
  const tail = node.conclusion ? ` — ${node.conclusion}` : '';
  lines.splice(end, 0, `- [ ] ${node.id}${who} ${node.title}${tail}`);
  return { text: lines.join('\n'), changed: [`话题 ${id} → ${section}`] };
}

/** 取话题树（扁平列表 + 父指针）。父由 `└─ 父: #x` 行给出；未显式给出时
 * 按 id 的层级默认（`#1.2` 的父是 `#1`）—— 否则 `abs topic new "#1.2 x"` 会白成一个孤根。
 * 显式 `└─ 父:` 优先（允许手工把子话题挂到非 id 前缀的父上）。 */
export function topicTree(text) {
  const { lines: seg } = topicLines(text);
  const out = [];
  for (let i = 0; i < seg.length; i++) {
    const t = parseTopicLine(seg[i]);
    if (!t) continue;
    const pm = seg[i + 1]?.match(/^\s*└─\s*父:\s*(#[\w.]+)/);
    // 无显式父指针 → 从点分层级推（#a.b.c 的父 = #a.b）
    const dot = t.id.lastIndexOf('.');
    const implied = dot === -1 ? null : t.id.slice(0, dot);
    out.push({ ...t, parent: pm ? pm[1] : implied });
  }
  return out;
}

/** 此刻正在推进的那条话题（供 load 首屏「当前话题」一行）。
 * 判据：`进行中` 且是**叶子**（没有进行中的子话题）—— 最深的活话题才是当前在说的。
 * 无活话题返回 null。
 *
 * 为什么不打印整棵树（2026-09-13 用户定）：整棵树会被 load 反复读取并**带偏后续会话**
 * （跟刚删的 Roadmap 同一个病）。当前态要常驻眼前，全貌用 `abs topic` 主动查。 */
export function currentTopic(text) {
  const nodes = topicTree(text).filter((n) => n.state === '进行中');
  if (!nodes.length) return null;
  const hasActiveKid = new Set(
    nodes.map((n) => n.parent).filter((p) => p && nodes.some((n) => n.id === p)),
  );
  return nodes.filter((n) => !hasActiveKid.has(n.id)).pop() || null;
}

/** 话题树的文本视图：**只输出话题行**，不写任何解释/统计标题。
 * 理由（用户定）：这一段是状态数据，不是文档 —— 正文说明会被 load 反复打印、
 * 挤占上下文，也让人分不清哪些是话题、哪些是说明。注释只留在源码里。
 * 已证伪的用 ✘ 标出并在末尾单列一块（防下个会话重走死路）。 */
export function topicTreeText(text) {
  const nodes = topicTree(text);
  if (!nodes.length) return '';
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map();
  const roots = [];
  for (const n of nodes) {
    if (n.parent && byId.has(n.parent)) {
      if (!kids.has(n.parent)) kids.set(n.parent, []);
      kids.get(n.parent).push(n);
    } else roots.push(n);
  }
  const icon = (s) => ({ 进行中: '▶', 已结论: '✔', 已否决: '✘', 待验证: '?', 已落地: '✓', 未落地: '·' }[s] || '·');
  const out = [];
  const draw = (n, depth) => {
    // 格式与存储行一致（单层分隔，不用双空格夹状态），便于人眼与文件对照
    out.push(`${'  '.repeat(depth)}${icon(n.state)} ${n.id} ${n.title} [${n.state}]${n.conclusion ? ' — ' + n.conclusion : ''}`);
    for (const k of kids.get(n.id) || []) draw(k, depth + 1);
  };
  for (const r of roots) draw(r, 0);
  const dead = nodes.filter((n) => n.state === '已否决' && !roots.includes(n) && !kids.has(n.parent));
  if (dead.length) {
    out.push('');
    for (const d of dead) out.push(`✘ ${d.id} ${d.title}${d.conclusion ? ' — ' + d.conclusion : ''}`);
  }
  return out.join('\n');
}
