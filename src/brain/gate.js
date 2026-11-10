// src/brain/gate.js — 写入侧格式闸门注册。
// 从 store.js 拆出（2026-11-01）：闸门是「哪个文件用哪套标准」的全局注册，
// 与建骨架无关。靠 import 副作用生效 —— 模块顶层即注册。
import { setFormatGate } from '../lock.js';
import { enforceBrainFormat, ensureStateMark } from '../todo.js';
import { BRAIN_SHAPE, legacyRenames } from './shape.js';
import { basename } from 'node:path';

/** 写入侧格式闸门：lock.js 的 editFile 是所有写入的唯一收口，
 * 这里把「哪个文件名用哪套标准」告诉它 —— 三个目标文件之外的写入一律放行。
 * 非目标文件返回 null 表示不管。 */
setFormatGate((file, text, current) => {
  // basename 而不是 split('/')：Windows 路径是反斜杠，split 取不到文件名，
  // 闸门会静默放行（等于没装）。install.js 有 win32 候选，Windows 是支持目标。
  const name = basename(file);
  const spec = BRAIN_SHAPE[name];
  if (!spec) return null;
  const r = enforceBrainFormat(text, { ...spec, renames: legacyRenames() }, current);
  return name === 'todo.md'
    ? r.text.split('\n').map((l) => (l.startsWith('- [ ] ') ? ensureStateMark(l, '进行中') : l)).join('\n')
    : r.text;
});
