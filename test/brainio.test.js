// test/brainio.test.js — .brain 统一读写收口 (src/brainio.js)。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { cmdInit } from '../src/store.js';
import { readBrain, writeBrain, appendBrain, createBrainFile } from '../src/brainio.js';
import { brainPath } from '../src/index.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(REPO, 'bin', 'abs.js');
let sandbox;
let project;

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-brainio-'));
  project = join(sandbox, 'proj');
  await cmdInit({ dir: project });
});
afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

describe('brainio: 统一读', () => {
  test('readBrain 读 .brain/<rel> 文本', async () => {
    const t = await readBrain(project, 'todo.md');
    assert.ok(t.includes('# 📋 Todo 看板'));
    assert.ok(t.includes('## Backlog'));
  });
  test('readBrain 文件不存在返回 null(不抛)', async () => {
    const t = await readBrain(project, 'sources/不存在.md');
    assert.equal(t, null);
  });
});

describe('brainio: 统一写(自动防并发)', () => {
  test('writeBrain 锁内读改写: transform 改文本落盘', async () => {
    const before = await readBrain(project, 'log.md');
    const r = await writeBrain(project, 'log.md', (cur) => `${cur}\n## [2026-09-09] dev | brainio 测试`);
    assert.ok(r.includes('brainio 测试'));
    const after = await readBrain(project, 'log.md');
    assert.ok(after.includes('brainio 测试'));
  });

  test('writeBrain transform 返回 null 不落盘', async () => {
    const before = await readBrain(project, 'todo.md');
    await writeBrain(project, 'todo.md', () => null);
    const after = await readBrain(project, 'todo.md');
    assert.equal(after, before); // 内容未变
  });

  test('appendBrain 往文末追加多行', async () => {
    await appendBrain(project, 'log.md', ['## [2026-09-09] dev | 行1', '## [2026-09-09] dev | 行2']);
    const t = await readBrain(project, 'log.md');
    assert.ok(t.includes('行1') && t.includes('行2'));
  });
});

describe('brainio: 多进程并发写不丢(防重复/防并发继承 lock)', () => {
  test('N 进程并发 appendBrain 追加各自行, 全保留', async () => {
    // worker: 独立进程直接调 brainio.appendBrain 往项目 log.md 追加一行唯一标记
    const worker = join(sandbox, 'worker.mjs');
    const brainioAbs = join(REPO, 'src', 'brainio.js');
    await fs.writeFile(worker, [
      `import { appendBrain } from ${JSON.stringify('file://' + brainioAbs)};`,
      `import { join } from 'node:path';`,
      `const [, , proj, tag] = process.argv;`,
      `await appendBrain(proj, 'log.md', ['## [2026-09-09] dev | 并发标记 ' + tag]);`,
      `process.exit(0);`,
    ].join('\n'), 'utf8');
    const N = 8;
    await Promise.all(Array.from({ length: N }, (_, i) => new Promise((resolve) => {
      const c = spawn(process.execPath, [worker, project, `tag-${i}`]);
      c.on('close', (code) => resolve(code));
    })));
    const t = await readBrain(project, 'log.md');
    for (let i = 0; i < N; i++) assert.ok(t.includes(`并发标记 tag-${i}`), `丢失了 tag-${i}`);
  });
});

describe('brainio: createBrainFile 原子建新文件', () => {
  test('写新 .brain 子文件(自动建目录)', async () => {
    const p = await createBrainFile(project, 'concepts/test-xyz.md', '# 测试\n---\n');
    await fs.access(p);
    const t = await readBrain(project, 'concepts/test-xyz.md');
    assert.equal(t, '# 测试\n---\n');
  });
});
