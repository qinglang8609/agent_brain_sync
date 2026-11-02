// evolve：知识自我进化的体检判据。
// 只测三件事：推翻关系能看出、类型标签不算主题、会话流水不算堆积。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb, rebuild, ensureDbDir } from '../src/brain/db.js';
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
