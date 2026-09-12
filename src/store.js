// src/store.js — CLI 命令实现：图谱读写层。
// 命令: init / board / status / load / task / query / lint
import { promises as fs } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { requireBrain, brainPath, absLogDir, BRAIN_DIR } from './index.js';
import { requireUser, atTag, getUser } from './userconfig.js';
import { addTask, upsertTask, boardText, readTodo, ensureTodo, todoTemplate, today, localStamp, setBreakpoint, moveBlocked, insertDoneGrouped, idOfTaskLine, archiveDoneInText, renderArchivePage, renderArchiveBody, DONE_KINDS, withDoneKind, doneKindOf } from './todo.js';
import { editFile, SKIP } from './lock.js';
import { appendWrapup, strandedFor } from './wrapup.js';

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
  // 建完就提示设姓名 —— 否则用户一路到第一次 todo add 才撞墙，
  // 中间 init/load 都不提，根本不知道该设。
  const who = await getUser();
  const hint = who ? '' : `\n  ⚠ 尚未设置使用者姓名，写操作(todo add/log/note)会先报错。\n    请先设置: abs config set user <你的名字>`;
  return `✓ 已建图谱 ${brain}\n  (模板见 SKILL.md「文件标准」)${hint}`;
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
  // 必须显式回退 cwd: resolve(undefined) 会抛 ERR_INVALID_ARG_TYPE，
  // 并不像看上去那样「自动回退」。曾误删此分支为 resolve(dir)，把 abs init/load/board
  // 不带 --dir 全部变成裸栈崩溃。
  return resolve(dir || process.cwd());
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
  ];
  // 未设姓名时开场就提醒 —— load 是开机第一屏，不在这里提，
  // 用户要撞到第一次写操作才知道（init/load 一路沉默）。
  if (!(await getUser())) {
    sections.push(
      '⚠ 尚未设置使用者姓名（写操作会先报错）',
      '→ abs config set user <你的名字>    (或临时: ABS_USER=<名字> abs ...)',
      ''
    );
  }
  sections.push(
    '--- 当前路线 (index.md) ---',
    index || '(index.md 为空)',
    '',
    '--- Todo 看板 (todo.md) ---',
    todo.trim() || '(todo.md 为空)',
    '',
    '--- 最近动作 (log.md, 最新 5 条) ---',
    recentLogLines(log, 5) || '(log.md 为空)',
  );
  if (stranded.length) {
    const rows = stranded.map((t) => {
      const bp = t.bp.length ? `\n    ${t.bp.map((b) => `↳ 断点: ${b}`).join('\n    ')}` : '';
      return `  - ${t.body}${bp}`;
    });
    // 插在项目行之后、其它内容之前
    sections.splice(
      1, 0,
      '⏳ 上会话滞留（未 done，先对账）',
      rows.join('\n'),
      '→ 完成: abs todo done <id>；未完: abs todo note <id> --note 断点',
      ''
    );
  }
  return sections.join('\n');
}

// ---------- wrapup: 滞留快照（B）/ load 内展示由 cmdLoad 完成（A） ----------
export async function cmdWrapup({ dir }) {
  const root = await requireBrain(dir || process.cwd());
  const snap = await appendWrapup(root);
  // 顺手做 Done 归档。**不引入 cron/定时器**：Stop hook 已经会在会话结束时调
  // `abs wrapup`，直接复用这个触发点（零新基础设施、零新失败面）。
  // 只对「超过保留天数 且 整天都已完成」的日期组动手，平时无动作。
  // 本函数 stdout 会被 hook 追写到 ~/.abs/log/hooks.log → 归档动作自动留痕。
  let arch = '';
  try {
    const a = await cmdTodoArchive({ dir: root, keepDays: 3 });
    if (a.startsWith('✓')) arch = '\n' + a;
  } catch { /* 归档失败不影响快照本身 */ }
  return snap + arch;
}

/**
 * `abs todo archive` —— 把 Done 区里「超过保留天数 且 整天都已完成」的日期组迁到归档页。
 * 规则见 `archiveDoneInText`（① 只留近 N 天 ② 任一天有未完成则整天不归档 ③ 归档成一个文件
 * 并在 Done 区尾部 `### 归档` 记 `- [[slug]] 完成任务 N 条`）。
 * 幂等：同日重跑 = 追写到同一归档页 + 就地更新标记行。
 */
