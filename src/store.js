// src/store.js — CLI 命令实现：图谱读写层。
// 命令: init / board / status / load / task / query / lint
import { promises as fs } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { requireBrain, findBrainRoot, brainPath } from './index.js';
import { addTask, upsertTask, boardText, readTodo, ensureTodo, todoTemplate, today, localStamp, setBreakpoint, moveBlocked, insertDoneGrouped } from './todo.js';
import { editFile, SKIP } from './lock.js';
import { appendWrapup, strandedFor, wrapupLogPath } from './wrapup.js';

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
  const stranded = await strandedFor(root);
  const sections = [
    `📂 abs → 项目: ${root}`,
    '--- 当前路线 (index.md) ---',
    index || '(index.md 为空)',
    '',
    '--- Todo 看板 (todo.md) ---',
    todo.trim() || '(todo.md 为空)',
    '',
    '--- 最近动作 (log.md, 末尾 5 条) ---',
    tailLines(log, 5) || '(log.md 为空)',
  ];
  if (stranded.length) {
    const rows = stranded.map((t) => {
      const bp = t.bp.length ? `\n    ${t.bp.map((b) => `↳ 断点: ${b}`).join('\n    ')}` : '';
      return `  - ${t.body}${bp}`;
    });
    sections.splice(
      0, 1,
      `📂 abs → 项目: ${root}`,
      '⏳ 上会话滞留（未 done，先对账）',
      rows.join('\n'),
      '→ 完成: abs task done <id>；未完: abs task note <id> --note 断点',
      ''
    );
  }
  return sections.join('\n');
}

// ---------- wrapup: 滞留快照（B）/ load 内展示由 cmdLoad 完成（A） ----------
export async function cmdWrapup({ dir }) {
  const root = await requireBrain(dir || process.cwd());
  return appendWrapup(root);
}

/**
 * Stop hook 收尾注入判定 —— CC/Co​dex 的"主动推"。
 * 与 pi 插件四条件一致: ①本会话真改过文件 ②有 .brain ③log.md 今日无条目 ④每会话一次。
 * 输出给 shell: `push:<json>` = 注入, 其它 = 放行。JSON 走 stdout 回宿主的 decision:block。
 * 所有异常一律放行(`{}`), 绝不因判定失败而卡住用户会话。
 */
export async function cmdTeardownCheck({ dir, payload }) {
  try {
    let ev = {};
    try { ev = JSON.parse(payload || '{}'); } catch { ev = {}; }

    // 条件①: 本会话真改过文件。CC 的 Stop payload 不带工具足迹,
    // 故以 transcript_path 为准; 取不到就退化为"本项目今日是否已有产物"判断。
    const transcript = ev.transcript_path || ev.transcriptPath;
    if (transcript) {
      const txt = await readIfExists(transcript);
      const wrote = /"(Write|Edit|MultiEdit|NotebookEdit)"/.test(txt);
      if (!wrote) return '{}'; // 纯只读会话不打扰
    }

    // 条件②: 本项目有 .brain
    const dir0 = dir || ev.cwd || process.cwd();
    let root;
    try { root = await requireBrain(dir0); } catch { return '{}'; }

    // 条件③: log.md 今日尚无条目(条目头 '## [YYYY-MM-DD HH:MM]')
    const logTxt = await readIfExists(brainPath(root, 'log.md'));
    const stamp = localStamp();            // 'YYYY-MM-DD HH:MM'
    const day = stamp.slice(0, 10);
    if (new RegExp('^## \\[' + day + ' \\d{2}:\\d{2}\\]', 'm').test(logTxt)) return '{}';

    // 条件④: 每会话一次。
    // 双保险, 因为官方 stop_hook_active 有已知
    // 不传播 bug(claude-code#54360): 同一 turn 内重复 fire 时它仍是 false。
    // ① 官方契约: stop_hook_active=true = 本次 Stop 已是注入后的产物, 绝不再推(否则死循环)
    if (ev.stop_hook_active === true) return '{}';
    // ② 己方节流: 以 session_id 落 mark。缺 id 时退化为按项目+日期节流,
    //    绝不"无节流"——否则一旦宿主张不到 id, decision:block 就会无限自激。
    const sid = String(ev.session_id || ev.sessionId || '').replace(/[^\w-]/g, '');
    const key = sid || 'nosession-' + day + '-' + root.replace(/[^\w]/g, '_');
    const mark = join(homedir(), '.abs', 'log', `teardown-${key}.mark`);
    try {
      await fs.access(mark);
      return '{}'; // 本会话(或本项目今日)已推过
    } catch { /* 未推过 */ }
    await fs.mkdir(dirname(mark), { recursive: true });
    await fs.writeFile(mark, stamp).catch(() => {});

    const msg = [
      '[abs 收尾提醒] 本会话改过文件但 .brain/ 今天还没有记录。请立即走收尾循环：',
      '1) 跑 abs load 看 Today 还有哪些未完成；',
      '2) 实际做完漏登记的 abs task done <id>，做到一半的 abs task note <id> --note "断点"；',
      '3) 值得留的经验 abs note "..."（宁少勿滥，能从代码 grep 到的不记）；',
      '4) abs log "完成 X：..." 记一行工作成果，新页同步进 index。',
      '简洁执行，不要复述本条提醒。若本次确实没有可沉淀产出，直接回一句"无可沉淀"即可。',
    ].join('\n');

    // Cl​aude Code Stop hook 契约: {"decision":"block","reason":"..."} = 阻止结束并把 reason 回灌给 agent
    return 'push:' + JSON.stringify({ decision: 'block', reason: msg });
  } catch {
    return '{}'; // 永不阻塞宿主
  }
}

