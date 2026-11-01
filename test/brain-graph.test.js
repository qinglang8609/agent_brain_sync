// src/brain/__luminance.test.js 之外的正式测试：七层 + 图数据库。
// 只测三件必须稳定的事：层归属唯一、层不会漂、库坏了能降级。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LAYERS, DIR_LAYER, DEFAULT_LAYER, layerOf, decayOf, resolveLayer, anchorsOf, layerConflict } from '../src/brain/layers.js';
import { openDb, rebuild, search, illuminate, rulesOf, stats, bigrams, ensureDbDir, DbError } from '../src/brain/db.js';

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
