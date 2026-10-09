// src/page.js — 知识页的生命周期：id 冻结 / 状态机 / 推翻 / 待确认队列 / 引用反查。
//
// 从 store.js 拆出（2026-10-05）：原单文件 1509 行 / 18 职责，读改都吃力。
// 拆法照 rpiv-todo 的规模（单文件 ≤300 行）。本文件只放"对单页的操作"，
// 不含加载/看板/任务那几块（那些留在 store.js）。
//
// 依赖方向：page.js ← store.js（不可反向）。store.js 里的 cmdSupersede /
// cmdReview / cmdResolve 会 re-export 本文件的实现，保持既有调用面不变。
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { requireBrain, brainPath, BRAIN_DIR } from './index.js';
import { editFile, SKIP } from './lock.js';
// PAGE_DIRS / listPages 早先就在 lint.js（页面清单遍历是 lint 的职责），此处复用而非重写。
import { PAGE_DIRS, listPages } from './lint.js';

// ---------- page id: 改名不改引用 ----------
// 问题：`.brain` 内部引用靠 [[slug]]，而 slug 就是文件名 —— 改一次文件名，
// 所有指向它的链接静默变成 DEAD-LINK，只能靠 lint 事后抓。
// 解法（最小代价）：页面 frontmatter 写一行 `id:`，建页时冻结。
//   • 不发明新编号：id 默认等于建页时的 slug（人可读、可手写、无需迁移）
//   • 旧页无 id → 回退用 slug，因此存量 31 页零迁移
//   • 改名后 slug 变而 id 不变 → lint 报 ID-DRIFT，提示改成谁
// 为什么不上内容哈希/uuid：哈希一改内容就变（比文件名还不稳定），
// uuid 不可读不可手写且要全量迁移。slug 就是最合适的 id，只要不再跟文件名跑。
const ID_RE = /^id:\s*(.+)$/m;

/** 读页面 id；无 id 行则回退 slug（存量页零迁移）。 */
export function idOfPage(body, slug) {
  const m = String(body || '').match(ID_RE);
  return m ? m[1].trim() : slug;
}

/** 给存量页补 id（只在缺时写），落 frontmatter。返回 'added' | 'exists' | 'no-fm'。 */
export async function backfillPageId(full, slug) {
  const res = await editFile(full, (cur) => {
    if (!cur || !cur.startsWith('---\n')) return SKIP;
    if (ID_RE.test(cur.split('\n---')[0])) return SKIP; // 已有 id 不动
    const end = cur.indexOf('\n---', 3);
    if (end === -1) return SKIP;
    return { text: `${cur.slice(0, end)}\nid: ${slug}${cur.slice(end)}` };
  });
  return res === SKIP ? 'exists' : 'added';
}

// ---------- page status: 经验/知识页的生命周期 ----------
// 问题：经验写进去就永远躺在那里 —— 推翻时删不掉（skill 里写着"人工内容一律不覆盖"，
// AI 不敢删）、读的时候又看不见（load 只给分区计数）→ 旧经验持续骗下一个会话。
// 解法：给已有的 `status:` 字段（字段本来就存在，20 页在用）定死三个值：
//   active      当前有效（缺字段的默认值 —— 存量 22 页零迁移）
//   superseded  已被推翻，别再依据它 —— 配 superseded-by 指向取代它的页
//   draft       待核实（abs note 新落的经验就是这个）
// 关键：推翻 = 改一行 frontmatter，**不删文件不丢历史** —— AI 敢做，人也能反悔。
// 为什么不用新字段/新目录：字段已存在且有存量值，重命名会另起一套双轨（同 OPTS-DOUBLE-KEYS 之病）。
export const PAGE_STATUS = ['active', 'superseded', 'draft'];
const STATUS_RE = /^status:\s*(\S+)\s*$/m;
const SUPERSEDED_BY_RE = /^superseded-by:\s*(.+)$/m;

/** 读页面 status；无字段或是未知值时当 active（存量页零迁移）。 */
export function statusOfPage(body, frontmatter) {
  const fm = frontmatter !== undefined
    ? frontmatter
    : (String(body || '').match(/^---\n([\s\S]*?)\n---/) || ['', ''])[1];
  const m = String(fm).match(STATUS_RE);
  const v = m ? m[1].trim() : '';
  return PAGE_STATUS.includes(v) ? v : 'active';
}

/** 读 superseded-by（只在 status=superseded 时有意义）。无则空串。 */
export function supersededByOf(body) {
  const m = String(body || '').match(SUPERSEDED_BY_RE);
  return m ? m[1].trim() : '';
}

