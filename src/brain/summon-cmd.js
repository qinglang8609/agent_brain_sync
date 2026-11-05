// src/brain/summon-cmd.js — `abs summon` 命令族：会话总结的托底扫描。
//
// 定位：正常路径是收尾时 `abs capture` / `abs log`。这条路被跳过时，本命令把
// 「有实质内容但还没总结」的会话提出来。它是托底，不是替代。
//
// 三个动作：
//   abs summon            扫当前项目，列出未总结 / 有更新的会话（只读，不写盘）
//   abs summon --mark     把本次列出的记为「已提取」，下次不再列
//   abs summon --status   看账本统计
import { resolve } from 'node:path';
import { findBrainRoot } from '../index.js';
import {
  scanProject, renderScan, readLedger, updateLedger, markSummarized, ledgerPath,
} from './summon.js';

/** 解析项目根：显式 --dir 优先，否则用当前目录的图谱根。 */
async function resolveRoot(dir) {
  if (dir) {
    const r = await findBrainRoot(resolve(dir));
    if (!r) throw new Error(`✗ ${resolve(dir)} 下没有 .brain/ 图谱`);
    return r;
  }
  const here = await findBrainRoot(process.cwd());
  if (!here) throw new Error('✗ 当前目录没有 .brain/ 图谱（用 --dir 指定，或先 abs init）');
  return here;
}

export async function cmdSummon({ dir, mark = false, full = false, limit = 15, status = false } = {}) {
  const path = ledgerPath();

  if (status) {
    const book = await readLedger(path);
    const n = Object.keys(book.files).length;
    const days = new Set(Object.values(book.files).map((r) => r.day).filter(Boolean));
    return [
      `📒 总结账本: ${path}`,
      `已记录 ${n} 个会话，跨 ${days.size} 天`,
      n ? `最近一条: ${Object.entries(book.files).sort((a, b) => (b[1].summarizedAt || '').localeCompare(a[1].summarizedAt || ''))[0].map((x) => Array.isArray(x) ? JSON.stringify(x).slice(0, 90) : x).join(' · ')}` : '',
    ].filter(Boolean).join('\n');
  }

  let root;
  try { root = await resolveRoot(dir); } catch (e) { return e.message; }

  const book = await readLedger(path);
  const result = await scanProject(root, { ledger: book });

  const pending = [...result.fresh, ...result.changed];
  if (!mark) return renderScan(result, { full, limit });

  // --mark：记为已提取。不写知识页 —— 那是人的判断，不是本命令的。
  if (!pending.length) return '✓ 没有待提取的会话，账本未改动。';
  // updateLedger 加锁改写（2026-11-05）：与 ingest 落页并发时，
  // 两个「读 → 改 → 写」会互相盖掉，先写那条静默消失。
  await updateLedger((latest) => { markSummarized(latest, pending); }, path);
  return [
    `✓ 已记账 ${pending.length} 个会话（下次不再列出）`,
    `  账本: ${path}`,
    '',
    '注意：这一步只记「这些会话我提过了」，**没有写任何知识页**。',
    '要沉淀的仍要显式落: abs capture --layer N "…" / abs log "…"',
  ].join('\n');
}
