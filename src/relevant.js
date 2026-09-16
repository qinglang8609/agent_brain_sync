/**
 * 相关页推荐：按"当前在干什么"挑出该读的知识页。
 *
 * 为何需要它（2026-09-16 实测）：
 *   MCP 日志里 abs_task 234 / abs_note 54 / abs_load 53，而 abs_query 只有 2 次。
 *   写入 288 : 检索 2 = 144:1。经验写进去了，几乎从没被读回来。
 *
 * 根因不是"忘了查"，是【给人看目录，人不会去翻书】：
 *   load 只给 index 的一句话清单 → 模型觉得"我记过了" → 开工 → 真需要时靠印象。
 *   模型不知道自己不知道什么，所以永远不会主动 query。
 *
 * 解法：不依赖主动查询 —— load 时【被动带出】相关页正文。
 *   匹配依据是"当前在干什么"，不是"主题词"：
 *     · 最近改过的源文件名      → 我现在在动哪个模块
 *     · todo 里活跃任务         → 我现在在做什么事
 *
 * 为何不用 git：本项目 store.js 是纯文件操作，引 git 要处理
 *   “没装 git / 不是 repo / 子进程 27ms”三种情况，为取几个文件名不值。
 *   改用 mtime 扫最近改动 —— 信息量相同，零依赖。
 *
 * 与 query 的区别：
 *   query 需要用户/模型先想到一个词；本模块不需要 —— 输入是环境事实。
 */

/** 中文/英文都按"够长才算有效词"处理，避免 the/的/了 这类噪音。 */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'when', 'then',
  'abs', 'src', 'test', 'js', 'ts', 'md', 'json', 'node',
  '的', '了', '是', '在', '和', '与', '或', '把', '被', '给', '对', '从',
]);

/** 从任意文本抽关键词：英文词(>=3) + 中文 2-gram。 */
export function keywords(text) {
  const out = new Set();
  const s = String(text || '');
  // 英文/数字/下划线词
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9_-]{2,}/g)) {
    const w = m[0].toLowerCase();
    if (!STOP.has(w)) out.add(w);
  }
  // 中文串 → 2-gram（中文没有词边界，2-gram 是最省事的可匹配单位）
  for (const m of s.matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
    const seg = m[0];
    for (let i = 0; i + 2 <= seg.length; i++) {
      const g = seg.slice(i, i + 2);
      if (!STOP.has(g)) out.add(g);
    }
  }
  return [...out];
}

/**
 * 给一页打分：命中多少关键词（标题权重 3，正文权重 1）。
 * 不做 TF-IDF —— 图谱就 30 页，朴素加权够用，也更好解释。
 */
export function scorePage(body, pageName, kws) {
  const title = String(pageName).toLowerCase();
  const text = String(body).toLowerCase();
  let score = 0;
  const hit = [];
  for (const k of kws) {
    const inTitle = title.includes(k);
    const n = text.split(k).length - 1;
    if (!inTitle && !n) continue;
    score += (inTitle ? 3 : 0) + Math.min(n, 3);
    hit.push(k);
  }
  return { score, hit };
}

/**
 * 挑出 top-N 相关页。
 * @param {{name:string,body:string}[]} pages
 * @param {string[]} kws
 * @param {number} n
 */
export function pickRelevant(pages, kws, n = 3) {
  if (!kws.length) return [];
  return pages
    .map((p) => {
      const { score, hit } = scorePage(p.body, p.name, kws);
      return { ...p, score, hit };
    })
    .filter((p) => p.score > 0)
    // 同分时按名字排，保证输出稳定（否则测试会抖）
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, n);
}

/**
 * 扫最近改过的源文件名（mtime 排序，不调 git）。
 * 跳过 .brain/（那是图谱自己）、node_modules、隐藏目录。
 */
export async function recentFiles(root, { n = 8, days = 3 } = {}) {
  const fs = await import('node:fs/promises');
  const { join } = await import('node:path');
  const cutoff = Date.now() - days * 86400_000;
  const found = [];
  const SKIP = new Set(['node_modules', '.git', '.brain', 'dist', 'build']);
  async function walk(d, depth) {
    if (depth > 3 || found.length > 400) return;
    let ents;
    try { ents = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) { await walk(p, depth + 1); continue; }
      if (!/\.(js|ts|mjs|cjs|jsx|tsx|py|go|rs|sh)$/.test(e.name)) continue;
      try {
        const st = await fs.stat(p);
        if (st.mtimeMs >= cutoff) found.push({ name: e.name, path: p.replace(root + '/', ''), mtime: st.mtimeMs });
      } catch { /* 忽略不可读 */ }
    }
  }
  await walk(root, 0);
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, n);
}

/**
 * 两级匹配：
 *   exact  = 查询词直接出现（子串）
 *   fuzzy  = 查询词的 2-gram 有重叠（如查 "并发写" 能中写"互斥/锁"的页）
 *
 * 为何需要 fuzzy（2026-09-16 实测根因）：
 *   原 cmdQuery 只做 body.includes(word) —— 查"并发写"时页里写的是"互斥"、
 *   查"发布流程"时页名是 npm-publish-flow，全部匹配不上。
 *   用户看到"无命中"会以为图谱里没这条经验（静默失效）。
 */
