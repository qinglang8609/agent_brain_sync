// evolve：知识自我进化的体检判据。
// 只测三件事：推翻关系能看出、类型标签不算主题、会话流水不算堆积。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb, rebuild, ensureDbDir, search, rulesOf, parseAnchor } from '../src/brain/db.js';
import { evolveSignals, renderEvolve } from '../src/brain/evolve.js';

async function freshDb() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'evolve-'));
  const path = join(dir, 'g.db');
  await ensureDbDir(path);
  return { dir, path, h: openDb(path) };
}

function page(dirName, slug, body) {
  return { project: 'p1', dir: dirName, slug, body, mtime: Date.now() };
}

async function with_db(fn) {
  const { h, dir } = await freshDb();
  try { return await fn(h); }
  finally { h.close(); await fs.rm(dir, { recursive: true, force: true }); }
}

test('能看出被推翻的页与被谁取代', async () => {
  await with_db(async (h) => {
    rebuild(h, [
      page('concepts', 'old', '---\nstatus: superseded\nsuperseded-by: new\n---\n旧结论'),
      page('concepts', 'new', '---\nstatus: active\n---\n新结论'),
    ]);
    const sig = evolveSignals(h);
    assert.equal(sig.superseded.length, 1);
    assert.equal(sig.superseded[0].slug, 'old');
    assert.equal(sig.superseded[0].superseded_by, 'new', '推翻关系必须能从库里读出来');
    assert.equal(sig.danglingSupersede.length, 0, '指向了存在的页，不算断链');
  });
});

test('标了推翻却没指向新页 → 报断链', async () => {
  await with_db(async (h) => {
    rebuild(h, [page('concepts', 'old', '---\nstatus: superseded\n---\n旧结论')]);
    const sig = evolveSignals(h);
    assert.equal(sig.danglingSupersede.length, 1, '历史断了要报，不能静默');
  });
});

test('指向的页不存在 → 也报断链', async () => {
  await with_db(async (h) => {
    rebuild(h, [page('concepts', 'old', '---\nstatus: superseded\nsuperseded-by: 不存在的页\n---\n旧')]);
    assert.equal(evolveSignals(h).danglingSupersede.length, 1);
  });
});

test('类型标签不算主题（不能把 58 页 concept 报成一组堆积）', async () => {
  await with_db(async (h) => {
    const pages = [];
    for (let i = 0; i < 20; i++) {
      pages.push(page('concepts', `c${i}`, `---\ntags: [concept]\n---\n内容 ${i}`));
    }
    rebuild(h, pages);
    const sig = evolveSignals(h);
    assert.equal(sig.piled.length, 0, '`concept` 是页面类型不是主题，不能报堆积');
  });
});

test('同一业务主题页数过多 → 报堆积', async () => {
  await with_db(async (h) => {
    const pages = [];
    for (let i = 0; i < 10; i++) {
      pages.push(page('concepts', `c${i}`, `---\ntags: [concept, docker]\n---\n内容 ${i}`));
    }
    rebuild(h, pages);
    const sig = evolveSignals(h);
    assert.ok(sig.piled.length > 0, '同一主题 10 页该报堆积');
    assert.equal(sig.piled[0][0], 'docker');
  });
});

test('会话流水不参与主题堆积（归档快照本来就该各自独立）', async () => {
  await with_db(async (h) => {
    const pages = [];
    for (let i = 0; i < 15; i++) {
      pages.push(page('sessions', `log-2026-10-${String(i + 1).padStart(2, '0')}`,
        `---\ntags: [session-log, todo-archive, 历史]\n---\n流水 ${i}`));
    }
    rebuild(h, pages);
    const sig = evolveSignals(h);
    assert.equal(sig.piled.length, 0, 'sessions/ 下是流水不是知识页，不能报堆积');
  });
});

