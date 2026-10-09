// src/todo/archive.js — Done 结语契约与任务归档（分组、折叠、迁归档区）。

import { today, SEC, isTaskLine, isChildLine, daysAgo } from './common.js';
import { ARCHIVE_HEADING, ARCHIVE_SECTION } from './spec.js';

export function doneDateOf(line) {
  const m = String(line).match(/\(完成\s*(\d{4}-\d{2}-\d{2})[^)]*\)/);
  return m ? m[1] : '';
}

// ---------- Done 结语契约 ----------
// 为什么需要: `[x]` 原本同时表示「真落地」「评估后不做」「仅设计过」三种完全不同的状态，
// 读的人(下一个会话/未来的自己)无法区分。实测翻车: 读 daemon 条的 [x] 当成已落地，
// 实际它跑通后被撤销、代码全删 —— 基于假记录得出「daemon 是过配项」的错误结论。
// 结论: 图谱的价值取决于「可被信任」，一条状态失真的记录比一百条冗长记录的危害大一个量级。

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

function isUndoneLine(l) {
  return /^\s*- \[ \]/.test(l);
}

/**
 * 把 Done 区里"可归档"的日期组摘出来，并追回归档标记行。**纯函数**（不碰磁盘）。
 * 规则（用户定）：
 *   ① 只保留近 keepDays 天（含今天）；更早的才归档。
 *   ② 某一天只要还有未完成（- [ ]）任务，**整天都不归档**（不拆半天）。
 *   ③ 每**天**一个文件，slug 为 `log-<日期>`（由 slugFor 给）—— 即**归进那天的会话快照**
 *      （同一天的东西放一处，别为归档另建文件）。本函数只负责从 todo 文本里移除
 *      + 在 Done 区尾部的 `### 归档` 区**每天记一行** `- [[log-<日期>]] 完成任务 N 条`。
 * 无日期组（### （未标日期））无法判天数，**保守不归档**。
 * @returns {{text:string, archived:{date:string,lines:string[],slug:string,count:number}[], skipped:{date:string,reason:string}[], count:number}}
 */

export function archiveDoneInText(text, { keepDays = 3, from = today(), maxLines = 0, slugFor = (d) => `log-${d}` } = {}) {
  const lines = String(text || '').split('\n');
  const di = lines.findIndex((l) => l.startsWith('## Done'));
  if (di === -1) return { text, archived: [], skipped: [], count: 0 };
  const head = lines.slice(0, di + 1);
  const { groupLines, archiveLines } = splitDoneBody(lines.slice(di + 1));
  const units = parseDoneUnits(groupLines);
  if (!units.length) return { text, archived: [], skipped: [], count: 0 };

  const keep = Math.max(1, Number(keepDays) || 3);
  // 保留 cutoff..from 这 keep 天；比 cutoff 更早的才归档
  let cutoff = daysAgo(keep - 1, from);
  // 超限放宽（2026-10-05 加）：ROOT-OVER-SIZE 限看板 ≤60 行，而 keepDays≥1 意味着
  //   密集工作日（一天几十条 Done）必然超限 —— 两条规则打架，且 archive 拒绝动，
  //   于是每天提交都被 lint 拦一次。修法：**看板已超行数上限时，把 cutoff 推到当天**，
  //   让「整天已完成」的组可以立刻归档（仍有 ② 未完成则整天不归档 的保护）。
  // 注意裁到「今天之后」：判断是 `date >= cutoff → 保留`，若 cutoff = 今天，
  // 今天的组仍被保留（首版就栽在这，dry-run 一看当天没进归档列表）。
  if (maxLines && lines.length > maxLines) cutoff = daysAgo(-1, from);

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

/** 归档页正文（按日期分组，原文保留）。供同日追写复用。 */

export function renderArchiveBody(groups) {
  const out = [];
  for (const g of groups) out.push(`### ${g.date}`, '', ...g.lines, '');
  return out.join('\n').replace(/\n+$/, '\n');
}

/** 归档区标题。归档内容全部落在这个二级标题下，**与 AI 手写的会话快照共存**：
 *  同一天的记录（快照 + 任务明细）放一个文件里，而不是分两个文件。
 *  写入侧只动这一段：标题之前的内容原样保留（已存在的人工内容一律不覆盖）。 */

export function upsertArchiveSection(body, group) {
  const chunk = renderArchiveBody([group]);
  if (body == null) {
    // ① 新文件：只有归档段（无手写快照也合法 —— 那天本来就只有任务记录）
    const fm = [
      '---',
      'tags: [session-log, todo-archive, 历史]',
      `updated: ${group.date}`,
      'status: reviewed',
      '---',
      '',
      `# ${group.date} 记录`,
      '',
      '> 本页 = 该日的会话快照（若有）+ 从 `todo.md` Done 区迁出的任务明细。',
      '',
      ARCHIVE_SECTION,
      '',
      chunk.trimEnd(),
      '',
    ];
    return fm.join('\n');
  }
  // ② 已存在：只动归档段，段外原样
  const lines = body.split('\n');
  const i = lines.findIndex((l) => l.trim() === ARCHIVE_SECTION);
  if (i === -1) {
    // 有文件但还没归档段 → 追加到末尾（不搅动已有内容）
    return `${body.replace(/\s*$/, '')}\n\n${ARCHIVE_SECTION}\n\n${chunk.trimEnd()}\n`;
  }
  // 找到本段结束（下一个同级或更高级标题）
  let j = i + 1;
  while (j < lines.length && !/^#{1,2} \S/.test(lines[j].trim())) j++;
  const head = lines.slice(0, i + 1);
  const tailPart = lines.slice(j);
  const existingInner = lines.slice(i + 1, j).join('\n').trim();
  const merged = existingInner ? `${existingInner}\n\n${chunk.trimEnd()}` : chunk.trimEnd();
  return [...head, '', merged, '', ...tailPart].join('\n').replace(/\n{3,}/g, '\n\n');
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
    const header = `## ${SEC.done}`;
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
