// src/brain/summon.js — 会话总结的托底：扫 pi 会话目录，找出「还没总结过」的会话。
//
// 为何需要它（2026-11-01 实测）：pi 会话目录里本项目 63 个会话跨 26 天，
//   而 .brain/sessions/ 只有 19 天有快照 —— 缺 12 天。正常路径是收尾时人主动总结，
//   但这个动作会被跳过。「琐碎知识没有正常总结」是结构问题：会话发生了，没人回头提炼。
//   本命令是**托底**，不是替代：有快照就不管，没快照才提出来。
//
// 判重靠 md5 账本（用户定，2026-11-01）：
//   每条已总结的会话记录其文件 md5。下次扫描：
//     · md5 相同 → 已总结过，跳过
//     · md5 不同 → 会话被补写过（同一会话继续聊），要**补充总结**
//   为何用 md5 而不是 mtime/size：mtime 会因任何触碰变化（备份、同步），
//   size 在「改了同一长度内容」时不变。md5 是内容判据，恰好对应「会话内容变没变」。
//   代价是读全文 —— 实测本项目 63 个文件 55MB，全读约 0.2s，可接受。
//
// 边界（守「已存在的人工内容一律不覆盖」）：
//   本命令**只输出摘要给人看，不写任何 .brain/ 知识页**。
//   账本只记「这个会话文件我提过了」，不记内容判断。
//   要落哪一条由人确认后显式 `abs capture` / `abs log`。
//
// 会话文件格式（pi，2026-11-01 实测）：
//   JSONL，每行 { type: 'session' | 'message' | ... }；message.content 是**数组**。
//   坑：曾按 typeof content === 'string' 判断 → 用户消息恒 0 条。

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

/** 活跃会话判定：mtime 在此毫秒内 → 文件还在写，本轮跳过。
 * 实测（2026-11-01）当前会话 0 分钟前，其余最晚 189 分钟前，30 分钟阈值安全。 */
export const ACTIVE_MS = 30 * 60 * 1000;

/** 会话根目录。ABS_PI_SESSIONS 可覆盖（测试隔离 / 别的宿主）。 */
export function sessionsRoot() {
  return process.env.ABS_PI_SESSIONS || join(homedir(), '.pi', 'agent', 'sessions');
}

/** 项目绝对路径 → pi 的会话目录名。
 *
 * 规则（2026-11-01 实测 pi 的 42 个真实目录反推，5 个样本全通过）：
 *     `--` + 去掉开头的 `/` + 所有 `/` 换成 `-` + `--`
 *     `/Users/fanchao/Code/agent_brain_sync`
 *     → `--Users-fanchao-Code-agent_brain_sync--`
 *
 * 坑一：曾用 `replace(/[^A-Za-z0-9]/g, '-')` —— 下划线 `_` 也被换掉，
 *   `agent_brain_sync` 变 `agent-brain-sync`，目录找不到（实测报错）。
 *   `_` 与 `.` 必须原样保留。
 * 坑二：这个编码**不可逆**——路径本身可能含 `-`（如 `vibe-coding-help`），
 *   解码时无法区分哪个 `-` 原本是 `/`。实测 42 个目录只有 14 个能解码回存在的路径。
 *   所以只能按本函数正向拼，不要试图反查。 */
export function projectDirName(projectRoot) {
  const body = String(projectRoot).replace(/^\/+/, '').replace(/\//g, '-');
  return `--${body}--`;
}

/** 账本路径：和库同目录（~/.abs/summarized.json），ABS_SUMMON_LEDGER 可覆盖。 */
export function ledgerPath() {
  return process.env.ABS_SUMMON_LEDGER || join(homedir(), '.abs', 'summarized.json');
}

/** content 数组取纯文本。string 也兼容。 */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('\n');
}

/** 是否值得当成「用户真说的话」。滤掉注入块与无信息量的单句。 */
function isRealUserText(t) {
  const s = String(t || '').trim();
  if (!s) return false;
  if (s.startsWith('<')) return false;                 // 系统注入块
  if (s.startsWith('[abs')) return false;              // abs 自己的提醒
  if (s.startsWith('[SYSTEM')) return false;
  if (s.length <= 4 && /^(abs|继续|好的|是的|嗯|ok|好)$/i.test(s)) return false;
  return true;
}

/** 会话文件 md5。判「内容有没有变」的唯一可靠判据。 */
async function md5Of(file) {
  const buf = await fs.readFile(file).catch(() => null);
  if (!buf) return null;
  return createHash('md5').update(buf).digest('hex');
}

