// src/store.js — CLI 命令实现：图谱读写层。
// 命令: init / board / status / load / task / query / lint
import { promises as fs } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { requireBrain, brainPath, absLogDir, BRAIN_DIR } from './index.js';
import { requireUser, atTag, getUser } from './userconfig.js';
import { stripStateMark, ensureStateMark, normalizeTodo, addTask, upsertTask, boardText, readTodo, ensureTodo, todoTemplate, today, localStamp, setBreakpoint, setStateMark, TASK_STATES, insertDoneGrouped, idOfTaskLine, archiveDoneInText, upsertArchiveSection, DONE_KINDS, withDoneKind, doneKindOf, doneDateOf, collapseDone, SEC, rebuildStructure } from './todo.js';
import { editFile, SKIP } from './lock.js';
import { appendWrapup, strandedFor } from './wrapup.js';
import { keywords, pickRelevant, renderRelevant, recentFiles, rankPage, topicStrength } from './relevant.js';

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
  // 同 todoTemplate：由 rebuildStructure 生成，模板 = 重排结果，不会来回抖。
  return rebuildStructure(
    ['# 🗂 Graph Index', '',
      '本文件唯一入口。每新建/大改一页，同步在此分类下加一行 [[页面名]] — 一句话。', '',
      '## Rules', '## Concepts', '## Entities', '## Sources', '## Syntheses', '## Sessions'].join('\n'),
    {
      h1: '# 🗂 Graph Index',
      // 无 `## Roadmap`：它是 AI 自己写的方向总结，会被 load 反复读到并带偏后续会话
      // （“看似是总结指引，其实是 AI 的总结指引” —— 2026-09-13 用户决策删除）。
      order: ['## Rules', '## Concepts', '## Entities', '## Sources', '## Syntheses', '## Sessions'],
    },
  ).text;
}

export function logTemplate() {
  return ['# 🗒 Activity Log', '', '## [YYYY-MM-DD] ingest | 沉淀 <slug>', ''].join('\n');
}

// ---------- 结构核对: load 每次都读 index/log/todo，顺手核形状 ----------
/** 标准形状表（与 indexTemplate/logTemplate/todoTemplate 同源）。
 * 标记不一致 = 直接改成标准（“能自己处理的先处理”）。
 * 只按**整行精确匹配**改标题，绝不动正文 —— 不做模糊替换，否则正文里提到的旧名会被误改。 */
// sources/ 堆积阀值：超过就是「采了没消化」。lint 报 SOURCES-PILED-UP，load 顶部同步提示。
// 两处共用同一常量 —— 阀值只有一个真源。
const SOURCES_MAX = 10;

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

/** 把不符标准的标记改成标准（按整行精确匹配，不碰正文）。
 * log.md 特殊：它没有固定分区，只有条目行 —— 不做结构重排，只改 H1。
 * 返回 { text, changed }；无不一致时 changed 为空。 */
export function fixMarks(text, spec) {
  const lines = String(text ?? '').split('\n');
  const changed = [];
  const h1At = lines.findIndex((l) => l.trim().startsWith('# '));
  if (h1At !== -1 && lines[h1At].trim() !== spec.h1) {
    const cur = lines[h1At].trim();
    const hit = LEGACY_MARKS.find(([o]) => o === cur && o.startsWith('# '));
    if (hit) { lines[h1At] = spec.h1; changed.push(`${cur} → ${spec.h1}`); }
  }
  for (let i = 0; i < lines.length; i++) {
    if (i === h1At) continue;
    const t = lines[i].trim();
    const hit = LEGACY_MARKS.find(([o]) => o === t && !o.startsWith('# '));
    if (hit) { lines[i] = hit[1]; changed.push(`${hit[0]} → ${hit[1]}`); }
  }
  return { text: lines.join('\n'), changed };
}

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
      let next2 = cur;
      if (spec.order.length) {
        // todo.md 的四区 → 两区迁移**必须先走 normalizeTodo**：只有它知道
        // `## Blocked` 区的任务该标 [滞留中]（语义信息），而 rebuildStructure 只按
        // renames 改标题、看不到来源分区，只能一律给 [进行中]。
        // 2026-09-13 实测坑：cmdLoad 先跑 checkBrainShape、后跑 readTodo，于是
        // normalizeTodo 的 [滞留中] 映射在 load 路径上永远走不到 → 卡住的任务
        // 被静默标成进行中，两条路径语义不一致。
        const srcText = file === 'todo.md' ? normalizeTodo(cur) : cur;
        const r0 = rebuildStructure(srcText, { ...spec, renames: LEGACY_MARKS.filter(([o]) => o.startsWith('## ') || o.startsWith('### ')) });
        // 兜底：仍无状态标记的未完成任务补默认值（新格式文件本就有标记，此处不触发）。
        next2 = file === 'todo.md'
          ? r0.text.split('\n').map((l) => (l.startsWith('- [ ] ') ? ensureStateMark(l, '进行中') : l)).join('\n')
          : r0.text;
      } else {
        next2 = fixMarks(cur, spec).text;
      }
      const r = { text: next2, changed: next2 === cur ? [] : ['结构按标准重排'] };
      if (!r.changed.length) return SKIP;
      changed = r.changed;
      return { text: r.text };
    }).catch(() => {});
    if (changed.length) fixed.push(`${file}: ${changed.join('; ')}`);
    if (!knownH1) warn.push(`${file}: 标题非标准（读到 "${clip(l1, 24) || '(空)'}"）`);
  }
  return { fixed, warn };
}

// ---------- board: 看板 ----------
export async function cmdBoard({ dir, full }) {
  const root = await requireBrain(dir || process.cwd());
  return boardText(root, undefined, { full: !!full });
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
  // 结构核对先跑：load 每回都要读这三个文件，顺手把它们形状摆正（缺分区）或提个醒（无头）。
  // 正常时完全静默、零字节，不增加 load 体积（load 已被压缩到 ~1.8k token）。
  const shape = await checkBrainShape(root).catch(() => ({ fixed: [], warn: [] }));
  const todo = await readTodo(root);
  const index = await readIfExists(brainPath(root, 'index.md'));
  const log = await readIfExists(brainPath(root, 'log.md'));
  const stranded = await strandedFor(root);
  const sections = [
    `📂 abs → 项目: ${root}`,
  ];
  if (shape.fixed.length || shape.warn.length) {
    const rows = [
      ...shape.fixed.map((a) => `  ✓ 已补: ${a}`),
      ...shape.warn.map((a) => `  ⚠ ${a}`),
    ];
    if (shape.warn.length) rows.push('  （无头文件不自动改：结构可能整体脱轨，请手工对齐 .brain/ 模板）');
    sections.push('--- 文件形状核对 ---', ...rows, '');
  }
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
    // Rules 单独成段且放在最前（仅次于项目行/滞留）：它是硬规则，不是普通清单。
    // 坑: 曾在 index 段内与页面清单平铺 —— AI 会当普通清单划过，而它每条都是付过代价的。
    ...(rulesSection(index) ? [rulesSection(index), ''] : []),
    collapseIndex(index) || '(index.md 为空)',
    '',
    // 两区制：Todo（未完成，行首带状态标记）+ Done。
    '--- Todo Board (todo.md) ---',
    collapseDone(todo).text || '(todo.md 为空)',
    '\n（Done 已按日期折叠计数；明细: abs todo --full）',
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
  // 卡点提取（2026-09-16，定位 = 看板可见性）：
  // 从 todo 里抽出带 `阻塞:` / `等待:` 的断点行，集中展示。
  // 为何需要：断点行在任务下方，一屏扫过去看不出"哪些事在等人/等外部"。
  // 只提取不求全 —— 只有明确写了前缀的才被抽出，没写的不猜。
  const blocks = extractBlocks(todo);
  if (blocks.length) {
    const at = sections.findIndex((s) => String(s).startsWith('--- Rules'));
    sections.splice(at === -1 ? 1 : at, 0,
      `⛔ 卡点 ${blocks.length} 条（在等外部条件）`,
      ...blocks.map((b) => `  - ${b.id}: ${b.why}`),
      '');
  }
  // 相关页提示（2026-09-16）：实测 abs_query 几乎不被调用（MCP 日志 task 234 / note 54 / load 53 vs query 2）。
  // 根因：load 只列目录 → 模型觉得"我记过了" → 真需要时靠印象。模型不知道自己不知道什么。
  // 解法（用户定）：不替它查 —— 而是【把该查的词直接给出来】，降低发起查询的成本。
  //   自动带出正文是错的方向：那会让 query 更没人用，且无法按需求变化调整词。
  // 失败静默：这只是 additive 提示，出任何错都不应弄坏 load。
  try {
    const rel = await queryHint(root, todo);
    if (rel) sections.push('', rel);
  } catch { /* 提示失败不影响 load */ }
  // sources 堆积提醒：与「滞留」同构 —— 放在每次开工必经的顶部，而不是等人跑 lint。
  // 只数目录条目（不读文件），零成本。提炼仍手工：这里只负责送达，不替判断。
  const nsrc = await countSources(root);
  if (nsrc > SOURCES_MAX) {
    // 插在滞留之后 / Rules 之前：滞留更紧急（卡住当前工作），消化其次。
    const at = sections.findIndex((s) => String(s).startsWith('--- Rules')) ;
    sections.splice(at === -1 ? 1 : at, 0,
      `♻ 待消化: sources/ 有 ${nsrc} 条 > ${SOURCES_MAX}（采集了没提炼）`,
      '→ abs lint 看明细；提炼成 concepts/ 后删 source 并清引用',
      '');
  }
  return sections.join('\n');
}

