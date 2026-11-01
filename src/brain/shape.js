// src/brain/shape.js — .brain/ 三个受管文件的标准形状 + 结构核对。
// 从 store.js 拆出（2026-11-01）：init 与 load 共用同一份形状表，
// 单独立文件避免二者互相 import。
import { promises as fs } from 'node:fs';
import { brainPath } from '../index.js';
import { editFile, SKIP } from '../lock.js';
import { enforceBrainFormat, ensureStateMark } from '../todo.js';
import { clip } from '../text.js';

/** 标准形状表（与 indexTemplate/logTemplate/todoTemplate 同源）。
 * 标记不一致 = 直接改成标准（“能自己处理的先处理”）。
 * 只按**整行精确匹配**改标题，绝不动正文 —— 不做模糊替换，否则正文里提到的旧名会被误改。 */
// sources/ 堆积阀值：超过就是「采了没消化」。lint 报 SOURCES-PILED-UP，load 顶部同步提示。
// 两处共用同一常量 —— 阀值只有一个真源（SOURCES_MAX 在 lint.js 定义，此处导入使用）。

export const BRAIN_SHAPE = {
  'todo.md': {
    h1: '# 📋 Todo Board',
    order: ['## Todo', '## Done'],
  },
  'log.md': {
    h1: '# 🗒 Activity Log',
    order: [],   // log 无固定分区（条目行自带时间，倒序）
  },
  'index.md': {
    h1: '# 🗂 Graph Index',
    order: ['## Rules', '## Concepts', '## Entities', '## Sources', '## Syntheses', '## Sessions'],
  },
};

/** 旧标记 → 标准标记。load 发现就改（幂等）。含 H1 与分区/分组标题的旧名。 */
export const LEGACY_MARKS = [
  ['# 🗂 图谱索引', '# 🗂 Graph Index'],
  ['# 🗒 操作日志', '# 🗒 Activity Log'],
  ['# 📋 Todo 看板', '# 📋 Todo Board'],
  ['# 操作日志', '# 🗒 Activity Log'],
  ['# 图谱索引', '# 🗂 Graph Index'],
  ['# Todo 看板', '# 📋 Todo Board'],
  // 四区 → 两区（2026-09-13 用户定）。**这条路径是 load 走的**（rebuildStructure），
  // 与 todo.js 的 LEGACY_SECTION_RENAMES（normalizeTodo 用）是两条独立迁移路径 ——
  // 只改一处会导致另一条认不出旧区名，把它们当"非标准分区"原样留末尾（未完成任务
  // 留在文件里但不再被当 TODO）。测试 'load 也要能迁移' 钉住这一点。
  ['## Backlog', '## Todo'],
  ['## Today / In Progress', '## Todo'],
  ['## Blocked', '## Todo'],
  ['## Done（只留近期，旧的迁 log.md/快照）', '## Done'],
  ['### 归档', '### Archived'],
  ['### （未标日期）', '### Undated'],
];

/** 全套旧标记 → 标准标记（含 H1）。shape 核对与 gate 写入两处共用，故放在这里。 */
export const legacyRenames = () => LEGACY_MARKS;

/**
 * 核对 index/log/todo 的结构，不符就按标准重建（B 档：重排分区 + 内容按归属回填）。
 * 它每次 load 都跑，所以改动立即生效，不必等额外命令。
 *
 * 边界（内容安全）：
 *   - 只动**标题行位置**与缺失分区的空位，已有内容行按原归属搬运，不改写；
 *   - **非标准分区原样留在末尾**（人自加的区不合入，机器不猜语义）；
 *   - log.md 不做重排（无固定分区，条目自带时间倒序）；
 *   - 锁内重算 + “改了才写盘”，幂等。
 *
 * 不抛错（load 不能因核对失败而挂）。返回 { fixed:[描述], warn:[描述] }。
 */
export async function checkBrainShape(root) {
  const fixed = [];
  const warn = [];
  for (const [file, spec] of Object.entries(BRAIN_SHAPE)) {
    const p = brainPath(root, file);
    let text;
    try { text = await fs.readFile(p, 'utf8'); } catch { continue; }
    if (!text.trim()) continue;
    const l1 = (text.split('\n')[0] || '').trim();
    const knownH1 = l1 === spec.h1 || LEGACY_MARKS.some(([o]) => o === l1 && o.startsWith('# '));
    let changed = [];
    await editFile(p, (cur) => {
      if (cur === null) return SKIP;
      // 格式闸门收口在一处（见 todo.js enforceBrainFormat）：样式/空行/无头 三条规则
      // 与写入侧共用同一实现，写盘前顺手把破坏格式的部分整理回标准形态。
      // 走 normalizeTodo 的语义（Blocked → [滞留中]）由 enforceBrainFormat 内部保证。
      const r = enforceBrainFormat(cur, { ...spec, renames: legacyRenames() });
      // 兜底：仍无状态标记的未完成任务补默认值（新格式文件本就有标记，此处不触发）。
      const next2 = file === 'todo.md'
        ? r.text.split('\n').map((l) => (l.startsWith('- [ ] ') ? ensureStateMark(l, '进行中') : l)).join('\n')
        : r.text;
      if (next2 === cur) return SKIP;
      changed = r.fixed.length ? r.fixed : ['结构按标准重排'];
      return { text: next2 };
    }).catch((e) => {
      // 不能吞：load 是开机第一入口，静默跳过会让人以为库是健康的。
      // 典型触发：文件里有孤儿子任务（真错，不修而报）。
      // 只报**具体问题行**（以 `·` 开头的那些），不把整个错误头拼进去。
      const msg = e && e.message ? e.message : '未知错误';
      const detail = msg.split('\n').filter((x) => x.trim().startsWith('·')).map((x) => x.trim().slice(1).trim());
      warn.push(`${file}: 未能自动归一 —— ${detail.length ? detail.join('; ') : msg.split('\n')[0]}`.slice(0, 200));
    });
    if (changed.length) fixed.push(`${file}: ${changed.join('; ')}`);
    if (!knownH1) warn.push(`${file}: 标题非标准（读到 "${clip(l1, 24) || '(空)'}"）`);
  }
  return { fixed, warn };
}
