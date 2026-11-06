// src/brain/db-cmd.js — `abs db` 命令族：建库 / 搜索 / 状态。
//
// 这是「触发搜索先搜 SQLite」的入口。分工：
//   abs query <词>   —— 旧的 markdown 直扫，保留不动（唯一被验证过的路径）
//   abs db search <词> —— 走库：FTS 拿种子 → 亮度扩散，带 L1 铁律
import { promises as fs } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { findBrainRoot, brainPath } from '../index.js';
import { openDb, rebuild, search, illuminate, rulesOf, stats, ensureDbDir, dbPath, lastOpenRebuilt } from './db.js';
import { LAYERS } from './layers.js';

const PAGE_DIRS = ['concepts', 'entities', 'sources', 'syntheses', 'sessions'];
const FLAT_FILES = ['index.md', 'todo.md', 'log.md'];

/** 项目根路径 → 项目名（入库时的 project 字段）。
 *
 * 取路径末段。为何不引入 UUID（2026-11-02 评估）：项目名是给人看的标识，
 * 出现在每条检索结果里；UUID 会让输出不可读。末段同名的风险用 `db status` 暴露，
 * 不做静默处理。
 */
function projectNameOf(root) {
  return String(root).split('/').filter(Boolean).pop() || 'unknown';
}

/** 给一批项目根算出**互不重名**的项目名。
 *
 * 为何需要（2026-11-02 实测）：项目名默认取路径末段，而机器上同时存在
 *   ~/.agents 与 ~/Documents/软件/.agents，两者末段都是 `.agents` →
 *   入库时撞 UNIQUE(project, dir, slug) 约束，整个 rebuild 失败。
 *
 * 消歧规则：重名的那些改用「父目录-末段」，仍重名就继续往上加，直到唯一。
 * 只给重名的项目加前缀 —— 没重名的保持短名（检索结果里读起来更清楚）。
 */
export function uniqueProjectNames(roots) {
  const seg = (p) => String(p).split('/').filter(Boolean);
  const base = new Map(roots.map((r) => [r, seg(r).pop() || 'unknown']));
  const groups = new Map();
  for (const [r, n] of base) {
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(r);
  }
  const out = new Map();
  for (const [name, list] of groups) {
    if (list.length === 1) { out.set(list[0], name); continue; }
    // 重名 → 逐层加父目录前缀，直到组内唯一
    for (let depth = 2; depth <= 4; depth++) {
      const cand = new Map();
      for (const r of list) {
        const s = seg(r);
        cand.set(r, s.slice(Math.max(0, s.length - depth)).join('-'));
      }
      const vals = [...cand.values()];
      if (new Set(vals).size === vals.length) {
        for (const [r, v] of cand) out.set(r, v);
        break;
      }
      if (depth === 4) {
        // 深度到 4 仍重名（如 ~/a/x/软件/.agents 与 ~/b/y/软件/.agents 共享 4 层尾路径）：
        // 不能「认了」直接塞 —— 那会让两个项目拿到同一个项目名，rebuild 撞
        // UNIQUE(project,dir,slug) 约束整体崩溃（正是本函数要避免的场景）。
        // 给仍碰撞的条目追加序号（-2/-3…），保证互不重名且可读。
        const byVal = new Map();
        for (const [r, v] of cand) {
          if (!byVal.has(v)) { byVal.set(v, []); }
          byVal.get(v).push(r);
        }
        for (const [v, rs] of byVal) {
          if (rs.length === 1) { out.set(rs[0], v); continue; }
          rs.forEach((r, i) => out.set(r, `${v}-${i + 2}`));
        }
      }
    }
  }
  return out;
}

/** 当前所在项目名。查询时用它决定「读哪几条铁律」。
 *
 * 为何要单独一个函数（2026-11-02）：原来只在 cmdDbSearch 里内联算，
 * 与 rebuild 用的算法是两份代码 —— 任一边改了项目名规则，铁律就会读错项目的。
 * 判据：项目名的算法只能有一处。 */
async function currentProjectName(dir) {
  if (process.env.ABS_PROJECT) return process.env.ABS_PROJECT;
  const from = dir || process.cwd();
  const root = await findBrainRoot(from);
  return root ? projectNameOf(root) : '';
}