// ---------- supersede: 标记一条经验被推翻（回退的写入端） ----------
// 为什么是标记而不是删除：
//   ① 删除后下一个会话会重新踩同一个坑并重新记一遍（历史本身是资产）
//   ② AI 不敢删（人工内容不覆盖），但敢改一行 frontmatter
//   ③ 反悔只需把 status 改回 active
export async function cmdSupersede({ dir, refs, by }) {
  const list = (refs || []).map((r) => String(r).trim()).filter(Boolean);
  if (!list.length) return '用法: abs supersede <页名或id> [更多…] [--by <取代它的页>]  — 标记经验已失效（不删文件）';
  let root;
  try {
    root = await requireBrain(dir || process.cwd());
  } catch {
    return `未找到 .brain/ 图谱。先在项目根运行: abs init`;
  }
  const byRef = String(by || '').trim();
  // 取代者必须先存在 —— 否则写下一个永远悬空的引用（lint 会报，不如现在拒）。
  if (byRef) {
    const target = await resolvePage(root, byRef);
    if (!target) return `✗ --by ${byRef}: 图谱里没有这页（先用 abs resolve 确认页名）`;
  }
  const out = [];
  // 取代者 slug 在循环外解析一次（锁内 mutator 不能 await）
  const bySlug = byRef ? (await resolvePage(root, byRef)).slug : '';
  for (const r of list) {
    const hit = await resolvePage(root, r);
    if (!hit) { out.push(`✗ ${r}: 未找到（试 abs query <词> 或 abs index 看清单）`); continue; }
    const res = await editFile(hit.full, (cur) => {
      if (!cur || !cur.startsWith('---\n')) return SKIP;
      const end = cur.indexOf('\n---', 3);
      if (end === -1) return SKIP;
      let fm = cur.slice(0, end);
      // 幂等：已是 superseded 且 superseded-by 一致 → 不写盘
      const curSt = statusOfPage('', fm);
      const curBy = supersededByOf(cur);
      if (curSt === 'superseded' && curBy === bySlug) return SKIP;
      // 去掉旧的 superseded-by（不论换不换取代者，旧值都作废）
      fm = fm.replace(/\nsuperseded-by:.*(?=\n|$)/g, '');
      fm = STATUS_RE.test(fm)
        ? fm.replace(STATUS_RE, 'status: superseded')
        : `${fm}\nstatus: superseded`;
      // superseded-by 用 slug（不是 id）：人直接能按名找页，lint 能直接比对文件名
      if (bySlug) fm = `${fm}\nsuperseded-by: ${bySlug}`;
      return { text: fm + cur.slice(end) };
    });
    out.push(res === SKIP
      ? `= ${hit.slug}: 已是 superseded（无变化）`
      : `✓ ${hit.slug} → superseded${byRef ? ` (被 [[${byRef}]] 取代)` : ''}`);
  }
  return out.join('\n');
}

/** 把 id（或 slug）解析为页面路径。命中返回 {slug, dir, full, id}，否则 null。 */
export async function resolvePage(root, idOrSlug) {
  const want = String(idOrSlug || '').trim();
  if (!want) return null;
  const vault = brainPath(root);
  for (const d of PAGE_DIRS) {
    const p = join(vault, d);
    let files;
    try { files = await fs.readdir(p); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      const slug = f.replace(/\.md$/, '');
      const full = join(p, f);
      // slug 直接命中就够快（绝大多数调用走这条），不命中才去读 frontmatter 比 id
      if (slug === want) return { slug, dir: d, full, id: want };
      const body = await fs.readFile(full, 'utf8').catch(() => '');
      const id = idOfPage(body, slug);
      if (id === want) return { slug, dir: d, full, id };
    }
  }
  return null;
}

