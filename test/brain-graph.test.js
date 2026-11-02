// src/brain/__luminance.test.js 之外的正式测试：七层 + 图数据库。
// 只测三件必须稳定的事：层归属唯一、层不会漂、库坏了能降级。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LAYERS, DIR_LAYER, DEFAULT_LAYER, layerOf, decayOf, resolveLayer, anchorsOf, layerConflict } from '../src/brain/layers.js';
import { openDb, rebuild, search, illuminate, rulesOf, stats, bigrams, ensureDbDir, DbError, lastOpenRebuilt } from '../src/brain/db.js';

// ---------- 七层规格 ----------

test('七层齐全且 id 连续', () => {
  assert.equal(LAYERS.length, 7);
  assert.deepEqual(LAYERS.map((l) => l.id), [1, 2, 3, 4, 5, 6, 7]);
});

test('L1 衰减为 0（永不衰减），L7 最接近丢弃', () => {
  assert.equal(decayOf(1), 0);
  assert.ok(decayOf(7) > decayOf(4));
});

test('非法层 id 返回 null，不静默兜底', () => {
  assert.equal(layerOf(0), null);
  assert.equal(layerOf(8), null);
  assert.equal(layerOf('x'), null);
});

test('resolveLayer: frontmatter 优先，缺省按目录，非法要报错', () => {
  assert.equal(resolveLayer('layer: 3\n', 'concepts').layer, 3);
  assert.equal(resolveLayer('layer: 3\n', 'concepts').source, 'frontmatter');

  const byDir = resolveLayer('no layer here', 'sessions');
  assert.equal(byDir.layer, 5);
  assert.equal(byDir.source, 'dir');

  const bad = resolveLayer('layer: 99\n', 'concepts');
  assert.ok(bad.error, '非法 layer 必须报错');
  assert.equal(bad.layer, DEFAULT_LAYER, '降级到默认层而不是崩');

  assert.equal(resolveLayer('nothing', 'weird').layer, DEFAULT_LAYER);
});

test('目录映射：sessions→L5 sources→L7 其余→L4', () => {
  assert.equal(DIR_LAYER.sessions, 5);
  assert.equal(DIR_LAYER.sources, 7);
  assert.equal(DIR_LAYER.concepts, 4);
  assert.equal(DIR_LAYER.entities, 4);
});

test('anchorsOf 提取双链词（含别名与锚点写法）', () => {
  const got = anchorsOf('见 [[静默失效]] 与 [[双副本|另一个名字]] 和 [[陈旧路径#小节]]');
  assert.deepEqual(got.sort(), ['双副本', '陈旧路径', '静默失效'].sort());
});

test('anchorsOf 排除模板占位符与代码块里的示例', () => {
  // 实测（2026-11-01）：正文里讨论语法时会写出 [[作者]] [[页面名]]，
  // 它们被当成真双链 → 污染断点词表 + 报成悬挂链接。
  const body = '作者标记 [[作者]]；用法 `[[页面名]]`；\n```\n[[示例链接]]\n```';
  assert.deepEqual(anchorsOf(body), [], '占位符与代码块都不该算真链接');
});

test('layerConflict: 只有明确与目录冲突才报', () => {
  assert.equal(layerConflict('layer: 4', 'concepts'), null, '同层不报');
  assert.ok(layerConflict('layer: 7', 'concepts'), '冲突要报');
  assert.equal(layerConflict('无字段', 'concepts'), null, '无字段不报');
});

// ---------- 图数据库 ----------

async function freshDb() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'absdb-'));
  const path = join(dir, 'g.db');
  await ensureDbDir(path);
  return { dir, path, h: openDb(path) };
}

function page(project, dir, slug, body) {
  return { project, dir, slug, body, mtime: Date.now() };
}

test('bigrams 存储与查询两侧一致（否则静默失配）', () => {
  const g = bigrams('静默失效');
  assert.ok(g.includes('静默'));
  assert.ok(g.includes('失效'));
  // 单字词必须能切出来，否则「锁」搜不到
  assert.deepEqual(bigrams('锁'), ['锁']);
});

