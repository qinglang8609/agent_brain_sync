// src/brain/load.js — 开机读状态：board / status / load。都是只读呈现。
// 从 store.js 拆出（2026-11-01）：与写命令分开，load 是开机第一入口，读起来要能一口气看完。
import { promises as fs } from 'node:fs';
import { brainPath, requireBrain } from '../index.js';
import { getUser, placeholderWarn } from '../userconfig.js';
import { boardText, readTodo, collapseDone } from '../todo.js';
import { strandedFor } from '../wrapup.js';
import { keywords, recentFiles, topicStrength, digest } from '../relevant.js';
import { readIfExists, recentLogLines } from '../text.js';
import { listPages } from '../lint.js';
import { SOURCES_MAX } from '../lint.js';
// 判「会话页骨架填没填」的唯一真源在 layers.js（入库侧 db.js 也用它算 unfilled 列）。
// 两处必须同一个判据 —— 否则会出现「load 说不算未填、检索却把它排除掉」的矛盾。
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

/** 从「活跃 todo + 最近改动的文件」推出当前上下文的关键词。
 *
 * 抽成公共函数（2026-11-02）：queryHint（给查询词）与 hotPages（给正文）
 * 都要用，两处各算一遍必然漂移。
 *
 * 已剔掉任务行的结构记号：`- [ ] [状态] <id> [[作者]] —` 里只有「—」后面是真内容。
 * 实测教训（2026-09-17）：不剔的话 `<id>` 与 `[[作者]]` 会进入词表，
 * 而作者名恰好有自己的 entities/<作者>.md 页 → 命中页名 → 提出「查你自己的名字」。
 */
async function contextKeywords(root, todoText) {
  const active = String(todoText || '')
    .split('\n')
    .filter((l) => /^\s*-\s*\[\s*\]/.test(l))
    .map((l) => l.replace(/^\s*-\s*\[\s*\]\s*(?:\[[^\]]*\]\s*)?(?:\S+\s*)?/, '').replace(/\[\[[^\]]*\]\]/g, ' '))
    .join(' ');
  const files = await recentFiles(root, { n: 5 }).catch(() => []);
  const src = [active, files.map((f) => f.name).join(' ')].filter(Boolean).join(' ');
  return { kws: keywords(src), files };
}

/**
 * 开机带出「当前上下文最相关的几页」—— 只给页名 + 一句话摘要，不贴正文。
 *
 * 与 queryHint 的分工（2026-11-02 用户定）：
 *   queryHint 给「该查什么词」，本函数给「该读哪几页」。两者都只是**送达线索**，
 *   不替代 query / db search，也不贴正文。
 *
 * 为何不贴正文：既有判据是「自动带出正文会让 query 更没人用，且无法按需求变化调整词」。
 *   只给页名 + 摘要把选择权留给人：想看再 abs resolve / 读文件。
 *
 * 输入是环境事实（活跃 todo 的关键词 + 最近改过的文件），不需要人先想到搜索词 ——
 *   这正是不依赖「主动查询」的那条路。
 *
 * 降级：库不存在 / 库坏了 / 任何异常 → 返回空串，不影响 load。
 *
 * @param {string} root 项目根
 * @param {string} todoText
 * @param {number} limit 最多几页
 */