/** 扫一个项目的 .brain/ → 页面数组（含 index/todo/log 三份平铺文件）。 */
async function scanProject(root, project) {
  const out = [];
  for (const d of PAGE_DIRS) {
    const p = brainPath(root, d);
    let files;
    try { files = await fs.readdir(p); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      const full = join(p, f);
      try {
        const [body, st] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)]);
        out.push({ project, dir: d, slug: f.replace(/\.md$/, ''), body, mtime: st.mtimeMs });
      } catch { /* 读不到就跳过，不阻断整库 */ }
    }
  }
  // 用户要求：todo / index / log 也进库。dir 为空串表示"根目录平铺文件"。
  for (const f of FLAT_FILES) {
    try {
      const full = brainPath(root, f);
      const [body, st] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)]);
      out.push({ project, dir: '', slug: f.replace(/\.md$/, ''), body, mtime: st.mtimeMs });
    } catch { /* 不存在 */ }
  }
  return out;
}

/** 项目登记表。~/.abs/projects.json：一行一个项目根路径。
 * 用登记表而不是自动发现 —— 自动扫根目录会误收无关项目，且用户项目未必在一处。 */
function projectsFile() {
  // 坑（2026-11-01 实测）：曾写 join(dbPath(), '../../projects.json') —— 那是把
  // graph.db 当**目录**往上退两级，实际落到 ~/projects.json（家目录），不在 ~/.abs/。
  // 判据：配置与库同目录，用户找得到、备份得走一起。
  return process.env.ABS_PROJECTS || join(dirname(dbPath()), 'projects.json');
}

async function readProjects() {
  try {
    const t = await fs.readFile(projectsFile(), 'utf8');
    const j = JSON.parse(t);
    return Array.isArray(j.projects) ? j.projects : [];
  } catch {
    return [];
  }
}

/** 登记一个项目（幂等）。 */
export async function addProject(dir) {
  const root = resolve(dir);
  const p = projectsFile();
  const list = await readProjects();
  if (!list.includes(root)) list.push(root);
  await fs.mkdir(join(p, '..'), { recursive: true });
  await fs.writeFile(p, JSON.stringify({ projects: list }, null, 2) + '\n');
  return root;
}

/** `abs db rebuild` —— 扫所有登记项目，全量重建库。 */
export async function cmdDbRebuild({ dir } = {}) {
  const registered = await readProjects();
  // 当前目录即使没登记也纳入（用户就地跑 rebuild 应生效）
  const here = dir ? resolve(dir) : await findBrainRoot(process.cwd());
  const roots = [...new Set([...registered, ...(here ? [here] : [])])];

  if (!roots.length) {
    return '✗ 没有可入的项目。先在项目根跑: abs db add   或  abs db rebuild';
  }

  // 先收集所有有效根，再统一算项目名 —— 名字要去重，必须看到全局才知道谁重名
  const found = [];
  for (const root of roots) {
    const r = await findBrainRoot(root);
    if (r) found.push(r);                       // 登记了但目录没了 → 跳过，不报错
  }
  const names = uniqueProjectNames([...new Set(found)]);
  const pages = [];
  const used = [];
  for (const f of [...new Set(found)]) {
    const project = names.get(f);
    pages.push(...await scanProject(f, project));
    used.push(`${project} (${f})`);
  }
  if (!pages.length) return '✗ 登记的项目都没有 .brain/ 图谱，无可入库内容。';

  const path = dbPath();
  await ensureDbDir(path);
  const h = openDb(path);
  try {
    const st = rebuild(h, pages);
    const lines = [
      `✓ 已重建 ${path}`,
      `  项目 ${used.length}: ${used.join(', ')}`,
      `  节点 ${st.nodes} | 边 ${st.edges} | 悬挂 ${st.dangling} | 断点词 ${st.anchors} | 铁律 ${st.rules}`,
    ];
    if (st.dangling) {
      lines.push('', `⚠ ${st.dangling} 条链接指向不存在的页（abs db status 可查）`);
    }
    return lines.join('\n');
  } finally {
    h.close();
  }
}