test('建库：节点 / 边 / 铁律 / 断点词都落库', async () => {
  const { h, dir } = await freshDb();
  try {
    const st = rebuild(h, [
      page('p1', '', 'index', '## Rules\n- 铁律一\n- 铁律二\n\n## Concepts\n- [[甲]] — 一句话'),
      page('p1', 'concepts', '甲', '## 关联连接\n- [[乙]]'),
      page('p1', 'concepts', '乙', '普通页'),
    ]);
    assert.equal(st.nodes, 3);
    assert.equal(st.rules, 2, '只抽 Rules 区，不把页面清单当铁律');
    assert.ok(st.edges >= 1);
    assert.deepEqual(rulesOf(h, 'p1'), ['铁律一', '铁律二']);
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('库可重建：跑两次结果一致（幂等）', async () => {
  const { h, dir } = await freshDb();
  try {
    const pages = [page('p1', 'concepts', '甲', '见 [[乙]]'), page('p1', 'concepts', '乙', '内容')];
    const a = rebuild(h, pages);
    const b = rebuild(h, pages);
    assert.deepEqual(a, b, '重建必须幂等，不能越建越多');
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('搜索：两字中文词能命中（trigram 方案在这里会失败）', async () => {
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [page('p1', 'concepts', '静默失效', '出 ENOENT 不报错')]);
    assert.ok(search(h, '静默').length > 0, '两字词必须能搜到');
    assert.ok(search(h, '静默失效').length > 0);
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('搜索：种子亮度有区分度，不全等', async () => {
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [
      page('p1', 'concepts', 'a', '并发写 并发写 并发写'),
      page('p1', 'concepts', 'b', '并发写 提了一句'),
    ]);
    const seeds = search(h, '并发写');
    assert.ok(seeds.length >= 2);
    const vals = seeds.map((s) => s.bright);
    assert.ok(new Set(vals.map((v) => v.toFixed(3))).size > 1, '相关度必须体现在亮度上');
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('扩散：枢纽节点被压低，不霸榜', async () => {
  const { h, dir } = await freshDb();
  try {
    // hub 被 5 页链，leaf 被 1 页链
    const pages = [
      page('p1', 'concepts', 'seed', '目标词 目标词\n[[hub]]\n[[leaf]]'),
      page('p1', 'concepts', 'hub', '枢纽'),
      page('p1', 'concepts', 'leaf', '叶子'),
      ...['a', 'b', 'c', 'd'].map((n) => page('p1', 'concepts', n, `链 [[hub]]`)),
    ];
    rebuild(h, pages);
    const lit = illuminate(h, search(h, '目标词'), { limit: 20 });
    const hub = lit.find((x) => x.slug === 'hub');
    const leaf = lit.find((x) => x.slug === 'leaf');
    assert.ok(hub && leaf, '两者都该被点亮');
    assert.ok(hub.bright < leaf.bright, '入度高的枢纽必须比叶子暗');
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('跨项目：同名页各自独立，不串边', async () => {
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [
      page('pA', 'concepts', '同名', 'A 版内容'),
      page('pB', 'concepts', '同名', 'B 版内容'),
      page('pA', 'concepts', '引用者', '见 [[同名]]'),
    ]);
    const rows = h.db.prepare("SELECT project, body FROM nodes WHERE slug='同名' ORDER BY project").all();
    assert.equal(rows.length, 2, '两个项目各有一份');
    assert.equal(rows[0].body, 'A 版内容');
    assert.equal(rows[1].body, 'B 版内容');
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('库不可用时抛 DbError，不静默产出空结果', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'absdb-'));
  try {
    const bad = join(dir, 'nope', 'deep', 'g.db');
    assert.throws(() => openDb(bad), (e) => e instanceof DbError);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('stats 报全量计数', async () => {
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [page('p1', 'concepts', '甲', '见 [[不存在的页]]')]);
    const s = stats(h);
    assert.equal(s.nodes, 1);
    assert.equal(s.dangling, 1, '悬挂链接要能数出来');
    assert.equal(s.projects, 1);
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------- capture：按七层判定落点 ----------

import { cmdCapture, layerGuide } from '../src/brain/capture.js';

/** 造一个带 index.md（含 ## Rules 区）的最小图谱。 */
async function freshBrain() {
  const root = await fs.mkdtemp(join(tmpdir(), 'capbrain-'));
  const b = join(root, '.brain');
  for (const d of ['concepts', 'entities', 'sources', 'syntheses', 'sessions']) {
    await fs.mkdir(join(b, d), { recursive: true });
  }
  await fs.writeFile(join(b, 'index.md'), [
    '# 🗂 Graph Index', '', '## Rules', '',
    '## Concepts', '## Entities', '## Sources', '## Syntheses', '## Sessions', '',
  ].join('\n'));
  await fs.writeFile(join(b, 'todo.md'), '# 📋 Todo Board\n\n## Todo\n\n## Done\n');
  await fs.writeFile(join(b, 'log.md'), '# 🗒 Activity Log\n');
  return root;
}

const savedUser = process.env.ABS_USER;
process.env.ABS_USER = 'tester';

test('capture: L3 落 concepts/ 且带 layer: 3', async () => {
  const root = await freshBrain();
  try {
    const out = await cmdCapture({ dir: root, text: 'bash 里用 sh 跑 hook 会丢退出码', layer: '3' });
    assert.match(out, /L3 工具层/);
    const files = (await fs.readdir(join(root, '.brain', 'concepts'))).filter((f) => f.endsWith('.md'));
    assert.equal(files.length, 1);
    const body = await fs.readFile(join(root, '.brain', 'concepts', files[0]), 'utf8');
    assert.match(body, /^layer: 3$/m, '必须写进 frontmatter，否则入库时判不出层');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('capture: 不传 layer 默认 L4', async () => {
  const root = await freshBrain();
  try {
    const out = await cmdCapture({ dir: root, text: '判等价要真跑到' });
    assert.match(out, /L4 认知层/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('capture: L7 落 sources/', async () => {
  const root = await freshBrain();
  try {
    const out = await cmdCapture({ dir: root, text: '某个地方好像会慢但没查清', layer: '7' });
    assert.match(out, /L7 混沌层/);
    assert.match(out, /sources\//);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('capture: L1 走铁律门槛，超长被拒（不静默写入）', async () => {
  const root = await freshBrain();
  try {
    const long = '这一条故意写得非常非常长目的是明确超过四十二个字符的门槛用来验证确实会被拒绝而不是静默写入进去';
    assert.ok(long.length > 42, '测试前提：这段确实超长');
    const out = await cmdCapture({ dir: root, text: long, layer: '1' });
    assert.match(out, /太长/, '超长铁律必须被拒');
    const idx = await fs.readFile(join(root, '.brain', 'index.md'), 'utf8');
    assert.ok(!idx.includes(long), '被拒的内容不能出现在 index.md');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('capture: L6 拒绝手写（断点层由机器抽）', async () => {
  const root = await freshBrain();
  try {
    const out = await cmdCapture({ dir: root, text: '某个词', layer: '6' });
    assert.match(out, /不接手写/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('capture: 非法层号被拒，不静默当默认层', async () => {
  const root = await freshBrain();
  try {
    for (const bad of ['9', '0', 'x', '-1']) {
      const out = await cmdCapture({ dir: root, text: '内容', layer: bad });
      assert.match(out, /非法/i, `--layer ${bad} 必须被拒`);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('capture: 同文本幂等，不重复落页', async () => {
  const root = await freshBrain();
  try {
    await cmdCapture({ dir: root, text: '同一句话', layer: '3' });
    const second = await cmdCapture({ dir: root, text: '同一句话', layer: '3' });
    assert.match(second, /已落过|跳过重复/);
    const files = (await fs.readdir(join(root, '.brain', 'concepts'))).filter((f) => f.endsWith('.md'));
    assert.equal(files.length, 1, '重复总结不能落两份');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('layerGuide 七层都列出', () => {
  const g = layerGuide();
  for (const n of ['1', '2', '3', '4', '5', '6', '7']) assert.ok(g.includes(`L${n}`), `缺 L${n}`);
});

process.env.ABS_USER = savedUser;

test('流水页（index/todo/log）不进检索候选', async () => {
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [
      // log 里照抄了同一句经验 —— 这是真实行为（cmdLog 会把正文写进 log）
      page('p1', '', 'log', '## [2026-11-01] note | 并发写同一文件必须加锁'),
      page('p1', '', 'index', '## Concepts\n- [[并发写]] — 一句话'),
      page('p1', 'concepts', '并发写', '并发写同一文件必须加锁'),
    ]);
    const seeds = search(h, '并发写');
    assert.ok(seeds.length > 0, '内容页该命中');
    const ledgers = seeds.filter((s) => ['index', 'todo', 'log'].includes(s.slug));
    assert.deepEqual(ledgers, [], '流水页正文照抄了经验原文，会命中一切查询 —— 必须排除');
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('旧版本库能自动迁移，不卡死用户', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'absdb-'));
  const path = join(dir, 'g.db');
  try {
    // 造一个「老库」：版本号写成 1，且 nodes 没有 is_ledger 列
    const { DatabaseSync } = await import('node:sqlite');
    const old = new DatabaseSync(path);
    old.exec('CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    old.exec("INSERT INTO meta VALUES('version','1')");
    old.exec('CREATE TABLE nodes(id INTEGER PRIMARY KEY, project TEXT, dir TEXT, slug TEXT, layer INT, title TEXT, tags TEXT, status TEXT, body TEXT, mtime REAL)');
    old.close();

    // 打开应当自动丢表重建，而不是报「跑 abs db rebuild 重建」让用户死循环
    const h = openDb(path);
    try {
      const st = rebuild(h, [page('p1', 'concepts', '甲', '内容')]);
      assert.equal(st.nodes, 1);
    } finally { h.close(); }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('项目登记表与库同目录，不落到家目录', async () => {
  // 坑（2026-11-01 实测）：曾用 join(dbPath(), '../../projects.json')，
  // 把 graph.db 当目录往上退两级 → 实际写到 ~/projects.json，不在 ~/.abs/。
  const { dbPath } = await import('../src/brain/db.js');
  const { dirname, join } = await import('node:path');
  const dir = await fs.mkdtemp(join(tmpdir(), 'proj-'));
  const saved = process.env.ABS_DB;
  process.env.ABS_DB = join(dir, 'graph.db');
  try {
    const { addProject } = await import('../src/brain/db-cmd.js');
    const fake = join(dir, 'someproj');
    await fs.mkdir(join(fake, '.brain'), { recursive: true });
    await addProject(fake);

    const want = join(dirname(dbPath()), 'projects.json');
    const exists = await fs.stat(want).then(() => true).catch(() => false);
    assert.ok(exists, `登记表必须与库同目录: ${want}`);
    // 明确排除「往上退两级落到父目录」这个具体错法
    const wrong = join(dbPath(), '../../projects.json');
    const wrongExists = await fs.stat(wrong).then(() => true).catch(() => false);
    assert.ok(!wrongExists, `不该写到 ${wrong}`);
  } finally {
    if (saved === undefined) delete process.env.ABS_DB; else process.env.ABS_DB = saved;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('搜索：不存在的词不能靠单个 gram 误命中', async () => {
  // 坑（2026-11-02 深度测试发现）：FTS 的 OR 语义是「命中任意 gram 就算」，
  // 查 `zzzz不存在zzz` 时 gram 含「存在」，于是任何提到「存在」的页都命中 ——
  // 实测返回 7 页，用户会以为图谱里真有条目。
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [
      page('p1', 'concepts', 'c1', '这里存在问题需要排查'),
      page('p1', 'concepts', 'c2', '配置必须同目录'),
    ]);
    assert.equal(search(h, 'zzzz不存在zzz').length, 0, '不存在的词必须 0 命中，不能靠单个 gram 沾边');
    assert.ok(search(h, '配置').length > 0, '正常两字词仍要能搜到');
    assert.ok(search(h, '存在').length > 0);
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('queryBigrams: 单字只在整条查询是单字时才产出', async () => {
  const { queryBigrams } = await import('../src/brain/db.js');
  // 多字查询不得混进单字 gram，否则「不」「存」「在」会连上一切
  const multi = queryBigrams('zzzz不存在zzz');
  assert.ok(!multi.includes('不'), '多字查询不该含单字 gram');
  assert.ok(!multi.includes('在'));
  // 一字查询仍要能搜（「锁」这类）
  assert.deepEqual(queryBigrams('锁'), ['锁']);
});

test('库文件损坏 → 自动清空重建，不把用户卡死', async () => {
  // 坑（2026-11-02 深度测试发现）：库文件被写坏后，rebuild 走同一条打开路径，
  // 于是只报「库结构初始化失败: file is not a database」——用户修不好也删不掉
  // （不知道删哪），只能去查源码。库是派生物，删了从 markdown 重扫即可。
  const dir = await fs.mkdtemp(join(tmpdir(), 'absdb-'));
  const path = join(dir, 'g.db');
  try {
    await fs.writeFile(path, 'this is not a sqlite database');
    const h = openDb(path);
    try {
      assert.equal(lastOpenRebuilt(), true, '要标记「刚重建过」，否则调用方会以为库本来就这样');
      const st = rebuild(h, [page('p1', 'concepts', '甲', '内容')]);
      assert.equal(st.nodes, 1, '重建后能正常写入');
    } finally { h.close(); }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('库正常时 lastOpenRebuilt 为 false（不能每次都报警）', async () => {
  const { h, dir } = await freshDb();
  try {
    assert.equal(lastOpenRebuilt(), false);
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('亮度必须在 0.3~1.0 之间，不能出现天文数字', async () => {
  // 坑（2026-11-02 深度测试发现）：归一化分母取了「最不相关那条」的 rank（≈2e-6），
  // 于是最相关那条算出 |−2.42|/2e-6 = 1168694，输出一行 165 万宽的亮度条。
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [
      page('p1', 'concepts', 'full', '独特关键词戊己庚'),
      page('p1', 'concepts', 'partial', '共同关键词甲乙丙'),
      page('p1', 'concepts', 'other', '完全无关的话'),
    ]);
    const rows = search(h, '独特关键词');
    for (const r of rows) {
      assert.ok(r.bright >= 0.3 && r.bright <= 1, `${r.slug} 亮度 ${r.bright} 越界`);
    }
    const full = rows.find((r) => r.slug === 'full');
    assert.equal(full.cover, 1, '全命中页的 cover 必须是 1（曾因解构掉 g 而恒为 0）');
    assert.ok(full.bright > (rows.find((r) => r.slug === 'partial')?.bright ?? 0),
      '全命中必须比只沾边的亮');
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('superseded 页不出现在检索结果里', async () => {
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [
      page('p1', 'concepts', 'dead', '---\nstatus: superseded\nsuperseded-by: live\n---\n独特关键词'),
      page('p1', 'concepts', 'live', '独特关键词也在这'),
    ]);
    const got = search(h, '独特关键词').map((r) => r.slug);
    assert.ok(!got.includes('dead'), '被推翻的经验不能出现在检索里（会给出已知错误的答案）');
    assert.ok(got.includes('live'));
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('高频虚词组合不能靠命中数凑够门槛（加权覆盖）', async () => {
  // 坑（2026-11-02 深度测试发现，两轮才修对）：
  //   先试「命中数 ≥ 一半」，但中文高频组合能绕过 —— 查 `zzzz不存在zzz` 时
  //   「不存在」切出 [不存, 存在] 两个 gram，命中 2/4 就达标，
  //   而「不存在」在真实图谱里到处都是（实测「验证」出现在 84% 的页里）。
  const { h, dir } = await freshDb();
  try {
    // 造一堆都含「不存在」的页，模拟高频虚词
    const pages = [];
    for (let i = 0; i < 10; i++) pages.push(page('p1', 'concepts', `filler${i}`, '这里存在问题需要排查文档记录内容'));
    pages.push(page('p1', 'concepts', 'target', 'zzzz 不存在的专有词'));
    rebuild(h, pages);

    // 只含「不存在」的页不该因为命中 2 个 gram 就被当成候选
    const got = search(h, 'zzzz不存在zzz');
    assert.ok(got.length <= 1, `不该返回 ${got.length} 页，高频组合不能凑够门槛`);
    // 真含 zzzz 的那页仍要能命中
    if (got.length) assert.equal(got[0].slug, 'target');
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('superseded 页不能被扩散点亮（入口排了出口也要排）', async () => {
  // 坑（2026-11-02 实测）：search 里排了 superseded，但 illuminate 的出口没排 ——
  // 旧结论页自己不进种子，却被邻居扩散点亮（实测亮度 0.24，带 ↝ 标记），
  // 等于绕过了「被推翻的经验别再依据」这条判据。
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [
      page('p1', 'concepts', 'live', '---\nstatus: active\n---\n独特关键词，见 [[old]]'),
      page('p1', 'concepts', 'old', '---\nstatus: superseded\nsuperseded-by: live\n---\n旧结论'),
    ]);
    const seeds = search(h, '独特关键词');
    const lit = illuminate(h, seeds, { limit: 20 });
    assert.ok(!lit.some((r) => r.slug === 'old'), '被推翻的页不能通过扩散出现');
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('检索排序：知识页要压过会话流水页（层权重）', async () => {
  // 坑（2026-11-02，14 个项目 586 页实测）：查「docker」时三个 sessions/ 流水页排最前，
  // 压过真正讲 docker 的知识页 —— 流水页正文长、词频高，bm25 天然占优，
  // 但对「我上次怎么解决 X」没有价值。分层不能只在扩散时起作用，种子也要加权。
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [
      // 流水页：关键词重复多次，bm25 会很高
      page('p1', 'sessions', 'log-x', 'docker 部署 docker 启动 docker 失败 docker'),
      // 知识页：只提一次
      page('p1', 'concepts', 'docker-代理失效', 'docker 拉镜像失败是因为残留代理'),
    ]);
    const rows = search(h, 'docker');
    assert.ok(rows.length >= 2, '两页都该命中');
    assert.equal(rows[0].slug, 'docker-代理失效', '知识页必须排在流水页前面');
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------- load 首屏带出最亮几页 ----------

test('hotPagesSection: 无库时静默返回空串（不影响 load）', async () => {
  const { hotPagesSection } = await import('../src/brain/load.js');
  const root = await freshBrain();
  try {
    const out = await withEnv2({ ABS_DB: join(root, 'nodb.db') }, () => hotPagesSection(root, '- [ ] TASK-1 — 测试', {}));
    assert.equal(out, '', '库不存在时不能报错，也不能占位');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('hotPagesSection: 只出本项目的页，且按纯亮度排（不按层权重）', async () => {
  const root = await freshBrain();
  const dbFile = join(root, 'g.db');
  try {
    const { openDb, rebuild } = await import('../src/brain/db.js');
    const h = openDb(dbFile);
    const proj = root.split('/').filter(Boolean).pop();
    rebuild(h, [
      // 本项目：一个 L3（亮度高但层权重大）、一个 L4（亮度更高）
      { project: proj, dir: 'concepts', slug: 'tool-page', body: '---\nlayer: 3\n---\n并发写 加锁 并发写 加锁', mtime: Date.now() },
      { project: proj, dir: 'concepts', slug: 'cog-page', body: '---\nlayer: 4\n---\n并发写 加锁 丢了 并发写 加锁 丢了 更多', mtime: Date.now() },
      // 别的项目：不该出现在首屏
      { project: 'other', dir: 'concepts', slug: 'foreign', body: '---\n---\n并发写 加锁', mtime: Date.now() },
    ]);
    h.close();

    const { hotPagesSection } = await import('../src/brain/load.js');
    const out = await withEnv2({ ABS_DB: dbFile }, () => hotPagesSection(root, '- [ ] TASK-1 [[x]] — 并发写 加锁', { limit: 5 }));
    assert.match(out, /tool-page|cog-page/, '该带出本项目的页');
    assert.doesNotMatch(out, /foreign/, '别的项目的页不进开机首屏');
    assert.doesNotMatch(out, /##\s/, '不能贴正文标题，只给页名 + 摘要');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

async function withEnv2(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try { return await fn(); }
  finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}
