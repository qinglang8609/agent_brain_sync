// test/restore.test.js — `abs todo restore`：把历史归档进日志页的任务拿回看板。
//
// 背景：2026-09 至 2026-11 的 `abs todo archive` 把超期任务搬进
// `sessions/log-<日期>.md` 的「📦 任务归档」段，todo.md 只留一行链接。
// 2026-11-16 用户定：Done 不压缩、全量留在看板 → 一次性回捞，日志页原样保留。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { restoreArchivedTasks, archivedTaskLines } from '../src/todo.js';

let sandbox;
let proj;

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-restore-'));
  proj = join(sandbox, 'proj');
  await fs.mkdir(join(proj, '.brain', 'sessions'), { recursive: true });
  await fs.writeFile(join(proj, '.brain', 'todo.md'), '# 📋 Todo Board\n\n- [ ] 还在做 (认领 2026-09-10)\n', 'utf8');
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

const page = (sections) => [
  '---',
  'tags: [session-log, todo-archive, 历史]',
  '---',
  '',
  '# 2026-09-04 记录',
  '',
  '## 会话 01a1d04d',
  '',
  '这场聊了什么。',
  '',
  ...sections,
].join('\n');

describe('archivedTaskLines', () => {
  test('只取归档段里的任务行与缩进子项，日期分组标题与正文不要', () => {
    const body = page([
      '## 📦 任务归档',
      '',
      '### 2026-09-04',
      '',
      '- [x] OLD-A [[fanchao]] — 老任务 — 做完 【落地】 (完成 2026-09-04)',
      '  - [x] 子项一',
      '  - [ ] 子项二',
      '',
      '## 关联连接',
      '- [[某个页]]',
      '',
    ]);
    assert.deepEqual(archivedTaskLines(body), [
      '- [x] OLD-A [[fanchao]] — 老任务 — 做完 【落地】 (完成 2026-09-04)',
      '  - [x] 子项一',
      '  - [ ] 子项二',
    ]);
  });

  test('没有归档段的页 → 空（会话摘要不会被当成任务）', () => {
    const body = page(['## 关联连接', '- [[某个页]]', '- [x] 这行不在归档段', '']);
    assert.deepEqual(archivedTaskLines(body), []);
  });
});

describe('restoreArchivedTasks', () => {
  test('把归档段的任务并回 todo.md，日志页一字不改', async () => {
    const body = page([
      '## 📦 任务归档',
      '',
      '### 2026-09-04',
      '',
      '- [x] OLD-A [[fanchao]] — 老任务 【落地】 (完成 2026-09-04)',
      '  - [x] 子项一',
      '  - [ ] 子项二',
      '',
    ]);
    const pagePath = join(proj, '.brain', 'sessions', 'log-2026-09-04.md');
    await fs.writeFile(pagePath, body, 'utf8');

    const r = await restoreArchivedTasks(proj);
    assert.equal(r.added, 1, JSON.stringify(r));

    const todo = await fs.readFile(join(proj, '.brain', 'todo.md'), 'utf8');
    assert.ok(/\[OLD-A/.test(todo), `任务应回到看板:\n${todo}`);
    // 任务与它的两条子项按原顺序回来，子项仍挂在它下面
    const rows = todo.split('\n');
    const at = rows.findIndex((l) => l.includes('OLD-A'));
    assert.ok(rows[at + 1].includes('子项一') && rows[at + 2].includes('子项二'), `子项应跟在任务下:\n${todo}`);
    // 已有的未完成任务不受影响
    assert.ok(/\[还在做\]/.test(todo), todo);
    // 日志页原样（只读不删）
    assert.equal(await fs.readFile(pagePath, 'utf8'), body);
  });

  test('幂等：跑两次不会重复插入', async () => {
    await fs.writeFile(join(proj, '.brain', 'sessions', 'log-2026-09-04.md'), page([
      '## 📦 任务归档', '', '### 2026-09-04', '', '- [x] OLD-A — 老任务 【落地】 (完成 2026-09-04)', '',
    ]), 'utf8');
    const first = await restoreArchivedTasks(proj);
    const after1 = await fs.readFile(join(proj, '.brain', 'todo.md'), 'utf8');
    const second = await restoreArchivedTasks(proj);
    const after2 = await fs.readFile(join(proj, '.brain', 'todo.md'), 'utf8');
    assert.equal(first.added, 1);
    assert.equal(second.added, 0, '第二次不该再加');
    assert.equal(after1, after2, '文件不该再变');
    assert.equal((after2.match(/OLD-A/g) || []).length, 1, `只应一条:\n${after2}`);
  });

  // 审查时补的边界：父任务已在看板、子项却不在 —— 子项必须挂回父任务下，
  // 不能追加到文件尾（那会变孤儿子项，写闸门直接拒掉整次回捞）。
  test('父任务已在看板时，缺的子项挂回它下面（不产生孤儿）', async () => {
    const parentLine = '- [x] OLD-A [[fanchao]] — 老任务 【落地】 (完成 2026-09-04)';
    await fs.writeFile(join(proj, '.brain', 'todo.md'),
      `# 📋 Todo Board\n\n${parentLine}\n- [ ] 另一条还在做 (认领 2026-09-10)\n`, 'utf8');
    await fs.writeFile(join(proj, '.brain', 'sessions', 'log-2026-09-04.md'), page([
      '## 📦 任务归档', '', '### 2026-09-04', '', parentLine, '  - [x] 子项一', '  - [ ] 子项二', '',
    ]), 'utf8');

    const r = await restoreArchivedTasks(proj);
    assert.equal(r.added, 0, `父任务已在，不该重复计入: ${JSON.stringify(r)}`);
    const todo = await fs.readFile(join(proj, '.brain', 'todo.md'), 'utf8');
    assert.equal((todo.match(/OLD-A/g) || []).length, 1, `父任务不该重复:\n${todo}`);
    const rows = todo.split('\n');
    const at = rows.findIndex((l) => l.includes('OLD-A'));
    assert.ok(rows[at + 1].includes('子项一') && rows[at + 2].includes('子项二'), `子项应挂在父任务下:\n${todo}`);
    assert.ok(!/^ {2}- \[/m.test(rows[0]), '文件头不该出现孤儿行');
  });

  test('dry-run 只报数不改盘', async () => {
    await fs.writeFile(join(proj, '.brain', 'sessions', 'log-2026-09-04.md'), page([
      '## 📦 任务归档', '', '- [x] OLD-A — 老任务 【落地】 (完成 2026-09-04)', '',
    ]), 'utf8');
    const before = await fs.readFile(join(proj, '.brain', 'todo.md'), 'utf8');
    const r = await restoreArchivedTasks(proj, { dryRun: true });
    assert.equal(r.added, 1);
    assert.equal(await fs.readFile(join(proj, '.brain', 'todo.md'), 'utf8'), before);
  });

  test('早期独立归档页（<日期>-todo归档.md）整页都是归档内容', async () => {
    await fs.writeFile(join(proj, '.brain', 'sessions', '2026-09-03-todo归档.md'),
      '# 2026-09-03 归档\n\n### 2026-09-03\n\n- [x] OLD-B — 老任务 【落地】 (完成 2026-09-03)\n', 'utf8');
    const r = await restoreArchivedTasks(proj);
    assert.equal(r.added, 1, JSON.stringify(r));
    const todo = await fs.readFile(join(proj, '.brain', 'todo.md'), 'utf8');
    assert.ok(/\[OLD-B/.test(todo), todo);
  });
});
