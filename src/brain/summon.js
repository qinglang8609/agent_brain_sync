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
export async function md5Of(file) {
  const buf = await fs.readFile(file).catch(() => null);
  if (!buf) return null;
  return createHash('md5').update(buf).digest('hex');
}

/** 解析一个会话文件 → 摘要素材。 */
export async function digestSession(file) {
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); } catch { return null; }
  const out = {
    file, start: '', endedAt: '', day: '', id: '', cwd: '',
    users: [], filesEdited: new Map(), toolCalls: 0, lastAssist: '',
  };
  for (const l of raw.split('\n')) {
    if (!l) continue;
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    if (o.type === 'session') {
      out.start = o.timestamp || '';
      out.cwd = o.cwd;
      // 会话 id 是「这份资料属于哪场会话」的唯一凭据 —— pi 把它放在首行，
      // 文件名里也有，但文件名会被改，id 不会。
      out.id = o.id || '';
      continue;
    }
    if (o.type !== 'message') continue;
    if (o.timestamp) out.endedAt = o.timestamp;
    const m = o.message || {};
    if (m.role === 'user') {
      const t = textOf(m.content).trim();
      if (isRealUserText(t)) out.users.push(t);
    } else if (m.role === 'assistant' && Array.isArray(m.content)) {
      let said = '';
      for (const c of m.content) {
        if (!c) continue;
        if (c.type === 'text' && c.text) said += c.text;
        if (c.type !== 'toolCall') continue;
        out.toolCalls++;
        const p = c.arguments && c.arguments.path;
        if (p && typeof p === 'string' && ['edit', 'write'].includes(c.name)) {
          out.filesEdited.set(p, (out.filesEdited.get(p) || 0) + 1);
        }
      }
      // 只留最后一轮说了什么（会话的收尾结论通常在这），不存全文 ——
      // 全文动辄几百 KB，存进来就是「读取侧随规模增长」。
      if (said.trim()) out.lastAssist = said.trim();
    }
  }
  out.day = (out.start || '').slice(0, 10);
  if (!out.id) {
    // 兜底：文件名形如 `2026-11-05T03-35-14-951Z_<id>.jsonl`
    const m = String(file).match(/^[^_]+_([0-9a-f-]{16,})\.jsonl$/);
    if (m) out.id = m[1];
  }
  return out;
}

/** 已总结状态（从 .brain/sessions/*.md 的正文取）：
 *   ids  —— 页面里已有 `挂钩: session=<会话 id>` 的会话（已提炼过的那几场）
 *   days —— 「整天快照」的日期集合（页里没有任何 `## 会话 ` 段）
 *
 * 两个判据回答的是不同问题：
 *   · 该天页存在且是人写的快照 → 那天**已经总结过**（人写的，最权威）
 *   · 页里有该会话 id 的段      → 那**场**会话已经提过
 *   · 账本记 md5               → 那个**会话文件**提过了
 * 只按 md5 判会把「已有快照的日子」全列出来当未总结（实测 15 条全是已有快照的），
 *   那是把托底做成噪音；而只按日期跳过会把同一天没落的几场永久埋掉。
 *
 * 为何改成读正文（2026-11-08）：会话摘要不再是一場一文件（`session-<日期>-s<id8>.md`），
 *   而是并进当天的 `log-<日期>.md` 里的 `## 会话 <id8>` 段 —— 文件名里不再有会话 id，
 *   所以「这场提过没有」只能按段里的 `挂钩: session=` 查，不能按文件名猜。
 *   而「那天已有人写快照」仍按天判：页里没有任何 `## 会话 ` 段就说明那天只有人写的内容。 */
