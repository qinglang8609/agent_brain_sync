// src/brainio.js — .brain 文档统一读写收口。
// 目的：所有需读写 .brain 文档的地方(todo/log/index/source/…)都走这一个方法，
//       调用方不必各自拼 brainPath + lock.editFile/裸 readFile，也天然带上防重复/防并发锁。
//   - readBrain(brainRoot, rel)     读 .brain/<rel> 文本（文件不存在返回 null）
//   - writeBrain(brainRoot, rel, transform) 锁内读改写（自动 lock.editFile 防并发）；transform 返回新文本或 null=不改
//   - appendBrain(brainRoot, rel, lines)    锁内追加多行到文末
// 纯 IO 封装：路径由 brainPath 统一算，写由 lock.editFile 统一带锁。无业务逻辑。
import { promises as fs } from 'node:fs';
import { brainPath } from './index.js';
import { editFile, SKIP } from './lock.js';

/** 读 .brain/<rel> 全文。不存在返回 null。读不经锁（读旧内容无害）。 */
export async function readBrain(brainRoot, rel) {
  const p = brainPath(brainRoot, rel);
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null; // 尚未建该页
  }
}

/** 锁内读-改-写 .brain/<rel>。transform(currentText) 返回新文本；返回 null/undefined 表示不改(不落盘)。
 * 返回：落盘后的新文本(transform 不改时返回原文本)。自动防并发(同文件多进程同时写不覆盖)。
 * 注：本方法写的是「整体新文本」；若文件不存在 currentText 传 null。 */
export async function writeBrain(brainRoot, rel, transform) {
  const p = brainPath(brainRoot, rel);
  const out = await editFile(p, (current) => {
    const next = transform(current);
    if (next === null || next === undefined) return SKIP; // 不改 → 不落盘
    const text = typeof next === 'string' ? next : next.text;
    return text === current ? SKIP : text; // 与当前相同也不落盘(editFile 幂等)
  });
  // out 是 editFile 返回的字符串(新文本)或 SKIP(未改)。未改时返回读到的当前文本。
  if (out === SKIP) return currentTextOf(brainPath(brainRoot, rel));
  return out;
}

/** 读文件文本(不经锁); 供 writeBrain 未改时回读当前值。 */
async function currentTextOf(p) {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

/** 锁内往 .brain/<rel> 文末追加若干行(自动补换行)。若文件不存在则创建。 */
export async function appendBrain(brainRoot, rel, lines) {
  const arr = Array.isArray(lines) ? lines : [lines];
  return writeBrain(brainRoot, rel, (cur) => {
    const base = cur == null ? '' : cur.replace(/\s*$/, '');
    const body = arr.join('\n');
    return base ? `${base}\n${body}\n` : `${body}\n`;
  });
}

/** 原子建新 .brain/<rel>(tmp+rename, 不经锁——新文件写唯一内容无并发读者竞争)。 */
export async function createBrainFile(brainRoot, rel, content) {
  const p = brainPath(brainRoot, rel);
  const { dirname } = await import('node:path');
  await fs.mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.abs-tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, p);
  return p;
}
