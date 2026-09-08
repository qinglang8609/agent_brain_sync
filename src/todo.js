// src/todo.js — todo.md 读写。CLI 的核心纯读写层（被 MCP 转接、可被 hook 直接调）。
// 格式沿用 SKILL.md 契约：Backlog → Today / In Progress → Blocked → Done，半成品 `↳ 断点:`。
import { promises as fs } from 'node:fs';
import { brainPath } from './index.js';

// ---------- 今天日期 ----------
export function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
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
  if (norm !== text) {
    await fs.writeFile(p, norm, 'utf8'); // 惰性迁移：读到老格式顺带归一
    return norm;
  }
  return text;
}

export async function ensureTodo(brainRoot) {
  const p = brainPath(brainRoot, 'todo.md');
  try {
    await fs.access(p);
  } catch {
    await fs.writeFile(p, todoTemplate(), 'utf8');
  }
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
      if (inSec && l.trim()) items.push(l);
    }
    return items;
  };
  const done = grab('Done');
  const blocked = grab('Blocked');
  const inprog = grab('In Progress');
  const todo = grab('Todo');
  out.push('## Backlog', ...todo.length ? todo : ['- [ ] 待办任务（从老格式迁移）']);
  out.push('## Today / In Progress', ...inprog.length ? inprog : []);
  out.push('## Blocked', ...blocked.length ? blocked : []);
  out.push('## Done（只留近期，旧的迁 log.md/快照）', ...done.length ? done : ['- [x] （无）— 迁移自老格式']);
  return out.join('\n');
}
/** 在指定分区段落后插入一行任务；找不到分区则在文件末尾追加回退。写前惰性迁移老格式。 */
export async function addTask(brainRoot, { section, text }) {
  await ensureTodo(brainRoot);
  const p = brainPath(brainRoot, 'todo.md');
  let orig = await fs.readFile(p, 'utf8');
  const norm = normalizeTodo(orig);
  if (norm !== orig) {
    await fs.writeFile(p, norm, 'utf8');
    orig = norm;
  }
  const lines = orig.split('\n');
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
  await fs.writeFile(p, lines.join('\n'), 'utf8');
  return { file: p, text };
}

/** 任务行解析：`- [ ] <id> — note (认领 date)` / 附属断点行 `↳ 断点:`。 */
export function parseTaskLine(line) {
  const m = line.match(/^- \[( |x)\] (.*?)(?: — (.*?))? \(?(认领|完成 \d{4}-\d{2}-\d{2}[^)]*)?\)?$/);
  return m; // 保守解析；不匹配返回 null（附属行等）
}

/** 幂等登记：同 id 已有未完成任务行则原位更新（新 note/新认领日期），否则插入。 */
export async function upsertTask(brainRoot, { section, text }) {
  await ensureTodo(brainRoot);
  const p = brainPath(brainRoot, 'todo.md');
  const orig = await fs.readFile(p, 'utf8');
  const lines = orig.split('\n');
  const id = extractId(text);
  // 在所有分区中找含该 id 的未完成任务行（Done 的已完成行不重复动）
  const idx = lines.findIndex((l) => l.startsWith('- [ ]') && id && l.includes(id));
  if (idx !== -1) {
    // 原位更新：保留断点附属行，只换任务行本体
    const note = extractNote(text);
    const oldNote = extractNote(lines[idx].replace(/^- \[ \] /, ''));
    const merged = note && oldNote && oldNote.startsWith(note) ? `${note}${oldNote.slice(note.length)}` : note || oldNote;
    lines[idx] = `- [ ] ${id}${merged ? ' — ' + merged : ''} (认领 ${today()})`;
    await fs.writeFile(p, lines.join('\n'), 'utf8');
    return { file: p, text: lines[idx], updated: true };
  }
  const r = await addTask(brainRoot, { section, text });
  return { ...r, updated: false };
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

/** 定位含 id 的未完成任务行下标；附属断点行（↳ 开头）不算任务行。 */
export function findTaskLine(lines, id) {
  if (!id) return -1;
  return lines.findIndex((l) => l.startsWith('- [ ]') && l.includes(id));
}

/** 实时断点: 在 id 任务行下原位补/换 `↳ 断点:` 附属行（不挪任务位置）。 */
export async function setBreakpoint(brainRoot, { id, text }) {
  await ensureTodo(brainRoot);
  const p = brainPath(brainRoot, 'todo.md');
  const lines = (await fs.readFile(p, 'utf8')).split('\n');
  const idx = findTaskLine(lines, id);
  if (idx === -1) return { ok: false, msg: `(未找到含 "${id}" 的未完成任务行)` };
  const bp = `  ↳ 断点: ${text}`;
  if (lines[idx + 1] && lines[idx + 1].trimStart().startsWith('↳ 断点:')) {
    lines[idx + 1] = bp; // 幂等: 更新原附属行
  } else {
    lines.splice(idx + 1, 0, bp);
  }
  await fs.writeFile(p, lines.join('\n'), 'utf8');
  return { ok: true, msg: `✓ 断点已落 → ${id}\n  ${bp.trim()}` };
}

/** 实时碰壁: 任务行原位勾成 blocked 语义（移入 Blocked 区 + 附原因）。 */
export async function moveBlocked(brainRoot, { id, reason }) {
  await ensureTodo(brainRoot);
  const p = brainPath(brainRoot, 'todo.md');
  const lines = (await fs.readFile(p, 'utf8')).split('\n');
  const idx = findTaskLine(lines, id);
  if (idx === -1) return { ok: false, msg: `(未找到含 "${id}" 的未完成任务行)` };
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
  await fs.writeFile(p, out.join('\n'), 'utf8');
  return { ok: true, msg: `✓ 已标阻塞 → Blocked 区: ${id}${reason ? `\n  卡点: ${reason}` : ''}` };
}

// ---------- 看板输出 ----------
export async function boardText(brainRoot, textOverride) {
  const text = textOverride !== undefined ? textOverride : await readTodo(brainRoot);
  const head = `📂 abs → 项目: ${brainRoot}`;
  if (!text.trim()) return `${head}\n\n（todo.md 为空，先 abs task start 登记任务）`;
  return `${head}\n\n${text.trim()}`;
}