/** `abs db search <词>` —— 走库搜索：FTS 种子 → 亮度扩散。 */
export async function cmdDbSearch({ query, limit = 8, full = false, noRules = false, cmdName = 'db search' } = {}) {
  const q = String(query || '').trim();
  if (!q) return '用法: abs db search <词>';

  const path = dbPath();
  const exists = await fs.stat(path).then(() => true).catch(() => false);
  if (!exists) return `✗ 库还没建（${path}）。先跑: abs db rebuild`;

  const h = openDb(path);
  try {
    // L1 铁律永远先出 —— 「不可逾越」的代码保证，不靠读到文本才遵守
    const project = await currentProjectName();
    const rules = rulesOf(h, project);

    const seeds = search(h, q, { limit: 12 });
    const lit = illuminate(h, seeds, { limit });

    // 命令名随调用方式变（2026-11-06）：顶层叫 search，别名仍走 db search。
    // 直接印死 'db search' 会让新命令的输出自相矛盾。
    const out = [`${cmdName} [${q}] → 种子 ${seeds.length} 条，亮起 ${lit.length} 页`];
    // --no-rules：不输出 L1 铁律（2026-11-05）。
    // 为何要它：铁律 18 条，占输出近一半。开工时（abs load）确实该先看，
    // 但「查一个主题」时它们是噪音 —— 实测同一查询 43 行里有 4 行是铁律区，
    // 而 MCP 侧每次调用都受这个成本影响。省略不等于不遵守：铁律由 load 负责送达。
    if (rules.length && !noRules) {
      out.push('', `--- L1 铁律 ${rules.length} 条（任何检索先出）---`);
      for (const r of rules) out.push(`- ${r}`);
    }
    if (!lit.length) {
      out.push('', lastOpenRebuilt()
        ? '（库文件曾损坏被清空，现在没有内容：跑 abs db rebuild 重建）'
        : '（无命中。库可能是旧的：abs db rebuild 重扫）');
      return out.join('\n');
    }
    // --full：显式要求时才读正文。默认不给 —— 这是索引优先的核心。
    // 实测（2026-11-02）：ABS 单页平均 824 token，8 页全带就是 6600 token，
    // 而真正被用上的往往只有 1-2 页。让「看全文」成为一个显式动作。
    const bodies = new Map();
    if (full) {
      const root = await findBrainRoot(process.cwd());
      if (root) {
        for (const p of lit) {
          const body = await fs.readFile(brainPath(root, p.dir, `${p.slug}.md`), 'utf8').catch(() => '');
          if (body) bodies.set(p.id, body);
        }
      }
    }

    out.push('', '--- 按亮度排序 ---');
    for (const p of lit) {
      // 亮度现在是 0.3~1.0（不再是早期可能到 165 万的异常值），
      // 条长按 1.0 满格算：0.3 → 4 格，1.0 → 12 格。
      const bar = '█'.repeat(Math.max(1, Math.round(Math.min(p.bright, 1) * 12)));
      const where = [p.project, p.dir, p.slug].filter(Boolean).join('/');
      const tag = p.from === 'spread' ? ' ↝' : '';
      // 跨项目的结果要显式标出来 —— 用户得知道「这条是别的项目的经验」，
      // 否则会以为是自己项目的结论（判据、上下文都可能不同）。
      const other = project && p.project && p.project !== project ? '  [跨项目]' : '';
      // 索引优先：给摘要 + 取全文成本，让「要不要看全文」成为一个可算的决定。
      const about = p.digest ? `\n            ${p.digest}` : '';
      const cost = p.tokens ? `  ~${p.tokens}tok` : '';
      // 作用分档（gotcha/decision/tradeoff/howto）—— 同层里「哪种更该先看」的线索
      const KIND_ICON = { gotcha: '🔴坑', decision: '🟤决策', tradeoff: '⚖️权衡', howto: '🔵做法' };
      const kind = p.kind && KIND_ICON[p.kind] ? `  ${KIND_ICON[p.kind]}` : '';
      out.push(`${bar} ${p.bright.toFixed(2)} L${p.layer} ${where}${tag}${other}${kind}${cost}${about}`);
      if (full && bodies.has(p.id)) {
        // 正文缩进显示，便于与索引行区分
        const body = bodies.get(p.id).replace(/^---[\s\S]*?---\n/, '');   // 去掉 frontmatter
        out.push(...body.split('\n').slice(0, 60).map((l) => `      │ ${l}`));
        if (body.split('\n').length > 60) out.push('      │ …（已截断，用 abs resolve 看全文）');
      }
    }
    if (noRules) {
      out.push('', '（↝ 表示由邻居扩散点亮，非直接命中；铁律已省略，开工时 abs load 会给）');
    } else {
      out.push('', '（L1 铁律恒在最前；↝ 表示由邻居扩散点亮，非直接命中）');
    }
    out.push(`（只给摘要与成本；要看全文: abs ${cmdName} <词> --full  或  abs resolve <页名>）`);
    if (project && !noRules) {
      out.push(`（铁律只显示本项目 "${project}" 的 —— 别的项目的铁律不外借）`);
    }
    return out.join('\n');
  } finally {
    h.close();
  }
}

