// code/brain/page-meta.js — 知识页 frontmatter 的两项元数据：七层归属 + 断点词。
//
// 为什么要有这一层（2026-11-20 用户定，参照 /Users/fanchao/Code/abs 的七层与断点机制）：
//   - 七层（L1 铁律 … L7 混沌）本来就在 layers.js 里有，但页面里**只有 36/92 个**写了
//     `layer:`，其余靠目录猜。层决定检索权重（decay），猜出来的和写出来的会漂。
//   - 断点（L6）的定义是「页面里的 [[双链词]]」——检索时命中一个词就能激活整页。
//     它是词索引，不是新页面；但要能机械抽取，就得有一份**显式声明**，
//     否则每次都得扫全文重猜，且页面改了词就悄悄变了。
//
// 两条硬约束（照 layers.js 的规矩来）：
//   1. 只补不猜：已有 `layer:` / `anchors:` 一律原样保留（人工写过的不覆盖）。
//   2. 缺字段时按目录兜底（DIR_LAYER），并把锚点从正文双链抽出来 —— 抽不到就空数组，
//      空数组是「这页暂时没有断点词」，不是「跑挂了」。
import { DIR_LAYER, DEFAULT_LAYER, layerOf } from './layers.js';

/** 一页最多记多少个断点词（多了反而稀释命中权重）。 */
export const ANCHORS_MAX = 12;

/** 正文里出现的双链词（去重、去 `|别名`、去 `#锚点`、保持出现顺序）。 */
export function linksOf(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(/\[\[([^\]]+)\]\]/g)) {
    const raw = m[1].split('|')[0].split('#')[0].trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

/** 断点词 = 正文双链（去掉页面自己的链接与作者页），最多 ANCHORS_MAX 个。 */
export function anchorsOf(text, { self = '', author = '' } = {}) {
  return linksOf(text)
    .filter((n) => n !== self && n !== author)
    .slice(0, ANCHORS_MAX);
}

/** 目录名 → 层 id。认不得的目录按默认层（4 认知）。 */
export function layerForDir(dirName) {
  return DIR_LAYER[dirName] ?? DEFAULT_LAYER;
}

/** 页里声明的层 id；没写或写坏了返回 null（调用方决定要不要报错）。 */
export function declaredLayer(frontmatter) {
  const m = String(frontmatter || '').match(/^layer:\s*(\d+)\s*$/m);
  if (!m) return null;
  return layerOf(Number(m[1])) ? Number(m[1]) : null;
}

/** 页里声明的断点词；没写返回 null（空数组 `anchors: []` 视为已声明）。 */
export function declaredAnchors(frontmatter) {
  const m = String(frontmatter || '').match(/^anchors:\s*\[(.*)\]\s*$/m);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/**
 * 给一页补 `layer:` 与 `anchors:`（只补缺，不覆盖已有值）。
 *
 * @param {string} text 整页 markdown
 * @param {{dir?: string, self?: string, author?: string}} opts
 * @returns {{ text: string, added: string[] }} added = 这次新加了哪些字段
 */
export function ensurePageMeta(text, { dir = '', self = '', author = '' } = {}) {
  const src = String(text || '');
  const added = [];
  const fmMatch = src.match(/^---\n([\s\S]*?)\n---\n?/);
  const body = fmMatch ? src.slice(fmMatch[0].length) : src;
  const fmText = fmMatch ? fmMatch[1] : '';

  const needLayer = declaredLayer(fmText) === null;
  const needAnchors = declaredAnchors(fmText) === null;
  if (!needLayer && !needAnchors) return { text: src, added };

  const au = fmText.match(/^author:\s*(.+)$/m);
  const authorName = author || (au ? au[1].trim() : '');
  const lines = fmText ? fmText.split('\n') : [];

  if (needLayer) {
    lines.push(`layer: ${layerForDir(dir)}`);
    added.push('layer');
  }
  if (needAnchors) {
    const anchors = anchorsOf(body, { self, author: authorName });
    lines.push(`anchors: [${anchors.join(', ')}]`);
    added.push('anchors');
  }

  // 没有 frontmatter 的页（老页/手写页）就地补一个在最前面。
  if (!fmMatch) return { text: `---\n${lines.join('\n')}\n---\n\n${body}`, added };
  return { text: `---\n${lines.join('\n')}\n---\n${body}`, added };
}
