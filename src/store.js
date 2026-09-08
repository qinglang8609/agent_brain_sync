// src/store.js — CLI 命令实现：图谱读写层。
// 命令: init / board / status / load / task / query / lint
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { requireBrain, findBrainRoot, brainPath } from './index.js';
import { addTask, upsertTask, boardText, readTodo, ensureTodo, todoTemplate, today, setBreakpoint, moveBlocked } from './todo.js';

// ---------- init: 建 .brain/ 骨架 ----------
const BRAIN_DIRS = ['entities', 'concepts', 'sources', 'syntheses', 'sessions'];
const BRAIN_FILES = ['index.md', 'log.md', 'todo.md'];

export async function cmdInit({ dir }) {
  const root = resolveProjectDir(dir);
  const brain = join(root, '.brain');
  try {
    await fs.access(brain);
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e;
    return createSkeleton(root, brain);
  }
  // 已存在 → 校验结构完整性；损坏则明确报错并指引 repair（不静默半初始化）
  const report = await reportBrain({ dir: root });
  if (report.ok) throw new Error(`已存在: ${brain} (abort)`);
  throw new Error(
    `已存在但结构不完整:\n  ${report.problems.join('\n  ')}\n` +
    `  → 轻则补齐: abs init --repair    重则重建: 删掉 ${brain} 后重跑 abs init`
  );
}

async function createSkeleton(root, brain) {
  for (const d of BRAIN_DIRS) await fs.mkdir(join(brain, d), { recursive: true });
  await fs.writeFile(join(brain, 'index.md'), indexTemplate(), 'utf8');
  await fs.writeFile(join(brain, 'log.md'), logTemplate(), 'utf8');
  await fs.writeFile(join(brain, 'todo.md'), todoTemplate(), 'utf8');
  return `✓ 已建图谱 ${brain}\n  (模板见 SKILL.md「文件标准」)`;
}

/** 结构体检：6 目录 + 3 文件逐一核对。ok=false 时 problems 列出缺失项。 */
export async function reportBrain({ dir }) {
  const root = resolveProjectDir(dir);
  const brain = join(root, '.brain');
  const problems = [];
  for (const d of BRAIN_DIRS) {
    try {
      const st = await fs.stat(join(brain, d));
      if (!st.isDirectory()) problems.push(`缺目录 ${d}/ (被文件占位)`);
    } catch {
      problems.push(`缺目录 ${d}/`);
    }
  }
  for (const f of BRAIN_FILES) {
    try {
      await fs.access(join(brain, f));
    } catch {
      problems.push(`缺文件 ${f}`);
    }
  }
  return { ok: problems.length === 0, problems, brain };
}

/** init --repair: 只补缺失骨架，绝不覆盖已有文件。 */
export async function cmdRepair({ dir }) {
  const root = resolveProjectDir(dir);
  const brain = join(root, '.brain');
  try {
    await fs.access(brain);
  } catch {
    return createSkeleton(root, brain); // 整个图谱都没有 = 全新建
  }
  const fixed = [];
  for (const d of BRAIN_DIRS) {
    try {
      const st = await fs.stat(join(brain, d));
      if (!st.isDirectory()) {
        await fs.rm(join(brain, d), { force: true });
        await fs.mkdir(join(brain, d), { recursive: true });
        fixed.push(`${d}/`);
      }
    } catch {
      await fs.mkdir(join(brain, d), { recursive: true });
      fixed.push(`${d}/`);
    }
  }
  for (const [f, tpl] of [['index.md', indexTemplate], ['log.md', logTemplate], ['todo.md', todoTemplate]]) {
    try {
      await fs.access(join(brain, f));
    } catch {
      await fs.writeFile(join(brain, f), tpl(), 'utf8');
      fixed.push(f);
    }
  }
  if (!fixed.length) return `✓ 结构完整，无需修复: ${brain}`;
  return `✓ 已补齐 ${fixed.join(', ')} → ${brain}\n  (已有文件一律不覆盖)`;
}