/**
 * 从 todo 正文抽出"卡点"行，供 load 集中展示。
 *
 * 识别的前缀：`阻塞:` / `等待:` / `等 `（在断点/附属行里）。
 * 为何只认前缀（不靠语义猜）：没写就是没写，猜出来的卡点比不报更坑。
 *
 * @returns {{id:string, why:string}[]}
 */
export function extractBlocks(todoText) {
  const out = [];
  let curId = null;
  for (const line of String(todoText || '').split('\n')) {
    // 任务行（未完成）：`- [ ] [状态] ID [[who]] — 描述`
    const t = line.match(/^\s*-\s*\[\s*\]\s*(?:\[[^\]]*\]\s*)?(\S+)/);
    if (t) { curId = t[1]; continue; }
    // 完成行：不再跟踪
    if (/^\s*-\s*\[x\]/.test(line)) { curId = null; continue; }
    if (!curId) continue;
    // 附属行（↳ 开头或缩进行）里找卡点前缀
    const m = line.match(/^\s*(?:↳\s*断点:\s*)?(?:阻塞|等待|等)[:：]\s*(.+)$/);
    if (m && m[1].trim()) out.push({ id: curId, why: m[1].trim() });
  }
  return out;
}

/**
 * 开工提示：直接给出该查的几个词，降低发起 query 的成本。
 *
 * 为何不是"替它查"（2026-09-16 用户定）：自动带出正文会让 query 更没人用，
 * 且无法按需求变化调整词。正确做法是把词准备好，查询仍由调用方发。
 *
 * 词从两个环境事实推：活跃 todo 的关键词 + 最近改过的文件名。
 *
 * 挑词用【主题级强度】排序，不取词表前几个（2026-09-17 实测修正）：
 *   原实现 `pick = [...en.slice(0,2), ...zh.slice(0,1)]` 取的是最前面的词，
 *   而 todo 行以 `<任务id> [[作者]]` 开头 → 任务 id 与用户名稳占前两位，
 *   实测输出 `abs query queryhint-noise tester 进行`（强度 0/1/0，全是废词）。
 *   现按 topicStrength（tag/页名命中数）降序取，强度 0 的一律不提示
 *   —— 命中不了任何页的词，建议去查它等于没建议。
 * 失败静默：读页出错就当没有强词，退回不提示（不影响 load）。
 *
 * @param {string} root 项目根
 * @param {string} todoText
 * @param {{name:string,body:string}[]} [pages] 已读好的页（省一次磁盘扫描）
 */
async function queryHint(root, todoText, pages) {
  const active = String(todoText || '')
    .split('\n')
    .filter((l) => /^\s*-\s*\[\s*\]/.test(l))
    // 剔掉任务行的结构记号再分词：`- [ ] [状态] <id> [[作者]] —` 里只有「—」后面是真内容。
    // 实测教训（2026-09-17）：不剔的话 `<id>` 与 `[[作者]]` 会进入词表，
    // 而作者名恰好有自己的 entities/<作者>.md 页 → 命中**页名** → 强度 1 过了门槛，
    // 于是提示语变成「查一下你自己的名字」。建议查作者页不是“别重踩的经验”。
    // 用 task 行自身的形状剥（与 idOfTaskLine 同源），不维护人名/任务名黑名单。
    .map((l) => l.replace(/^\s*-\s*\[\s*\]\s*(?:\[[^\]]*\]\s*)?(?:\S+\s*)?/, '').replace(/\[\[[^\]]*\]\]/g, ' '))
    .join(' ');
  const files = await recentFiles(root, { n: 5 }).catch(() => []);
  const src = [active, files.map((f) => f.name).join(' ')].filter(Boolean).join(' ');
  const kws = keywords(src);
  if (!kws.length) return '';
  const all = pages || await listPages(brainPath(root)).catch(() => []);
  const strength = topicStrength(all.map((p) => ({ name: p.slug, body: p.body })), kws);
  // 英文词优先（中文 2-gram 单看无意义，只做补充）；每组内按强度降序
  const byStrength = (a, b) => (strength.get(b) || 0) - (strength.get(a) || 0) || a.localeCompare(b);
  const en = kws.filter((k) => /^[a-z][a-z0-9_-]+$/.test(k)).sort(byStrength).filter((k) => strength.get(k) > 0);
  const zh = kws.filter((k) => !/^[a-z][a-z0-9_-]+$/.test(k)).sort(byStrength).filter((k) => strength.get(k) > 0);
  const pick = [...en.slice(0, 2), ...zh.slice(0, 1)].slice(0, 3);
  if (!pick.length) return '';
  const rows = [
    '--- 开工前建议查一次（图谱里有相关经验，别重踩）---',
    `  abs query ${pick.join(' ')}`,
  ];
  if (files.length) rows.push(`  （据最近改动: ${files.slice(0, 3).map((f) => f.name).join(', ')}）`);
  return rows.join('\n');
}

/** 数 sources/ 下的 .md 文件数（只读目录，不解析内容）—— load 顶部提醒用。
 *  坑: root 是【项目根】，图谱在 root/.brain/ 下 —— 必须走 brainPath，
 *  直接用 join(root,'sources') 会 ENOENT 被 catch 吞成 0，成为又一个静默失效。 */
async function countSources(root) {
  try {
    const files = await fs.readdir(brainPath(root, 'sources'));
    return files.filter((f) => f.endsWith('.md') && !f.startsWith('_')).length;
  } catch { return 0; }
}

// ---------- Rules: index.md 里的硬规则区 ----------
/** index.md 的 `## Rules` 区名与上限。 */
export const RULES_HEADING = '## Rules';
export const RULES_MAX = 30; // 超过就 lint 报：它属于“被读到才有价值”的区，不能无界增长


