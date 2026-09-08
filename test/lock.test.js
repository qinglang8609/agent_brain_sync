// test/lock.test.js — 并发写冲突保护：多进程/多并发下无丢失更新。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { cmdInit, cmdTask, cmdLog } from '../src/store.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(REPO, 'bin', 'abs.js');

let sandbox;
let project;

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-lock-test-'));
  project = join(sandbox, 'proj');
  await cmdInit({ dir: project });
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

describe('并发写保护', () => {
  test('并发的 task start 登记不同 id 全部保留（无覆盖丢失）', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `TASK-CONC-${i}`);
    await Promise.all(ids.map((id) => cmdTask({ dir: project, action: 'start', id, note: `任务${id}` })));
    const todo = await fs.readFile(join(project, '.brain', 'todo.md'), 'utf8');
    for (const id of ids) assert.ok(todo.includes(id), `丢失了 ${id}`);
  });

  test('并发的 cmdLog 多条全部落到 log.md（倒序不互相覆盖）', async () => {
    const n = 15;
    await Promise.all(Array.from({ length: n }, (_, i) => cmdLog({ dir: project, title: `log-${i}`, kind: 'test' })));
    const log = await fs.readFile(join(project, '.brain', 'log.md'), 'utf8');
    for (let i = 0; i < n; i++) assert.ok(log.includes(`log-${i}`), `丢失了 log-${i}`);
  });

  test('task start 同 id 幂等，并发下也不重复登记', async () => {
    await Promise.all(Array.from({ length: 10 }, () => cmdTask({ dir: project, action: 'start', id: 'TASK-IDEMP', note: 'x' })));
    const todo = await fs.readFile(join(project, '.brain', 'todo.md'), 'utf8');
    const count = todo.split('\n').filter((l) => l.startsWith('- [ ]') && l.includes('TASK-IDEMP')).length;
    assert.equal(count, 1);
  });

  test('无残留 .lock 文件', async () => {
    const brain = join(project, '.brain');
    const todo = join(brain, 'todo.md');
    const log = join(brain, 'log.md');
    await Promise.all([
      cmdTask({ dir: project, action: 'start', id: 'T-A', note: 'a' }),
      cmdLog({ dir: project, title: 'hello', kind: 'test' }),
    ]);
    for (const f of [todo, log]) {
      const lock = join(brain, `.${f.split('/').pop()}.lock`);
      await assert.rejects(() => fs.access(lock));
    }
  });

  test('并发的 cmdNote 不同文本各自成文件且 index 全登记（无互相覆盖）', async () => {
    const { cmdNote } = await import('../src/store.js');
    const texts = Array.from({ length: 10 }, (_, i) => `并发经验记录 ${i} 号-特定内容`);
    await Promise.all(texts.map((t) => cmdNote({ dir: project, text: t })));
    const srcDir = join(project, '.brain', 'sources');
    const files = (await fs.readdir(srcDir)).filter((f) => f.endsWith('.md') && !f.includes('.tmp-'));
    assert.ok(files.length >= texts.length, `应有 ${texts.length} 个 source 页, 实际 ${files.length}`);
    // 每段文本在某个源文件里都能被找到（无丢失）
    const allBodies = await Promise.all(files.map((f) => fs.readFile(join(srcDir, f), 'utf8')));
    for (const t of texts) {
      assert.ok(allBodies.some((b) => b.includes(t)), `内容丢失: ${t}`);
    }
    // index Sources 区登记了全部
    const index = await fs.readFile(join(project, '.brain', 'index.md'), 'utf8');
    for (const f of files) assert.ok(index.includes(`[[${f.replace(/\.md$/, '')}]]`), `index 漏登记 ${f}`);
    // 无残留 tmp 文件
    const leftovers = (await fs.readdir(srcDir)).filter((f) => f.includes('.tmp-'));
    assert.equal(leftovers.length, 0);
  });

  // 回归: 真实多进程 CLI 并发写, 不应因排队等锁 LockTimeout 饿死而丢(见 acquireLock 预算)
  test('多进程 CLI 并发 task start 不丢(排队等锁不饿死)', async () => {
    const N = 12; // 独立 CLI 进程并发打同一 todo.md
    const runs = await Promise.all(Array.from({ length: N }, (_, i) => new Promise((resolve) => {
      const c = spawn(process.execPath, [CLI, 'task', 'start', `MPCLI-${i}`, '--note', `x${i}`, '--dir', project]);
      c.on('close', (code) => resolve(code));
    })));
    for (const code of runs) assert.equal(code, 0, `某进程退出码非 0 (LockTimeout 饿死): ${runs.filter((x) => x !== 0).join(',')}`);
    const todo = await fs.readFile(join(project, '.brain', 'todo.md'), 'utf8');
    for (let i = 0; i < N; i++) assert.ok(todo.includes(`MPCLI-${i}`), `丢失了 MPCLI-${i}(排队等锁被饿死)`);
    const locks = (await fs.readdir(join(project, '.brain'))).filter((f) => f.endsWith('.lock'));
    assert.equal(locks.length, 0, `残留 .lock: ${locks.join(',')}`);
  });
});
