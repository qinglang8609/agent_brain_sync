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

/**
 * 断点索引：词 → 用到它的页（2026-11-20 用户要求写进 index.md）。
 *
 * 为什么断点要进 index.md：断点是**交叉的** —— 同一个关键词在 a 页和 b 页都可能出现，
 *   一页也有多个断点。只把 anchors 留在各页 frontmatter 里，就看不到「这个词横跨哪些页」；
 *   写进 index.md 才能一眼看出交叉关系（L6 的原定义就是「词的索引，不占页面」）。
 *
 * 只收**被 ≥2 页共享**的词：单页独有的词在那一页里已经写着，进索引只会把 index.md 撑爆
 *   （实测 94 个词里 27 个只属于一页）。
 * 每词最多列 PAGES_PER_WORD 个页，其余折成「…共 N 页」—— 一个词横跨 22 页时不能占满一行。
 *
 * @param {{slug: string, anchors: string[]}[]} pages
 * @returns {Map<string, string[]>} 词 → 页 slug（按共享页数降序，同数按名字）
 */
export function anchorIndex(pages) {
  const byWord = new Map();
  for (const pg of pages) {
    for (const a of pg.anchors || []) {
      if (!byWord.has(a)) byWord.set(a, []);
      const list = byWord.get(a);
      if (!list.includes(pg.slug)) list.push(pg.slug);
    }
  }
  // 每个词下的页按名字排序：否则「谁先被读到」会决定索引里的顺序，
  // 生成方（rebuild）与校验方（lint）扫描顺序不同就会互相当成「过期」。
  for (const list of byWord.values()) list.sort((a, b) => a.localeCompare(b));
  const shared = [...byWord.entries()].filter(([, list]) => list.length >= 2);
  shared.sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]));
  return new Map(shared);
}

/**
 * index.md 里断点段的行（含段标题）。
 *
 * 2026-11-20 用户定：**只列词，不挂页**。
 *   原来写成「- 词 — [[页1]] [[页2]] …共 N 页」，页一变就得重建，维护成本太高；
 *   而断点本来就是「关键词清单」，看的是有哪些词、不是每个词指向谁
 *   （谁用了这个词，grep 一下或看各页 frontmatter 的 anchors 就行）。
 * 词按共享页数降序、同数按名字 —— 看得见的顺序稳定，重建结果才不会抖。
 */
export function renderAnchorSection(index) {
  const lines = [
    ANCHOR_SECTION,
    '<!-- 跨页关键词（一个词出现在 ≥2 个页面里）。由 abs init --repair 重建，别手写。 -->',
  ];
  if (!index.size) {
    lines.push('（暂无跨页 anchors）');
    return lines;
  }
  for (const word of index.keys()) lines.push(`- ${word}`);
  return lines;
}

/** anchors 段在 index.md 里的标题（重建与 lint 共用同一个判据）。 */
export const ANCHOR_SECTION = '## Anchors';

/** 旧标题（2026-11-26 改英文前叫「断点」）—— 存量图谱要靠它才认得出已有段。
 *  像这样兼容一个旧名，是为了让「改名」不用一次性迁移所有历史项目：
 *  读到旧名也当 anchors 段，重建时原地换成新名。 */
export const ANCHOR_SECTION_LEGACY = '## 断点';

/** 这一行是不是 anchors 段标题（新旧名都算）。 */
export function isAnchorSectionLine(line) {
  const t = String(line ?? '').trim();
  return t === ANCHOR_SECTION || t === ANCHOR_SECTION_LEGACY;
}

