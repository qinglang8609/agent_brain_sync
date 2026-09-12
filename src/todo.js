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

export function todoTemplate() {
  return [
    '# 📋 Todo 看板',
    '## Backlog',
    '- [ ] 待办任务',
    '## Today / In Progress',
    '## Blocked',
    '## Done（只留近期，旧的迁 log.md/快照）',
    '',
  ].join('\n');
}

/** 归一化 todo.md 分区：老格式（In Progress/Todo）迁移为 B4 定稿格式（Backlog→Today / In Progress→Blocked→Done）。
 * 幂等：已是新格式则原样返回。迁移原则——老 "In Progress" 内容进 "Today / In Progress"，老 "Todo" 内容进 "Backlog"。 */
export const TODO_SECTIONS = ['Backlog', 'Today / In Progress', 'Blocked', 'Done'];

export function normalizeTodo(text) {
  const lines = text.split('\n');
  const has = (name) => lines.some((l) => l.trim() === `## ${name}`);
  if (has('Backlog') || has('Today / In Progress')) return text; // 已是新格式
  if (!has('In Progress') && !has('Todo')) return text;          // 不是老格式，不动
  const out = ['# 📋 Todo 看板'];
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
  out.push('## Done（只留近期，旧的迁 log.md/快照）', ...done.length ? done : []);
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
  if (undated.length) out.push('### （未标日期）', '', ...undated.flatMap((u) => u.lines), '');
  return out;
}

/** 归档标记区标题。它在 Done 区内部、日期分组之后，形如：
 *   ### 归档
 *   - [[2026-09-10-todo归档]] 完成任务 10 条
 * 这区不是任务行，不能被 parseDoneUnits 吃挂，否则 markDone 重建 Done 时会把它丢掉。
 * 故先切出去当"不透明区域"原样保留。 */
const ARCHIVE_HEADING = '### 归档';

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
      // 原位更新：保留断点附属行，只换任务行本体
      const oldNote = extractNote(lines[idx].replace(/^- \[ \] /, ''));
      const merged = note && oldNote && oldNote.startsWith(note) ? `${note}${oldNote.slice(note.length)}` : note || oldNote;
      const newLine = `- [ ] ${id}${merged ? ' — ' + merged : ''} (认领 ${today()})`;
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

/** 提取 " — " 后的 note 部分。 */
export function extractNote(text) {
  const i = String(text).indexOf(' — ');
  return i === -1 ? '' : String(text).slice(i + 3).replace(/\s*\(认领[^)]*\)\s*$/, '');
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
export async function boardText(brainRoot, textOverride) {
  const text = textOverride !== undefined ? textOverride : await readTodo(brainRoot);
  const head = `📂 abs → 项目: ${brainRoot}`;
  if (!text.trim()) return `${head}\n\n（todo.md 为空，先 abs todo add 登记任务）`;
  return `${head}\n\n${text.trim()}`;
}
