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

// Re-export lint.js symbols so external importers (e.g. bin/mcp.js, bin/abs.js) still work.
export { cmdLint, listPages, hasTail, PAGE_DIRS } from './lint.js';
import { SOURCES_MAX, PAGE_DIRS, listPages } from './lint.js';

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
// 两处共用同一常量 —— 阀值只有一个真源（SOURCES_MAX 在 lint.js 定义，此处导入使用）。

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
    const rel = await queryHintSection(root, todo);
    if (rel) sections.push('', rel);
  } catch { /* 提示失败不影响 load */ }
  // sources 堆积提醒：与「滞留」同构 —— 放在每次开工必经的顶部，而不是等人跑 lint。
  // 只数目录条目（不读文件），零成本。提炼仍手工：这里只负责送达，不替判断。
  try {
    const srcWarn = await sourcesCountSection(root);
    if (srcWarn) {
      const at = sections.findIndex((s) => String(s).startsWith('--- Rules'));
      sections.splice(at === -1 ? 1 : at, 0, ...srcWarn);
    }
  } catch { /* 提醒失败不影响 load */ }
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

/** queryHint 的 load 端封装：返回提示文本（含标题行），无强词则空串。失败静默。 */
async function queryHintSection(root, todo) {
  return queryHint(root, todo);
}

/** sources 堆积提醒：返回 [标题行, ...内容行] 或 null。失败静默。 */
async function sourcesCountSection(root) {
  const nsrc = await countSources(root);
  if (nsrc <= SOURCES_MAX) return null;
  return [
    `♻ 待消化: sources/ 有 ${nsrc} 条 > ${SOURCES_MAX}（采集了没提炼）`,
    '→ abs lint 看明细；提炼成 concepts/ 后删 source 并清引用',
    '',
  ];
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

// Re-export query.js symbols so external importers still work.
export { cmdQuery } from './query.js';

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