function resolveProjectDir(dir) {
  if (!dir) return process.cwd();
  return resolve(dir);
}

export function indexTemplate() {
  return [
    '# 🗂 图谱索引',
    '',
    '本文件唯一入口。每新建/大改一页，同步在此分类下加一行 [[页面名]] — 一句话。',
    '',
    '## 当前路线 (Roadmap)',
    '## Concepts',
    '## Entities',
    '## Sources',
    '## Syntheses',
    '## Sessions',
    '',
  ].join('\n');
}

export function logTemplate() {
  return ['# 🗒 操作日志', '', '## [YYYY-MM-DD] ingest | 沉淀 <slug>', ''].join('\n');
}

// ---------- board: 看板 ----------
export async function cmdBoard({ dir }) {
  const root = await requireBrain(dir || process.cwd());
  return boardText(root);
}

// ---------- status: 定位报告 + 图谱概要 ----------
export async function cmdStatus({ dir }) {
  const root = await requireBrain(dir || process.cwd());
  const entries = await listBrainFiles(root);
  return [
    `📂 abs → 项目: ${root}`,
    `图谱: ${brainPath(root)}`,
    '',
    entries.length ? entries.join('\n') : '(图谱为空)',
  ].join('\n');
}

async function listBrainFiles(root) {
  const out = [];
  const dirs = ['concepts', 'entities', 'sources', 'syntheses', 'sessions'];
  for (const d of dirs) {
    const p = brainPath(root, d);
    try {
      const files = (await fs.readdir(p)).filter((f) => f.endsWith('.md'));
      out.push(`${d}/: ${files.length} 页`);
    } catch { out.push(`${d}/: 0 页`); }
  }
  return out;
}

// ---------- load: 开机读状态 ----------
export async function cmdLoad({ dir }) {
  const root = await requireBrain(dir || process.cwd());
  const todo = await readTodo(root);
  const index = await readIfExists(brainPath(root, 'index.md'));
  const log = await readIfExists(brainPath(root, 'log.md'));
  return [
    `📂 abs → 项目: ${root}`,
    '--- 当前路线 (index.md) ---',
    index || '(index.md 为空)',
    '',
    '--- Todo 看板 (todo.md) ---',
    todo.trim() || '(todo.md 为空)',
    '',
    '--- 最近动作 (log.md, 末尾 5 条) ---',
    tailLines(log, 5) || '(log.md 为空)',
  ].join('\n');
}

async function readIfExists(p) {
  try { return (await fs.readFile(p, 'utf8')).trim(); } catch { return ''; }
}

function tailLines(text, n) {
  const lines = text.split('\n').filter((l) => l.trim());
  return lines.slice(-n).join('\n');
}

// ---------- log: 追加一行活动流水（默认 hook 前缀；也可 task/note 调用方指定 kind） ----------
export async function cmdLog({ dir, title, kind = 'hook' }) {
  const root = await requireBrain(dir || process.cwd());
  const p = brainPath(root, 'log.md');
  let text = '';
  try { text = await fs.readFile(p, 'utf8'); } catch { text = '# 🗒 操作日志\n'; }
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const clean = String(title || '').replace(/\n/g, ' ').slice(0, 100); // 整行含前缀 ≤120
  const line = `## [${stamp}] ${kind} | ${clean}`;
  // 倒序：新行插在标题后（若已是模板占位行则替换它）
  const lines = text.split('\n');
  const headerIdx = lines.findIndex((l) => l.startsWith('#'));
  lines.splice(headerIdx + 1, 0, line);
  await fs.writeFile(p, lines.join('\n'), 'utf8');
  return `✓ log → ${p}\n  ${line}`;
}

// ---------- task: 登记/推进（幂等键 = 行首 id；hook 也调这个） ----------
// 每次成功的 task 操作都在 log.md 留一行活动（倒序流水），格式: [time] task | <action> <id> [note摘要]
async function taskLog(root, action, id, note) {
  try {
    await cmdLog({ dir: root, title: `${action} ${id}${note ? ' — ' + note.slice(0, 50) : ''}`, kind: 'task' });
  } catch { /* 日志失败不影响 task 主操作 */ }
}