test('renderEvolve 不抛、含关键小节', async () => {
  await with_db(async (h) => {
    rebuild(h, [page('concepts', 'a', '---\nstatus: superseded\n---\nx')]);
    const out = renderEvolve(evolveSignals(h));
    assert.match(out, /图谱进化体检/);
    assert.match(out, /已推翻/);
    assert.match(out, /abs supersede/, '要给可执行的下一步');
  });
});

// ---------- 跨项目：共享查询 / 跨项目双链 / 铁律不外借 ----------


test('parseAnchor: @项目/页面 是显式跨项目，普通词是就近', () => {
  assert.deepEqual(parseAnchor('@projB/部署流程'), { project: 'projB', page: '部署流程' });
  assert.deepEqual(parseAnchor('普通页'), { project: null, page: '普通页' });

});

test('@前缀 建立显式跨项目边', async () => {
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [
      page2('pA', 'concepts', '引用者', '参考 [[@pB/目标页]]'),
      page2('pB', 'concepts', '目标页', 'B 的页'),
    ]);
    const cross = h.db.prepare(`
      SELECT s.project sp, d.project dp, d.slug ds, e.raw
      FROM edges e JOIN nodes s ON s.id=e.src JOIN nodes d ON d.id=e.dst
      WHERE e.dst > 0 AND s.project != d.project
    `).all();
    assert.equal(cross.length, 1, `只该有 1 条跨项目边，实际 ${cross.length}`);
    assert.equal(cross[0].sp, 'pA');
    assert.equal(cross[0].dp, 'pB');
    assert.equal(cross[0].ds, '目标页');
  } finally { h.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('@前缀 指向不存在的页 → 悬挂，不退回全局兜底', async () => {
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [
      page2('pA', 'concepts', '引用者', '参考 [[@pB/根本没这页]]'),
      // pC 有个同名页 —— 若退回兜底就会静默连过去
      page2('pC', 'concepts', '根本没这页', '别的项目的同名页'),
    ]);
    const rows = h.db.prepare(`
      SELECT d.project FROM edges e JOIN nodes d ON d.id=e.dst WHERE e.dst > 0
    `).all();
    assert.equal(rows.length, 0, '显式跨项目找不到时必须是悬挂，不能连到别的项目');
  } finally { h.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('同名平铺文件不跨项目误连（index/todo/log 每个项目都有）', async () => {
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [
      page2('pA', 'concepts', '页甲', '见 [[index]]'),
      page2('pB', '', 'index', '## Concepts\n- [[x]] — y'),
    ]);
    const cross = h.db.prepare(`
      SELECT count(*) c FROM edges e JOIN nodes s ON s.id=e.src JOIN nodes d ON d.id=e.dst
      WHERE e.dst > 0 AND s.project != d.project
    `).get().c;
    assert.equal(cross, 0, '[[index]] 不能连到别的项目的 index（实测踩过，纯误连）');
  } finally { h.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('铁律按项目隔离：只出自己的，不外借别人的', async () => {
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [
      page2('pA', '', 'index', '## Rules\n- A 的铁律\n'),
      page2('pB', '', 'index', '## Rules\n- B 的铁律\n'),
    ]);
    const a = rulesOf(h, 'pA');
    const b = rulesOf(h, 'pB');
    assert.deepEqual(a, ['A 的铁律']);
    assert.deepEqual(b, ['B 的铁律']);
    assert.ok(!a.includes('B 的铁律'), '别的项目的铁律不能外借');
  } finally { h.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('查询跨项目共享：能查到别的项目的知识页', async () => {
  const { h, dir } = await freshDb();
  try {
    rebuild(h, [
      page2('pA', 'concepts', '本项目页', '蓝绿部署的替代方案'),
      page2('pB', 'concepts', '别项目页', '蓝绿部署的完整流程'),
    ]);
    const got = search(h, '蓝绿部署').map((r) => r.project);
    assert.ok(got.includes('pA') && got.includes('pB'), '两个项目的页都该查到（知识共享）');
  } finally { h.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

function page2(project, dirName, slug, body) {
  return { project, dir: dirName, slug, body, mtime: Date.now() };
}
