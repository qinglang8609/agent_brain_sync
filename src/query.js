// src/query.js — 检索知识图谱（多词 OR，扫全 .md 页）
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { requireBrain, brainPath } from './index.js';
import { rankPage } from './relevant.js';
import { statusOfPage, idOfPage, supersededByOf, clip } from './store.js';
import { DIR_LAYER, decayOf } from './brain/layers.js';

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
          hits.push({ hidden: 'superseded', slug });
          continue;
        }
        // 流水页默认不进结果（2026-11-03 修）：sessions/log-* 是「那天做了什么」
        // 的草稿记录，不是知识页。它正文里碰巧出现检索词不代表它是这条经验所在 ——
        // 与 db search 对齐（db 里层权重把 L5 会话页压到底，query 扫 md 没有这层，
        // 只能显式隐藏）。不是静默消失：计数告知 + --all 可看。
        const isFlow = d === 'sessions' && /^log-/.test(slug);
        if (isFlow && !includeSuperseded) {
          hits.push({ hidden: 'flow', slug });
          continue;
        }
        // draft（未核实）默认也隐藏（2026-11-03 修）：主动 recall 要的是「可信的
        // 知识」，draft 是没核实的草稿，与 db search 对齐（db 里 L7 草稿被层权重
        // 压到底、L4 draft 骨架亮度低）。与 superseded/flow 同待遇：--all 可看。
        if (st === 'draft' && !includeSuperseded) {
          hits.push({ hidden: 'draft', slug });
          continue;
        }
        hits.push({
          full, slug, dir: d, matched: rank.matched, kind: rank.kind, fuzzyScore: rank.score, via: rank.via,
          author: au ? au[1].trim() : '',
          id: idOfPage(body, slug),
          status: st,
          supersededBy: supersededByOf(body),
          snippet: firstHitLine(body, rank.matched.length ? rank.matched : words),
        });
      }
    }
  }
  const hiddenSup = hits.filter((h) => h.hidden === 'superseded').length;
  const hiddenFlow = hits.filter((h) => h.hidden === 'flow').length;
  const hiddenDraft = hits.filter((h) => h.hidden === 'draft').length;
  const hidden = hiddenSup + hiddenFlow + hiddenDraft;
  // 分两区：精确命中优先，模糊只作补充。
  // 坑(2026-09-16 实测): 不加区分时查 file-write-locking 返回 26 页（几乎全图）——
  //   连字符词的 2-gram 太通用，模糊命中把无关页也拉进来。
  //   规则：只要有任何精确命中，模糊命中的就不排在前面（但也不丢弃，单列一段）。
  // 层权重（2026-11-03 修）：query 之前只按分数排，流水页（sessions/log-*）和
  // 草稿（sources/）与内容页同分竞争，于是 log 页挤进前 10。db search 干净的本质
  // 是它按层权重排序 —— sessions=L5(decay 0.75)、sources=L7(decay 0.95)，亮度被
  // 压到 0.25/0.05，而 concepts/entities/syntheses=L4(decay 0.6) 权重 0.4。
  // 这里复用同一套 DIR_LAYER + decayOf，与 db search 对齐，不再用笼统的「降 20 分」
  // （那个修法在命中分数接近时失效，实测「长期记忆 提炼 主动回忆」前 10 仍混 3 个 log 页）。
  // 权重 = 1 - decay（与 db.js 的 layerWeight 同口径）。
  const layerWeight = (h) => Math.max(0.05, 1 - decayOf(DIR_LAYER[h.dir] ?? 4));
  const rankBy = (h) => h.fuzzyScore * layerWeight(h);
  const exactHits = hits.filter((h) => !h.hidden && h.kind === 'exact')
    .map((h) => ({ ...h, score: rankBy(h) }))
    .sort((a, b) => b.score - a.score);
  const fuzzyHits = hits.filter((h) => !h.hidden && h.kind === 'fuzzy')
    .map((h) => ({ ...h, score: rankBy(h) }))
    .sort((a, b) => b.score - a.score);
  // 有精确命中 → 模糊全藏起来（但不静默：告知数量 + 怎么看）
  const fuzzySuppressed = exactHits.length > 0 && fuzzyHits.length > 0;
  const shown = exactHits.length ? exactHits : fuzzyHits;
  if (!shown.length) {
    const extra = hidden ? `（另外 ${hidden} 页被隐藏，用 abs query ${words.join(' ')} --all 查看）` : '';
    return `query [${words.join(', ')}]: 无命中。${extra}用 abs lint 看图谱健康；首次使用先 abs init。`;
  }
  // 输出条数上限（2026-09-30 补）：落实 read-side-output-must-not-scale 规则。
  // query 会把命中页全部渲染；图谱长大到几百页时一次命中 50 页会爆输出。
  // 硬上限 10 页，超出只给计数 + 收窄提示（不给全文 —— 那不是「不静默」，是「可再查」）。
  const MAX_SHOWN = 10;
  const overflow = shown.length - MAX_SHOWN;
  const displayed = shown.slice(0, MAX_SHOWN);
  const lines = displayed.map((h) => {
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
  const anyFull = displayed.some((h) => h.kind === 'exact' && h.matched.length === words.length);
  const tail = [];
  if (words.length > 1 && !anyFull) tail.push('', `（无页同时命中全部 ${words.length} 个词，以下按命中数排序）`);
  if (fuzzySuppressed) tail.push('', `（另有 ${fuzzyHits.length} 页字形相近但字面未命中，已隐藏 —— 它们通常不相关）`);
  if (hiddenSup) tail.push(``, `（${hiddenSup} 页 superseded 已隐藏；--all 可看）`);
  if (hiddenFlow) tail.push(``, `（${hiddenFlow} 页流水已隐藏；--all 可看）`);
  if (hiddenDraft) tail.push(``, `（${hiddenDraft} 页 draft 未核实已隐藏；--all 可看）`);
  if (overflow > 0) tail.push(``, `（另有 ${overflow} 页未展示 —— 用更具体的词收窄：abs query <词1> <词2>）`);
  return [`query [${words.join(', ')}] → ${shown.length} 页（展示前 ${displayed.length} 页）:`, '', ...lines, ...tail].join('\n');
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