/** 解析一个会话文件 → 摘要素材。 */
export async function digestSession(file) {
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); } catch { return null; }
  const out = {
    file, start: '', endedAt: '', day: '',
    users: [], filesEdited: new Map(), toolCalls: 0,
  };
  for (const l of raw.split('\n')) {
    if (!l) continue;
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    if (o.type === 'session') { out.start = o.timestamp || ''; out.cwd = o.cwd; continue; }
    if (o.type !== 'message') continue;
    if (o.timestamp) out.endedAt = o.timestamp;
    const m = o.message || {};
    if (m.role === 'user') {
      const t = textOf(m.content).trim();
      if (isRealUserText(t)) out.users.push(t);
    } else if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const c of m.content) {
        if (!c || c.type !== 'toolCall') continue;
        out.toolCalls++;
        const p = c.arguments && c.arguments.path;
        if (p && typeof p === 'string' && ['edit', 'write'].includes(c.name)) {
          out.filesEdited.set(p, (out.filesEdited.get(p) || 0) + 1);
        }
      }
    }
  }
  out.day = (out.start || '').slice(0, 10);
  return out;
}

/** 已有快照的日期集合（从 .brain/sessions/*.md 文件名取）。
 *
 * 为何要和 md5 账本并用（2026-11-01）：两条判据回答的是不同问题 ——
 *   · 有快照         → 那天**已经总结过**（人写的，最权威）
 *   · 账本记录 md5   → 那个**会话文件**提过了
 * 只按 md5 判会把「已有快照的日子」全列出来当未总结（实测 15 条全是已有快照的），
 * 那是把托底做成噪音。两条都要：有快照就跳过，没有才看账本。 */
async function daysWithSnapshot(brainSessionsDir) {
  const days = new Set();
  let files;
  try { files = await fs.readdir(brainSessionsDir); } catch { return days; }
  for (const f of files) {
    const m = f.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) days.add(m[1]);
  }
  return days;
}

/** 读账本。格式 { version, files: { "<相对文件名>": { md5, day, summarizedAt } } } */
export async function readLedger(path = ledgerPath()) {
  try {
    const j = JSON.parse(await fs.readFile(path, 'utf8'));
    if (j && typeof j.files === 'object') return j;
  } catch { /* 不存在或坏了 → 空账本 */ }
  return { version: 1, files: {} };
}