export async function cmdTask({ dir, action, id, section, note }) {
  const root = await requireBrain(dir || process.cwd());
  if (action === 'start') {
    const text = `${id}${note ? ' — ' + note : ''}`;
    const r = await upsertTask(root, {
      section: section || 'Today / In Progress',
      text: `${text} (认领 ${today()})`,
    });
    await taskLog(root, action, id, note);
    return `✓ 任务${r.updated ? '更新(幂等)' : '登记'} → ${brainPath(root, 'todo.md')}\n  ${id}${note ? ' — ' + note : ''}`;
  }
  if (action === 'blocked') {
    const r = await moveBlocked(root, { id, reason: note });
    if (r.ok) await taskLog(root, action, id, note);
    return r.msg;
  }
  if (action === 'note') {
    if (!note) return '用法: abs task note <id> --note "断点/进度"（实时落 ↳ 断点 行）';
    const r = await setBreakpoint(root, { id, text: note });
    if (r.ok) await taskLog(root, action, id, note);
    return r.msg;
  }
  if (action === 'done') {
    // 找到匹配 id 的行，勾选并归位 Done（简化：若行在某 section 则标记完成）
    const res = await markDone(brainPath(root, 'todo.md'), id);
    // markDone 成功时才记 log（避免把"未找到"当完成）
    if (res.startsWith('✓')) await taskLog(root, action, id, note);
    return res;
  }
  throw new Error(`unknown task action: ${action}`);
}

async function markDone(file, id) {
  const text = await fs.readFile(file, 'utf8');
  const lines = text.split('\n');
  const doneIdx = lines.findIndex((l) => l.startsWith('## Done'));
  let changed = false;
  const kept = [];
  const moved = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('- [ ]') && l.includes(id)) {
      changed = true;
      moved.push(l.replace('- [ ]', '- [x]').replace(/\(认领[^)]*\)/, '') + ` (完成 ${today()})`);
      // 附属断点行随任务行一起归位
      while (i + 1 < lines.length && lines[i + 1].startsWith('↳')) moved.push(lines[++i]);
      continue;
    }
    kept.push(l);
  }
  if (!changed) return `(未找到含 "${id}" 的未完成任务行)`;
  // 归位: 移入 Done 区标题后（无 Done 区则追加文件尾）
  const out = doneIdx === -1
    ? [...kept, ...moved]
    : [...kept.slice(0, doneIdx + 1), ...moved, ...kept.slice(doneIdx + 1)];
  await fs.writeFile(file, out.join('\n'), 'utf8');
  return `✓ 已完成并归位 Done: ${id}`;
}

// ---------- show: 查看 index/todo/log（只读面） ----------
export async function cmdShow({ dir, view }) {
  const v = String(view || '').toLowerCase();
  if (!['todo', 'index', 'log'].includes(v)) {
    return '用法: abs <todo|index|log>  — todo=看板(原 board), index=图谱索引, log=操作流水';
  }
  const root = await requireBrain(dir || process.cwd());
  const p = brainPath(root, `${v === 'todo' ? 'todo' : v}.md`);
  let text;
  try {
    text = (await fs.readFile(p, 'utf8')).trim();
  } catch {
    return `${v}.md 不存在于 ${brainPath(root)}。初始化/补齐: abs init --repair`;
  }
  if (!text) return `(${v}.md 为空)`;
  return v === 'todo' ? boardText(root, text) : text;
}
// ---------- query: 检索知识图谱（多词 OR，扫全 .md 页） ----------
const KNOWN_SLUG_HINT = /模板残留|\[\[slug\]\]/;

