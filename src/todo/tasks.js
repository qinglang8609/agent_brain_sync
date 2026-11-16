// src/todo/tasks.js — 任务读写入口：读、加、改状态、断点、看板。

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { brainPath } from '../index.js';
import { editFile, SKIP } from '../lock.js';
import { today, localStamp, parseChild, renderChild, STATE_MARK } from './common.js';
import { parseTaskLine, renderTaskLine, taskIdOf, taskTimeOf, shortTitle } from './line.js';
import { todoTemplate, normalizeTodo, stateOfTaskLine, ensureStateMark } from './structure.js';
import { TASK_STATES } from './spec.js';
import { collapseDone, sortTodoLines } from './done.js';

export async function readTodo(brainRoot) {
  const p = brainPath(brainRoot, 'todo.md');
  let text;
  try {
    text = await fs.readFile(p, 'utf8');
  } catch {
    return ''; // 尚未创建，按空处理（不在此创建，避免读操作写文件）
  }
  // normalizeTodo 里含 Done 区拉平（2026-11-16：老文件的 `### 日期` 分组展开成平铺列表，幂等）
  const norm = normalizeTodo(text);
  if (norm !== text) {
    // 惰性迁移也是写：走锁，避免与并发写互相覆盖（锁内 re-read 已是权威最新内容）。
    // ★ 写失败**不能**让读操作崩掉（2026-11-05 实测教训：load 是开机第一入口，
    //   一条无法归一的脏数据就让它整屏崩了）。归一后的文本照样返回，让看板能读；
    //   写不进去这件事由 checkBrainShape 的「未能自动归一」警告报出来。
    await editFile(p, (cur) => (cur === text ? { text: norm } : SKIP)).catch(() => {});
    return norm;
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

/** 改任务状态：状态就写在复选框里（[ ] [-] [+] [~]）。 */
export function setStateMark(text, id, state) {
  if (!TASK_STATES.includes(state)) return { text, changed: [] };
  const lines = String(text ?? '').split('\n');
  const idx = findTaskLine(lines, id);
  if (idx === -1) return { text, changed: [] };
  if (stateOfTaskLine(lines[idx]) === state) return { text, changed: [] };
  lines[idx] = ensureStateMark(lines[idx], state);
  return { text: lines.join('\n'), changed: [`${id} 状态 → ${state}`] };
}

/** 剥掉行首状态标记。 */

export async function addTask(brainRoot, { id, title, state = '进行中' }) {
  const p = await ensureTodo(brainRoot);
  await editFile(p, (orig) => ({ text: insertTask(orig, makeLine({ id, title, state })) }));
  return { file: p, text: title };
}

/** 生成一条新任务行（时间 = 现在）。 */
function makeLine({ title, detail = '', state = '进行中', sid = '', author = '', time = '' }) {
  return renderTaskLine({
    mark: STATE_MARK[state] ?? ' ',
    time: time || localStamp(),
    title: shortTitle(title),
    author,
    detail,
    sid,
  });
}

/** 纯函数：把新任务行放到列表最上面（列表按时间倒序，刚登记的就是最新的）。 */
function insertTask(orig, line) {
  const base = normalizeTodo(orig);
  const body = base.split('\n').filter((l) => l.trim() && !/^#\s/.test(l.trim()));
  return ['# 📋 Todo Board', '', line, ...body].join('\n').replace(/\n+$/, '\n');
}

/** 幂等登记：同 id 已有未完成任务行则原位更新（标题/状态），否则插到最上面。
 *  原位更新保留原来的时间与作者 —— 时间代表「这条任务是什么时候登记/最后一次被写的」，
 *  重跑 start 不该把它刷成现在。 */
export async function upsertTask(brainRoot, { title, detail = '', state = null, session = '', author = '' }) {
  const p = await ensureTodo(brainRoot);
  let updated = false;
  await editFile(p, (orig) => {
    const base = normalizeTodo(orig ?? '');
    const lines = base.split('\n');
    const idx = findTaskLine(lines, title);
    const sid = String(session || '').replace(/[^\w-]/g, '').slice(0, 40);
    if (idx === -1) {
      return { text: insertTask(base, makeLine({ title, state: state || '进行中', sid, author, detail })) };
    }
    updated = true;
    const old = parseTaskLine(lines[idx]);
    const want = state && TASK_STATES.includes(state) ? state : (stateOfTaskLine(lines[idx]) || '进行中');
    lines[idx] = renderTaskLine({
      mark: STATE_MARK[want] ?? ' ',
      time: old.time || taskTimeOf(lines[idx]),
      title: shortTitle(title || old.title || old.id),
      author: old.author,
      detail: detail || old.detail,
      sid: sid || old.sid,
    });
    return { text: sortTodoLines(lines.filter((l) => l.trim())).join('\n') + '\n' };
  });
  return { file: p, updated };
}

/** 行首 id（命令用来定位）。 */
export function idOfTaskLine(line) {
  return taskIdOf(line);
}

/** 定位任务行：先按 id 全等（未完成的行），再按标题前缀唯一匹配。
 *  返回 -1 = 没找到或前缀命中多条（调用方按 NO_MATCH 处理，不猜）。 */
/** 定位任务行：按**标题**（新格式）/ id（旧格式）匹配；精确优先，其次唯一前缀。
 *  返回 -1 = 没找到或有歧义（调用方按 NO_MATCH 处理，不猜）。 */
export function findTaskLine(lines, key) {
  const want = String(key ?? '').replace(/\u200b/g, '').trim();
  if (!want) return -1;
  const open = (l) => { const t = parseTaskLine(l); return t && t.indent === 0 && t.mark !== 'x'; };
  const exact = lines.findIndex((l) => {
    if (!open(l)) return false;
    const t = parseTaskLine(l);
    return (t.title && t.title === want) || (t.id && t.id === want);
  });
  if (exact !== -1) return exact;
  // 其次：前缀唯一；再退一步：标题里包含它且唯一（按标题定位后，这点很重要）
  const collect = (test) => {
    const hits = [];
    lines.forEach((l, i) => { if (open(l) && test(parseTaskLine(l))) hits.push(i); });
    return hits;
  };
  const byPrefix = collect((t) => (t.title && t.title.startsWith(want)) || (t.id && t.id.startsWith(want)));
  if (byPrefix.length === 1) return byPrefix[0];
  if (byPrefix.length > 1) return -1;
  const byContains = collect((t) => (t.title && t.title.includes(want)) || (t.id && t.id.includes(want)));
  return byContains.length === 1 ? byContains[0] : -1;
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
  let kidLineText = '';
  const res = await editFile(p, (orig) => {
    const lines = orig.split('\n');
    const idx = findTaskLine(lines, id);
    if (idx === -1) return SKIP;
    const kids = childRange(lines, idx);
    const last = kids.length ? parseChild(lines[kids[kids.length - 1]]) : null;
    if (last && last.text === String(text).trim()) return SKIP; // 幂等：同文不重复追加
    // 子项与父任务同格式（继承父的时间/作者/会话 id）
    const par = parseTaskLine(lines[idx]);
    kidLineText = renderTaskLine({
      indent: '  ',
      mark: ' ',
      time: par.time || '',
      title: shortTitle(text),
      author: par.author || '',
      detail: String(text).length > shortTitle(text).length ? String(text).slice(shortTitle(text).length).replace(/^[，,、。；;：:\-\s]+/, '') : '',
      sid: par.sid || '',
    });
    lines.splice(idx + 1 + kids.length, 0, kidLineText);
    added = true;
    return { text: lines.join('\n'), ok: true };
  });
  if (res === SKIP) {
    return added
      ? { ok: true, msg: `✓ 子项已追加 → ${id}` }
      : { ok: false, msg: `[NO_MATCH] 未找到含 "${id}" 的未完成任务行（或子项已存在）` };
  }
  return { ok: true, msg: `✓ 子项已追加 → ${id}\n  ${kidLineText}` };
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
    // 保留印过的状态标记（2026-11-09）：只翻复选框，不能把 [滞留中] 这类标记抹掉。
    // 子项与任务同格式：翻记号时保留时间/作者/详情/会话 id
    {
      const c0 = parseTaskLine(lines[target]);
      lines[target] = renderTaskLine({
        indent: ' '.repeat(c0.indent),
        mark: done ? 'x' : (STATE_MARK[child.state] ?? ' '),
        time: c0.time, title: c0.title, author: c0.author, detail: c0.detail, sid: c0.sid,
      });
    }
    return { text: lines.join('\n'), ok: true };
  });
  if (res === SKIP || !picked) {
    return { ok: false, msg: `[NO_MATCH] "${id}" 下没有第 ${n || '(最后)'} 条子项（或任务不存在）` };
  }
  return { ok: true, msg: `✓ 子项 ${done ? '已勾' : '已取消勾'} → ${id}\n  ${renderChild(picked.text, { done, state: picked.state })}` };
}

/** 改**子项**的状态标记（2026-11-09 用户要求：子项也要能标四态）。
 *
 * 为何不复用 setStateMark：子项没有自己的 id，findTaskLine 只能定位任务行
 * （idOfTaskLine 取的是行首第一个 token，子项那行取到的是正文首字），
 * 所以子项只能按「某任务的第 n 条」定位（与 child-done 同一套坐标）。
 *   任务行：`- [ ] [进行中] TASK-1 …`
 *   子项行：`  - [ ] [滞留中] 改到哪一步`
 * n 必填（1-based）：不带 n 的「改状态」= 改任务本身（setStateMark），
 * 子项路径只由带 n 的调用进来。非正整数或越界 → 当没匹配，不静默改到别的行。 */
export function setChildStateMark(text, id, n, state) {
  if (!TASK_STATES.includes(state)) return { text, changed: [] };
  if (!Number.isInteger(n) || n < 1) return { text, changed: [] };
  const lines = String(text ?? '').split('\n');
  const idx = findTaskLine(lines, id);
  if (idx === -1) return { text, changed: [] };
  const kids = childRange(lines, idx);
  const target = kids[n - 1];
  if (target === undefined) return { text, changed: [] };
  const child = parseChild(lines[target]);
  if (!child || child.state === state) return { text, changed: [] };
  const ord = kids.indexOf(target) + 1;
  {
    const c0 = parseTaskLine(lines[target]);
    lines[target] = renderTaskLine({
      indent: ' '.repeat(c0.indent),
      mark: STATE_MARK[state] ?? ' ',
      time: c0.time, title: c0.title, author: c0.author, detail: c0.detail, sid: c0.sid,
    });
  }
  return { text: lines.join('\n'), changed: [`${id} 第 ${ord} 条子项状态 → ${state}`] };
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
  // 已完成的行折叠成一条计数：它无上限增长（2026-11-16 起不再归档迁出），
  // 全量打印会把上下文塞满。明细用 --full。
  const body = full ? text.trim() : collapseDone(text).text;
  return `${head}\n\n${body}`;
}