/** 提取 index.md 里的 Rules 区条目（不含标题）。返回 { items:[行], body, found }。 */
export function readRules(indexText) {
  const lines = String(indexText || '').split('\n');
  const i = lines.findIndex((l) => l.trim() === RULES_HEADING);
  if (i === -1) return { items: [], body: '', found: false };
  const rest = lines.slice(i + 1);
  const j = rest.findIndex((l) => /^##\s/.test(l));
  const body = rest.slice(0, j === -1 ? rest.length : j);
  return { items: body.filter((l) => l.trim().startsWith('- ')), body: body.join('\n').trim(), found: true };
}

/** load 里 Rules 的呈现：带独立段头，条目原样（不折、不截）。无条目则不占字节。 */
function rulesSection(indexText) {
  const { items, body, found } = readRules(indexText);
  if (!found || !body) return '';
  // 有引言句（> 开头）时一并带上，它解释了这个区是干什么的。
  const intro = body.split('\n').filter((l) => l.trim().startsWith('>')).join('\n');
  return [
    `--- Rules (硬规则，先读, index.md) — ${items.length} 条 ---`,
    intro,
    ...items,
  ].filter((x) => x !== '').join('\n');
}

/**
 * `abs rule` —— 读写 index.md 的 Rules 区。
 * 无参 = 列出（只给规则，不被 load 的其它内容占上下文）。
 * add <一句话> = 追加一条（走锁写、幂等去重）。
 * 门槛：只该放“违反会丢数据/静默失效/白干活”级规律；长句会被拒并指向概念页。
 */
export async function cmdRule({ dir, action, text }) {
  let root;
  try { root = await requireBrain(dir || process.cwd()); } catch {
    return '未找到 .brain/ 图谱。先在项目根运行: abs init';
  }
  const p = brainPath(root, 'index.md');
  if (!action || action === 'list' || action === 'show') {
    const { items, found } = readRules(await readFileOrNull(p));
    if (!found) return `index.md 无 \`${RULES_HEADING}\` 区（跑 abs load 会自动补位）`;
    if (!items.length) return `${RULES_HEADING} 区为空（add "一句话" 追加）`;
    return [`${RULES_HEADING} — ${items.length} 条:`, ...items].join('\n');
  }
  if (action !== 'add') {
    return `用法: abs rule            列出硬规则\n      abs rule add "一句话" [--note "补充"]`;
  }
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '用法: abs rule add "一句话硬规则"';
  // 门槛：**纪律不是记事本**。Rules 是最前面的项目铁律，每条必须一眼扫完。
  // 2026-09-13 用户定：不带链接、不带解释、不写细节 —— 细节进概念页，Rules 只留结论。
  // 宽严：中文一字信息量大，按 40 字算（≈ 英文 80 字符的量）。实测现有 12 条最长 56 字符。
  if (clean.length > 42) {
    return `✗ 太长（${clean.length} > 42）—— Rules 是纪律不是记事本：\n`
      + `  每条要一眼扫完。细节/出处/例子 → 写进 concepts/ 概念页，这里只留一句话结论。`;
  }
  if (/\[\[|\]\]|https?:\/\//.test(clean)) {
    return '✗ 不带链接 —— Rules 区会被反复全量打印，链接占位且让纪律读起来像索引。\n'
      + '  要挂概念页，去概念页自己的「## 关联连接」里挂。';
  }
  let added = null;
  await editFile(p, (cur) => {
    if (cur === null) return SKIP;
    const lines = cur.split('\n');
    const i = lines.findIndex((l) => l.trim() === RULES_HEADING);
    if (i === -1) return SKIP; // 无该区不擅自建（load 会补位）
    if (lines.some((l) => l.trim() === `- ${clean}`)) return SKIP; // 幂等：同句不重复
    // 插在该区最后一条条目之后（保序、不搅动其它条目）
    let at = i + 1;
    for (let k = i + 1; k < lines.length; k++) {
      if (/^##\s/.test(lines[k])) break;
      if (lines[k].trim().startsWith('- ')) at = k + 1;
    }
    lines.splice(at, 0, `- ${clean}`);
    added = clean;
    return { text: lines.join('\n') };
  });
  if (added === null) return `• 已有同句或 index.md 无 ${RULES_HEADING} 区（跳过）`;
  const { items } = readRules(await readFileOrNull(p));
  const warn = items.length > RULES_MAX
    ? `\n⚠ Rules 已 ${items.length} 条 > ${RULES_MAX}：考虑把其中几条提炼成概念页（跑 abs lint 会报）`
    : '';
  return `✓ 已加硬规则（共 ${items.length} 条）\n  - ${clean}${warn}`;
}

async function readFileOrNull(p) {
  try { return await fs.readFile(p, 'utf8'); } catch { return ''; }
}

/** index.md 在 `abs load` 里的折叠形态：把页面清单各分区折成计数。
 *
 * 坑: index 的 concept 清单带每一页的一句话描述，**隨图谱线性增长** —— 本仓库 17 条
 * 占 load 输出 2286/3571 tok（64%），另一台 40 条的项目约 2.3 倍。它刚成了 Done 之后
 * 最大的单体膨胀源（Done 已折叠，见 collapseDone）。
 *
 * 续接真正需要的只是「有哪些分区、各多少页」（据此知道去哪找），不需要每页写了什么 ——
 * 要那个用 `abs index`（完整原文件）或按词 `abs query`。
 *
 * `## Rules` 也已不在本函数输出——它由 rulesSection 在**上方**单独成段（需要正文）；
 * 这里再原样吐一遍 = 同一段硬规则在首屏出现两次（2026-09-13 实测发现）。
 * 曾另有 `## Roadmap`：AI 自己写的方向总结，会被反复读到并带偏会话，已删。 */
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

  // 1) 归档目标 = 当天的会话快照文件（log-<日期>.md），写进其「任务归档」段。
  //    为何合一（2026-09-15 用户定）: 归档与会话快照是**同一天的记录**，分两个文件查着要开两处。
  //    边界: ① 文件不存在→建只有归档段的页（那天可能没写快照）
  //          ② 文件已存在（含 AI 手写快照）→ 只替换归档段，段外逐字保留
  //    （硬规则「已存在的人工内容一律不覆盖」由 upsertArchiveSection 保证）。
  const sessDir = brainPath(root, 'sessions');
  for (const g of plan.archived) {
    const pageP = join(sessDir, `${g.slug}.md`);
    let page = null;
    try { page = await fs.readFile(pageP, 'utf8'); } catch { /* 首次 */ }
    const nextPage = upsertArchiveSection(page, g);
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
  // 坑（2026-09-15 修）: 原先把归档页登记到 `## Sources` 区 —— 但它们在 sessions/ 里，
  // 旧数据实测就是错位的（09-10/09-12 两条曾键在 Sources 段，人工才发现）。现改登 `## Sessions`。
  const iP = brainPath(root, 'index.md');
  await editFile(iP, (index) => {
    if (!index) return SKIP;
    const missing = plan.archived.filter((g) => !index.includes(`[[${g.slug}]]`));
    if (!missing.length) return SKIP;
    const sIdx = index.indexOf('## Sessions');
    if (sIdx === -1) return SKIP;
    const after = index.indexOf('\n## ', sIdx + 1);
    const add = missing.map((g) => `- [[${g.slug}]] — ${g.date}（会话快照 + 任务归档）`).join('\n');
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

    // 条件③: log.md 今日尚无【工作成果】条目(条目头 '## [YYYY-MM-DD HH:MM] [[name]] dev |')。
    // 坑(2026-09-13 实测, pi 侧先修): `abs note` 也写 log.md(kind=note)，
    // 旧判据只看「今天有没有行」会把「沉淀了一条经验」误判成「今天已收尾」→ 整天不再提醒。
    // 三宿主(pi/CC/op​encode)判据必须一致 —— 见 [[hook-throttle-alignment]]。
    const logTxt = await readIfExists(brainPath(root, 'log.md'));
    const stamp = localStamp();            // 'YYYY-MM-DD HH:MM'
    const day = stamp.slice(0, 10);
    if (new RegExp('^## \\[' + day + ' \\d{2}:\\d{2}\\] (?:\\[\\[[^\\]]+\\]\\] )?dev \\|', 'm').test(logTxt)) return '{}';

    // 条件④: 每会话一次。
    // 双保险, 因为官方 stop_hook_active 有已知
    // 不传播 bug(claude-code#54360): 同一 turn 内重复 fire 时它仍是 false。
    // ① 官方契约: stop_hook_active=true = 本次 Stop 已是注入后的产物, 绝不再推(否则死循环)
    if (ev.stop_hook_active === true) return '{}';
    // ② 己方节流: 以 session_id 落 mark。缺 id 时退化为按项目+日期节流,
    //    绝不"无节流"——否则一旦宿主张不到 id, decision:block 就会无限自激。
    const sid = String(ev.session_id || ev.sessionId || '').replace(/[^\w-]/g, '');
    // 兼底 key 只用【项目名】而非 full path。
    // 坑(2026-09-16 实测): 原用 root.replace(/[^\w]/g,'_') 会把 cwd 的 tmp 路径
    //   (/var/folders/..._tmpXXXX) 也编进去 —— 而每个会话的 tmp 目录都不同,
    //   于是"按项目+日期节流"根本没生效, 每次都新 key → ~/.abs/log/ 堆了 361 个 mark。
    const projKey = root.split('/').filter(Boolean).pop() || 'unknown';
    const key = sid || 'nosession-' + day + '-' + projKey;
    const mark = join(absLogDir(), `teardown-${key}.mark`);
    try {
      await fs.access(mark);
      return '{}'; // 本会话(或本项目今日)已推过
    } catch { /* 未推过 */ }
    await fs.mkdir(dirname(mark), { recursive: true });
    await fs.writeFile(mark, stamp).catch(() => {});
    // mark 只增不减会堆成垃圾(实测 361 个)。只清【带旧日期】的 mark ——
    // 节流只在当天有意义(判据是 day), 旧日期 mark 不可能再命中;
    // 无日期的会话 mark(teardown-<sid>.mark)保留, 它靠自身存在与否判重。
    try {
      for (const f of await fs.readdir(absLogDir())) {
        const m = f.match(/^teardown-.*-(\d{4}-\d{2}-\d{2})-.*\.mark$/);
        if (m && m[1] !== day) await fs.unlink(join(absLogDir(), f)).catch(() => {});
      }
    } catch { /* 清理失败不影响主流程 */ }

    const msg = [
      // 未设姓名时把设置指令插到第0条 —— 否则后续 todo add/log/note 全会被守卫拦下。
    (await getUser() ? [] : [
      '0) 本机尚未设置使用者姓名 —— 先跑 abs config set user <你的名字>，否则 todo/log/note 都会被拦下；',
    ]),
    '[abs] 本会话改过文件，.brain/ 今日无记录。',
      '这条是信息不是命令：该沉淀就沉淀，没有可沉淀的直接回一句「无可沉淀」，不用凑。',
      '需要时：abs todo / abs todo done <id> / abs note "..." / abs log "..."',
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
    // 每条按语义边界收口：load 是开机读状态，只求"上会话做到哪"的线索，不须全文。
    // 坑: 不收口时 5 条能占 2.9KB（单条 800B），又是一处随日志变长而膨胀的上下文。
    .map((l) => clip(l, 220))
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
  await ensurePersonPage(root, who); // 首次写操作即建人页（已存在不动）
  const p = brainPath(root, 'log.md');
  const stamp = localStamp();
  // 不硬切: log.md 是人类读的成果摘要, 也是 abs load 的开机入口。600 码点够一条完整小结,
  // 超出才在语义边界收口（曾 slice(0,100) → 34/85 条断在词中间）
  const clean = clip(String(title || '').replace(/\n/g, ' '), 600);
  // 作者前置于 kind：`## [时间] @name dev | 内容`。
  // 一眼先看到谁做的（与 todo 行 `ID @name — 说明` 排版对齐）。
  const line = `## [${stamp}] ${atTag(who)} ${kind} | ${clean}`;
  await editFile(p, (cur) => {
    const text = cur ?? '# 🗒 Activity Log\n';
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
  await ensurePersonPage(root, who); // 首次写操作即建人页（已存在不动）
  if (action === 'start') {
    // 两区制：未完成一律进 Todo，行首带状态标记（默认 进行中）。
    const st = section && TASK_STATES.includes(section) ? section : '进行中';
    const r = await upsertTask(root, {
      section: SEC.todo,
      text: `[${st}] ${id} ${atTag(who)}${note ? ' — ' + note : ''} (认领 ${today()})`,
    });
    return `✓ 任务${r.updated ? '更新(幂等)' : '登记'} → ${brainPath(root, 'todo.md')}\n  [${st}] ${id} ${atTag(who)}${note ? ' — ' + note : ''}`;
  }
  if (action === 'state') {
    // 改状态标记（原地，不搬区）：进行中 / 讨论中 / 滞留中
    if (!note) throw new Error(`✗ 用法: abs todo state <id> --note "${TASK_STATES.join('|')}"`);
    if (!TASK_STATES.includes(note)) {
      throw new Error(`✗ 状态只接受: ${TASK_STATES.join(' | ')}（收到 "${note}"）`);
    }
    const f = brainPath(root, 'todo.md');
    let cc = [];
    await editFile(f, (cur) => {
      if (cur === null) return SKIP;
      const r = setStateMark(cur, id, note);
      cc = r.changed;
      return r.changed.length ? { text: r.text } : SKIP;
    });
    return cc.length ? `✓ ${id} 状态 → [${note}]` : `[NO_MATCH] 未找到含 "${id}" 的未完成任务行，或状态未变`;
  }
  if (action === 'note') {
    if (!note) return '用法: abs todo note <id> --note "进度"\n  建议前缀（load 会把它们单独抽出来，让人一眼看到）:\n    验证: <跑过的命令/结果>\n    边界: <这方案治不了什么>\n    阻塞: <在等什么，卡在哪>';
    const r = await setBreakpoint(root, { id, text: note });
    return r.msg;
  }
  if (action === 'done') {
    // 找到匹配 id 的行，勾选并归位 Done（简化：若行在某 section 则标记完成）
    // --as 结语：落地(默认) / 否决 / 仅方案 —— 让 [x] 可被信任（见 todo.js DONE_KINDS）
    if (as && !DONE_KINDS.includes(as)) {
      throw new Error(`✗ --as 只接受: ${DONE_KINDS.join(' | ')}（收到 "${as}"）`);
    }
    // 结语 = note（MCP 路径）或位置参数（CLI 路径）。坑(2026-09-16 实测):
    // MCP abs_task schema 无 as，AI 按旧 SKILL.md 传 note 会被静默丢弃、行上默认盖【落地】
    // —— 状态失真且无声。现在 note 也当结语；note 里自带【落地/否决/仅方案】时它就是 kind。
    // as 与 note 里的 kind 矛盾 → 报错不猜（猜一侧就是静默篡改另一侧）。
    const conclusion = note ? String(note).replace(/\u200b/g, '') : undefined;
    const inlineKind = conclusion ? (conclusion.match(/【(落地|否决|仅方案)】/) || [])[1] : undefined;
    if (inlineKind && as && inlineKind !== as) {
      throw new Error(`✗ as="${as}" 与 note 里的【${inlineKind}】矛盾 —— 只留一个（改 as，或改 note 里的【】）`);
    }
    const res = await markDone(brainPath(root, 'todo.md'), id, as || inlineKind || '落地', conclusion);
    return res;
  }
  throw new Error(`unknown task action: ${action}`);
}

async function markDone(file, id, kind = '落地', conclusion) {
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
        // 结语（MCP note / CLI 位置参数）拼在日期前 —— 与 CLI `abs todo done <id> [--as ..] <结语>` 同一落点。
        const tail = conclusion ? ` — ${conclusion}` : '';
        const head = withDoneKind(
          stripStateMark(l).replace('- [ ]', '- [x]').replace(/\(认领[^)]*\)/, '') + `${tail} (完成 ${today()})`,
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
    ? `[NO_MATCH] 未找到含 "${id}" 的未完成任务行`
    : `✓ 已完成并归位 Done: ${id} 【${kind}】`;
}

// ---------- show: 查看 index/todo/log（只读面） ----------
export async function cmdShow({ dir, view, full }) {
  const v = String(view || '').toLowerCase();
  if (!['todo', 'index', 'log'].includes(v)) {
    return '用法: abs <todo|index|log>  — todo=看板(原 board), index=Graph Index, log=操作流水';
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
  return v === 'todo' ? boardText(root, text, { full: !!full }) : text;
}
// ---------- query: 检索知识图谱（多词 OR，扫全 .md 页） ----------
const KNOWN_SLUG_HINT = /模板残留|\[\[slug\]\]/;

export async function cmdQuery({ dir, terms, includeSuperseded }) {
  // 每个 term 内部再按空白拆 —— 让 `abs query "发布 流程"` 与 `abs query 发布 流程` 等价。
  // 坑: 曾经引号包起来的 "发布 流程" 被当成一个完整短语 → 全图无命中。
  // 用户看到「无命中」会以为图谱里没这条经验，实际只是词没被拆开（静默失效）。
  const words = [...new Set(
    (terms || []).flatMap((w) => String(w).trim().split(/\s+/)).filter(Boolean)
  )];
  if (!words.length) {
    return '用法: abs query <词1> [词2 …]  — 多词检索 .brain/ 全部知识页';
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
      const slug = f.replace(/\.md$/, '');
      const rank = rankPage(body, slug, words);
      if (rank) {
        // 作者从本页 frontmatter 读（权威来源）。不在 index 行里重复 ——
        // index 行是覆盖式更新的，作者会从"创建者"漂成"最后改的人"。
        const au = body.match(/^author:\s*(.+)$/m);
        const st = statusOfPage(body);
        // 被推翻的经验默认不出现在检索结果里 —— 它的存在意义是"别再用它"，
        // 而不是回答"我上次怎么解決 X"（那会拿到一个已知错误的答案）。
        // 但它不是静默消失：计数里告知还有几条被隐藏（带 --all 能看）。
        if (st === 'superseded' && !includeSuperseded) {
          hits.push({ hidden: true, slug });
          continue;
        }
        hits.push({
          full, slug, matched: rank.matched, kind: rank.kind, fuzzyScore: rank.score, via: rank.via,
          author: au ? au[1].trim() : '',
          id: idOfPage(body, slug),
          status: st,
          supersededBy: supersededByOf(body),
          snippet: firstHitLine(body, rank.matched.length ? rank.matched : words),
        });
      }
    }
  }
  const hidden = hits.filter((h) => h.hidden).length;
  // 分两区：精确命中优先，模糊只作补充。
  // 坑(2026-09-16 实测): 不加区分时查 file-write-locking 返回 26 页（几乎全图）——
  //   连字符词的 2-gram 太通用，模糊命中把无关页也拉进来。
  //   规则：只要有任何精确命中，模糊命中的就不排在前面（但也不丢弃，单列一段）。
  const exactHits = hits.filter((h) => !h.hidden && h.kind === 'exact')
    .map((h) => ({ ...h, score: h.fuzzyScore }))
    .sort((a, b) => b.score - a.score);
  const fuzzyHits = hits.filter((h) => !h.hidden && h.kind === 'fuzzy')
    .map((h) => ({ ...h, score: h.fuzzyScore }))
    .sort((a, b) => b.score - a.score);
  // 有精确命中 → 模糊全藏起来（但不静默：告知数量 + 怎么看）
  const fuzzySuppressed = exactHits.length > 0 && fuzzyHits.length > 0;
  const shown = exactHits.length ? exactHits : fuzzyHits;
  if (!shown.length) {
    const extra = hidden ? `（另外 ${hidden} 页已标记 superseded，用 abs query ${words.join(' ')} --all 查看）` : '';
    return `query [${words.join(', ')}]: 无命中。${extra}用 abs lint 看图谱健康；首次使用先 abs init。`;
  }
  const lines = shown.map((h) => {
    const by = h.author ? `  @${h.author}` : '';
    // id 只在≠slug 时显示 —— 相同时再印一遗就是纯噪音（绝大多数页）。
    // 目的：让 AI 拿到一个改名也不漂的引用句柄（abs resolve <id> 能反查回来）。
    const id = h.id && h.id !== h.slug ? `  [id: ${h.id}]` : '';
    // draft = 未经核实。不拦使用，但必须让 AI 知道这是它自己没验证过的。
    const st = h.status === 'draft' ? '  [draft 未核实]' : '';
    const full = h.kind === 'exact' && words.length > 1 && h.matched.length === words.length ? ' ★全命中' : '';
    // 模糊命中必须显式标出 —— 否则用户会把"语义相近"当成"真的是这条"。
    const fuzzy = h.kind === 'fuzzy' ? '  [模糊命中: 字面未出现，仅字形相近]' : '';
    const hitTxt = h.matched.length ? h.matched.join(', ') : '(无字面命中)';
    // 命中渠道：tag 最有价值（人工提炼的关键词），显式标出便于判断可信度
    const viaTag = h.via && h.via.tag.length ? `  [tag: ${h.via.tag.join(', ')}]` : '';
    return `📄 ${h.slug}${by}${id}${st}${fuzzy}  (命中: ${hitTxt}${full})${viaTag}\n    ${h.snippet}`;
  });
  // 多词且无全命中时告知降级了 —— 不静默给一堆弱相关结果。
  const anyFull = shown.some((h) => h.kind === 'exact' && h.matched.length === words.length);
  const tail = [];
  if (words.length > 1 && !anyFull) tail.push('', `（无页同时命中全部 ${words.length} 个词，以下按命中数排序）`);
  if (fuzzySuppressed) tail.push('', `（另有 ${fuzzyHits.length} 页字形相近但字面未命中，已隐藏 —— 它们通常不相关）`);
  if (hidden) tail.push(``, `（${hidden} 页 superseded 已隐藏；--all 可看）`);
  return [`query [${words.join(', ')}] → ${shown.length} 页:`, '', ...lines, ...tail].join('\n');
}

/** 从页面正文取一段「像答案」的片段。
 *  基线（2026-09-15 实测 296 条片段）: 25% 是非内容行（tags:/H1/段落标题）。
 *  典型症状: 查「发布」时 npm-publish-flow 返回 `tags: [concept, npm, publish, 发布]`
 *  —— frontmatter 在第 3 行，跑在正文前，于是「含关键词的第一行」永远先命中它。
 *  所以必须：(1) 跳过 frontmatter/标题这类非内容行；(2) 优先从「答案段」里找。
 *  只做机械判断：行首标记 + 所属小节标题，不猜语义。 */
const ANSWER_SECTION_RE = /解法|根因|修复|验证|流程|标准|判据|处置|怎么办|🛠/;

function firstHitLine(body, words) {
  const lines = body.split('\n');
  // 逐行扫描，记录当前所属小节标题，供「答案段优先」用。
  let section = '';
  const candidates = []; // {line, inAnswer}
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('#')) {
      section = t.replace(/^#+\s*/, '');
      continue; // 标题本身不是内容
    }
    if (!t || t === '---') continue;
    const l = t.toLowerCase();
    if (!words.some((w) => l.includes(w.toLowerCase()))) continue;
    if (KNOWN_SLUG_HINT.test(t)) continue;
    // 非内容行：frontmatter 的键值对（tags:/id:/status:/updated:/author:/superseded-by:）
    if (/^(tags|id|status|updated|author|superseded-by|superseded|aliases)\s*:/.test(t)) continue;
    candidates.push({ line: t, inAnswer: ANSWER_SECTION_RE.test(section) });
  }
  if (!candidates.length) return '';
  // 答案段里的行优先；否则回退到第一条命中的正文行
  const best = candidates.find((c) => c.inAnswer) || candidates[0];
  return clip(best.line, 160);
}

// ---------- note: 经验实时暂存（source 页，一念一落，防流失） ----------
const NOTE_DEDUP_MS = 60 * 1000;

export async function cmdNote({ dir, text, tags, when }) {
  const clean = String(text || '').trim();
  if (!clean) return '用法: abs note "经验/坑/技巧一句话" [--when "何时该读它"]（落 sources/ 暂存页，实时不流失）';
  let root;
  try {
    root = await requireBrain(dir || process.cwd());
  } catch {
    return `未找到 .brain/ 图谱。先在项目根运行: abs init`;
  }
  const who = await requireUser(); // 写操作守卫
  await ensurePersonPage(root, who); // 首次写操作即建人页（已存在不动）
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
  // 触发条件（2026-09-16）：经验"写入多读得少"的根因之一是存的是结论、不是"何时该看"。
  // 带上 --when 后，load 的相关页推荐能按当前在做的事匹配，而不是按主题词。
  const whenText = String(when || '').trim();
  const body = [
    '---',
    `tags: [${fmTags}]`,
    `id: ${file.replace(/\.md$/, '')}`,
    `author: ${who}`,
    `updated: ${today()}`,
    'status: draft',
    '---',
    '',
    `# 来源：${heading}`,
    '',
    `TITLE: ${clean}`,
    ...(whenText ? ['', `WHEN: ${whenText}`] : []),
    '',
    `## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）`,
    `- ${clean}`,
    ...(whenText ? [`- 何时读：${whenText}`] : []),
    '',
    '## 关联连接',
    `- ${atTag(who)} — 本页沉淀者`,
    '（提炼成 concepts 规律页后，在此挂双链到该页）',
    '',
  ].join('\n');
  // 源文件是新写唯一文件：tmp+rename 原子落盘（避免并发读读到半写文件）
  const srcFile = join(srcDir, file);
  const tmp = join(srcDir, `.${file}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, srcFile);
  // index Sources 区登记（锁内幂等：别页已登记则跳过，防并发重复） + log 一行
  const slug = file.replace(/\.md$/, '');
  await registerInIndex(root, 'Sources', slug, heading);
  await cmdLog({ dir: root, title: clean, kind: 'note' });
  return `✓ 经验暂存 → sources/${file}\n  ${clean} ${atTag(who)}`;
}

// ---------- concept: 概念页脚手架（给「写入」定结构，不替人做判断） ----------
/** 建一张带骨架的概念页。
 *
 * 为何需要它（实测 2026-09-15）: concepts/ 页原来**没有任何代码写入路径** ——
 * 全靠人/AI 手写 markdown，结果 26 页里 2 页完全没有「做完怎么确认」。
 * 而骨架只写在 skill 的**文字里**（"触发场景/表现/解法/验证命令"），没有执行点 → 看运气。
 * 对照: `abs note` 落的 source 页结构整齐，因为模板在**代码里**。
 *
 * 边界（关键）: 它只给**结构**，不给**内容**。
 * 「这条值不值得留 / 归哪一页」仍靠人判断 —— 那是 skill 明写的分工（深提炼不自动化）。
 * 所以本命令不猜语义、不自动提炼，只在你要新建页时把该有的位置摆好。
 *
 * 尾巴用「占位符」而非真实值: 这样 lint 的 NO-TAIL 判据在占位未填时仍会报
 * （骨架≠完成）。填完删掉占位行即可。 */
export async function cmdConcept({ dir, slug, title, tags, desc }) {
  let root;
  try {
    root = await requireBrain(dir || process.cwd());
  } catch {
    return `未找到 .brain/ 图谱。先在项目根运行: abs init`;
  }
  const raw = String(slug || '').trim();
  if (!raw) {
    return [
      '用法: abs concept <slug> --title "一句话标题" [--tags a,b] [--desc "index 里的一句话"]',
      '  例: abs concept docker-prisma-429 --title "Docker 内存超限导致 Prisma 429"',
      '  说明: 只给骨架（头/中/尾位置），内容仍由你写 —— 判断不自动化。',
    ].join('\n');
  }
  // slug 即文件名（命名即链接）。收口掉路径分隔符与空白，防逃出 concepts/。
  const name = raw.replace(/[\s/\\]+/g, '-').replace(/[^\w\u4e00-\u9fff.-]/g, '').replace(/^-+|-+$/g, '');
  if (!name) return `✗ slug 无效（清洗后为空）: ${raw}`;
  const who = await requireUser();
  await ensurePersonPage(root, who);
  const dirP = brainPath(root, 'concepts');
  await fs.mkdir(dirP, { recursive: true });
  const file = join(dirP, `${name}.md`);
  const head = String(title || '').trim() || name;
  const tagList = ['concept', ...String(tags || '').split(',').map((t) => t.trim()).filter(Boolean)];
  const body = [
    '---',
    `tags: [${tagList.join(', ')}]`,
    `id: ${name}`,
    `author: ${who}`,
    `updated: ${today()}`,
    'status: draft',
    '---',
    '',
    `# 概念：${head}`,
    '',
    '## 触发场景',
    '<!-- 什么情况下该想起这条？（写可检索的词，别只写“遇到问题”） -->',
    '',
    '## ❌ 表现',
    '<!-- 具体症状 / 贴报错 / 复现条件 -->',
    '',
    '## 🛠 解法',
    '<!-- 根因 + 修复 -->',
    '',
    '## 验证',
    '<!-- 做完怎么确认？跑什么命令 / 看什么信号 / 用什么判据。必须填 —— 没尾巴的经验只能被“相信”，不能被“验证” -->',
    '',
    '## 关联连接',
    `- ${atTag(who)} — 本页沉淀者`,
    '（在这挂相关页双链，别留孤岛）',
    '',
  ].join('\n');
  // 独占写（wx）：已存在则 EEXIST —— 与 ensurePersonPage 同路数。
  // 不用「先查后写」：那有 TOCTOU 竞态，且已有人工内容一律不覆盖是本仓硬规则。
  // 也不走 tmp+rename：rename 会默默覆盖已存在文件，而这里必须「存在就拒绝」。
  try {
    await fs.writeFile(file, body, { encoding: 'utf8', flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') {
      return `• 已存在，不覆盖 → .brain/concepts/${name}.md\n  要改请直接编辑（或先删页）；新建请换个 slug。`;
    }
    throw e;
  }
  const oneLine = String(desc || '').trim() || clip(head, 60);
  await registerInIndex(root, 'Concepts', name, oneLine);
  await cmdLog({ dir: root, title: `新建概念页 ${name}`, kind: 'concept' });
  return `✓ 概念页骨架 → .brain/concepts/${name}.md ${atTag(who)}\n` +
    '  已给好四段位置；填完内容后：删掉 <!-- --> 占位、按需改 status: active、挂双链。\n' +
    '  尾部「## 验证」必须填（留空会被 abs lint 报 NO-TAIL）。';
}

// ---------- person: 使用者实体页（首次需要时创建，已存在则不动） ----------
/** 确保 entities/<name>.md 存在。已存在一律不动（里面的技术栈/特点是人工沉淀的）。
 * 用 `wx` 独占写：并发下后到者拿到 EEXIST 就静默跳过，不覆盖。
 * 失败不抛：建页是附带动作，不能因为它让 todo/log 写不进去。
 * 返回 'created' | 'exists' | 'skip'。 */
export async function ensurePersonPage(root, name) {
  const nm = String(name || '').trim();
  if (!nm || !/^[\w\u4e00-\u9fff.-]+$/.test(nm)) return 'skip';
  const dir = brainPath(root, 'entities');
  const file = join(dir, `${nm}.md`);
  const body = [
    '---',
    'tags: [entity, person]',
    `id: ${nm}`,
    `author: ${nm}`,
    `updated: ${today()}`,
    'status: draft',
    '---',
    '',
    `# ${nm}`,
    '',
    '## 技术栈',
    '<!-- 沉淀时填: 主力语言/框架/工具链。例: TypeScript + Node, 熟悉 MCP 协议与 CLI 工具链 -->',
    '',
    '## 特点 / 工作习惯',
    '<!-- 沉淀时填: 决策偏好、沟通习惯、反复出现的判断倾向。例: 先要方案后动手; 质疑"这需求是否需要存在" -->',
    '',
    '## 名下踩过的坑',
    '（本页被 [[todo]] / [[log]] 里的作者标记引用；沉淀经验时在此挂双链）',
    '',
  ].join('\n');
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, body, { encoding: 'utf8', flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') return 'exists';
    return 'skip';
  }
  // 只有真建成才登记 index（否则 index 指向不存在的页 → INDEX-DEAD-LINK）。
  // 放这里而非各调用点：todo/log/note 三条写路径都要登记，抄三遍必漂。
  await registerInIndex(root, 'Entities', nm, `${nm} — 使用者；技术栈 / 特点 / 名下踩过的坑`);
  return 'created';
}

/** 把新页登记进 index.md 的指定分区（幂等）。供人页/其它程序建页用。 */
export async function registerInIndex(root, section, slug, desc) {
  const iP = brainPath(root, 'index.md');
  await editFile(iP, (index) => {
    if (!index || index.includes(`[[${slug}]]`)) return SKIP;
    const sIdx = index.indexOf(`## ${section}`);
    if (sIdx === -1) return SKIP;
    const after = index.indexOf('\n## ', sIdx + 1);
    const line = `- [[${slug}]] — ${desc}`;
    const next = after === -1
      ? `${index.replace(/\s*$/, '')}\n${line}\n`
      : index.slice(0, after) + `\n${line}` + index.slice(after);
    return { text: next };
  });
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
  // 入度统计（不含 index.md）：图上"有人引用它"才算被接上。
  // index 是入口清单（每页都会被登记），算进去就永远不会有 NO-INBOUND —— 失去意义。
  const inbound = new Map();
  for (const p of pages) for (const ln of p.links) inbound.set(ln, (inbound.get(ln) || 0) + 1);
  // index.md 里列的 [[x]] —— 用于反向查死引用（列了但页不存在）
  let indexLinks = [];
  try {
    const idx = await fs.readFile(join(vault, 'index.md'), 'utf8');
    indexLinks = [...idx.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());
  } catch { /* 无 index 则不查 */ }
  const issues = [];

  for (const pg of pages) {
    if (!pg.hasFrontmatter) issues.push(`NO-FRONTMATTER: ${pg.rel}`);
    // ID-DRIFT: 页面写了 id 但已跟文件名(slug)不一致 = 改过名或改过 id。
    // 不是错误（id 就是用来固定身份的），但必须提示：[[slug]] 形式的引用指向的是**文件名**，
    // 改名后旧引用全变 DEAD-LINK；本检查让「静默断链」变成「一条可执行的提示」。
    // 优先看「有没有别的页 id 指向旧名」→ 那才是真正的改名现场。
    if (pg.hasFrontmatter) {
      const id = idOfPage(pg.body, pg.slug);
      // 反向查：有别的页声明 id = 本页 slug，说明本页是从那个 id 改名过来的。
      // 这种才是「改名没同步引用」的真信号；单纯 id≠slug 也可能只是手写的 id。
      if (id !== pg.slug) {
        issues.push(`ID-DRIFT: ${pg.rel} (frontmatter id=${id} ≠ 文件名 ${pg.slug}；` +
          `引用请用 [[${id}]] 或改回文件名)`);
      }
    }
    for (const ln of pg.links) {
      // 两类都不是真链接，只报 TEMPLATE-LINK（且不短路就会再报一次 DEAD-LINK，同一条报两遍）：
      //   ① 模板占位: `[[页面名]]` / `[[slug]]` / `[[Name]]` —— 模板没填
      //   ② 描述语法时引用的字面量: `[[<slug>]]` —— 尖括号不是合法 wikilink 字符，
      //      而是任务描述在解释格式（如 “在 ### 归档 段留下 [[<slug>]] 完成任务 N 条”）。
      // 单靠关键字（slug/name）分辨不了两者，故额外认尖括号形态。
      if (/^<.+>$/.test(ln) || /slug|Name|name|Date|页面名$/.test(ln)) {
        issues.push(`TEMPLATE-LINK: ${pg.rel} -> [[${ln}]]`);
      } else if (!names.has(ln)) {
        issues.push(`DEAD-LINK: ${pg.rel} -> [[${ln}]]`);
      }
    }
    // ORPHAN: sources/ 暂存页与会话/归档页豁免。前者是暂存线索（提炼成 concept 前天然孤立），
    // 后者是历史记录（已登记在 index.md，就是图谱入口，无需再制造双链）。
    // 豁免名单含两种归档命名：旧 `*-todo归档`（存量页仍在）+ 新 `log-*`
    //（2026-09-15 起归档并入当天快照，见 todo.js 的 upsertArchiveSection）。
    const isTerminal = pg.dir === 'sources'
      || /todo归档$/.test(pg.slug)
      || (pg.dir === 'sessions' && /^log-/.test(pg.slug));
    if (!isTerminal && !pg.links.length && !linkedNames.has(pg.slug)) {
      issues.push(`ORPHAN-PAGE: ${pg.rel} (no links out, no links in)`);
    }
    // NO-INBOUND: 有出边但无人指向 = 挂在图上没人接。ORPHAN-PAGE 只抓"零出零入"，
    // 抓不到"连了 5 条出去却没人连它"的悬挂页（实测 concepts/file-shape-check-on-load 即是）。
    // 只查知识页（concepts/entities/syntheses）——sources/sessions 的孤立是设计使然。
    if (['concepts', 'entities', 'syntheses'].includes(pg.dir) && !(inbound.get(pg.slug) || 0)) {
      issues.push(`NO-INBOUND: ${pg.rel} (无人链接到本页；在相关页的 ## 关联连接 挂一条 [[${pg.slug}]]）`);
    }
    // UNRESOLVED-CONFLICT: 有「## 知识冲突」段但还是 draft = 冲突标了没裁决。
    // 判据必须认【段标题】而非页内出现「知识冲突」字样。
    // 坑（2026-09-15 实测）: 原用裸子串 → codebuddy 的会话快照因任务描述里写了
    // 「更新 session-key-fingerprint-flaw（知识冲突裁决）」而误报（它并无该段）。
    // 同 NO-TAIL 的教训: 判据看结构，不看关键词。
    if (/^#{2,6}[^\n]*知识冲突/m.test(pg.body) && /status: draft/.test(pg.frontmatter)) {
      issues.push(`UNRESOLVED-CONFLICT: ${pg.rel}`);
    }
    if (['concepts', 'entities', 'syntheses'].includes(pg.dir)) {
      if (pg.lines > PAGE_MAX_LINES || pg.bytes > PAGE_MAX_BYTES) {
        issues.push(`OVER-SIZE: ${pg.rel} (${pg.lines}L/${pg.bytes}B > ${PAGE_MAX_LINES}L/${PAGE_MAX_BYTES / 1024}KB; 拆或外链)`);
      }
    }
    // NO-TAIL: concept 页只有「头」（触发场景/表现）没有「尾」（可执行的东西）= 只能信，不能验。
    // 尾巴的本质不是「叫验证」，而是【给出可执行的东西】：跑什么 / 怎么查 / 按什么步骤 / 用什么判据。
    //
    // 判据为何要宽（实测）:
    //   26 页的段名高度分散 —— `## ✅ 处置` 出现 17 次，比 `## 🛠 解法` 还多；
    //   还有 `## 做法`(11) / `## 判据` / `## ✅ 正确顺序` / `## 测试要点` / `## 分析步骤`。
    //   只认「验证」二字会误报 7/11（64%）→ 噪音 → 规则被忽略。
    // 判据为何要看「段内有没有真内容」:
    //   `abs concept` 生成的骨架自带 `## 验证` 占位；若只看标题，骨架刚建就被判有尾（假阴性）。
    //   所以必须排除「只有 <!-- 占位 --> 的空段」。
    // 实测此版: 误报 0 / 漏报 0（报出的 2 页确实都没有「做完怎么确认」）。
    if (pg.dir === 'concepts' && !hasTail(pg.body)) {
      issues.push(`NO-TAIL: ${pg.rel}（无「做完怎么确认」；尾巴写清跑什么/看什么/按什么判据，别只有头）`);
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
  if (nsrc > SOURCES_MAX) issues.push(`SOURCES-PILED-UP: sources/ has ${nsrc} files > ${SOURCES_MAX}; 提炼归档旧 source`);

  // SOURCE-UNDISTILLED: source 页超过 SOURCE_STALE_DAYS 天仍没链到任何 concept 页 = 暂存了没归位。
  // 只数总量（SOURCES-PILED-UP）抓不到"4 个 source 里 3 个没提炼"——实测本仓即如此。
  // 判据机械可判：出边里有没有 concepts/ 的页 + mtime 超龄，不猜语义。
  const conceptSlugs = new Set(pages.filter((p) => p.dir === 'concepts').map((p) => p.slug));
  const staleMs = SOURCE_STALE_DAYS * 86400 * 1000;
  for (const pg of pages) {
    if (pg.dir !== 'sources') continue;
    if (pg.links.some((ln) => conceptSlugs.has(ln))) continue;
    let ageMs = 0;
    try { ageMs = Date.now() - (await fs.stat(join(root, pg.rel))).mtimeMs; } catch { continue; }
    if (ageMs > staleMs) {
      issues.push(`SOURCE-UNDISTILLED: ${pg.rel}（${SOURCE_STALE_DAYS} 天未提炼成 concept；提炼后删 source 并清引用）`);
    }
  }

  // SESSIONS-NAMING: sessions/ 的一天一文件契约（见 skill 的「sessions/ 命名契约」）。
  // 实测 codebuddy 乱局（2026-09-15）：一天最多出现 5 个文件、5 种 tags、同天两个快照。
  // 判据纯机械：按“日期前缀”归组——同天 >1 个文件报 SPLIT；单个但非规范名报 NAMING。
  // 只看文件名，不猜内容。
  const sessByDate = new Map();
  for (const pg of pages) {
    if (pg.dir !== 'sessions') continue;
    // 同时认两种写法：规范名 `log-<日期>` 与旧/杂命名 `<日期>-…`。
    // 坑（写测试时抓到的）: 首版只写 `^(\d{4}-…)` → **匹配不上规范名 `log-2026-09-07`**，
    // 于是「一个 log- + 一个旧杂文件」被数成 1 个而非 2 个，漏报。
    const m = pg.slug.match(/^(?:log-)?(\d{4}-\d{2}-\d{2})/);
    if (!m) continue;
    // 长期存续的归档页豁免：**只认独立的 `archive` 标签**（如 `tags: [session-log, archive]`），
    // 不认 `todo-archive`（那是旧归档页的标签，它正是要迁移的对象）。
    // 坑（2026-09-15 在 ~/Docker 实测抓到）: 首版用 `\barchive\b` —— 而 `todo-archive`
    // 里 `-` 与 `a` 之间也是词边界 → **老式归档页全被豁免**，一个都不报（漏报四天）。
    // 豁免是为「外部产物全文归档」（如仓库 todo.md 全文）设的，不是为旧命名归档页。
    const tags = String(pg.frontmatter).match(/^tags:\s*(.+)$/m)?.[1] || '';
    const tagList = tags.replace(/^\[|\]$/g, '').split(',').map((t) => t.trim());
    if (tagList.includes('archive')) continue;
    if (!sessByDate.has(m[1])) sessByDate.set(m[1], []);
    sessByDate.get(m[1]).push(pg.slug);
  }
  for (const [date, slugs] of sessByDate) {
    if (slugs.length > 1) {
      issues.push(`SESSIONS-SPLIT: ${date} 在 sessions/ 有 ${slugs.length} 个文件（${slugs.join('、')}）；` +
        `一天只应有一个 \`log-${date}.md\`：归档写进其「## 📦 任务归档」段，多主题写成多个 ## 子段`);
    } else if (!slugs[0].startsWith('log-')) {
      // 单个文件但**不是规范名** —— 旧命名（`<日期>-todo归档.md` 等）单独存留。
      // 坑（2026-09-15 在 ~/Docker 实测抓到）: 首版只看“同天 >1 个” → 4 个日期
      // 各只有一份 `<日期>-todo归档.md` → 一个都不报（漏报）。
      // 旧命名的页无论是否孤单都该改：跑 `abs todo archive` 后并入 `log-<日期>.md`。
      issues.push(`SESSIONS-NAMING: ${date} 的文件 \`${slugs[0]}.md\` 不是规范名；` +
        `应为 \`log-${date}.md\`（跑 abs todo archive 会并入；旧归档页可删）`);
    }
  }
  // SESSIONS-MISPLACED: sessions/ 里放了 tags 既非 session-log / todo-archive / archive 的页。
  // 实例：codebuddy 的 `2026-09-07-ui-fixes.md`（tags: [source,session-log]）等 5 页 ——
  // 当时做的一组工作不是「暂存线索」，而就是当天的快照正文。
  for (const pg of pages) {
    if (pg.dir !== 'sessions') continue;
    const tags = String(pg.frontmatter).match(/^tags:\s*(.+)$/m)?.[1] || '';
    if (!/session-log|todo-archive|archive/.test(tags)) {
      issues.push(`SESSIONS-MISPLACED: ${pg.rel}（tags: ${tags.trim()} 不属 sessions/；` +
        `当天工作写进 \`log-<日期>.md\` 正文，暂存线索用 \`abs note\` 落 sources/）`);
    }
  }

  // SUPERSEDED-DANGLING: superseded 页声明的取代者也必须存在。
  // 它跟 DEAD-LINK 同性质（指向不存在的页），但后果更重：
  // 读者被引导去找一个不存在的"新版本"，比单纯断链更容易让人以为"没新页就是没替代"。
  for (const pg of pages) {
    if (pg.status !== 'superseded') continue;
    if (!pg.supersededBy) continue; // 无取代者也是合法状态（就是弃用，没替代）
    const by = pg.supersededBy.replace(/^\[\[|\]\]$/g, '').trim();
    if (!names.has(by)) {
      issues.push(`SUPERSEDED-DANGLING: ${pg.rel} (superseded-by: ${by} —— 该页不存在，删页后未同步)`);
    }
  }

  // DRAFT-STALE: draft 停太久 = 既没核实也没被推翻，实质是写了没人看的堆积。
  // 不报 sources（它们由 SOURCE-UNDISTILLED 管），只报 concepts/entities/syntheses ——
  // 那些页是"应该已经被确认过"的长期资产，长期 draft 说明核实环节缺位。
  for (const pg of pages) {
    if (pg.status !== 'draft') continue;
    if (pg.dir === 'sources') continue;
    let ageMs = 0;
    try { ageMs = Date.now() - (await fs.stat(join(root, pg.rel))).mtimeMs; } catch { continue; }
    if (ageMs > DRAFT_STALE_DAYS * 86400 * 1000) {
      const days = Math.floor(ageMs / 86400000);
      issues.push(`DRAFT-STALE: ${pg.rel}（已 ${days} 天停在 draft；核实后改 status: active，推翻则 abs supersede）`);
    }
  }

  // Rules 区：它的价值在“少而重”，且不被折叠（load 每次都全量读）。
  // 无上限增长 = 把 load 又撑回去（同 Done / index 清单的膨胀根因）。
  {
    const idxTxt = await readFileOrNull(join(vault, 'index.md'));
    const { items, found } = readRules(idxTxt);
    if (found && items.length > RULES_MAX) {
      issues.push(`RULES-PILED-UP: Rules 区 ${items.length} 条 > ${RULES_MAX}；把长条目提炼成概念页，这里只留一句话`);
    }
    // 该区是 load 必读的硬规则清单，条目却写得像段落 → 提醒改短句。
    const longOnes = items.filter((l) => l.trim().length > 160);
    if (longOnes.length) {
      issues.push(`RULES-TOO-LONG: Rules 区 ${longOnes.length} 条超 160 字符（如 "${clip(longOnes[0].trim(), 40)}"）；展开写进概念页，这里只留一句话（不带链接）`);
    }
  }

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
    // 完成日期同理必须由工具盖：手写 [x] 时人会抄语义部分（结语）而漏掉机械部分（日期）。
    // 后果不只是排版不齐 —— 无日期行归入 `### （未标日期）` 尾组，而归档靠日期判天数，
    // 故这些行**永远无法被 abs todo archive 迁出**（todo.js:300 保守跳过）。
    // 即：漏一个日期 = 一条永久钉住 Done 区、拖大 load 输出的行。
    // 两处在同一处校验（同一份契约的两半），别只查一半给假信心。
    const noDate = doneBody.filter((l) => /^\s*- \[x\]/.test(l) && !doneDateOf(l));
    if (noDate.length) {
      const sample = (noDate[0].match(/- \[x\] (\S+)/) || [, '?'])[1];
      issues.push(
        `DONE-NO-DATE: Done 区 ${noDate.length} 条缺 \`(完成 YYYY-MM-DD)\`（如 ${sample}）。` +
        `手写的 [x] 不会自动盖日期 —— 补上后重跑；新条目一律走 \`abs todo done <id>\`。`,
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

/** 尾巴关键词：只要段名里带这些「动作词」，就认为作者在给「做完怎么确认」。
 *  为何不限定叫「验证」：实测 26 页段名高度分散（`## ✅ 处置` 17 次 > `## 🛠 解法`），
 *  只认「验证」会误报 7/11（64%）—— 噪音会让规则失去意义。 */
const TAIL_WORDS = '验证|检查|清单|测试|处置|做法|步骤|顺序|判据|信号|怎么';

/** concept 页是否有「尾」（可执行的东西）。
 *  两种真实形态都算：
 *   1. 有带动作词的段标题，且**段内有真内容** —— 排除 `abs concept` 骨架的
 *      `## 验证` + `<!-- 占位 -->`（只看标题会把未填的骨架误判为有尾）。
 *   2. 列表项形式，如 `3. 验证命令：\`cmd\``（hook-sh-not-bash / todo-rewrite-not-map 的写法）。
 *  逐行扫描而非复杂正则：需要「段边界」与「占位识别」，正则会难读且难改。 */
export function hasTail(body) {
  const lines = String(body || '').split('\n');
  const headRe = new RegExp(`^#{2,6}[^\\n]*(${TAIL_WORDS})`);
  for (let i = 0; i < lines.length; i++) {
    if (!headRe.test(lines[i])) continue;
    const lvl = lines[i].match(/^#+/)[0].length;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      const h = lines[j].match(/^(#+)\s/);
      if (h && h[1].length <= lvl) break;        // 本段结束，换下一段找
      if (!t) continue;
      if (t.startsWith('<!--') || t === '-->') continue; // 占位注释不算内容
      return true;
    }
  }
  return new RegExp(`^\\s*(?:\\d+\\.|[-*])\\s*\\**[^\\n]{0,20}(${TAIL_WORDS})`, 'm').test(String(body || ''));
}
const PAGE_MAX_BYTES = 8 * 1024;

// source 页超龄未提炼的天数阈值（SOURCE-UNDISTILLED）。
// 7 天 = 跨过至少一个完整工作周还没人提炼，基本等于被遗忘。
const SOURCE_STALE_DAYS = 7;
// draft 超龄阈值：新落的经验（abs note）默认 draft，指的是"还没核实过"。
// 长期停在 draft = 既没被核实也没被推翻，属"写了没人看"的堆积 —— 不自动改，只报。
const DRAFT_STALE_DAYS = 14;

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
        status: statusOfPage(body, fm ? fm[1] : ''),
        supersededBy: supersededByOf(body),
      });
    }
  }
  return pages;
}