async function readIfExists(p) {
  try { return (await fs.readFile(p, 'utf8')).trim(); } catch { return ''; }
}

function tailLines(text, n) {
  const lines = text.split('\n').filter((l) => l.trim());
  return lines.slice(-n).join('\n');
}

// ---------- log: 追加工作成果沉淀摘要（用户/AI 主动 abs log "..." 记, 不收工具动作流水） ----------
export async function cmdLog({ dir, title, kind = 'dev' }) {
  const root = await requireBrain(dir || process.cwd());
  const p = brainPath(root, 'log.md');
  const stamp = localStamp();
  const clean = String(title || '').replace(/\n/g, ' ').slice(0, 100); // 整行含前缀 ≤120
  const line = `## [${stamp}] ${kind} | ${clean}`;
  await editFile(p, (cur) => {
    const text = cur ?? '# 🗒 操作日志\n';
    // 倒序：新行插在标题后（若已是模板占位行则替换它）
    const lines = text.split('\n');
    const headerIdx = lines.findIndex((l) => l.startsWith('#'));
    lines.splice(headerIdx + 1, 0, line);
    return { text: lines.join('\n') };
  });
  return `✓ log → ${p}\n  ${line}`;
}

// ---------- task: 登记/推进（幂等键 = 行首 id；hook 也调这个） ----------
// 纪律: task 过程动作(start/done/note/blocked)只改 todo.md, 不写 log.md。
// log.md 是「工作成果沉淀摘要」(用户/AI 主动 abs log "..." 记), 不收工具动作流水。
export async function cmdTask({ dir, action, id, section, note }) {
  const root = await requireBrain(dir || process.cwd());
  if (action === 'start') {
    const text = `${id}${note ? ' — ' + note : ''}`;
    const r = await upsertTask(root, {
      section: section || 'Today / In Progress',
      text: `${text} (认领 ${today()})`,
    });
    return `✓ 任务${r.updated ? '更新(幂等)' : '登记'} → ${brainPath(root, 'todo.md')}\n  ${id}${note ? ' — ' + note : ''}`;
  }
  if (action === 'blocked') {
    const r = await moveBlocked(root, { id, reason: note });
    return r.msg;
  }
  if (action === 'note') {
    if (!note) return '用法: abs task note <id> --note "断点/进度"（实时落 ↳ 断点 行）';
    const r = await setBreakpoint(root, { id, text: note });
    return r.msg;
  }
  if (action === 'done') {
    // 找到匹配 id 的行，勾选并归位 Done（简化：若行在某 section 则标记完成）
    const res = await markDone(brainPath(root, 'todo.md'), id);
    return res;
  }
  throw new Error(`unknown task action: ${action}`);
}