export async function hotPagesSection(root, todoText, { limit = 3 } = {}) {
  try {
    const { kws } = await contextKeywords(root, todoText);
    if (!kws.length) return '';
    const { openDb, search, illuminate, dbPath } = await import('./db.js');
    const { promises: fsp } = await import('node:fs');
    const exists = await fsp.stat(dbPath()).then(() => true).catch(() => false);
    if (!exists) return '';   // 库没建 → 静默跳过（不是错误）

    // 项目名要与入库时一致 —— 铁律按项目隔离，读错项目就是串味
    const project = String(root).split('/').filter(Boolean).pop() || '';
    const h = openDb(dbPath());
    try {
      // 用几个强词合并成一组种子：逐个查再按 id 去重取最高亮度
      const seeds = new Map();
      for (const kw of kws.slice(0, 5)) {
        for (const s of search(h, kw, { limit: 6 })) {
          const prev = seeds.get(s.id);
          if (!prev || s.bright > prev.bright) seeds.set(s.id, s);
        }
      }
      if (!seeds.size) return '';
      const lit = illuminate(h, [...seeds.values()], { limit: limit + 6 })
        // 只留本项目的页：跨项目的经验可以查，但不该在开机首屏默认塞进来
        .filter((r) => r.project === project)
        // 再按**纯亮度**重排 —— illuminate 用的是「层权重 × 亮度」，
        // 那是为了让知识页压过流水页（搜索场景对）；但开机首屏要看的是
        // 「跟我现在干的事最贴的」，不是「层级最高的」。
        // 实测：不重排时 L3 的 0.925 会排在 L4 的 1.000 前面 —— 读起来反直觉。
        .sort((a, b) => b.bright - a.bright)
        .slice(0, limit);
      if (!lit.length) return '';

      const rows = ['--- 当前最相关（按亮度，纯线索不贴正文；要看用 abs resolve <页名>）---'];
      for (const r of lit) {
        const one = await fsp.readFile(brainPath(root, r.dir, `${r.slug}.md`), 'utf8').catch(() => '');
        const about = one ? digest(one, 80) : '';
        const tag = r.from === 'spread' ? ' ↝' : '';
        rows.push(`  ${r.bright.toFixed(2)} L${r.layer} [[${r.slug}]]${tag}${about ? ' — ' + about : ''}`);
      }
      return rows.join('\n');
    } finally {
      h.close();
    }
  } catch {
    return '';   // 任何异常都不该弄坏 load
  }
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
export async function queryHint(root, todoText, pages) {
  const { kws, files } = await contextKeywords(root, todoText);
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



/**
 * recall：卡住时主动取「跟当前处境相关的几页」，不需要先想到检索词。
 *
 * 为何要它（2026-11-03 实测）：hotPages 只挂在 load 上，于是只有开工那一刻会送页。
 *   实测一场完整会话从头到尾没调过一次 abs —— 不是检索不准（命中确实准），
 *   而是「要人先想到发起查询」这一步天然被跳过。一个出口只开一次，就等于没开。
 *
 * 与 hotPages 的分工：hotPages 是开机首屏（自动、固定 3 页）；
 *   recall 是随时可调（agent 卡住/换方向时自己跑），且能补词。
 *   两者共用 contextKeywords + 亮度搜索，不各算一套。
 *
 * 词从哪来：
 *   - 传了词 → 用它（这时它就是个带上下文的搜索，仍会补处境词）
 *   - 没传词 → 纯靠处境（活跃 todo 的关键词 + 最近改过的文件）
 * 全部凭空无词 → 说清楚缺什么，不返回空列表充数。
 *
 * @param {{dir?:string, terms?:string[], limit?:number}} opts
 */
export async function cmdRecall({ dir, terms, limit = 5 } = {}) {
  const given = (terms || []).flatMap((t) => String(t).trim().split(/\s+/)).filter(Boolean);
  let root;
  try {
    root = await requireBrain(dir || process.cwd());
  } catch {
    return '未找到 .brain/ 图谱（无记忆可查）。先在项目根运行: abs init';
  }
  const todo = await readTodo(root).catch(() => '');
  let kws = [];
  let files = [];
  try {
    ({ kws, files } = await contextKeywords(root, todo));
  } catch {
    // 拔词失败不该拦住整个 recall
  }
  // 手动传的词优先级最高：用户/agent 已经想清楚要什么，就别把处境词混进去稀释
  const words = given.length ? given : kws.slice(0, 5);
  if (!words.length) {
    return 'recall: 无从判断当前处境（todo 空、近期无改动、也没给词）。\n'
      + '→ 直接给词: abs recall <词1> <词2>；或先 abs todo add 把在干的事登记上。';
  }
  try {
    const { openDb, search, illuminate, dbPath } = await import('./db.js');
    const { promises: fsp } = await import('node:fs');
    const exists = await fsp.stat(dbPath()).then(() => true).catch(() => false);
    if (!exists) return 'recall: 图数据库还没建（亮度检索需要它）。先跑: abs db rebuild';

    const project = String(root).split('/').filter(Boolean).pop() || '';
    const h = openDb(dbPath());
    let lit;
    try {
      const seeds = new Map();
      // 整串先查（实测：`db search "并发 锁"` 能出 file-write-locking，
      // 而逐词分开查的种子表里根本没它 —— 2-gram 索引对整串和单词的切法不同，
      // 拆开就把最有用的命中拆没了。所以整串优先，再用逐词兜底补漏。
      const whole = given.length ? words.join(' ') : words.join(' ');
      for (const s of search(h, whole, { limit: 12 })) seeds.set(s.id, s);
      for (const w of words) {
        for (const s of search(h, w, { limit: 6 })) {
          const prev = seeds.get(s.id);
          if (!prev || s.bright > prev.bright) seeds.set(s.id, s);
        }
      }
      if (!seeds.size) {
        return `recall [${words.join(', ')}]: 库里没搜到相关页。\n`
          + '→ 换个说法: abs recall <别的词>；看图谱全貌: abs query <词>。';
      }
      // 流水页降权（2026-11-03 实测）：不加时前 5 位里挤进 2 页 sessions/log-*，
      // 还被排到第一，把 file-write-locking 这种真经验页顶下去。
      // 与 query 用同一套判据（lint.js 的 isTerminal），不另造。只降权不剔除。
      const isFlow = (r) => r.dir === 'sources' || (r.dir === 'sessions' && /^log-/.test(r.slug));
      lit = illuminate(h, [...seeds.values()], { limit: limit * 8 })
        .filter((r) => r.project === project)
        .sort((a, b) => (b.bright - (isFlow(b) ? 1 : 0)) - (a.bright - (isFlow(a) ? 1 : 0)))
        .slice(0, limit);
    } finally {
      h.close();
    }
    if (!lit.length) {
      return `recall [${words.join(', ')}]: 搜到了种子，但本项目的页没有亮起来。\n`
        + '→ 试试 abs query <词> 看全图命中。';
    }
    const rows = [`recall [${words.join(', ')}] → ${lit.length} 页（按亮度；看全文: abs resolve <页名>）`];
    if (!given.length) {
      const why = [
        files.length ? `近期改动 ${files.length} 个文件` : '',
        todo ? '活跃 todo' : '',
      ].filter(Boolean).join(' + ');
      if (why) rows.push(`  处境: ${why}`);
    }
    rows.push('');
    for (const r of lit) {
      const one = await fsp.readFile(brainPath(root, r.dir, `${r.slug}.md`), 'utf8').catch(() => '');
      const about = one ? digest(one, 80) : '';
      rows.push(`  ${r.bright.toFixed(2)} L${r.layer} [[${r.slug}]]${about ? ' — ' + about : ''}`);
    }
    return rows.join('\n');
  } catch (e) {
    return `recall 失败: ${e instanceof Error ? e.message : String(e)}`;
  }
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