/** 从 index.md 全文里取出 anchors 段的行（找不到返回 null）。 */
export function anchorSectionOf(indexText) {
  const lines = String(indexText || '').split('\n');
  const start = lines.findIndex((l) => isAnchorSectionLine(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  const sec = lines.slice(start, end);
  // 去掉段尾的空行：文件末尾的空行不该让「内容一致」判成「过期」。
  while (sec.length && sec[sec.length - 1].trim() === '') sec.pop();
  return sec;
}

/**
 * 重建 index.md 的断点段。
 *
 * 为什么是「重建」而不是「追加」：词表随页面变，追加只会越滚越脏。
 *   每次从全部页面的 anchors 现算，整体替换那一段 —— 幂等、可反复跑。
 * 只刷新**已存在**的段；凭空补段要显式 append（abs init --repair --anchors），
 *   因为 repair 的契约是「只补缺骨架、绝不改已有文件」。
 */
export async function rebuildAnchorIndex(brain, { append = false } = {}) {
  const fs = (await import('node:fs')).promises;
  const pages = [];
  for (const d of ['concepts', 'entities', 'sources', 'syntheses', 'sessions']) {
    let files;
    try { files = await fs.readdir(`${brain}/${d}`); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      const body = await fs.readFile(`${brain}/${d}/${f}`, 'utf8').catch(() => '');
      const m = body.match(/^anchors:\s*\[(.*)\]\s*$/m);
      pages.push({
        slug: f.replace(/\.md$/, ''),
        anchors: m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : [],
      });
    }
  }
  const index = anchorIndex(pages);
  const section = renderAnchorSection(index);
  const indexPath = `${brain}/index.md`;
  const cur = await fs.readFile(indexPath, 'utf8').catch(() => null);
  if (cur === null) return { words: index.size, changed: false };
  const lines = cur.split('\n');
  const start = lines.findIndex((l) => isAnchorSectionLine(l));
  let next = lines;
  if (start < 0) {
    if (!append) return { words: index.size, changed: false };
    const tail = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
    next = [...tail, '', ...section, ''];
  } else {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }
    next = [...lines.slice(0, start), ...section, ...(end < lines.length ? ['', ...lines.slice(end)] : [''])];
  }
  const out = next.join('\n');
  if (out === cur) return { words: index.size, changed: false };
  await fs.writeFile(indexPath, out, 'utf8');
  return { words: index.size, changed: true };
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
 * refresh=true 时**重算已存在的 anchors**（2026-11-23）：断点词是正文 `[[双链]]` 的
 *   快照，抽一次就不动的话，页面后来加了双链、anchors 仍停在创建那一刻 ——
 *   断点静默漂移，跨页关系也跟着错。默认 false 保住「repair 绝不改已有文件」的契约，
 *   只有 `abs init --repair --anchors` 显式要求刷新时才动。
 * `layer:` 即使 refresh 也不动（层是人工判断，不能从正文推）。
 *
 * @param {string} text 整页 markdown
 * @param {{dir?: string, self?: string, author?: string, refresh?: boolean}} opts
 * @returns {{ text: string, added: string[] }} added = 这次新加了哪些字段
 */
export function ensurePageMeta(text, { dir = '', self = '', author = '', refresh = false } = {}) {
  const src = String(text || '');
  const added = [];
  const fmMatch = src.match(/^---\n([\s\S]*?)\n---\n?/);
  const body = fmMatch ? src.slice(fmMatch[0].length) : src;
  const fmText = fmMatch ? fmMatch[1] : '';

  const needLayer = declaredLayer(fmText) === null;
  const needAnchors = declaredAnchors(fmText) === null || refresh;
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
    const line = `anchors: [${anchors.join(', ')}]`;
    // 刷新时替换原行，不能 push —— 否则一页里会出现两条 anchors（解析只取第一条）。
    const at = lines.findIndex((l) => /^anchors:\s*\[.*\]\s*$/.test(l));
    if (at >= 0) {
      if (lines[at].trim() !== line) {
        lines[at] = line;
        added.push('anchors(刷新)');
      }
    } else {
      lines.push(line);
      added.push('anchors');
    }
  }

  // 没有 frontmatter 的页（老页/手写页）就地补一个在最前面。
  if (!fmMatch) return { text: `---\n${lines.join('\n')}\n---\n\n${body}`, added };
  return { text: `---\n${lines.join('\n')}\n---\n${body}`, added };
}
