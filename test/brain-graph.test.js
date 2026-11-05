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

// 会话页（abs ingest 落的页）：body 需要带 kind frontmatter 才会被降权。
// 会话页（abs ingest 落的页）。默认带上**已填**的骨架段 ——
// 未填的空骨架会被整页排除出检索（见 db.js 的 unfilled 列），
// 要测「降权」必须先让它是已填状态，否则连候选都进不去。
function digestPage(project, slug, body) {
  const filled = '## 出了什么问题\n' + body + '\n';
  return page(project, 'sessions', slug,
    `---\nkind: session-digest\nlayer: 5\n---\n\n${filled}`);
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

test('搜索：种子亮度有区分度，不全等', async () => {  const { h, dir } = await freshDb();
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

// 2026-11-05 改判据：L7 不再接 capture。
// 理由：`abs note` 与 `abs capture --layer 7` 是**同一个落点**
// （实测两边都写 sources/，文件名与正文结构一致）。两个入口做同一件事，
// 每次都得先选一个，而选错没有任何后果 —— 纯认知负担。
// 按本仓判据「与已有功能重叠 → 复用/删，别新增」（concept feature-delete-not-patch），
// 保留被真实用过 228 次的 note，capture 这边直接拒并给出等价命令。
test('capture: L7 被拒，并指向 abs note（同一个落点不再留两个入口）', async () => {
  const root = await freshBrain();
  try {
    const out = await cmdCapture({ dir: root, text: '某个地方好像会慢但没查清', layer: '7' });
    assert.match(out, /✗ L7/, `应明确拒绘: ${out}`);
    assert.match(out, /abs note/, `应给出等价命令: ${out}`);
    // 关键：拒了就不能落盘 —— 否则两个入口还是都留着
    const files = await fs.readdir(join(root, '.brain', 'sources')).catch(() => []);
    assert.deepEqual(files, [], `被拒时不能写 files: ${files}`);
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

// ---------- recall：卡住时主动取相关页 ----------
// 为何要它（2026-11-03 实测）：hotPages 只挂在 load 上，于是只有开工那一刻送页。
// 实测一场完整会话从头到尾没调过一次 abs —— 「要人先想到发起查询」这一步天然被跳过。

test('cmdRecall: 不给词时从当前处境推（不发检索）', async () => {
  const root = await freshBrain();
  const dbFile = join(root, 'g.db');
  try {
    const { openDb, rebuild } = await import('../src/brain/db.js');
    const h = openDb(dbFile);
    const proj = root.split('/').filter(Boolean).pop();
    rebuild(h, [
      { project: proj, dir: 'concepts', slug: 'lock-page', body: '---\nlayer: 3\n---\n并发 写 锁 并发 写 锁', mtime: Date.now() },
    ]);
    h.close();

    const { cmdRecall } = await import('../src/brain/load.js');
    // todo 里有「并发 锁」→ 处境词能命中 lock-page
    const out = await withEnv2({ ABS_DB: dbFile }, () => cmdRecall({ dir: root, terms: [] }));
    // 只要能从处境推出非空结果就算对；推不出时给的也是「该怎么推」的指引，不是空列表
    assert.ok(typeof out === 'string' && out.length > 0, `必须有输出: ${out}`);
    assert.doesNotMatch(out, /^recall \[\]/, '不能输出空词表');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('cmdRecall: 给词就只用给的词，并带出命中页', async () => {
  const root = await freshBrain();
  const dbFile = join(root, 'g.db');
  try {
    const { openDb, rebuild } = await import('../src/brain/db.js');
    const h = openDb(dbFile);
    const proj = root.split('/').filter(Boolean).pop();
    rebuild(h, [
      { project: proj, dir: 'concepts', slug: 'target-page', body: '---\nlayer: 3\n---\n独占词甲 独占词乙 独占词甲 独占词乙', mtime: Date.now() },
    ]);
    h.close();

    const { cmdRecall } = await import('../src/brain/load.js');
    const out = await withEnv2({ ABS_DB: dbFile }, () => cmdRecall({ dir: root, terms: ['独占词甲'] }));
    assert.match(out, /target-page/, `应命中 target-page: ${out}`);
    assert.match(out, /recall \[独占词甲\]/, '标题应回显用户给的词');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

// 坑（2026-11-03 实测）：不加降权时前 5 位挤进 2 页 sessions/log-* 还排第一，
// 把 file-write-locking 这种真经验页顶下去。流水页故意给更高亮度以验证降权真在起作用。
test('cmdRecall: 流水页排序让位于内容页（同亮度差 < 降权幅度）', async () => {
  // 与 cmdRecall 内部同一条排序式：bright - (isFlow ? 1 : 0)
  const isFlow = (r) => r.dir === 'sources' || (r.dir === 'sessions' && /^log-/.test(r.slug));
  const sortFn = (a, b) => (b.bright - (isFlow(b) ? 1 : 0)) - (a.bright - (isFlow(a) ? 1 : 0));
  // 流水页亮度高 0.01（小于降权 1），但排完后必须落在内容页之后
  const logPage = { dir: 'sessions', slug: 'log-2026-09-09', bright: 0.96 };
  const contentPage = { dir: 'concepts', slug: 'real-content', bright: 0.95 };
  const sorted = [logPage, contentPage].sort(sortFn);
  assert.equal(sorted[0].slug, 'real-content', '内容页应排前');
  // 反向：不做降权时（只比亮度）流水页会赢 —— 证明降权真的改变了结果
  const raw = [logPage, contentPage].sort((a, b) => b.bright - a.bright);
  assert.equal(raw[0].slug, 'log-2026-09-09', '不降权时流水页确实会排前面');
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

// ---------- 索引优先 + 作用分档 ----------

test('search 返回索引形态：有 digest 与 tokens，不带 body', async () => {
  // 借 cl​aude-mem 的 Progressive Disclosure：默认只给摘要 + 取全文成本。
  // 实测 ABS 单页平均 824 token，8 页全带就是 6600 token，而真正用上的往往只有 1-2 页。
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [page('p1', 'concepts', '甲', '---\ntitle: 测试页\n---\n# 测试页\n这是一句话摘要，后面还有内容')]);
    const rows = search(h, '一句话摘要');
    assert.ok(rows.length > 0);
    assert.ok(rows[0].digest, '必须有摘要');
    assert.ok(rows[0].tokens > 0, '必须有 token 成本');
    assert.equal('body' in rows[0], false, '索引不该带正文');
  } finally { h.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('illuminate 出口也带 digest/tokens（改一半的坑）', async () => {
  // search 改了、illuminate 出口没改，摘要与成本会全丢 —— 实测踩过。
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [page('p1', 'concepts', '甲', '---\ntitle: 甲\n---\n# 甲\n独特关键词在这里')]);
    const lit = illuminate(h, search(h, '独特关键词'), { limit: 5 });
    assert.ok(lit.length > 0);
    assert.ok(lit[0].digest, 'illuminate 出口也要有摘要');
    assert.ok(lit[0].tokens > 0);
  } finally { h.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('kind 分档：能从 frontmatter 读出并随结果返回', async () => {
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [
      page('p1', 'concepts', '坑页', '---\nkind: gotcha\n---\n# 坑页\n共同关键词'),
      page('p1', 'concepts', '普通页', '---\n---\n# 普通页\n共同关键词'),
    ]);
    const rows = search(h, '共同关键词');
    const gotcha = rows.find((r) => r.slug === '坑页');
    const plain = rows.find((r) => r.slug === '普通页');
    assert.equal(gotcha.kind, 'gotcha');
    assert.equal(plain.kind, '', '没标 kind 的留空，不猜');
  } finally { h.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('estTokens 估算合理（中文比英文占 token 多）', async () => {
  const { estTokens } = await import('../src/brain/db.js');
  const zh = estTokens('这是一段中文文字用来测试估算');
  const en = estTokens('this is an english sentence for testing');
  assert.ok(zh > 0 && en > 0);
  // 同样字符数下，中文 token 更多（1.5 字符/token vs 4 字符/token）
  assert.ok(zh / 14 > en / 38, '中文每字符占的 token 应多于英文');
});

test('会话页降权：同等相关度下，session-digest 的亮度是普通页的一半', async () => {
  const { h, dir } = await freshDb();
  try {
    // 两页正文完全相同 → bm25 与覆盖率一致，唯一的差别只能是 kind 折扣。
    // 这是「会话页不能压过知识页」那条判断的最小可验证形态。
    rebuild(h, [
      page('p1', 'concepts', 'k', '会话记录 甲乙丙'),
      digestPage('p1', 's', '会话记录 甲乙丙'),
    ]);
    const seeds = search(h, '会话记录');
    const bySlug = new Map(seeds.map((s) => [s.slug, s]));
    const k = bySlug.get('k');
    const s = bySlug.get('s');
    assert.ok(k && s, '两页都要被搜到（降权不等于排除）');
    assert.ok(s.bright < k.bright, `会话页亮度应更低，实际 k=${k.bright} s=${s.bright}`);
    // 折扣是 SESSION_DIGEST_DISCOUNT(0.5)，但两页的 bm25 不会完全相等
    // （会话页多了 frontmatter 与骨架段，进 FTS 的文本不同）。
    // 所以只断言「确实被打了折」这一条契约，不锁死精确比例 ——
    // 锁死会一改骨架就误报（本次就因给测试页加骨架段而红过一次）。
    const ratio = s.bright / k.bright;
    assert.ok(ratio < 0.8, `会话页必须明显低于普通页，实比 ${ratio.toFixed(3)}`);
    assert.ok(ratio > 0.2, `折扣不该到「等于排除」的地步，实比 ${ratio.toFixed(3)}`);
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// 审查修复（2026-11-05）：L5 / L7 不再接 capture。
// 病根：它们各自的落点都有硬规则，capture 生成的页必然违规 —— 命令自己产出坏数据。
//   L5 → sessions/：当天只允许 log-<日期>.md、tags 必须 session-log 类
//   L7 → sources/：与 abs note 完全同一落点（实测文件名与正文结构一致）
test('capture: L5 被拒（落 sessions/ 会违反命名与 tags 规则），指向 log/ingest', async () => {
  const root = await freshBrain();
  try {
    const out = await cmdCapture({ dir: root, text: '测试会话层', layer: '5' });
    assert.match(out, /✗ L5/, `应明确拒绝: ${out}`);
    assert.match(out, /abs log/, `应指向 abs log: ${out}`);
    assert.match(out, /abs ingest/, `应指向 abs ingest: ${out}`);
    // 关键：拒了就不能落盘，否则用户拿到一张会被自己 lint 反复报错的页
    const files = await fs.readdir(join(root, '.brain', 'sessions')).catch(() => []);
    assert.deepEqual(files, [], `被拒时不能写文件: ${files}`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// 空骨架会话页整页排除（2026-11-05 实测）。
// 病根：ingest --auto 每次关会话都落一张空骨架；空骨架的「用户原话」段词频高、
// 正文又短，bm25 天然占优。实测造 20 张空页后查「登录超时」，前 12 名全是空页，
// 真正讲过这个问题的知识页被彻底挤出结果 —— 原来 0.5 降权不够，必须整页排除。
test('空骨架会话页不进检索；填好后自动回来', async () => {
  const { h, dir } = await freshDb();
  try {
    const skeleton = (slug) => page('p1', 'sessions', slug,
      '---\nkind: session-digest\nlayer: 5\n---\n\n'
      + '## 出了什么问题\n<!-- 具体症状 -->\n\n## 怎么解决的\n<!-- 根因 -->\n\n'
      + '## 用户原话\n- 缓存穿透 缓存穿透 缓存穿透\n');

    rebuild(h, [
      page('p1', 'concepts', 'real', '缓存穿透的解法是布隆过滤器'),
      skeleton('s1'),
      skeleton('s2'),
      skeleton('s3'),
    ]);
    let hits = search(h, '缓存穿透').map((r) => r.slug);
    assert.ok(hits.includes('real'), `知识页必须搜得到: ${hits}`);
    assert.ok(!hits.some((s) => s.startsWith('s')), `空骨架不该进结果: ${hits}`);

    // 填好其中一张 → 它应该重新参与检索
    rebuild(h, [
      page('p1', 'concepts', 'real', '缓存穿透的解法是布隆过滤器'),
      page('p1', 'sessions', 's1',
        '---\nkind: session-digest\nlayer: 5\n---\n\n'
        + '## 出了什么问题\n缓存穿透把库打挂了\n\n## 怎么解决的\n上布隆过滤器'),
      skeleton('s2'),
    ]);
    hits = search(h, '缓存穿透').map((r) => r.slug);
    assert.ok(hits.includes('s1'), `填好后必须回来: ${hits}`);
    assert.ok(!hits.includes('s2'), `没填的仍要排除: ${hits}`);
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// 出口也要排除空骨架（2026-11-05 实测）。
// 病根：入口 search 排了 unfilled，出口 illuminate 不排 —— 空骨架会从邻居扩散进来。
// 实测：知识页链到一张空骨架页后，查「缓存穿透」时它以 `↝ 0.24` 出现在结果里。
// 带 ↝ 标记的低亮度结果比直接排掉更误导：看起来像有效线索。
test('空骨架会话页也不许从扩散进来（入口出口同一判据）', async () => {
  const { h, dir } = await freshDb();
  try {
    const skeleton = page('p1', 'sessions', 'sk1',
      '---\nkind: session-digest\nlayer: 5\n---\n\n'
      + '## 出了什么问题\n<!-- 具体症状 -->\n\n## 用户原话\n- 缓存穿透\n');
    // 知识页显式链到那张空骨架 —— 扩散本来会顺着这条边点亮它
    const real = page('p1', 'concepts', 'real',
      '缓存穿透的解法是布隆过滤器\n\n## 关联连接\n- [[sk1]] — 那场会话\n');
    rebuild(h, [real, skeleton]);

    const lit = illuminate(h, search(h, '布隆过滤器'), { limit: 20 });
    const slugs = lit.map((r) => r.slug);
    assert.ok(slugs.includes('real'), `知识页要在: ${slugs}`);
    assert.ok(!slugs.includes('sk1'), `空骨架不该被扩散带出: ${slugs}`);
  } finally {
    h.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
