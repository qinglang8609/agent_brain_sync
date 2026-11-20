// test/page-meta.test.js — 页面元数据：七层归属 + 断点词（2026-11-20）。
//
// 为什么要这层测试：这两项是**写进 99 个存量页**的东西，且要满足两条硬约束 ——
//   ① 只补缺，绝不覆盖人工写过的值（写坏了就是悄悄改用户数据）；
//   ② 断点词必须从正文双链里抽（抽错 = 检索激活到错的词）。
// 纯函数 + 一次 --repair 的集成，都钉住。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  anchorsOf, linksOf, layerForDir, declaredLayer, declaredAnchors, ensurePageMeta, ANCHORS_MAX,
  anchorIndex, renderAnchorSection, rebuildAnchorIndex, ANCHOR_SECTION,
} from '../../code/brain/page-meta.js';
import { backfillPageMeta } from '../../code/brain/init.js';

let sandbox;
beforeEach(async () => { sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-pagemeta-')); });
afterEach(async () => { await fs.rm(sandbox, { recursive: true, force: true }); });

describe('linksOf / anchorsOf — 从正文抽双链词', () => {
  test('去重、去别名、去锚点，保持出现顺序', () => {
    const md = '[[a]] [[b|x]] [[a]] [[c#段]]';
    assert.deepEqual(linksOf(md), ['a', 'b', 'c']);
  });

  test('断点词排除页面自己与作者页', () => {
    const md = '[[self-page]] [[fanchao]] [[有用]]';
    assert.deepEqual(anchorsOf(md, { self: 'self-page', author: 'fanchao' }), ['有用']);
  });

  test('断点词有上限，避免稀释命中权重', () => {
    const md = Array.from({ length: ANCHORS_MAX + 5 }, (_, i) => `[[w${i}]]`).join(' ');
    assert.equal(anchorsOf(md).length, ANCHORS_MAX);
  });

  test('没有双链 → 空数组（不是 null、不抛）', () => {
    assert.deepEqual(anchorsOf('纯正文，没有链接'), []);
    assert.deepEqual(anchorsOf(''), []);
    assert.deepEqual(anchorsOf(null), []);
  });
});

describe('层归属', () => {
  test('目录 → 层：concepts/entities/syntheses 是 4，sessions 是 5，sources 是 7', () => {
    assert.equal(layerForDir('concepts'), 4);
    assert.equal(layerForDir('syntheses'), 4);
    assert.equal(layerForDir('sessions'), 5);
    assert.equal(layerForDir('sources'), 7);
    assert.equal(layerForDir('不认识的目录'), 4, '认不得 → 默认认知层');
  });

  test('declaredLayer：没写/写坏都算「没声明」（不当 4 静默兜底）', () => {
    assert.equal(declaredLayer('layer: 3'), 3);
    assert.equal(declaredLayer('layer: 0'), null, '0 不是合法层');
    assert.equal(declaredLayer('layer: 9'), null);
    assert.equal(declaredLayer('tags: [x]'), null);
    assert.equal(declaredLayer(''), null);
  });

  test('declaredAnchors：空数组算已声明，没这行才算缺', () => {
    assert.deepEqual(declaredAnchors('anchors: []'), []);
    assert.deepEqual(declaredAnchors('anchors: [a, b]'), ['a', 'b']);
    assert.deepEqual(declaredAnchors('anchors: ["a-b", \'c\']'), ['a-b', 'c']);
    assert.equal(declaredAnchors('tags: [x]'), null);
  });
});

describe('ensurePageMeta — 只补缺、不覆盖', () => {
  const page = [
    '---',
    'tags: [concept]',
    'author: fanchao',
    '---',
    '',
    '# 标题',
    '正文提了 [[pi-tui]] 与 [[fanchao]]。',
  ].join('\n');

  test('缺两字段就都补上，正文一个字不动', () => {
    const r = ensurePageMeta(page, { dir: 'concepts', self: 'x', author: 'fanchao' });
    assert.deepEqual(r.added, ['layer', 'anchors']);
    assert.match(r.text, /^layer: 4$/m);
    assert.match(r.text, /^anchors: \[pi-tui\]$/m, '作者页不算断点词');
    assert.ok(r.text.includes('正文提了 [[pi-tui]] 与 [[fanchao]]。'), '正文必须原样');
  });

  test('已有值一律不覆盖（人工写过的不动）', () => {
    const kept = '---\nlayer: 3\nanchors: [手写词]\n---\n\n[[另一个]]\n';
    const r = ensurePageMeta(kept, { dir: 'concepts' });
    assert.deepEqual(r.added, []);
    assert.equal(r.text, kept);
  });

  test('幂等：跑两次结果一致', () => {
    const once = ensurePageMeta(page, { dir: 'concepts', self: 'x' }).text;
    const twice = ensurePageMeta(once, { dir: 'concepts', self: 'x' });
    assert.deepEqual(twice.added, []);
    assert.equal(twice.text, once);
  });

  test('没有 frontmatter 的老页：在最前面补一个', () => {
    const r = ensurePageMeta('# 裸页\n\n[[a]]\n', { dir: 'entities' });
    assert.deepEqual(r.added, ['layer', 'anchors']);
    assert.ok(r.text.startsWith('---\nlayer: 4\nanchors: [a]\n---\n\n# 裸页'), r.text);
  });

  test('sessions/ 的页补出来是 L5', () => {
    const r = ensurePageMeta('---\nstatus: draft\n---\n\n正文\n', { dir: 'sessions' });
    assert.match(r.text, /^layer: 5$/m);
  });
});

describe('init --repair 的存量补齐（集成）', () => {
  test('给缺字段的页补上，已合规的页不碰', async () => {
    const brain = join(sandbox, '.brain');
    for (const d of ['concepts', 'entities']) await fs.mkdir(join(brain, d), { recursive: true });
    const need = join(brain, 'concepts', 'need.md');
    const fine = join(brain, 'concepts', 'fine.md');
    await fs.writeFile(need, '---\nauthor: fanchao\n---\n\n# 缺字段\n\n[[other-page]]\n');
    await fs.writeFile(fine, '---\nlayer: 3\nanchors: [keep-me]\n---\n\n# 已合规\n');
    const before = await fs.readFile(fine, 'utf8');

    const fixed = await backfillPageMeta(brain);
    assert.equal(fixed.length, 1, `只应改一张: ${fixed.join(',')}`);
    const after = await fs.readFile(need, 'utf8');
    assert.match(after, /^layer: 4$/m);
    assert.match(after, /^anchors: \[other-page\]$/m);
    assert.equal(await fs.readFile(fine, 'utf8'), before, '合规页必须一字不动');
  });

  test('没有页面的目录不炸', async () => {
    const brain = join(sandbox, '.brain');
    await fs.mkdir(join(brain, 'concepts'), { recursive: true });
    assert.deepEqual(await backfillPageMeta(brain), []);
  });
});

describe('断点索引（写进 index.md）', () => {
  test('只收跨页词：单词独有的不进索引', () => {
    const idx = anchorIndex([
      { slug: 'a', anchors: ['共享', '独有-a'] },
      { slug: 'b', anchors: ['共享', '独有-b'] },
    ]);
    assert.deepEqual([...idx.keys()], ['共享'], `只该有跨页词: ${[...idx.keys()]}`);
  });

  test('同一页重复写同一个词只算一次', () => {
    const idx = anchorIndex([{ slug: 'a', anchors: ['w', 'w'] }, { slug: 'b', anchors: ['w'] }]);
    assert.deepEqual(idx.get('w'), ['a', 'b']);
  });

  test('页按名字排序、词按共享页数降序（生成方与校验方顺序必须一致）', () => {
    const idx = anchorIndex([
      { slug: 'z-page', anchors: ['少'] },
      { slug: 'b-page', anchors: ['多', '少'] },
      { slug: 'a-page', anchors: ['多'] },
    ]);
    assert.deepEqual([...idx.keys()], ['多', '少'], '同数量时按词名');
    assert.deepEqual(idx.get('多'), ['a-page', 'b-page'], '页名排序');
  });

  // 2026-11-20 用户定：只列词、不挂页（挂页的话页一变就得跟着重建，维护成本太高）。
  test('渲染：每行只有一个词，不带页名', () => {
    const pages = ['p1', 'p2', 'p3'].map((slug) => ({ slug, anchors: ['w'] }));
    const lines = renderAnchorSection(anchorIndex(pages));
    const rows = lines.filter((l) => l.startsWith('- '));
    assert.deepEqual(rows, ['- w'], JSON.stringify(rows));
    assert.ok(!lines.join('\n').includes('[['), '不该出现页链接');
  });

  test('空索引给出占位行（新库刚建好也不会被 lint 判过期）', () => {
    const lines = renderAnchorSection(new Map());
    assert.equal(lines[0], ANCHOR_SECTION);
    assert.match(lines.join('\n'), /暂无跨页断点词/);
  });
});

describe('rebuildAnchorIndex — 生成与「不擅自改手写 index」', () => {
  const seed = async (indexBody) => {
    const brain = join(sandbox, '.brain');
    await fs.mkdir(join(brain, 'concepts'), { recursive: true });
    await fs.writeFile(join(brain, 'concepts', 'a.md'), '---\nanchors: [w]\n---\n', 'utf8');
    await fs.writeFile(join(brain, 'concepts', 'b.md'), '---\nanchors: [w]\n---\n', 'utf8');
    await fs.writeFile(join(brain, 'index.md'), indexBody, 'utf8');
    return brain;
  };

  test('已有序段会被刷新', async () => {
    const brain = await seed('# 索引\n\n## 断点\n- 旧的 — [[x]]\n');
    const r = await rebuildAnchorIndex(brain);
    assert.equal(r.changed, true);
    assert.equal(r.words, 1);
    const out = await fs.readFile(join(brain, 'index.md'), 'utf8');
    assert.ok(out.includes('- w'), out);
    assert.ok(!out.includes('[[x]]'), '旧内容必须被替换');
    assert.ok(!out.includes('[['), '断点段只列词，不挂页');
  });

  test('没有断点段时默认不擅自加（手写 index 不动）', async () => {
    const brain = await seed('# 我的索引\n');
    const r = await rebuildAnchorIndex(brain);
    assert.equal(r.changed, false);
    assert.equal(await fs.readFile(join(brain, 'index.md'), 'utf8'), '# 我的索引\n');
  });

  test('显式 append 才凭空加段（abs init --repair --anchors）', async () => {
    const brain = await seed('# 我的索引\n');
    const r = await rebuildAnchorIndex(brain, { append: true });
    assert.equal(r.changed, true);
    const out = await fs.readFile(join(brain, 'index.md'), 'utf8');
    assert.ok(out.includes('## 断点') && out.includes('- w'), out);
  });
});

describe('L7 混沌层与断点在检索侧的作用（2026-11-20）', () => {
  // L7 = 未分辨的暂存（sources/），decay 0.95 → 检索权重 0.05，压到底。
  test('abs note 落的 sources 页必须带 layer 7 与 anchors', async () => {
    const { cmdNote } = await import('../../code/note.js');
    const root = join(sandbox, 'proj');
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(join(root, '.brain', 'sources'), { recursive: true });
    await fs.mkdir(join(root, '.brain', 'sessions'), { recursive: true });
    await fs.mkdir(join(root, '.brain', 'entities'), { recursive: true });
    for (const d of ['concepts', 'syntheses']) await fs.mkdir(join(root, '.brain', d), { recursive: true });
    await fs.writeFile(join(root, '.brain', 'index.md'), '# idx\n', 'utf8');
    await fs.writeFile(join(root, '.brain', 'log.md'), '# log\n', 'utf8');
    await fs.writeFile(join(root, '.brain', 'todo.md'), '# todo\n', 'utf8');
    await cmdNote({ dir: root, text: '暂存：[[pi-tui]] 与 [[truncateToWidth]] 有关' });
    const files = await fs.readdir(join(root, '.brain', 'sources'));
    const body = await fs.readFile(join(root, '.brain', 'sources', files[0]), 'utf8');
    assert.match(body, /^layer: 7$/m, body);
    assert.match(body, /^anchors: \[pi-tui, truncateToWidth\]$/m, body);
  });
});
