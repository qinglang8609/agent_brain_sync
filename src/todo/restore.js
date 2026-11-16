// src/todo/restore.js — 把历史上压缩进日志页的任务拿回 todo.md（2026-11-16 用户定）。
//
// 背景：2026-09 至 2026-11 之间，`abs todo archive` 会把超过保留天数的整天任务
// 搬进当天 `sessions/log-<日期>.md` 的「📦 任务归档」段，todo.md 只留一行
// `- [[log-日期]] 完成任务 N 条`。用户现在的判断：Done 就该全看在看板上，
// 一次回捞把那些任务行搬回来，日志页原样保留（只读，不删）。

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { brainPath } from '../index.js';
import { editFile } from '../lock.js';
import { normalizeTodo } from './structure.js';
import { isTaskLine, isChildLine, sigOfLine } from './common.js';

/** 归档段标题（现行 `## 📦 任务归档`；旧模板里也有不带 emoji 的写法）。 */
const ARCHIVE_HEADING_RE = /^##\s+(?:📦\s*)?任务归档\s*$/;

/** 早期独立归档页的文件名（`2026-09-12-todo归档.md` 这类）。整页都是归档内容。 */
const LEGACY_ARCHIVE_PAGE_RE = /todo归档|todo-archive/i;

/** 从一页正文里抓归档段的任务行（含缩进子项）。
 *
 * 只认归档段：日志页里还有会话摘要、## 关联连接 等，那些不是看板内容。
 * 段内的 `### 日期` 分组标题丢掉 —— 新模型没有日期分组。
 * 返回原样的行数组（顺序保持：新日期在前，与文件里一致）。 */
export function archivedTaskLines(body) {
  const lines = String(body ?? '').split('\n');
  const out = [];
  let inBlock = false;
  for (const raw of lines) {
    const t = raw.trim();
    if (/^##\s/.test(t)) { inBlock = ARCHIVE_HEADING_RE.test(t); continue; }
    if (!inBlock) continue;
    if (/^###\s/.test(t)) continue;       // 日期分组标题
    if (!t) continue;
    if (isTaskLine(raw) || isChildLine(raw)) out.push(raw);
  }
  return out;
}

/** 扫一个项目的 sessions/ 与旧的独立归档页，把归档任务并回 todo.md。
 *
 * 去重判据：整行签名（去空白、截 120 字）。同一行已经在 todo.md 里就不再插。
 * 幂等：重复跑不会重复插入。`dryRun` 只报数不改盘。
 * 返回 { added, scanned, files }：added = 新增条数，scanned = 扫过的页数。 */
export async function restoreArchivedTasks(root, { dryRun = false } = {}) {
  const todoP = brainPath(root, 'todo.md');
  const sessDir = brainPath(root, 'sessions');
  const files = (await fs.readdir(sessDir).catch(() => [])).filter((f) => f.endsWith('.md'));
  const recovered = [];
  const touched = [];
  for (const f of files) {
    const body = await fs.readFile(join(sessDir, f), 'utf8').catch(() => '');
    if (!body) continue;
    const legacyWholePage = LEGACY_ARCHIVE_PAGE_RE.test(f);
    const picked = legacyWholePage
      ? body.split('\n').filter((l) => (l.trim() && !/^#/.test(l.trim()) && (isTaskLine(l) || isChildLine(l))))
      : archivedTaskLines(body);
    if (!picked.length) continue;
    recovered.push(...picked);
    touched.push(f);
  }
  if (!recovered.length) return { added: 0, scanned: files.length, files: [], recovered: 0 };

  /** 把一批「父任务 + 它的子项」并进 base。
   *
   * 边界（审查时补）：父任务**已经在看板**、子项却不在 —— 直接把子项追加到文件尾
   * 会变成孤儿子项，写闸门会拒掉整次回捞。所以：
   *   ① 父任务不在看板 → 整组追加到末尾；
   *   ② 父任务已在看板 → 缺的子项插到 base 里那条父任务（及其现有子项）之后。 */
  const mergeInto = (base, have, recoveredLines) => {
    const out = base.replace(/\n+$/, '').split('\n');
    const groups = [];
    for (const l of recoveredLines) {
      const sig = sigOfLine(l);
      if (have.has(sig)) continue;              // 已经在了（幂等）
      have.add(sig);                            // 同一批里重复的行也只收一次
      if (/^- \[/.test(l) || !groups.length) groups.push({ head: l, kids: [] });
      else groups[groups.length - 1].kids.push(l);
    }
    let addedCount = 0;
    const tail = [];
    for (const g of groups) {
      if (/^- \[/.test(g.head)) addedCount++;
      const at = out.findIndex((l) => sigOfLine(l) === sigOfLine(g.head));
      if (at === -1) { tail.push(g.head, ...g.kids); continue; }
      // 父任务已在 → 插到他现有子项块的末尾
      let end = at + 1;
      while (end < out.length && /^\s+- \[/.test(out[end])) end++;
      out.splice(end, 0, ...g.kids);
    }
    return { text: normalizeTodo([...out, ...tail].join('\n')), added: addedCount };
  };

  let added = 0;
  if (!dryRun) {
    await editFile(todoP, (cur) => {
      const base = normalizeTodo(cur ?? '');
      const have = new Set(base.split('\n').map((l) => sigOfLine(l)));
      const r = mergeInto(base, have, recovered);
      added = r.added;
      // 回捞的行按**存量**对待：历史结论常超 400 字（实测 18/361），
      // 那是 2026-09 的旧规则留下的，不该把整次回捞顶回去。
      return { text: r.text, prevForGate: r.text };
    });
  } else {
    const base = normalizeTodo(await fs.readFile(todoP, 'utf8').catch(() => ''));
    const have = new Set(base.split('\n').map((l) => sigOfLine(l)));
    added = mergeInto(base, have, recovered).added;
  }
  return { added, scanned: files.length, files: touched, recovered: recovered.length };
}