/** `abs db status` —— 库的体检：计数、按层分布、项目列表、悬挂链接。 */
export async function cmdDbStatus() {
  const path = dbPath();
  const exists = await fs.stat(path).then(() => true).catch(() => false);
  if (!exists) return `库不存在: ${path}\n  先跑: abs db rebuild`;

  const h = openDb(path);
  try {
    const rebuilt = lastOpenRebuilt();
    const s = stats(h);
    const out = [
      `📀 库: ${path}`,
      ...(rebuilt ? ['⚠ 库文件曾损坏，已自动清空重建 —— 跑 abs db rebuild 恢复内容'] : []),
      `节点 ${s.nodes} | 边 ${s.edges} | 悬挂链接 ${s.dangling} | 断点词 ${s.anchors} | 铁律 ${s.rules}`,
      '',
      '--- 七层分布 ---',
    ];
    const byId = new Map(s.byLayer.map((r) => [r.layer, r.c]));
    for (const l of LAYERS) {
      const c = byId.get(l.id) ?? 0;
      if (l.id === 1) {
        out.push(`L1 ${l.name.padEnd(4)} ${String(s.rules).padStart(4)} 条（Rules 区，不立页）`);
        continue;
      }
      if (l.id === 6) {
        out.push(`L6 ${l.name.padEnd(4)} ${String(s.anchors).padStart(4)} 词（双链词，不立页）`);
        continue;
      }
      out.push(`L${l.id} ${l.name.padEnd(4)} ${String(c).padStart(4)} 页`);
    }
    const dangling = h.db.prepare('SELECT raw FROM edges WHERE dst = 0 ORDER BY raw').all();
    if (dangling.length) {
      out.push('', `--- 悬挂链接 ${dangling.length} 条（目标页不存在）---`);
      for (const d of dangling.slice(0, 10)) out.push(`  [[${d.raw}]]`);
      if (dangling.length > 10) out.push(`  …另有 ${dangling.length - 10} 条`);
    }
    const projects = h.db.prepare("SELECT DISTINCT project FROM nodes WHERE project != '' ORDER BY project").all();
    if (projects.length) {
      out.push('', `--- 已入库项目 ${projects.length} 个 ---`);
      for (const p of projects) out.push(`  ${p.project}`);
    }
    return out.join('\n');
  } finally {
    h.close();
  }
}

export { scanProject };

/**
 * 静默自动入库：写入类命令（capture / note / concept）收尾时调。
 *
 * 为何要它（2026-11-01 实测）：capture 落盘后不重建，检索就查不到刚写的东西 ——
 * 用户以为记下了，检索却空手而归，是静默失效。实测全量重建只要 0.07 秒（93 节点
 * 2 个项目），比做增量同步的复杂度便宜得多，故一律全量。
 *
 * 边界（关键）：
 *   · 永不抛错、永不阻塞主流程 —— 库坏了只是检索旧一点，不能让记笔记失败。
 *   · 库从没建过时不自动创建：那是用户没打算用库，静默建一个 ~/.abs/graph.db
 *     属于「没让做的事自己加戏」。只有库已存在才刷新。
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export async function autoIndex() {
  try {
    const path = dbPath();
    const exists = await fs.stat(path).then(() => true).catch(() => false);
    if (!exists) return { ok: false, reason: '库未建（跑 abs db rebuild 建）' };
    await cmdDbRebuildQuiet();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || '重建失败' };
  }
}

/** cmdDbRebuild 的静默版：只重建，不返回给人看的文案。 */
async function cmdDbRebuildQuiet() {
  const registered = await readProjects();
  const here = await findBrainRoot(process.cwd());
  const roots = [...new Set([...registered, ...(here ? [here] : [])])];
  if (!roots.length) return;
  const found = [];
  for (const root of roots) {
    const r = await findBrainRoot(root);
    if (r) found.push(r);
  }
  const uniq = [...new Set(found)];
  const names = uniqueProjectNames(uniq);
  const pages = [];
  for (const f of uniq) pages.push(...await scanProject(f, names.get(f)));
  if (!pages.length) return;
  const h = openDb(dbPath());
  try { rebuild(h, pages); } finally { h.close(); }
}

/** `abs db evolve` — 知识自我进化的体检：哪些被推翻、哪些堆积、哪些该合并。 */
export async function cmdDbEvolve({ staleDays = 90 } = {}) {
  const path = dbPath();
  const exists = await fs.stat(path).then(() => true).catch(() => false);
  if (!exists) return `库不存在: ${path}\n  先跑: abs db rebuild`;

  const h = openDb(path);
  try {
    const { evolveSignals, renderEvolve } = await import('./evolve.js');
    return renderEvolve(evolveSignals(h, { staleDays }), { staleDays });
  } finally {
    h.close();
  }
}
