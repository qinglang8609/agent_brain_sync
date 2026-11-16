// src/todo/done.js — 看板的「时间模型」与视图（行的解析/生成在 line.js）。
//
// 2026-11-16 用户定的第三版：todo.md 只有 H1 + 一条列表，
//   - [记号] [id 标题] [YYYY-MM-DD HH:MM] [[作者]] [会话id]
// 排序键是行里的时间，最新的在最上面；不再有完成时间、也不再区分「落地/否决/仅方案」。

import { isChildLine, markOf } from './common.js';
import { taskTimeOf, parseTaskLine } from './line.js';

/** 行的时间（排序用）。 */
export const dateOfLine = taskTimeOf;

/** 把行拆成「任务单元」：顶层任务行 + 紧跟的缩进子项。
 * 非任务行（人自加的小节标题、正文）也各自成一个单元，time = ''。 */
export function unitsOf(lines) {
  const units = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (isChildLine(raw) && units.length) { units[units.length - 1].lines.push(raw); continue; }
    const t = parseTaskLine(raw);
    units.push({
      time: taskTimeOf(raw),
      task: !!t,
      done: markOf(raw) === 'x',
      lines: [raw],
    });
  }
  return units;
}

/** 按时间倒序重排整条列表（稳定排序：同一时刻保持写入先后）。
 * 没有时间的单元（人自加的小节、正文）沉到最后，它们之间的相对顺序不变。 */
export function sortTodoLines(lines) {
  const units = unitsOf(lines);
  const dated = units.filter((u) => u.time);
  const undated = units.filter((u) => !u.time);
  dated.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
  return [...dated, ...undated].flatMap((u) => u.lines);
}

/** 未完成的单元（记号不是 `x`）：`abs load` 的「未完成」段用它。
 * 子项随父任务一起走。 */
export function openLines(text) {
  return unitsOf(String(text ?? '').split('\n'))
    .filter((u) => u.task && !u.done)
    .flatMap((u) => u.lines);
}

/** 已完成条数（只数顶层任务行）。 */
export function countDone(text) {
  return unitsOf(String(text ?? '').split('\n')).filter((u) => u.done).length;
}

/** 看板 / 开机屏用的折叠视图：已完成的行只给一行条数，明细用 `abs todo --full`。
 * 为何折叠：已完成行无上限增长，而 `abs load` 每次开局都被注入上下文。
 * 返回 { text, doneCount }。 */
export function collapseDone(text) {
  const units = unitsOf(String(text ?? '').split('\n'));
  const open = units.filter((u) => !u.done).flatMap((u) => u.lines);
  const n = units.filter((u) => u.done).length;
  const tail = n ? [`Done ${n} 条（明细: abs todo --full）`] : [];
  return { text: [...open, ...tail].join('\n').trim(), doneCount: n };
}
