// src/todo/tasks.js — 任务读写入口：读、加、改状态、断点、看板。

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { brainPath } from '../index.js';
import { editFile, SKIP } from '../lock.js';
import { today, localStamp, extractId, extractNote, extractAuthor, isLegacyAuthorTag, claimOf, parseChild, renderChild } from './common.js';
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
  // 前缀统一为 `- [ ]`（缩进保留）；旧 `↳` 写法已由 migrateLegacyChild 迁移掉。
  lines[idx] = raw.replace(/^(\s*-\s*\[[ x]\]\s*)/, `$1[${state}] `);
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
    // 在该分区标题后、下一个分区标题前插入。
    // ★ 插入点要**跳过尾部空行**：分区末尾本来就有个排版空行（`## Done` 前的那个），
    //   若插到它后面，新任务与前面的内容之间就隔了个空行 —— 每建一条多一个空行，
    //   而闸门明写「条目之间不允许空行」（实测：建 4 条就有 3 个空行）。
    let insertAt = idx + 1;
    while (insertAt < lines.length && !lines[insertAt].startsWith('## ')) insertAt++;
    while (insertAt > idx + 1 && !lines[insertAt - 1].trim()) insertAt--;
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
  if (!line) return null;
  // 两区制下行首可带状态标记（`- [ ] [进行中] <id> …`）—— 必须先剥掉再取 id，
  // 否则 id 会被读成 "[进行中]"，findTaskLine 全等比对永远落空（2026-09-13 实测）。
  // 前缀允许缩进（`  - [ ]`）—— 子任务天然带缩进。
  const m = line.match(/^\s*-\s*\[ \]\s*(?:\[[^\]]+\]\s*)?(\S+)/);
  return m ? m[1].replace(/\u200b/g, '') : null;
}

/** 定位 id 对应的未完成任务行下标；子项行不算独立任务。
 *  全等比对，不用 includes（否则 T1 会误命中 T11）。 */

export function findTaskLine(lines, id) {
  if (!id) return -1;
  const want = String(id).replace(/\u200b/g, '');
  return lines.findIndex((l) => idOfTaskLine(l) === want);
}

/** 子项行解析：从 `idx+1` 起扫连续的缩进行（子项），返回它们的下标。
 * 遇到非子项（下一个顶层任务 / 空行 / 分区标题）就停。 */
function childRange(lines, idx) {
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) break;              // 空行 = 子项块结束
    const child = parseChild(line);
    if (child && child.indent > 0) { out.push(i); continue; }
    break;                                 // 另一个顶层任务行 / 标题
  }
  return out;
}

/** 追加/更新一条子项（标准 md：缩进 2 空格 + `- [ ]`）。
 *
 * 语义（2026-10-16 用户定）：子项就是 todo 的嵌套子任务 —— 可多条、可各自勾选。
 * `abs todo note <id> "…"` **追加**一条（不再覆盖）—— 用户原话「不限，写多少算多少」。
 * 仍保留幂等：与最后一条完全同文就不重复追加（防手滑重复调）。 */
export async function setBreakpoint(brainRoot, { id, text }) {
  const p = await ensureTodo(brainRoot);
  let added = false;
  const res = await editFile(p, (orig) => {
    const lines = orig.split('\n');
    const idx = findTaskLine(lines, id);
    if (idx === -1) return SKIP;
    const kids = childRange(lines, idx);
    const last = kids.length ? parseChild(lines[kids[kids.length - 1]]) : null;
    if (last && last.text === String(text).trim()) return SKIP; // 幂等：同文不重复追加
    lines.splice(idx + 1 + kids.length, 0, renderChild(text));
    added = true;
    return { text: lines.join('\n'), ok: true };
  });
  if (res === SKIP) {
    return added
      ? { ok: true, msg: `✓ 子项已追加 → ${id}` }
      : { ok: false, msg: `[NO_MATCH] 未找到含 "${id}" 的未完成任务行（或子项已存在）` };
  }
  return { ok: true, msg: `✓ 子项已追加 → ${id}\n  ${renderChild(text)}` };
}

/** 勾/取消勾子项：`- [ ] …` ↔ `- [x] …`。
 *
 * 定位：子项没有自己的 id（身份 = 「某任务的第 N 条子项」），故按 n 定位（1-based）。
 * n 缺省 = 勾最后一条（最常用的「刚写的这条做完了」）。 */