export async function cmdQuery({ dir, terms }) {
  const words = (terms || []).map((w) => String(w).trim()).filter(Boolean);
  if (!words.length) {
    return '用法: abs query <词1> [词2 …]  — 多词 OR 检索 .brain/ 全部知识页';
  }
  let root;
  try {
    root = await requireBrain(dir || process.cwd());
  } catch {
    return `未找到 .brain/ 图谱（无记忆可查）。先在项目根运行: abs init`;
  }
  const hits = [];
  const dirs = ['concepts', 'entities', 'sources', 'syntheses', 'sessions'];
  for (const d of dirs) {
    const p = brainPath(root, d);
    let files;
    try {
      files = await fs.readdir(p);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      const full = join(p, f);
      const body = await fs.readFile(full, 'utf8').catch(() => '');
      const matched = words.filter((w) => body.toLowerCase().includes(w.toLowerCase()));
      if (matched.length) {
        hits.push({ full, slug: f.replace(/\.md$/, ''), matched, snippet: firstHitLine(body, words) });
      }
    }
  }
  if (!hits.length) return `query [${words.join(', ')}]: 无命中。用 abs lint 看图谱健康；首次使用先 abs init。`;
  const lines = hits.map((h) => `📄 ${h.slug}  (命中: ${h.matched.join(', ')})\n    ${h.snippet}`);
  return [`query [${words.join(', ')}] → ${hits.length} 页:`, '', ...lines].join('\n');
}

function firstHitLine(body, words) {
  const lower = body.toLowerCase();
  for (const line of body.split('\n')) {
    const l = line.toLowerCase();
    if (words.some((w) => l.includes(w.toLowerCase())) && line.trim() && !KNOWN_SLUG_HINT.test(line)) {
      return line.trim().slice(0, 100);
    }
  }
  return '';
}

// ---------- note: 经验实时暂存（source 页，一念一落，防流失） ----------
const NOTE_DEDUP_MS = 60 * 1000;

