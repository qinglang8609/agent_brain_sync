// src/brain/load.js — 开机读状态：board / status / load。都是只读呈现。
// 从 store.js 拆出（2026-11-01）：与写命令分开，load 是开机第一入口，读起来要能一口气看完。
import { promises as fs } from 'node:fs';
import { brainPath, requireBrain } from '../index.js';
import { getUser, placeholderWarn } from '../userconfig.js';
import { boardText, readTodo, collapseDone } from '../todo.js';
import { strandedFor } from '../wrapup.js';
import { keywords, recentFiles, topicStrength } from '../relevant.js';
import { readIfExists, recentLogLines } from '../text.js';
import { listPages } from '../lint.js';
import { SOURCES_MAX } from '../lint.js';
import { checkBrainShape } from './shape.js';
import { rulesSection } from './rules.js';
import { collapseIndex } from '../page.js';

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
    // 那句提示只适用于「标题非标准」：其他 warn（如格式不合规）说这句会误导。
    if (shape.warn.some((a) => a.includes('标题非标准'))) {
      rows.push('  （无头文件不自动改：结构可能整体脱轨，请手工对齐 .brain/ 模板）');
    }
    sections.push('--- 文件形状核对 ---', ...rows, '');
  }
  // 未设姓名/姓名是占位名时开场就提醒 —— load 是开机第一屏，不在这里提，
  // 用户要撞到第一次写操作才知道（init/load 一路沉默）。
  // 占位名（历史遗留 tester/foo）必须提：配置里有值 ≠ 名字是对的。
  // 一次调用拿两者（placeholderWarn 内部也要 getUser）—— 原先分两次读盘（2026-10-03 审查）。
  const who = await getUser();
  const ph = who ? await placeholderWarn() : null;
  if (!who) {
    sections.push(
      '⚠ 尚未设置使用者姓名（写操作会先报错）',
      '→ abs config set user <你的名字>    (或临时: ABS_USER=<名字> abs ...)',
      ''
    );
  } else if (ph) {
    sections.push(
      `⚠ 当前作者名是占位名 "${ph}" —— 之后所有项目的 todo/log 都会标它。`,
      '→ abs config set user <你的真名>    (或临时: ABS_USER=<名字> abs ...)',
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
      const bp = t.bp.length ? `\n    ${t.bp.map((b) => (b.startsWith('[') ? `- ${b}` : `- [ ] ${b}`)).join('\n    ')}` : '';
      return `  - ${t.body}${bp}`;
    });
    // 插在项目行之后、其它内容之前
    sections.splice(
      1, 0,
      '⏳ 上会话滞留（未 done，先对账）',
      rows.join('\n'),
      '→ 完成: abs todo done <id>；未完: abs todo note <id> --note 子项',
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
    // 附属行（缩进子项）里找卡点前缀。
    // 旧写法 `↳ 断点: 阻塞: …`（存量）也认 —— 保留一条前缀兼容，以免漏报历史卡点。
    const m = line.match(/^\s*(?:↳\s*(?:断点|卡点)?[:：]\s*)?(?:阻塞|等待|等)[:：]\s*(.+)$/);
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