/** 写账本（原子：tmp + rename）。 */
export async function writeLedger(ledger, path = ledgerPath()) {
  await fs.mkdir(join(path, '..'), { recursive: true });
  const tmp = `${path}.tmp-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(ledger, null, 2) + '\n');
  await fs.rename(tmp, path);
}

/**
 * 扫一个项目，分三类：
 *   fresh    —— 从未总结过（账本里没有）
 *   changed  —— 总结过但 md5 变了（会话被续写，要补充）
 *   skipped  —— md5 一致（真的总结过了）
 * 跳过活跃会话（文件仍在写），避免把半截内容记成已总结。
 */
export async function scanProject(projectRoot, { ledger, now = Date.now() } = {}) {
  const dir = join(sessionsRoot(), projectDirName(projectRoot));
  let names;
  try { names = (await fs.readdir(dir)).filter((f) => f.endsWith('.jsonl')); } catch {
    return { error: `找不到会话目录: ${dir}`, fresh: [], changed: [], skipped: [], active: [] };
  }
  const ownBook = !ledger;              // 账本是自己读的（不是调用方给的）
  const book = ledger || await readLedger();
  // 已有快照的日子整日跳过 —— 人已经总结过，托底不该再吵。
  const haveSnapshot = await daysWithSnapshot(join(projectRoot, '.brain', 'sessions'));
  const fresh = [], changed = [], skipped = [], active = [];
  let touched = false;   // 是否补记过 stat（需要回写账本，否则下次又得读全文）

  for (const name of names.sort()) {
    const full = join(dir, name);
    let st;
    try { st = await fs.stat(full); } catch { continue; }
    if (now - st.mtimeMs < ACTIVE_MS) { active.push({ name, reason: '会话仍在写' }); continue; }

    const rec = book.files[name];

    // ── 便宜的预筛：文件大小 + mtime 都没变 → 内容必然没变 → 跳过，不读全文。
    // 为何要它（2026-11-01 实测）：全读算 md5 在 63 个文件 / 55MB 上是 74ms，
    // 而只读 stat 是 0ms（快 74 倍）。这条路径会被 abs log 每次收尾调用，
    // 且文件数只增不减 —— 不预筛就是「读取侧随规模增长」。
    // 漏判风险为零：改内容必动 mtime，内容变了而 size 与 mtime 都不变不可能发生。
    if (rec && rec.size === st.size && rec.mtime === st.mtimeMs && rec.md5) {
      skipped.push({ name, reason: 'size+mtime 未变' });
      continue;
    }

    // 已有快照的日子，先看账本里记的 day —— 不必读文件就能判。
    // 实测（2026-11-01）：63 个文件里有 41 个属于「已有快照」的日子，
    // 原来要先 digestSession 读全文才知道日期，等于白读 41 次。账本里有 day 时先拦。
    if (rec && rec.day && haveSnapshot.has(rec.day)) {
      skipped.push({ name, reason: `${rec.day} 已有快照` });
      continue;
    }

    const d = await digestSession(full);
    if (!d || !d.users.length) { skipped.push({ name, reason: '无真实用户输入' }); continue; }
    if (d.day && haveSnapshot.has(d.day)) { skipped.push({ name, reason: `${d.day} 已有快照` }); continue; }

    // 到这里才需要 md5（要么文件变了，要么账本里没有）。
    const md5 = await md5Of(full);
    if (!md5) continue;
    if (rec && rec.md5 === md5) {
      // size/mtime 变了但内容没变（如 touch、备份还原）→ 补记新的 stat，下次走预筛
      book.files[name] = { ...rec, size: st.size, mtime: st.mtimeMs };
      touched = true;
      skipped.push({ name, reason: 'md5 一致（仅 stat 变化）' });
      continue;
    }

    const item = { name, md5, day: d.day, digest: d, sizeKB: Math.round(st.size / 1024), size: st.size, mtime: st.mtimeMs };
    if (rec) changed.push({ ...item, prevMd5: rec.md5 }); else fresh.push(item);
  }
  // 补记的 stat 要落盘 —— 只改内存等于每次重读全文，预筛白做。
  // 只在自己读的账本上回写：调用方传了 ledger 时，回写时机由它决定
  // （cmdSummon 要等 --mark 才写，免得扫描顺手改了用户的账本）。
  if (touched && ownBook) await writeLedger(book);

  return { fresh, changed, skipped, active, dir };
}

/** 记一笔：这些会话已提取（不管人是否落盘，账本只记「提过了」）。 */
/** 记一笔：这些会话已提取。同时存 size+mtime —— 下次扫描靠它做便宜预筛，避免全读。 */
export function markSummarized(ledger, items, when = new Date().toISOString()) {
  for (const it of items) {
    ledger.files[it.name] = {
      md5: it.md5, day: it.day, summarizedAt: when,
      size: it.size, mtime: it.mtime,
    };
  }
  return ledger;
}

/** 渲染待确认清单。不写盘。 */
export function renderScan(result, { full = false, limit = 15 } = {}) {
  if (result.error) return `✗ ${result.error}`;
  const out = [
    `会话目录: ${result.dir}`,
    `未总结 ${result.fresh.length} 个 · 有更新 ${result.changed.length} 个 · 已总结 ${result.skipped.length} 个 · 活跃跳过 ${result.active.length} 个`,
  ];
  const show = (title, items, tail) => {
    if (!items.length) return;
    out.push('', `--- ${title} (${items.length}) ---`);
    for (const it of items.slice(0, limit)) {
      out.push(`${it.day}  ${it.sizeKB}KB  ${it.name.slice(0, 34)}`);
      const sample = it.digest.users.slice(0, full ? 8 : 2);
      for (const u of sample) {
        out.push(`   · ${u.replace(/\s+/g, ' ').trim().slice(0, full ? 200 : 70)}`);
      }
      if (tail) out.push(`   ${tail}`);
    }
    if (items.length > limit) out.push(`  …另有 ${items.length - limit} 个`);
  };
  show('从未总结', result.fresh);
  show('总结过但有更新（会话被续写，需补充）', result.changed, '↳ md5 与账本不符');
  if (!result.fresh.length && !result.changed.length) {
    out.push('', '✓ 所有已结束的会话都总结过了。');
  } else {
    out.push(
      '',
      '这是**待确认清单，不会自动写盘**。落哪一条由你判断：',
      '  abs capture --layer 4 "…"   或   abs log "完成 X：…"',
      '  abs summon --mark            记下「这些已提取」，下次不再列出',
    );
  }
  return out.join('\n');
}