// ---------- review: 待确认页队列（draft → active/superseded） ----------
// 为何需要：abs note 落的是 status: draft（未经核实），但之前没有「确认」这一步 ——
//   draft 只是标签，没人管，经验就永远停在「待核实」状态，从不正式化。
// 借鉴 TencentDB 的 review/route 治理环节：提取后必经审查，防止脏知识进入正式图谱。
// 本命令只做「把 draft 显式升为 active 或否决为 superseded」，不替人判断内容好坏。
// 动作收口在一处（editFile 锁内），并发安全同 supersede。
export async function cmdReview({ dir, refs, action }) {
  let root;
  try {
    root = await requireBrain(dir || process.cwd());
  } catch {
    return `未找到 .brain/ 图谱。先在项目根运行: abs init`;
  }
  const act = String(action || '').toLowerCase();
  if (act && !['accept', 'reject'].includes(act)) {
    return '用法: abs review [--accept <页名…>] [--reject <页名…>]  — 无参数列出全部 draft 页';
  }
  // 无动作 → 列出所有 draft 页（待确认队列）
  if (!act) {
    const pages = await listPages(brainPath(root));
    // 只扫经验/知识目录（concepts/sources）。entities 是人页、sessions 是日志，
    // 它们不是「待核实的经验」，不该进 review 队列（拉进来会把人页/日志当经验误确认）。
    const REVIEW_DIRS = ['concepts', 'sources'];
    const drafts = pages.filter((p) => REVIEW_DIRS.includes(p.dir) && statusOfPage(p.body) === 'draft');
    if (!drafts.length) return '✓ 没有待确认的 draft 页。';
    const lines = drafts.map((p) => {
      const t = p.body.match(/^#\s*(.+)$/m);
      const title = t ? t[1].trim() : p.slug;
      return `  [draft] ${p.slug} — ${title}`;
    });
    return [
      `待确认 draft 页 ${drafts.length} 条：`,
      ...lines,
      '',
      '确认: abs review --accept <页名> [更多…]    否决: abs review --reject <页名> [更多…]',
    ].join('\n');
  }
  // 有动作 → 对每个 ref 改 status
  const list = (refs || []).map((r) => String(r).trim()).filter(Boolean);
  if (!list.length) return `✗ --${act} 需要至少一个页名。用法: abs review --${act} <页名…>`;
  const target = act === 'accept' ? 'active' : 'superseded';
  const out = [];
  for (const r of list) {
    const hit = await resolvePage(root, r);
    if (!hit) { out.push(`✗ ${r}: 未找到（试 abs review 看清单）`); continue; }
    const res = await editFile(hit.full, (cur) => {
      if (!cur || !cur.startsWith('---\n')) return SKIP;
      const end = cur.indexOf('\n---', 3);
      if (end === -1) return SKIP;
      let fm = cur.slice(0, end);
      const curSt = statusOfPage('', fm);
      // 幂等：已是目标状态 → 不写盘
      if (curSt === target) return SKIP;
      fm = STATUS_RE.test(fm)
        ? fm.replace(STATUS_RE, `status: ${target}`)
        : `${fm}\nstatus: ${target}`;
      return { text: fm + cur.slice(end) };
    });
    out.push(res === SKIP
      ? `= ${hit.slug}: 已是 ${target}（无变化）`
      : `✓ ${hit.slug} → ${target}`);
  }
  return out.join('\n');
}

// ---------- resolve: id/slug → 页面路径（引用的反查端） ----------
// 配合 frontmatter 的 id: 使用。页改名后 id 不变，靠本命令仍能找回来。
export async function cmdResolve({ dir, refs }) {
  const list = (refs || []).map((r) => String(r).trim()).filter(Boolean);
  if (!list.length) return '用法: abs resolve <id-or-slug> [更多…]  — 按 id/页面名反查路径';
  let root;
  try {
    root = await requireBrain(dir || process.cwd());
  } catch {
    return `未找到 .brain/ 图谱。先在项目根运行: abs init`;
  }
  const lines = [];
  for (const r of list) {
    const hit = await resolvePage(root, r);
    lines.push(hit
      ? `✓ ${r} → ${BRAIN_DIR}/${hit.dir}/${hit.slug}.md${hit.id !== hit.slug ? `  (id=${hit.id})` : ''}`
      : `✗ ${r}: 未找到（试 abs index 看完整清单，或 abs query <词> 全文搜）`);
  }
  return lines.join('\n');
}

export function collapseIndex(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  const out = [];
  let mode = null;      // null=逐行透传（文件头）；字符串=当前在计数的分区名
  let n = 0;            // mode 非 null 时的清单行计数
  const flush = () => {
    if (mode !== null) out.push(n ? `## ${mode}（${n} 页）` : `## ${mode}`);
    mode = null;
    n = 0;
  };
  let skipping = false; // 跳过 Rules 正文（已在上方单独成段）
  for (const l of s.split('\n')) {
    const m = l.match(/^##\s+(.+?)\s*$/);
    if (m) {
      flush();
      const name = m[1].trim();
      skipping = /Rules?|规则/i.test(name);
      if (skipping) continue;
      mode = name;   // 页面清单分区：只计数
      continue;
    }
    if (skipping) continue;
    if (mode === null) out.push(l);      // 透传区（含文件头 H1）
    else if (l.trim().startsWith('-')) n++;
  }
  flush();
  // 文件头与首个分区之间可能因跳过 Rules 而留下多余空行
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
