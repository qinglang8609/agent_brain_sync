/**
 * 检索打分：把一组查询词打成一页的分数（query.js 用它排序）。
 *
 * 2026-11-23 清掉死代码：「相关页自动带出」（scorePage / pickRelevant / renderRelevant /
 *   topicStrength / keywords / digest）已无任何生产调用者 —— 2.0.0 重构把 load 里的
 *   自动带出拿掉了，而 2026-11-08 用户已定「load 只留三样，查询提示撤出首屏」。
 *   留着只会让人误以为断点和相关页有人自动推。要恢复先确认 load 首屏预算。
 *
 * 断点（anchors）在这条路上的位置：query.js 用页面声明的 anchors 给命中页额外加权。
 *
 * 两级匹配：
 *   exact  = 查询词直接出现（子串）
 *   fuzzy  = 查询词的 2-gram 有重叠（如查 "并发写" 能中写"互斥/锁"的页）
 *
 * 为何需要 fuzzy（2026-09-16 实测根因）：
 *   原 cmdQuery 只做 body.includes(word) —— 查"并发写"时页里写的是"互斥"、
 *   查"发布流程"时页名是 npm-publish-flow，全部匹配不上。
 *   用户看到"无命中"会以为图谱里没这条经验（静默失效）。
 */
/**
 * 把「查询词侧的 2-gram」提前算一次（2026-11-20 性能审查）。
 *
 * 原来每个页面都重算一遍同样的查询 gram：92 页 × 若干词，纯重复劳动。
 * CPU profile 里 query 的 ngrams 占 15%。这里算一次、往下传。
 */
export function prepareQuery(queryWords) {
  const qGrams = new Set(queryWords.flatMap((w) => ngrams(String(w).toLowerCase())));
  const fuzzyWords = queryWords.filter(hasCJK);
  const fuzzyQGramCount = new Set(fuzzyWords.flatMap((w) => ngrams(String(w).toLowerCase()))).size;
  // 模糊兜底只对 CJK 查询词生效（rankPage 里 fuzzyWords 为空就直接不走）。
  // 查询全是 ASCII 时页侧 gram 算了也用不上 —— 省掉整页 4000 字的 2-gram 计算。
  const needGrams = fuzzyWords.length > 0;
  return { qGrams, fuzzyQGramCount, needGrams };
}

export function matchPage(body, pageName, queryWords, prepared) {
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
  if (prepared && !prepared.needGrams) return { exact, overlap: 0, ratio: 0 };
  const qGrams = prepared?.qGrams ?? new Set(queryWords.flatMap((w) => ngrams(String(w).toLowerCase())));
  const pGrams = pageGrams(text, name);
  let overlap = 0;
  for (const g of qGrams) if (pGrams.has(g)) overlap++;
  const ratio = qGrams.size ? overlap / qGrams.size : 0;
  return { exact, overlap, ratio };
}

/** 页正文侧 2-gram 集合的缓存。
 *
 * 为何缓存（2026-10-07 实测）：load 慢的根因就在这里。
 *   queryHint 走 topicStrength → 对【每个词 × 每一页】调 rankPage → matchPage，
 *   而每次都对同一页重算 ngrams(text.slice(0,4000))。
 *   实测规模：17 个活跃词 × 63 页 = 1071 次 matchPage，实测 156ms，
 *   而不同页只有 63 个 —— 同一次展开算了 17 遍。
 *   CPU profile：matchPage + ngrams + 那条正则占 load 总耗时的 82%。
 *   端到端：改看板前 191ms / 空看板 40ms（todo 越大词越多 → 越慢，用户实报的「卡」）。
 *
 * 键的构造（关键）：用正文当 Map 的键、页名当二级 Map 的键 —— 两级分开存，
 *   而不是拼成一个字符串键。好处：「同正文不同页名」天然是两个不同的表项，
 *   永远不可能互相覆盖（曾用 name+NUL+text 拼串，那是在赌没人会改错键；
 *   现有 20 个测试实际上抓不住那种错，改成两级后这个 bug 类不存在）。
 * 缓存值是**只读的 Set**，matchPage 只查不改 —— 避免把页名 gram 写进缓存。
 *
 * 为何用普通 Map（非 WeakMap）：字符串是原始值，不能当 WeakMap 键。
 *   故给容量上限，满了清空（一轮遍历内复用已足够）——
 *   ponytail: 不做 LRU，清空式淘汰对本场景够用。
 */
const PAGE_GRAMS_CACHE = new Map();
const PAGE_GRAMS_MAX = 500;

/** 取（或算）一页的 2-gram 集合（含页名）。返回的 Set 只读，调用方不得修改。 */
function pageGrams(text, name) {
  // 两级 Map：外层按正文、内层按页名。不用拼串键 —— 见上方注释。
  let inner = PAGE_GRAMS_CACHE.get(text);
  if (inner) {
    const hit = inner.get(name);
    if (hit) return hit;
  } else {
    if (PAGE_GRAMS_CACHE.size >= PAGE_GRAMS_MAX) PAGE_GRAMS_CACHE.clear();
    inner = new Map();
    PAGE_GRAMS_CACHE.set(text, inner);
  }
  const set = new Set(ngrams(text.slice(0, 4000)).concat(ngrams(name)));
  inner.set(name, set);
  return set;
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

/** 是否走 2-gram 模糊兜底。
 *
 * 只对【含中文】的查询词生效（2026-09-17 实测根因）。
 * 为何要这道门：字符 2-gram 是给中文设计的（"并发写"→"互斥"），中文 gram 有区分度；
 * 英文没有 —— "relevant" 的 7 个 gram(re,el,ev,va,an,nt) 在**任意**英文页里都存在，
 * ratio 恒为 1.0，稳过 FUZZY_MIN=0.6 → 每页都命中。
 * 实测（44 页图谱）：query relevant → 30 命中全是 fuzzy score=10，而 "relevant" 在
 * 页面里出现 0 次；query store → 42/44 命中。这些命中是巧合子串，不是相关。
 * 收紧后同一图谱：relevant 30→0、store 42→16（剩下的 16 是真子串命中）。
 * 反证该门不误伤：20 个真实中文查询（并发写/静默失效/陈旧路径…）实测 fuzzy 命中全为 0，
 * 全走精确路径 —— 收紧后逐字不变。
 */
export function hasCJK(s) {
  return /[\u4e00-\u9fa5]/.test(String(s || ''));
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
export function rankPage(body, pageName, queryWords, prepared) {
  const { exact, overlap, ratio } = matchPage(body, pageName, queryWords, prepared);
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
  const fuzzyWords = queryWords.filter(hasCJK);
  const qGramCount = prepared?.fuzzyQGramCount
    ?? new Set(fuzzyWords.flatMap((w) => ngrams(String(w).toLowerCase()))).size;
  if (fuzzyWords.length && qGramCount >= FUZZY_MIN_GRAMS && ratio >= FUZZY_MIN)
    return { kind: 'fuzzy', matched: [], score: ratio * 10, overlap, ratio, via: { tag: [], title: [], body: [] } };
  return null;
}