async function summarizedState(brainSessionsDir) {
  const days = new Set();
  const ids = new Set();
  let files;
  try { files = await fs.readdir(brainSessionsDir); } catch { return { days, ids }; }
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const body = await fs.readFile(join(brainSessionsDir, f), 'utf8').catch(() => '');
    if (!body) continue;
    for (const m of body.matchAll(/^>\s*挂钩:\s*session=(\S+)/gm)) ids.add(m[1]);
    if (/^##\s*会话\s/m.test(body)) continue;   // 含 ingest 摘要的页不整日跳过
    const m = f.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) days.add(m[1]);
  }
  return { days, ids };
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
  // tmp 名必须带随机后缀（2026-11-05 实测）：
  //   原来用 `${path}.tmp-${Date.now()}`。同一毫秒内起两个进程（同时关两个会话）
  //   会生成**完全相同**的 tmp 名 —— 前一个 rename 把文件改走后，后一个 rename
  //   对着已经不存在的老名字操作，抛 ENOENT。实测 20 个并发直接炸出这个错。
  //   仓库其它落盘点（ingest 的页、notes）早就在用 `${Date.now()}-${random}`，
  //   这里漏了随机段。
  const tmp = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(tmp, JSON.stringify(ledger, null, 2) + '\n');
  await fs.rename(tmp, path);
}

/** 读-改-写账本的**并发安全**版本。
 *
 * 为何要它（2026-11-05 实测）：`readLedger` + 修改 + `writeLedger` 是一组
 *   非原子操作。两个会话同时关闭 → 两个 ingest 进程各自读到同一份旧账本 →
 *   各自加一条 → 后写的盖掉先写的，**先写那条静默消失**。
 *   后果不是报错，是某场会话下次又被当作「未落页」重新催一遍。
 *
 * 用 lock.js 的 editFile（它按文件加 .lock 串行化，是仓库既定的写法）。
 * 账本不在 BRAIN_SHAPE 里，故不会过 index/todo/log 的格式闸门。
 *
 * @param {(book:object)=>void} mutator 就地修改 book
 */
export async function updateLedger(mutator, path = ledgerPath()) {
  const { promises: fsp } = await import('node:fs');
  await fsp.mkdir(join(path, '..'), { recursive: true });
  const { editFile } = await import('../lock.js');
  await editFile(path, async (current) => {
    let book;
    try {
      const j = JSON.parse(String(current || ''));
      book = (j && typeof j.files === 'object') ? j : { version: 1, files: {} };
    } catch { book = { version: 1, files: {} }; }
    await mutator(book);
    return { text: JSON.stringify(book, null, 2) + '\n' };
  });
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
  // 已总结状态：整天快照的日期（整日跳过）+ 已提过的会话 id（逐场跳过）。
  const { days: haveSnapshot, ids: haveDigest } = await summarizedState(join(projectRoot, '.brain', 'sessions'));
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
    if (d.id && haveDigest.has(d.id)) { skipped.push({ name, reason: '这一场已提炼过' }); continue; }
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

/** 收尾时顺手列出未总结/有更新的会话（给人看的尾巴）。
 *
 * 为何放在这里而不是各调用方（2026-11-02）：abs log 与 abs capture 都要用，
 * 两处各写一份必然漂移。失败一律吞掉 —— 记流水/记经验不能因为扫会话而失败。
 *
 * @param {string} root 项目根
 * @param {object} opts { limit } 最多列几场
 * @returns {Promise<string>} 无待总结时返回空串（不占输出）
 */
export async function summonTail(root, { limit = 8 } = {}) {
  try {
    const r = await scanProject(root);
    const pending = (r.fresh?.length || 0) + (r.changed?.length || 0);
    if (!pending) return '';
    const lines = ['', `--- 本项目有 ${pending} 场会话待总结 ---`];
    for (const it of [...r.fresh, ...r.changed].slice(0, limit)) {
      const tag = it.prevMd5 ? '（有更新）' : '';
      lines.push(`  ${it.day}  ${it.sizeKB}KB${tag}`);
      for (const u of (it.digest?.users || []).slice(0, 2)) {
        lines.push(`     · ${u.replace(/\s+/g, ' ').trim().slice(0, 70)}`);
      }
    }
    if (pending > limit) lines.push(`  …另有 ${pending - limit} 场（abs summon 看全量）`);
    lines.push('  落哪条由你判断: abs ingest <会话文件名>  |  abs capture --layer N "…"');
    return '\n' + lines.join('\n');
  } catch {
    return '';
  }
}
