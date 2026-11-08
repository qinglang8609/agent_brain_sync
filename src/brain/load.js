// src/brain/load.js — 开机读状态：board / status / load。都是只读呈现。
// 从 store.js 拆出（2026-11-01）：与写命令分开，load 是开机第一入口，读起来要能一口气看完。
import { promises as fs } from 'node:fs';
import { brainPath, requireBrain } from '../index.js';
import { getUser, placeholderWarn } from '../userconfig.js';
import { boardText, readTodo, collapseDone } from '../todo.js';
import { strandedFor } from '../wrapup.js';
import { readIfExists, recentLogLines } from '../text.js';
import { SOURCES_MAX } from '../lint.js';
// 判「会话页骨架填没填」的唯一真源在 layers.js。
import { digestFilled } from './layers.js';

/** 未填会话页在 load 里最多列几个页名（其余折叠成条数）。
 *  为何要限：会话页数量只增不减，全列会让 load 首屏随规模膨胀
 *  —— 违反本仓「读取侧输出不得随规模增长」。5 个够 agent 判断先填哪张。 */
const SESSION_UNFILLED_SHOW = 5;
/** 开机屏的使用方法（2026-11-08 用户定 load 三件套之一）。一行一个动作，别写成手册。 */
const LOAD_USAGE = [
  '--- 用法 ---',
  '接经验   abs search <词> / abs recall     记一句   abs note "…"',
  '立概念   abs concept <id> --title "…"      登记活   abs todo start <id> --note "做什么"',
  '收尾     abs todo done <id> --as 落地|否决|仅方案 "结论"',
  '体检     abs lint        看全量     abs show index|log|status',
  '纪律: 绝不通读 .brain/；检索词一冒出来就查，别等报错。',
].join('\n');
import { checkBrainShape } from './shape.js';
import { readRules } from './rules.js';


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
  // 2026-11-08 用户定：load 只留三样 —— 未完成 todo、使用方法、最近日志。
  // Rules 全文 / 图谱计数 / Done 折叠明细 / 查询提示 / 热点页 撤出开机屏；
  // 逃生口还在：abs rule / abs show index / abs todo --full / abs lint。
  const board = collapseDone(todo);
  const todoHead = String(board.text || '').split(/\n## Done/)[0].trim();
  const { items: ruleItems } = readRules(index);
  const blocks = extractBlocks(todo);
  sections.push(
    `📖 Rules ${ruleItems.length} 条（违反会丢数据/静默失效；全文: abs rule）`,
    '',
    '--- 未完成 (todo.md) ---',
    todoHead || '(无未完成任务)',
    ...(blocks.length
      ? [`  ⛔ 卡点 ${blocks.length} 条: ${blocks.map((b) => `${b.id}(${b.why})`).join('; ')}`]
      : []),
    `  Done ${board.doneCount} 条已折叠（明细: abs todo --full）`,
    '',
    '--- 最近动作 (log.md, 最新 3 条) ---',
    recentLogLines(log, 3, 140) || '(log.md 为空)',
    '',
    LOAD_USAGE,
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

  // 未填会话页 / sources 堆积：只给一行计数，不列页名（细节走 abs ingest --list / abs lint）。
  // 当年列页名是为送达；现在按总量预算收口，一线足够让人决定要不要深查。
  try {
    const sessWarn = await unfilledSessionSection(root, { oneLine: true });
    if (sessWarn) sections.push('', sessWarn);
  } catch { /* 提醒失败不影响 load */ }
  try {
    const srcWarn = await sourcesCountSection(root, { oneLine: true });
    if (srcWarn) sections.push('', srcWarn);
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

/** 会话页 fill 判据：骨架段是否还没人填。
 *
 * 为何要这个判据（2026-11-05）：`abs ingest` / hook 的 --auto 落的是**空骨架**，
 *   内容要读会话后填。但「落了没填」原来没有任何地方看得见 —— 落盘等于进了黑洞，
 *   正是本仓反复踩的「采集了不消化」。这里只判「填没填」，不判「该不该留」。
 *
 * 判据是「骨架段里填过没有」，段标题层级不写死 —— 摘要并进当天页后骨架段是 `###`。
 * 只认 ingest 生成的三种骨架段名（见 ingest.js 的 SHAPES）——它们都带
 * `<!-- 提示 -->` 占位；任何一段有了真内容就算填过。
 *
 * 不看 status：人可能填完忘了改 active。用 status 当判据会漏报，
 * 反过来「status: draft 但已填」也不该反复提醒。 */
/** 未填会话页提醒：返回 [标题行, ...内容行] 或 null。失败静默。
 *
 * 守「读取侧输出不随规模增长」：只列表头最多 SESSION_UNFILLED_SHOW 个页名，
 * 其余折叠成条数。页名够用 —— agent 要读哪张再 abs resolve 那一张，别在这贴正文。 */
async function unfilledSessionSection(root, { oneLine = false } = {}) {
  let files;
  try {
    files = await fs.readdir(brainPath(root, 'sessions'));
  } catch { return null; }
  const unfilled = [];
  for (const f of files) {
    if (!f.endsWith('.md') || f.startsWith('_')) continue;
    const body = await fs.readFile(brainPath(root, 'sessions', f), 'utf8').catch(() => '');
    if (!body) continue;
    // 只认 ingest 落的页：它有 `kind: session-digest`。手写页不该被催。
    // 不再按文件名前缀筛（2026-11-08）：会话摘要已并进当天的 `log-<日期>.md`，
    // 文件名里没有会话 id，前缀判据会把它整类漏掉。
    if (!/^kind:\s*session-digest$/m.test(body)) continue;
    if (!digestFilled(body)) unfilled.push(f.replace(/\.md$/, ''));
  }
  if (!unfilled.length) return null;
  // 2026-11-08 load 三件套收口：只回一行计数，不列页名（列名那套留给 --list / 以后要用再传 oneLine:false）。
  if (oneLine) return `📝 未填会话页 ${unfilled.length} 张（abs ingest --list 看哪几张；不进检索，不急着全填）`;
  // 按日期倒序（2026-11-05 实测修正）：原来按 readdir 顺序（≈文件名升序），
  // 60 张时列出来的是 18/27/36/45/54 —— 随机五张，既不是最近的也不是最该填的。
  // 页名现在是 `log-<日期>`，日期就在里面，直接按名字倒排即可。
  unfilled.sort((a, b) => b.localeCompare(a));
  const show = unfilled.slice(0, SESSION_UNFILLED_SHOW);
  const rows = [
    `📝 未填会话页 ${unfilled.length} 张（会话已落盘，内容还没人读）`,
    ...show.map((s) => `  - ${s}`),
  ];
  if (unfilled.length > show.length) {
    rows.push(`  …另有 ${unfilled.length - show.length} 张更早的（不逐条列，守读取侧不膨胀）`);
  }
  // 数量大时明说「别想着全填」——否则这个提醒会变成一种罪疚感，而不是决策依据。
  if (unfilled.length > SESSION_UNFILLED_SHOW) {
    rows.push('  挑最近、且有结论的那几场填；其余留着当流水，不填也不用管（它们不进检索）。');
  }
  rows.push('→ 填法: abs resolve <页名> 读那张 → 按骨架段写内容 → status 改 active');
  rows.push('');
  return rows;
}

/** sources 堆积提醒：返回 [标题行, ...内容行] 或 null。失败静默。 */
/** 数 sources/ 下的 .md 文件数（只读目录，不解析内容）—— load 顶部提醒用。
 *  坑: root 是【项目根】，图谱在 root/.brain/ 下 —— 必须走 brainPath，
 *  直接用 join(root,'sources') 会 ENOENT 被 catch 吞成 0，成为又一个静默失效。 */
async function countSources(root) {
  try {
    const files = await fs.readdir(brainPath(root, 'sources'));
    return files.filter((f) => f.endsWith('.md') && !f.startsWith('_')).length;
  } catch { return 0; }
}

async function sourcesCountSection(root, { oneLine = false } = {}) {
  const nsrc = await countSources(root);
  if (nsrc <= SOURCES_MAX) return null;
  if (oneLine) return `♻ 待消化: sources/ 有 ${nsrc} 条 > ${SOURCES_MAX}（abs lint 看明细）`;
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
