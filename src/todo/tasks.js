// src/todo/tasks.js — 任务读写入口：读、加、改状态、断点、看板。

import { promises as fs } from 'node:fs';
import { brainPath } from '../index.js';
import { editFile, SKIP } from '../lock.js';
import { today, extractId, extractNote, extractAuthor, isLegacyAuthorTag, claimOf } from './common.js';
import { todoTemplate, normalizeTodo, stateOfTaskLine, stripStateMark } from './structure.js';
import { TASK_STATES } from './spec.js';
import { collapseDone, groupDoneSection } from './archive.js';

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

export function setStateMark(text, id, state) {
  if (!TASK_STATES.includes(state)) return { text, changed: [] };
  const lines = String(text ?? '').split('\n');
  const idx = findTaskLine(lines, id);
  if (idx === -1) return { text, changed: [] };
  const cur = lines[idx];
  if (stateOfTaskLine(cur) === state) return { text, changed: [] };
  const raw = stripStateMark(cur);          // 先剥旧标记，再补新的
  lines[idx] = raw.replace(/^(- \[[ x]\] )/, `$1[${state}] `);
  return { text: lines.join('\n'), changed: [`${id} 状态 → ${state}`] };
}

/** 剥掉行首状态标记。 */

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
  const idx = lines.findIndex((l) => l.startsWith(header));
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

/** 幂等登记：同 id 已有未完成任务行则原位更新（新 note/新认领日期），否则插入。 */

export async function upsertTask(brainRoot, { section, text, session = '' }) {
  const p = await ensureTodo(brainRoot);
  const id = extractId(text);
  const note = extractNote(text);
  const out = await editFile(p, (orig) => {
    const base = normalizeTodo(orig);
    const lines = base.split('\n');
    // 在所有分区中找该 id 对应的未完成任务行（Done 的已完成行不重复动）；全等比对
    const idx = findTaskLine(lines, id);
    // 状态标记：新建用 text 里带的（默认 进行中），更新保留原有的
    const wanted = String(text).match(/^\[([^\]]+)\]/)?.[1];
    const state = idx !== -1
      ? (stateOfTaskLine(lines[idx]) || wanted || '进行中')
      : (TASK_STATES.includes(wanted) ? wanted : '进行中');
    if (idx !== -1) {
      // 原位更新：保留断点附属行 + 原@作者 + 原状态，只换任务行本体
      const raw = stripStateMark(lines[idx]).replace(/^- \[ \] /, '');
      const author = extractAuthor(raw);
      const legacy = isLegacyAuthorTag(raw); // 旧行保持旧形态，不静默改写
      const oldNote = extractNote(raw);
      const merged = note && oldNote && oldNote.startsWith(note) ? `${note}${oldNote.slice(note.length)}` : note || oldNote;
      const at = author ? ` ${legacy ? '@' + author : '[['
        + author + ']]'}` : '';
      // 认领段整体搬回去（新的优：带了 sid 就用新的，旧行原本有就保留）——
      //   不能无条件重写成 `(认领 today)`，否则重复 start 会把 sid 冲掉。
      const sid = String(session || '').replace(/[^\w-]/g, '').slice(0, 16);
      const claim = sid ? `(认领 ${today()} ${sid})` : (claimOf(raw) || `(认领 ${today()})`);
      const newLine = `- [ ] [${state}] ${id}${at}${merged ? ' — ' + merged : ''} ${claim}`;
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

export function idOfTaskLine(line) {
  if (!line || !line.startsWith('- [ ]')) return null;
  // 两区制下行首可带状态标记（`- [ ] [进行中] <id> …`）—— 必须先剥掉再取 id，
  // 否则 id 会被读成 "[进行中]"，findTaskLine 全等比对永远落空（2026-09-13 实测）。
  const m = line.match(/^- \[ \] (?:\[[^\]]+\] )?(\S+)/);
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
    ? { ok: false, msg: `[NO_MATCH] 未找到含 "${id}" 的未完成任务行` }
    : { ok: true, msg: `✓ 断点已落 → ${id}\n  ${bp.trim()}` };
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