async function markDone(file, id) {
  const res = await editFile(file, (text) => {
    const lines = text.split('\n');
    let changed = false;
    let moved = null;
    const kept = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!moved && l.startsWith('- [ ]') && l.includes(id)) {
        changed = true;
        const head = l.replace('- [ ]', '- [x]').replace(/\(认领[^)]*\)/, '') + ` (完成 ${today()})`;
        const bp = [];
        while (i + 1 < lines.length && lines[i + 1].trimStart().startsWith('↳')) bp.push(lines[++i]);
        moved = [head, ...bp];
        continue;
      }
      kept.push(l);
    }
    if (!changed || !moved) return SKIP;
    // 归位 + 按日期分组：insertDoneGrouped 一次重建 Done 区（新日期在前，未标日期归尾）
    return { text: insertDoneGrouped(kept.join('\n'), moved) };
  });
  return res === SKIP
    ? `(未找到含 "${id}" 的未完成任务行)`
    : `✓ 已完成并归位 Done: ${id}`;
}

// ---------- show: 查看 index/todo/log（只读面） ----------
export async function cmdShow({ dir, view }) {
  const v = String(view || '').toLowerCase();
  if (!['todo', 'index', 'log'].includes(v)) {
    return '用法: abs <todo|index|log>  — todo=看板(原 board), index=图谱索引, log=操作流水';
  }
  const root = await requireBrain(dir || process.cwd());
  const p = brainPath(root, `${v === 'todo' ? 'todo' : v}.md`);
  // todo 走 readTodo（含老格式惰性迁移写回）；index/log 直接读
  let text;
  try {
    text = v === 'todo'
      ? await readTodo(root)          // 迁移老格式 In Progress/Todo → B4
      : (await fs.readFile(p, 'utf8')).trim();
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
  // 源文件是新写唯一文件：tmp+rename 原子落盘（避免并发读读到半写文件）
  const srcFile = join(srcDir, file);
  const tmp = join(srcDir, `.${file}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, srcFile);
  // index Sources 区登记（锁内幂等：别页已登记则跳过，防并发重复） + log 一行
  const iP = brainPath(root, 'index.md');
  const slug = file.replace(/\.md$/, '');
  const line = `- [[${slug}]] — ${clean.slice(0, 40)}`;
  await editFile(iP, (index) => {
    if (!index || index.includes(`[[${slug}]]`)) return SKIP;
    const sIdx = index.indexOf('## Sources');
    if (sIdx === -1) return SKIP;
    const after = index.indexOf('\n## ', sIdx + 1);
    const next = after === -1
      ? `${index.replace(/\s*$/, '')}\n${line}\n`
      : index.slice(0, after) + `\n${line}` + index.slice(after);
    return { text: next };
  });
  await cmdLog({ dir: root, title: clean.slice(0, 60), kind: 'note' });
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
  // index.md 里列的 [[x]] —— 用于反向查死引用（列了但页不存在）
  let indexLinks = [];
  try {
    const idx = await fs.readFile(join(vault, 'index.md'), 'utf8');
    indexLinks = [...idx.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());
  } catch { /* 无 index 则不查 */ }
  const issues = [];

  for (const pg of pages) {
    if (!pg.hasFrontmatter) issues.push(`NO-FRONTMATTER: ${pg.rel}`);
    for (const ln of pg.links) {
      if (/slug|Name|name|Date|页面名$/.test(ln)) issues.push(`TEMPLATE-LINK: ${pg.rel} -> [[${ln}]]`);
      if (!names.has(ln)) issues.push(`DEAD-LINK: ${pg.rel} -> [[${ln}]]`);
    }
    // ORPHAN: sources/ 暂存页豁免（暂存线索天然孤立，提炼成 concept 前不强制挂链）
    if (pg.dir !== 'sources' && !pg.links.length && !linkedNames.has(pg.slug)) {
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

  // index.md 反向检查: 列了 [[x]] 但 x 页不存在 —— 删页/归档 source 后忘了清 index 的残留。
  // (page→index 的 INDEX-MISSING 已有, 这里补 index→page, 否则死引用静默留在入口文件里)
  for (const ln of indexLinks) {
    if (/slug|Name|name|Date|页面名$/.test(ln)) continue; // 模板占位行
    if (!names.has(ln)) issues.push(`INDEX-DEAD-LINK: index.md -> [[${ln}]] (该页不存在, 删页后忘清 index?)`);
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
