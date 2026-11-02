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

  const pages = [];
  const used = [];
  for (const root of roots) {
    const found = await findBrainRoot(root);
    if (!found) continue;                       // 登记了但目录没了 → 跳过，不报错
    const project = projectNameOf(found);
    pages.push(...await scanProject(found, project));
    used.push(`${project} (${found})`);
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
export async function cmdDbSearch({ query, limit = 8 } = {}) {
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

    const out = [`db search [${q}] → 种子 ${seeds.length} 条，亮起 ${lit.length} 页`];
    if (rules.length) {
      out.push('', `--- L1 铁律 ${rules.length} 条（任何检索先出）---`);
      for (const r of rules) out.push(`- ${r}`);
    }
    if (!lit.length) {
      out.push('', lastOpenRebuilt()
        ? '（库文件曾损坏被清空，现在没有内容：跑 abs db rebuild 重建）'
        : '（无命中。库可能是旧的：abs db rebuild 重扫）');
      return out.join('\n');
    }
    out.push('', '--- 按亮度排序 ---');
    for (const p of lit) {
      const bar = '█'.repeat(Math.max(1, Math.round(Math.min(p.bright, 3) / 3 * 12)));
      const where = [p.project, p.dir, p.slug].filter(Boolean).join('/');
      const tag = p.from === 'spread' ? ' ↝' : '';
      // 跨项目的结果要显式标出来 —— 用户得知道「这条是别的项目的经验」，
      // 否则会以为是自己项目的结论（判据、上下文都可能不同）。
      const other = project && p.project && p.project !== project ? '  [跨项目]' : '';
      out.push(`${bar} ${p.bright.toFixed(2)} L${p.layer} ${where}${tag}${other}`);
    }
    out.push('', '（L1 铁律恒在最前；↝ 表示由邻居扩散点亮，非直接命中）');
    if (project) {
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
  const pages = [];
  for (const root of roots) {
    const found = await findBrainRoot(root);
    if (!found) continue;
    pages.push(...await scanProject(found, projectNameOf(found)));
  }
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