export async function cmdNote({ dir, text, tags }) {
  const clean = String(text || '').trim();
  if (!clean) return '用法: abs note "经验/坑/技巧一句话"（落 sources/ 暂存页，实时不流失）';
  let root;
  try {
    root = await requireBrain(dir || process.cwd());
  } catch {
    return `未找到 .brain/ 图谱。先在项目根运行: abs init`;
  }
  const srcDir = brainPath(root, 'sources');
  await fs.mkdir(srcDir, { recursive: true });
  // 幂等: 同文本 60s 内只落一份
  const existing = (await fs.readdir(srcDir).catch(() => [])).filter((f) => f.endsWith('.md'));
  for (const f of existing) {
    const body = await fs.readFile(join(srcDir, f), 'utf8').catch(() => '');
    if (body.includes(clean)) {
      return `• 60s 内已落同文本 → ${f} (跳过重复)`;
    }
  }
  const tagList = String(tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  const fmTags = ['source', ...tagList].join(', ');
  const slugSrc = clean.slice(0, 24).replace(/[^\w一-鿿]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  const file = `${today()}-${slugSrc || 'note'}.md`;
  const body = [
    '---',
    `tags: [${fmTags}]`,
    `updated: ${today()}`,
    'status: draft',
    '---',
    '',
    `# 来源：${clean.slice(0, 40)}`,
    '',
    `## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）`,
    `- ${clean}`,
    '',
    '## 关联连接',
    '（提炼成 concepts 规律页后，在此挂双链到该页）',
    '',
  ].join('\n');
  await fs.writeFile(join(srcDir, file), body, 'utf8');
  // index Sources 区登记 + log 一行（与 Teardown 步骤 7 一致）
  const iP = brainPath(root, 'index.md');
  let index = await fs.readFile(iP, 'utf8').catch(() => '');
  if (index && !index.includes(`[[${file.replace(/\.md$/, '')}]]`)) {
    const sIdx = index.indexOf('## Sources');
    if (sIdx !== -1) {
      const line = `- [[${file.replace(/\.md$/, '')}]] — ${clean.slice(0, 40)}`;
      const after = index.indexOf('\n## ', sIdx + 1);
      index = after === -1
        ? index.replace(/$/, `\n${line}`)
        : index.slice(0, after) + `\n${line}` + index.slice(after);
      await fs.writeFile(iP, index, 'utf8');
    }
  }
  await cmdLog({ dir: root, title: `note | ${clean.slice(0, 60)}` });
  return `✓ 经验暂存 → sources/${file}\n  ${clean.slice(0, 60)}`;
}
// ---------- lint: 体检（与 scripts/lint.sh 同规则的 Node 版，供 CLI/MCP 直调） ----------
export async function cmdLint({ dir }) {
  let root;
  try {
    root = await requireBrain(dir || process.cwd());
  } catch {
    return `未找到 .brain/ 图谱。先在项目根运行: abs init`;
  }
  const vault = brainPath(root);
  const pages = await listPages(vault);
  const names = new Set(pages.map((p) => p.slug));
  const linkedNames = new Set(pages.flatMap((p) => p.links));
  const issues = [];

  for (const pg of pages) {
    if (!pg.hasFrontmatter) issues.push(`NO-FRONTMATTER: ${pg.rel}`);
    for (const ln of pg.links) {
      if (/slug|Name|name|Date|页面名$/.test(ln)) issues.push(`TEMPLATE-LINK: ${pg.rel} -> [[${ln}]]`);
      if (!names.has(ln)) issues.push(`DEAD-LINK: ${pg.rel} -> [[${ln}]]`);
    }
    if (!pg.links.length && !linkedNames.has(pg.slug)) {
      issues.push(`ORPHAN-PAGE: ${pg.rel} (no links out, no links in)`);
    }
    if (/知识冲突/.test(pg.body) && /status: draft/.test(pg.frontmatter)) {
      issues.push(`UNRESOLVED-CONFLICT: ${pg.rel}`);
    }
    if (['concepts', 'entities', 'syntheses'].includes(pg.dir)) {
      if (pg.lines > 150 || pg.bytes > 5 * 1024) {
        issues.push(`OVER-SIZE: ${pg.rel} (${pg.lines}L/${pg.bytes}B > 150L/5120B; 拆或外链)`);
      }
    }
    if (pg.dir !== 'sources' && !pg.indexed) {
      issues.push(`INDEX-MISSING: ${pg.rel} not listed as [[${pg.slug}]] in index.md`);
    }
  }

  const nsrc = pages.filter((p) => p.dir === 'sources').length;
  if (nsrc > 10) issues.push(`SOURCES-PILED-UP: sources/ has ${nsrc} files > 10; 提炼归档旧 source`);

  const n = issues.length;
  return [
    ...(issues.length ? issues : []),
    '',
    `lint: ${n} problem(s).`,
    n === 0 ? '✓ 图谱健康' : '',
  ].filter(Boolean).join('\n');
}

const PAGE_DIRS = ['entities', 'concepts', 'sources', 'syntheses', 'sessions'];

async function listPages(vault) {
  let indexText = '';
  try {
    indexText = await fs.readFile(join(vault, 'index.md'), 'utf8');
  } catch { /* no index yet */ }
  const pages = [];
  for (const d of PAGE_DIRS) {
    const dp = join(vault, d);
    let files;
    try {
      files = await fs.readdir(dp);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      const full = join(dp, f);
      const body = await fs.readFile(full, 'utf8').catch(() => '');
      const fm = body.match(/^---\n([\s\S]*?)\n---/);
      const links = [...new Set([...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].split('|')[0]))];
      pages.push({
        dir: d,
        rel: `${d}/${f}`,
        slug: f.replace(/\.md$/, ''),
        body,
        frontmatter: fm ? fm[1] : '',
        hasFrontmatter: body.startsWith('---\n'),
        links,
        lines: body.split('\n').length,
        bytes: Buffer.byteLength(body, 'utf8'),
        indexed: indexText.includes(`[[${f.replace(/\.md$/, '')}]]`),
      });
    }
  }
  return pages;
}