export async function cmdTodoArchive({ dir, keepDays = 3, dryRun = false } = {}) {
  let root;
  try { root = await requireBrain(dir || process.cwd()); } catch { return '未找到 .brain/ 图谱。先在项目根运行: abs init'; }
  const days = Math.max(1, Number(keepDays) || 3);
  const todoP = brainPath(root, 'todo.md');
  const raw = await fs.readFile(todoP, 'utf8').catch(() => '');
  if (!raw.trim()) return '（todo.md 为空）';

  const plan = archiveDoneInText(raw, { keepDays: days, from: today() });
  const why = plan.skipped.length
    ? `\n  跳过: ${plan.skipped.map((s) => `${s.date}（${s.reason}）`).join('；')}`
    : '';
  if (!plan.archived.length) return `（无可归档：保留近 ${days} 天）${why}`;
  const brief = plan.archived.map((g) => `${g.date}(${g.count})`).join(' ');
  if (dryRun) {
    return `[dry-run] 将归档 ${plan.archived.length} 天 / ${plan.count} 条（每天一个文件）\n  ${brief}${why}`;
  }

  // 1) 归档页：**每天一个文件**，文件名用被归档那天的日期（便于按天回溯）。
  //    同一天再次归档（罕见：该日组已被移走，除非有人重新补当天任务）则追写正文。
  const sessDir = brainPath(root, 'sessions');
  for (const g of plan.archived) {
    const pageP = join(sessDir, `${g.slug}.md`);
    let page = null;
    try { page = await fs.readFile(pageP, 'utf8'); } catch { /* 首次 */ }
    const nextPage = page == null
      ? renderArchivePage({ group: g })
      : page.replace(/\s*$/, '') + '\n\n' + renderArchiveBody([g]) + '\n';
    const tmp = join(sessDir, `.${g.slug}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await fs.writeFile(tmp, nextPage, 'utf8');
    await fs.rename(tmp, pageP);
  }

  // 2) todo.md：锁内重算（拿最新内容，避免与并发 done 互相覆盖）
  await editFile(todoP, (cur) => {
    const p2 = archiveDoneInText(cur ?? '', { keepDays: days, from: today() });
    return p2.archived.length ? { text: p2.text } : SKIP;
  });

  // 3) index 登记（每个日期页一行，幂等）
  const iP = brainPath(root, 'index.md');
  await editFile(iP, (index) => {
    if (!index) return SKIP;
    const missing = plan.archived.filter((g) => !index.includes(`[[${g.slug}]]`));
    if (!missing.length) return SKIP;
    const sIdx = index.indexOf('## Sources');
    if (sIdx === -1) return SKIP;
    const after = index.indexOf('\n## ', sIdx + 1);
    const add = missing.map((g) => `- [[${g.slug}]] — Todo 归档：${g.date}，共 ${g.count} 条已完成任务`).join('\n');
    const next = after === -1
      ? `${index.replace(/\s*$/, '')}\n${add}\n`
      : index.slice(0, after) + `\n${add}` + index.slice(after);
    return { text: next };
  });

  const files = plan.archived.map((g) => `sessions/${g.slug}.md`).join('\n  ');
  return `✓ 已归档 ${plan.archived.length} 天 / ${plan.count} 条\n  ${brief}\n  → ${files}${why}`;
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
    const mark = join(absLogDir(), `teardown-${key}.mark`);
    try {
      await fs.access(mark);
      return '{}'; // 本会话(或本项目今日)已推过
    } catch { /* 未推过 */ }
    await fs.mkdir(dirname(mark), { recursive: true });
    await fs.writeFile(mark, stamp).catch(() => {});

    const msg = [
      // 未设姓名时把设置指令插到第0条 —— 否则后续 todo add/log/note 全会被守卫拦下，
    // 而收尾提醒本身不提这事，使用者只会看到一连串报错。
    (await getUser() ? [] : [
      '0) 本机尚未设置使用者姓名 —— 先跑 abs config set user <你的名字>，否则下面 2/3/4 都会被拦下；',
    ]),
    '[abs 收尾提醒] 本会话改过文件但 .brain/ 今天还没有记录。请立即走收尾循环：',
      '1) 跑 abs load 看 Today 还有哪些未完成；',
      '2) 实际做完漏登记的 abs todo done <id>，做到一半的 abs todo note <id> --note "断点"；',
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

/** log.md 是"新在上"（cmdLog 把新行插在标题后）——取**最新** n 条，只认 `## [` 条目行。
 * 坑: 曾用 tailLines 取末尾 → 拿到的永远是最旧几条，而标签写着"最近动作"，
 * 于是"开机读状态"最该看的一节长期显示两天前的旧记录（今天的新条目从未显示）。 */
function recentLogLines(text, n) {
  return String(text || '')
    .split('\n')
    .filter((l) => /^##\s*\[/.test(l))
    .slice(0, n)
    .join('\n');
}

/** 摘要收口：超过 n 码点在**语义边界**收尾（标点 → 空格 → 硬切），加省略号。
 * 坑: 曾直接 `.slice(0, n)` 硬切 → log.md 34/85 条断在词中间(revert-c / file-write-lockin /
 * ~/.cl​aude/ski), 文件名也被切成 ...-decision-blo。而 abs load 开机读的就是这份残句,
 * 用户与后续会话看到的天然是半句 —— "摘要读起来抽象"的真因在写入口, 不在表述能力。 */
export function clip(text, n) {
  const s = String(text || '').trim();
  if (s.length <= n) return s;
  const head = s.slice(0, n);
  // 优先在标点处断开（中文句读 + 英文句读），其次空格，最后才硬切
  const cut = Math.max(
    head.lastIndexOf('。'), head.lastIndexOf('；'), head.lastIndexOf('！'), head.lastIndexOf('？'),
    head.lastIndexOf('，'), head.lastIndexOf('、'), head.lastIndexOf(';'), head.lastIndexOf(','),
    head.lastIndexOf('.'), head.lastIndexOf(' '),
  );
  // 边界太靠前（< 一半）说明这一段本就是长句，宁可硬切也不留个残破的短头
  const keep = cut > n / 2 ? cut : n;
  return `${s.slice(0, keep).replace(/[\s,，、;；.。]+$/, '')}…`;
}

/** slug：取前 n 码点 → 非词字符折叠为 '-'。只用于**文件名**，完整标题另存 TITLE 行。
 * 在标点/空格边界收口，不在字中间切断（否则出 `...-硬切-不` 这种残尾）。 */
function slugOf(text, n = 24) {
  const s = String(text || '').trim();
  let head = s.slice(0, n);
  if (s.length > n) {
    const cut = Math.max(head.lastIndexOf('，'), head.lastIndexOf('。'), head.lastIndexOf('、'),
      head.lastIndexOf('：'), head.lastIndexOf(','), head.lastIndexOf('.'), head.lastIndexOf(' '));
    if (cut > n / 2) head = head.slice(0, cut);
  }
  return head.replace(/[^\w一-鿿]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

// ---------- log: 追加工作成果沉淀摘要（用户/AI 主动 abs log "..." 记, 不收工具动作流水） ----------
export async function cmdLog({ dir, title, kind = 'dev' }) {
  const root = await requireBrain(dir || process.cwd());
  const who = await requireUser(); // 写操作守卫
  const p = brainPath(root, 'log.md');
  const stamp = localStamp();
  // 不硬切: log.md 是人类读的成果摘要, 也是 abs load 的开机入口。600 码点够一条完整小结,
  // 超出才在语义边界收口（曾 slice(0,100) → 34/85 条断在词中间）
  const clean = clip(String(title || '').replace(/\n/g, ' '), 600);
  // 作者前置于 kind：`## [时间] @name dev | 内容`。
  // 一眼先看到谁做的（与 todo 行 `ID @name — 说明` 排版对齐）。
  const line = `## [${stamp}] ${atTag(who)} ${kind} | ${clean}`;
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
export async function cmdTask({ dir, action, id, section, note, as }) {
  const root = await requireBrain(dir || process.cwd());
  // 写操作守卫：无姓名不落盘（hook 调的 wrapup/teardown-check 不经过这里，不受影响）
  const who = await requireUser();
  if (action === 'start') {
    const r = await upsertTask(root, {
      section: section || 'Today / In Progress',
      text: `${id} ${atTag(who)}${note ? ' — ' + note : ''} (认领 ${today()})`,
    });
    return `✓ 任务${r.updated ? '更新(幂等)' : '登记'} → ${brainPath(root, 'todo.md')}\n  ${id} ${atTag(who)}${note ? ' — ' + note : ''}`;
  }
  if (action === 'blocked') {
    const r = await moveBlocked(root, { id, reason: note });
    return r.msg;
  }
  if (action === 'note') {
    if (!note) return '用法: abs todo note <id> --note "断点/进度"（实时落 ↳ 断点 行）';
    const r = await setBreakpoint(root, { id, text: note });
    return r.msg;
  }
  if (action === 'done') {
    // 找到匹配 id 的行，勾选并归位 Done（简化：若行在某 section 则标记完成）
    // --as 结语：落地(默认) / 否决 / 仅方案 —— 让 [x] 可被信任（见 todo.js DONE_KINDS）
    if (as && !DONE_KINDS.includes(as)) {
      throw new Error(`✗ --as 只接受: ${DONE_KINDS.join(' | ')}（收到 "${as}"）`);
    }
    const res = await markDone(brainPath(root, 'todo.md'), id, as || '落地');
    return res;
  }
  throw new Error(`unknown task action: ${action}`);
}

async function markDone(file, id, kind = '落地') {
  const res = await editFile(file, (text) => {
    const lines = text.split('\n');
    let changed = false;
    let moved = null;
    const kept = [];
    const wantId = String(id).replace(/\u200b/g, '');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!moved && idOfTaskLine(l) === wantId) {
        changed = true;
        const head = withDoneKind(
          l.replace('- [ ]', '- [x]').replace(/\(认领[^)]*\)/, '') + ` (完成 ${today()})`,
          kind,
        );
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
    : `✓ 已完成并归位 Done: ${id} 【${kind}】`;
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
      return clip(line.trim(), 160);
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
  const who = await requireUser(); // 写操作守卫
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
  const slugSrc = slugOf(clean);
  const file = `${today()}-${slugSrc || 'note'}.md`;
  const heading = clip(clean, 80); // 页面标题: 完整优先, 超长才收口
  const body = [
    '---',
    `tags: [${fmTags}]`,
    `author: ${who}`,
    `updated: ${today()}`,
    'status: draft',
    '---',
    '',
    `# 来源：${heading}`,
    '',
    `TITLE: ${clean}`,
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
  const line = `- [[${slug}]] — ${heading}`;
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
  await cmdLog({ dir: root, title: clean, kind: 'note' });
  return `✓ 经验暂存 → sources/${file}\n  ${clean} ${atTag(who)}`;
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
  // `.brain` 顶层文件（index / log / todo）也是真实页：从图谱看 [[todo]] 就是 todo.md。
  // 坑: 以前只把子目录当页 → [[todo]] 被当成死链（误报），反而逼用户去删掉正确引用。
  // 只用于「链接目标是否存在」判定；不参与 ORPHAN / INDEX-MISSING（它们只针对子目录页）。
  for (const f of await fs.readdir(vault).catch(() => [])) {
    if (f.endsWith('.md')) names.add(f.replace(/\.md$/, ''));
  }
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
    // ORPHAN: sources/ 暂存页与 todo 归档页豁免。前者是暂存线索（提炼成 concept 前天然孤立），
    // 后者是历史数据倾倒（已登记在 index.md，就是图谱入口，无需再制造双链）。
    const isTerminal = pg.dir === 'sources' || /todo归档$/.test(pg.slug);
    if (!isTerminal && !pg.links.length && !linkedNames.has(pg.slug)) {
      issues.push(`ORPHAN-PAGE: ${pg.rel} (no links out, no links in)`);
    }
    if (/知识冲突/.test(pg.body) && /status: draft/.test(pg.frontmatter)) {
      issues.push(`UNRESOLVED-CONFLICT: ${pg.rel}`);
    }
    if (['concepts', 'entities', 'syntheses'].includes(pg.dir)) {
      if (pg.lines > PAGE_MAX_LINES || pg.bytes > PAGE_MAX_BYTES) {
        issues.push(`OVER-SIZE: ${pg.rel} (${pg.lines}L/${pg.bytes}B > ${PAGE_MAX_LINES}L/${PAGE_MAX_BYTES / 1024}KB; 拆或外链)`);
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

  // Done 区堆积：它无上限增长，且 `abs todo`/`abs load` 每次全量打印 → 越积越难用。
  // （与 hooks.log/wrapup.log 同类问题；那两处有轮转，这里靠 `abs todo archive`。）
  // 坑: 曾经写成 brainPath(vault, 'todo.md')，而 vault 已经是 .brain 目录
  // → 拼出 .brain/.brain/todo.md（ENOENT），又被外层 try/catch 吞掉
  // → 检查静默失效（lint 永远 0 problem）。故这里不用 try/catch 吞错，
  // 只对 ENOENT 做缺省，写错路径这类编程错会直接暴露。
  const todoTxt = await fs.readFile(join(vault, 'todo.md'), 'utf8').catch(() => '');
  const di = todoTxt.split('\n').findIndex((l) => l.startsWith('## Done'));
  if (di !== -1) {
    const doneLines = todoTxt.split('\n').slice(di + 1).filter((l) => l.trim()).length;
    const DONE_MAX = 60;
    if (doneLines > DONE_MAX) {
      issues.push(`DONE-PILED-UP: Done 区 ${doneLines} 行 > ${DONE_MAX}; 跑 \`abs todo archive\` 迁出旧日期组`);
    }

    // 结语契约：Done 的 [x] 必须带【落地/否决/仅方案】。
    // 为什么钉死: 无结语的 [x] 同时意味着"真做完了"和"只想过"，读的人无法区分。
    // 实测翻车: 把"跑通后又被撤销"的 daemon 条当成已落地 → 得出错误结论。
    // 只查 Done 区（含历史归档前的旧条目也算），不做自动改写（改记录属内容决策，不该由 lint 代劳）。
    const doneBody = todoTxt.split('\n').slice(di + 1);
    const noKind = doneBody.filter((l) => /^\s*- \[x\]/.test(l) && !doneKindOf(l));
    if (noKind.length) {
      const sample = (noKind[0].match(/- \[x\] (\S+)/) || [, '?'])[1];
      issues.push(
        `DONE-NO-KIND: Done 区 ${noKind.length} 条缺结语（如 ${sample}）。` +
        `逐条补 \`--as 落地|否决|仅方案\`（新条目：abs todo done <id> --as …）`,
      );
    }
  }

  const n = issues.length;
  return [
    ...(issues.length ? issues : []),
    '',
    `lint: ${n} problem(s).`,
    n === 0 ? '✓ 图谱健康' : '',
  ].filter(Boolean).join('\n');
}

const PAGE_DIRS = ['entities', 'concepts', 'sources', 'syntheses', 'sessions'];

// concept/entity/synthesis 页的容量上限，超出提示"拆或外链"。
// 曾为 150L/5120B —— 实测偏紧：跨 4 项目 68 页里仅 2 页超限，且都只超一点
// （5463B / 5440B）；为满足它还把一页从 5319B 压到 4972B（内容受损、收益为零）。
// 放宽到 8KB：当前最大页 5463B，留约 50% 余量，但不至于失去"该拆了"的信号。
// 提成常量避免检查条件与提示文本各写一份而漂移。
const PAGE_MAX_LINES = 150;
const PAGE_MAX_BYTES = 8 * 1024;

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
        // 带上 .brain/ 前缀：这串会原样出现在 lint 提示里，用户会拿它去找文件。
        // 坑: 曾经只给 vault 相对路径（concepts/x.md），用户到项目根找 concepts/ 找不到。
        rel: `${BRAIN_DIR}/${d}/${f}`,
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