export async function setBreakpointDone(brainRoot, { id, n, done = true }) {
  const p = await ensureTodo(brainRoot);
  let picked = null;
  const res = await editFile(p, (orig) => {
    const lines = orig.split('\n');
    const idx = findTaskLine(lines, id);
    if (idx === -1) return SKIP;
    const kids = childRange(lines, idx);
    if (!kids.length) return SKIP;
    const target = n ? kids[n - 1] : kids[kids.length - 1];
    if (target === undefined) return SKIP;
    const child = parseChild(lines[target]);
    picked = child;
    lines[target] = renderChild(child.text, { done });
    return { text: lines.join('\n'), ok: true };
  });
  if (res === SKIP || !picked) {
    return { ok: false, msg: `[NO_MATCH] "${id}" 下没有第 ${n || '(最后)'} 条子项（或任务不存在）` };
  }
  return { ok: true, msg: `✓ 子项 ${done ? '已勾' : '已取消勾'} → ${id}\n  ${renderChild(picked.text, { done })}` };
}

// ---------- 任务随手记（memo）----------
/** 任务进行中的随手记：多句、不定长、可追加，**不占看板**。
 *
 * 为何需要它（2026-10-11，用户定）：断点只该一句话（用户明确要求保持），
 * 而 `abs log` 要起 kind、进 log.md，对「随手记一句」太重；`abs note` 只管
 * 经验/坑且落 sources/。于是任务干到一半想记「现在做到哪、发现了什么」时
 * **没有轻档位**，AI 就顺手塞进 todo.md —— 实测 .agents/.brain/todo.md 被塞进
 * 10 行实施报告，而清理时发现「原内容只存在 todo.md，删任务时差点永久丢失」。
 * 堵（白名单闸门）只治标：不给出路，下次还会换个写法再塞。本命令就是那条出路。
 *
 * 落点选 sessions/（不是新目录）：那里已有目录遍历/frontmatter/归档机制，
 * lint 的豁免判据也是现成的（两条契约都已核实）：
 *   · `archive` tag  → SESSIONS-SPLIT / SESSIONS-NAMING 豁免（它们只算无 archive 的）
 *   · `log-` 前缀   → ORPHAN-PAGE 豁免（sessions 里非 log- 开头要求有链接）
 * 所以文件名取 `log-<日期>-<id>.md`，两个条件同时满足，**不改 lint 任何契约**。
 *
 * 追加式（不是覆盖）：每次调用多一条带时间戳的条目，与断点的语义有意不同 ——
 * 断点是「现在到哪了」（旧值就该被替换），memo 是「过程流水」（旧值不能丢）。 */
export async function setMemo(brainRoot, { id, text, at }) {
  const stamp = at || localStamp();
  const dir = brainPath(brainRoot, 'sessions');
  const file = join(dir, `log-${today()}-${id}.md`);
  const rel = `sessions/log-${today()}-${id}.md`;
  const line = `- ${stamp} ${text}`;
  const head = [
    '---',
    'tags: [archive, task-memo]', // archive → 豁免一天一文件；task-memo → 标明用途
    `id: log-${today()}-${id}`,
    `updated: ${today()}`,
    '---',
    '',
    `# 任务随手记：${id}`,
    '',
    `━━ ${id} 的过程笔记（不上看板；任务结束后随 sessions 留存）`,
    '',
  ].join('\n');
  await fs.mkdir(dir, { recursive: true });
  // 全程走 editFile 的锁：同一任务的并发 memo 不能丢条目（append 是 read-modify-write）。
  // 初次创建也走它 —— editFile 对「文件尚不存在」已经处理（current=null），
  // 自己再写一份 tmp+rename 分支反而绕过锁，首次并发两个 memo 会互相覆盖。
  await editFile(file, (cur) => {
    if (cur === null) return { text: `${head}${line}\n` };
    const t = cur.replace(/\n+$/, '');
    const next = /^updated:\s*.+$/m.test(t) ? t.replace(/^updated:\s*.+$/m, `updated: ${today()}`) : t;
    return { text: `${next}\n${line}\n` };
  });
  return { ok: true, msg: `✓ 随手记 → ${rel}\n  ${line}` };
}

/** 读回某任务的随手记（无则空）。供 CLI/MCP 查看与 done 时提醒。
 *  按**完整文件名后缀**匹配而不是 id 后缀：`endsWith('-${id}.md')` 会让
 *  `t-1` 误命中 `task-t-1`（同族坑见 idOfTaskLine 的全等比对注释）。
 *  文件名形如 `log-<日期>-<id>.md`，所以匹配 `-<id>.md` 时必须确认 id 是**最后一段**。 */
export async function readMemo(brainRoot, id) {
  const dir = brainPath(brainRoot, 'sessions');
  const files = await fs.readdir(dir).catch(() => []);
  const want = String(id).replace(/\u200b/g, '');
  const hit = files.filter((f) => {
    const m = f.match(/^log-\d{4}-\d{2}-\d{2}-(.+)\.md$/);
    return m && m[1] === want;
  }).sort();
  if (!hit.length) return '';
  const parts = [];
  for (const f of hit) {
    const body = await fs.readFile(join(dir, f), 'utf8').catch(() => '');
    parts.push(body.trim());
  }
  return parts.join('\n\n');
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