export function matchPage(body, pageName, queryWords) {
  const text = String(body).toLowerCase();
  const name = String(pageName).toLowerCase();
  const exact = [];
  for (const w of queryWords) {
    const q = w.toLowerCase();
    if (text.includes(q) || name.includes(q)) exact.push(w);
  }
  // 模糊：拿查询词的字符 2-gram 去页里找，重叠度足够就算关联
  // 坑(2026-09-16 实测): 曾用 overlap/qGrams.size >= 0.5 —— 太松。
  //   查"zzzz不存在"时 qGrams={zz,不存,存在}, 页里恰好有"存在" → ratio=0.5 误命中。
  //   两个修正: (1) 重复字符的 gram 不算(zz 去重); (2) 至少得命中 2 个不同 gram。
  const qGrams = new Set(queryWords.flatMap((w) => ngrams(String(w).toLowerCase())));
  const pGrams = new Set(ngrams(text.slice(0, 4000)).concat(ngrams(name)));
  let overlap = 0;
  for (const g of qGrams) if (pGrams.has(g)) overlap++;
  const ratio = qGrams.size ? overlap / qGrams.size : 0;
  return { exact, overlap, ratio };
}

/** 拆字符 2-gram（中英文都适用）—— 模糊匹配的最小单位。
 *  先过 [\p{L}\p{N}] 再切，单一字符组成的 gram(如 zz) 没区分度，丢掉。 */
function ngrams(s) {
  const out = [];
  const clean = s.replace(/[^\p{L}\p{N}]+/gu, '');
  for (let i = 0; i + 2 <= clean.length; i++) {
    const g = clean.slice(i, i + 2);
    if (g[0] === g[1]) continue; // zz / 11 这类无信息量
    out.push(g);
  }
  return out;
}

/** 模糊门槛 + 最小 gram 数（见 rankPage 注释） */
export const FUZZY_MIN = 0.6;
// 查询词去重后的 gram 数必须≥4：否则 "zzzz不存在" 只剩 [不存,存在] 两个 gram，
// 两个都在任意中文页里 → ratio=100% 误命中（实测）。分母够大才拉得动比例。
export const FUZZY_MIN_GRAMS = 4;

/** 从 frontmatter 取 tags 列表。无 frontmatter / 无 tags → []。 */
export function tagsOf(body) {
  const m = String(body || '').match(/^tags:\s*(.+)$/m);
  if (!m) return [];
  return m[1]
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * 端到端检索：把一组查询词打成一页的分数。
 * 返回 null = 不相关（既不精确命中，模糊重叠也不够）。
 *
 * 权重（tags 最高，2026-09-16 用户定）：
 *   tags 命中  —— 人工提炼的关键词，最可靠  → 权重 8/个
 *   标题命中  —— 页名往往就是主题          → 权重 4/个
 *   正文命中  —— 可能出现但可能只是提一句  → 权重 1/个（封顶 3）
 *
 * 为何 tags 优先：实测现有页的 tags 写着大量人工词组（"静默失效"、
 *   "双副本"、"陈旧路径"），而 firstHitLine 一直把 tags 行当噪音跳过 ——
 *   等于把最准的检索信号丢掉了。
 */
export function rankPage(body, pageName, queryWords) {
  const { exact, overlap, ratio } = matchPage(body, pageName, queryWords);
  if (exact.length) {
    const tags = tagsOf(body).map((t) => t.toLowerCase());
    const name = String(pageName).toLowerCase();
    const text = String(body).toLowerCase();
    let score = 10 + exact.length * 5;
    const via = { tag: [], title: [], body: [] };
    for (const w of exact) {
      const q = String(w).toLowerCase();
      if (tags.some((t) => t === q || t.includes(q) || q.includes(t))) {
        score += 8; via.tag.push(w);
      } else if (name.includes(q)) {
        score += 4; via.title.push(w);
      } else if (text.includes(q)) {
        score += 1; via.body.push(w);
      }
    }
    return { kind: 'exact', matched: exact, score, overlap, ratio, via };
  }
  const qGramCount = new Set(queryWords.flatMap((w) => ngrams(String(w).toLowerCase()))).size;
  if (qGramCount >= FUZZY_MIN_GRAMS && ratio >= FUZZY_MIN)
    return { kind: 'fuzzy', matched: [], score: ratio * 10, overlap, ratio, via: { tag: [], title: [], body: [] } };
  return null;
}

/** 取页正文的摘要：优先 frontmatter 的 description，退化到首个非标题行。 */
export function digest(body, maxLen = 200) {
  const lines = String(body || '').split('\n');
  const fmEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  if (fmEnd > 0) {
    const d = lines.slice(1, fmEnd).find((l) => /^description\s*:/.test(l));
    if (d) return d.replace(/^description\s*:\s*/, '').trim().slice(0, maxLen);
  }
  // 无 description 时跳过整个 frontmatter 区 —— 否则会把 'title: X' 当正文。
  const start = fmEnd > 0 ? fmEnd + 1 : 0;
  const first = lines
    .slice(start)
    .find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('---'));
  return (first || '').trim().slice(0, maxLen);
}

/** 渲染"该读的页"段。无命中返回空串（不占 load 体积）。 */
export function renderRelevant(picked, why = '') {
  if (!picked.length) return '';
  const out = [`--- 相关页（据当前改动/任务自动带出）${why ? ` [${why}]` : ''} ---`];
  for (const p of picked) {
    out.push(`[[${p.name}]] (${p.score}) — ${digest(p.body)}`);
    out.push(`  命中: ${p.hit.slice(0, 8).join(' ')}`);
  }
  out.push('（这些页与你当前在做的事相关；不必再 query）');
  return out.join('\n');
}
