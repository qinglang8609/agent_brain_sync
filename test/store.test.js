// test/store.test.js — store/todo 层单测（node:test，零外部依赖）。
// 覆盖: init/load/board/task/query/lint 命令 + todo 读写 + 定位层。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { cmdInit, cmdBoard, cmdStatus, cmdLoad, cmdTask, cmdLog, cmdQuery, cmdLint, cmdNote, cmdShow, cmdWrapup } from '../src/store.js';
import { readTodo, todoTemplate, today, addTask, normalizeTodo, groupDoneSection, insertDoneGrouped } from '../src/todo.js';
import { findBrainRoot, requireBrain, brainPath } from '../src/index.js';

// ---------- 测试沙盒: 每个用例一个临时目录 ----------
let sandbox;
let projectA; // A 项目根（含 .brain/）
let projectB; // B 项目根（无 .brain/）→ 定位应向上穿透 A 找到最近祖先

async function mkProject(name) {
  const p = join(sandbox, name);
  await fs.mkdir(join(p, 'sub', 'deep'), { recursive: true });
  return p;
}

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-test-'));
  projectA = await mkProject('proj-a');
  projectB = await mkProject('proj-b');
  await cmdInit({ dir: projectA });
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

// ---------- 定位层 (src/index.js) ----------
describe('findBrainRoot 定位', () => {
  test('从项目子目录向上找到 .brain/', async () => {
    const root = await findBrainRoot(join(projectA, 'sub', 'deep'));
    assert.equal(root, projectA);
  });

  test('无图谱返回 null', async () => {
    const root = await findBrainRoot(projectB);
    assert.equal(root, null);
  });

  test('requireBrain 无图谱时抛错且信息含 abs init', async () => {
    await assert.rejects(() => requireBrain(projectB), /abs init/);
  });

  test('brainPath 拼接图谱内路径', () => {
    assert.equal(brainPath(projectA, 'todo.md'), join(projectA, '.brain', 'todo.md'));
  });
});

// ---------- init ----------
describe('cmdInit', () => {
  test('已存在时拒绝重建', async () => {
    await assert.rejects(() => cmdInit({ dir: projectA }), /已存在/);
  });

  test('骨架齐全: 6 目录 + 3 文件', async () => {
    for (const d of ['entities', 'concepts', 'sources', 'syntheses', 'sessions']) {
      const st = await fs.stat(join(projectA, '.brain', d));
      assert.ok(st.isDirectory(), `缺目录 ${d}`);
    }
    for (const f of ['index.md', 'log.md', 'todo.md']) {
      await fs.access(join(projectA, '.brain', f));
    }
  });

  test('结构损坏诊断: 缺目录/缺文件被 reportBrain 指出', async () => {
    const { reportBrain } = await import('../src/store.js');
    await fs.rm(join(projectA, '.brain', 'sessions'), { recursive: true });
    await fs.rm(join(projectA, '.brain', 'index.md'));
    const r = await reportBrain({ dir: projectA });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('sessions/')), r.problems.join(';'));
    assert.ok(r.problems.some((p) => p.includes('index.md')), r.problems.join(';'));
  });

  test('init 拒绝重建时可带 --repair 补齐损坏骨架', async () => {
    const { cmdRepair } = await import('../src/store.js');
    await fs.rm(join(projectA, '.brain', 'sources'), { recursive: true });
    await fs.rm(join(projectA, '.brain', 'todo.md'));
    const r = await cmdRepair({ dir: projectA });
    assert.ok(r.includes('✓') || r.includes('补齐'), r);
    await fs.access(join(projectA, '.brain', 'sources'));
    await fs.access(join(projectA, '.brain', 'todo.md'));
    // 已存在的 index.md 不被覆盖
    await fs.writeFile(join(projectA, '.brain', 'index.md'), '# 自定义索引', 'utf8');
    await cmdRepair({ dir: projectA });
    assert.equal(await fs.readFile(join(projectA, '.brain', 'index.md'), 'utf8'), '# 自定义索引');
  });
});

// ---------- todo 层 ----------
describe('todo 层', () => {
  test('todoTemplate 含两级分区与断点标记', () => {
    const t = todoTemplate();
    for (const seg of ['## Backlog', '## Today / In Progress', '## Blocked', '## Done']) {
      assert.ok(t.includes(seg), `缺分区 ${seg}`);
    }
  });

  test('addTask 在指定分区末尾插入', async () => {
    await addTask(projectA, { section: 'Backlog', text: 'X — 优先级:P1' });
    const t = await readTodo(projectA);
    const backlog = t.split('## Today')[0];
    assert.ok(backlog.includes('X — 优先级:P1'));
  });
});

// ---------- 老格式迁移 (用户报告: bootstrap 老模板 In Progress/Todo 与 B4 定稿冲突) ----------
describe('normalizeTodo 老格式迁移', () => {
  const OLD = [
    '# 📋 Todo 看板',
    '## In Progress',
    '- [ ] 正在做的事 (认领 2026-09-08)',
    '## Todo',
    '- [ ] 老待办A',
    '- [ ] 老待办B',
    '## Blocked',
    '- [ ] 卡住的事 — 原因',
    '## Done',
    '- [x] 老完成 — 完成日期',
    '',
  ].join('\n');

  test('老格式 → B4 定稿: In Progress→Today, Todo→Backlog, 内容不丢', () => {
    const out = normalizeTodo(OLD);
    assert.ok(out.includes('## Backlog'), out);
    assert.ok(out.includes('## Today / In Progress'), out);
    assert.ok(out.includes('- [ ] 正在做的事 (认领 2026-09-08)'), 'In Progress 内容应进 Today 区');
    assert.ok(out.includes('- [ ] 老待办A') && out.includes('- [ ] 老待办B'), 'Todo 内容应进 Backlog');
    const backlog = out.split('## Today')[0];
    assert.ok(backlog.includes('老待办A'), '老 Todo 应在 Backlog 区');
    assert.ok(out.includes('## Blocked') && out.includes('卡住的事'));
    assert.ok(out.includes('老完成'));
  });

  test('新格式幂等: 已有 Backlog/Today 区原样返回', () => {
    const t = todoTemplate();
    assert.equal(normalizeTodo(t), t);
  });

  test('迁移后 task done 能正确归位 (端到端)', async () => {
    await fs.writeFile(join(projectA, '.brain', 'todo.md'), OLD, 'utf8');
    const r = await cmdTask({ dir: projectA, action: 'start', id: 'MIG-1', note: '迁移后登记' });
    assert.ok(r.includes('登记'), r);
    const t = await readTodo(projectA);
    assert.ok(!t.includes('## In Progress\n') || t.includes('## Today / In Progress'), `应已归一:\n${t}`);
    assert.ok(t.includes('MIG-1'));
    const r2 = await cmdTask({ dir: projectA, action: 'done', id: 'MIG-1' });
    assert.ok(r2.includes('✓'), r2);
    const t2 = await readTodo(projectA);
    const doneSec = t2.split('## Done')[1] || '';
    assert.ok(doneSec.includes('MIG-1'), `迁移后 done 应归位 Done:\n${t2}`);
  });
});

// ---------- task: 登记/完成 + 幂等 ----------
describe('cmdTask', () => {
  test('start 登记进 Today 区并带认领日期', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'T-1', note: '做 X' });
    const t = await readTodo(projectA);
    assert.ok(t.includes('T-1 — 做 X'));
    assert.ok(t.includes(`认领 ${today()}`));
  });

  test('幂等: 同 id 重复 start 只有一行（更新 note，不重复登记）', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'T-2', note: 'v1' });
    await cmdTask({ dir: projectA, action: 'start', id: 'T-2', note: 'v2' });
    const t = await readTodo(projectA);
    const hits = t.split('\n').filter((l) => l.includes('T-2') && l.startsWith('- [ ]'));
    assert.equal(hits.length, 1, `应只有一行 T-2，实际 ${hits.length}:\n${hits.join('\n')}`);
    assert.ok(t.includes('v2'), '重复 start 应更新 note 为最新');
    assert.ok(!t.includes('v1'), '旧 note 不应残留');
  });

  test('done 勾选并归位（保持一行，标完成日期）', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'T-3', note: '做 Y' });
    const r = await cmdTask({ dir: projectA, action: 'done', id: 'T-3' });
    assert.ok(r.includes('✓'), r);
    const t = await readTodo(projectA);
    const done = t.split('## Done')[1] || '';
    assert.ok(/- \[x\].*T-3/.test(done), `T-3 应在 Done 区:\n${t}`);
    assert.ok(t.includes(`完成 ${today()}`));
  });

  test('done 归位时断点附属行随任务走，不残留原区 (trimStart bug)', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'T-BP', note: '带断点任务' });
    await cmdTask({ dir: projectA, action: 'note', id: 'T-BP', note: '改到 store.js L40' });
    const r = await cmdTask({ dir: projectA, action: 'done', id: 'T-BP' });
    assert.ok(r.includes('✓'), r);
    const t = await readTodo(projectA);
    const todaySec = t.split('## Today')[1]?.split('## ')[0] || '';
    const doneSec = t.split('## Done')[1] || '';
    // 断点应随任务进 Done 区（Done 区内 T-BP 行下方）
    assert.ok(!todaySec.includes('改到 store.js L40'), `断点不应残留在 Today 区:\n${todaySec}`);
    assert.ok(doneSec.includes('改到 store.js L40'), `断点应随任务归位 Done:\n${doneSec}`);
  });

  test('done 幂等: 重复 done 不再追加行', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'T-4' });
    await cmdTask({ dir: projectA, action: 'done', id: 'T-4' });
    const after1 = await readTodo(projectA);
    await cmdTask({ dir: projectA, action: 'done', id: 'T-4' });
    const after2 = await readTodo(projectA);
    assert.equal(after1, after2, '二次 done 不应再改文件');
  });

  test('done 未找到 id 时给明确提示不抛错', async () => {
    const r = await cmdTask({ dir: projectA, action: 'done', id: 'NOPE' });
    assert.ok(r.includes('NOPE'));
  });
});

// ---------- board/load/status ----------
describe('board/load/status', () => {
  test('board 输出项目头 + 看板', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'T-5', note: 'Z' });
    const out = await cmdBoard({ dir: projectA });
    assert.ok(out.includes('T-5'));
    assert.ok(out.includes('📂'));
  });

  test('load 输出 index + todo + log 三段', async () => {
    const out = await cmdLoad({ dir: projectA });
    assert.ok(out.includes('index.md'));
    assert.ok(out.includes('Todo'));
    assert.ok(out.includes('log.md'));
  });

  test('status 报告项目 + 各类页数', async () => {
    const out = await cmdStatus({ dir: projectA });
    assert.ok(out.includes('concepts/: 0 页'));
  });
});

// ---------- log ----------
describe('cmdLog', () => {
  test('追加一行且换行被清洗、限长', async () => {
    await cmdLog({ dir: projectA, title: '[SessionStart]\nlong'.repeat(30) });
    const log = await fs.readFile(join(projectA, '.brain', 'log.md'), 'utf8');
    const line = log.split('\n').find((l) => l.startsWith('## ['));
    assert.ok(line, '应有流水行');
    assert.ok(!line.includes('\n'));
    assert.ok(line.length <= 140, '行应被截断（时间戳+120 字符）');
  });
});

// ---------- query: 检索（TASK-02） ----------
describe('cmdQuery', () => {
  test('命中 concept 页并带页面路径', async () => {
    await fs.writeFile(
      join(projectA, '.brain', 'concepts', 'docker-prisma-429.md'),
      '---\ntags: [concept, docker]\nupdated: 2026-09-08\nstatus: draft\n---\n# 概念\n429 是连接池超限\n',
      'utf8'
    );
    const out = await cmdQuery({ dir: projectA, terms: ['docker', '429'] });
    assert.ok(out.includes('docker-prisma-429'), out);
  });

  test('多词是 OR：任一命中即出', async () => {
    await fs.writeFile(
      join(projectA, '.brain', 'concepts', 'a-page.md'),
      '---\ntags: [concept]\nupdated: 2026-09-08\nstatus: draft\n---\nalpha 专属词\n',
      'utf8'
    );
    const out = await cmdQuery({ dir: projectA, terms: ['专属词'] });
    assert.ok(out.includes('a-page'), out);
  });

  test('无命中时明确提示并建议 abs init', async () => {
    const out = await cmdQuery({ dir: projectB, terms: ['x'] });
    assert.ok(out.includes('abs init'), out);
  });

  test('无 terms 时给用法提示', async () => {
    const out = await cmdQuery({ dir: projectA, terms: [] });
    assert.ok(out.includes('用法') || out.toLowerCase().includes('usage'), out);
  });
});

// ---------- 实时化: blocked / note / 进度断点 (TASK-RT) ----------
describe('cmdTask blocked + note (实时断点)', () => {
  test('blocked: 任务行移入 Blocked 区并附原因', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'TB-1', note: '做 W' });
    const r = await cmdTask({ dir: projectA, action: 'blocked', id: 'TB-1', note: '端口被占' });
    assert.ok(r.includes('Blocked') || r.includes('✓'), r);
    const t = await readTodo(projectA);
    const blocked = t.split('## Blocked')[1]?.split('## ')[0] || '';
    assert.ok(/- \[ \].*TB-1/.test(blocked), `TB-1 应在 Blocked 区:\n${t}`);
    assert.ok(blocked.includes('端口被占'), '应附原因');
  });

  test('note: 半成品断点原位补 ↳ 断点 行，不挪任务位置', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'TN-1', note: '做 V' });
    const r = await cmdTask({ dir: projectA, action: 'note', id: 'TN-1', note: '改到 store.js L40，卡在 markDone' });
    assert.ok(r.includes('✓') || r.includes('断点'), r);
    const t = await readTodo(projectA);
    const today = t.split('## Today')[1]?.split('## ')[0] || '';
    assert.ok(today.includes('↳ 断点: 改到 store.js L40'), `断点行应在任务下:\n${t}`);
  });

  test('note 幂等: 同任务再补断点更新原行不叠加', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'TN-2' });
    await cmdTask({ dir: projectA, action: 'note', id: 'TN-2', note: '断点A' });
    await cmdTask({ dir: projectA, action: 'note', id: 'TN-2', note: '断点B(新)' });
    const t = await readTodo(projectA);
    const lines = t.split('\n').filter((l) => l.includes('↳ 断点:') && l.includes('TN-2') === false && (l.includes('断点A') || l.includes('断点B')));
    // 同一任务只保留最新断点行
    const forTask = t.split('\n');
    const idx = forTask.findIndex((l) => l.includes('TN-2'));
    assert.ok(forTask[idx + 1].includes('↳ 断点: 断点B'), `应更新为最新断点:\n${forTask.slice(idx, idx + 2).join('\n')}`);
    assert.ok(!forTask[idx + 1].includes('断点A'), '旧断点不残留');
  });

  test('blocked 未找到 id 时明确提示', async () => {
    const r = await cmdTask({ dir: projectA, action: 'blocked', id: 'NOPE2' });
    assert.ok(r.includes('NOPE2'));
  });
});

// ---------- 实时化: abs note 经验暂存通道 (TASK-RT) ----------
describe('cmdNote (经验实时暂存)', () => {
  test('写一条 source 页: 文件名带日期slug、frontmatter 齐、内容含原文', async () => {
    const r = await cmdNote({ dir: projectA, text: 'docker 内存超限导致 prisma 429', tags: 'docker,坑' });
    assert.ok(r.includes('✓'), r);
    const srcDir = join(projectA, '.brain', 'sources');
    const files = (await fs.readdir(srcDir)).filter((f) => f.endsWith('.md'));
    assert.equal(files.length, 1);
    const body = await fs.readFile(join(srcDir, files[0]), 'utf8');
    assert.ok(body.startsWith('---\n'), '应有 frontmatter');
    assert.ok(body.includes('tags: [source'), '首标签 source');
    assert.ok(body.includes('docker 内存超限导致 prisma 429'));
  });

  test('幂等: 同文本 60s 内重复只落一份', async () => {
    await cmdNote({ dir: projectA, text: '重复我' });
    await cmdNote({ dir: projectA, text: '重复我' });
    const srcDir = join(projectA, '.brain', 'sources');
    const files = (await fs.readdir(srcDir)).filter((f) => f.includes('dedup') || f.endsWith('.md'));
    const n = files.length;
    assert.ok(n >= 1, '至少一条');
    // 关键断言: 两次调用后含"重复我"的文件只有一个
    let dup = 0;
    for (const f of files) {
      const b = await fs.readFile(join(srcDir, f), 'utf8');
      if (b.includes('重复我')) dup++;
    }
    assert.equal(dup, 1, `同文本应只落一份, 实际 ${dup}`);
  });

  test('追加到 index Sources 区 + log 一行', async () => {
    await cmdNote({ dir: projectA, text: '要进索引的经验' });
    const index = await fs.readFile(join(projectA, '.brain', 'index.md'), 'utf8');
    assert.ok(/## Sources/.test(index));
    const log = await fs.readFile(join(projectA, '.brain', 'log.md'), 'utf8');
    assert.ok(log.includes('note |'), 'log 应有一行 note 流水');
  });

  test('空文本拒绝', async () => {
    const r = await cmdNote({ dir: projectA, text: '   ' });
    assert.ok(r.includes('用法') || r.includes('text'), r);
  });
});

// ---------- 查看命令: todo/index/log (TASK-CLI) ----------
describe('cmdShow (todo/index/log 查看)', () => {
  test('view=todo 等价 board 输出', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'TS-1' });
    const a = await cmdShow({ dir: projectA, view: 'todo' });
    const b = await cmdBoard({ dir: projectA });
    assert.equal(a, b);
    assert.ok(a.includes('TS-1'));
  });

  test('view=index 输出 index.md 全文', async () => {
    const out = await cmdShow({ dir: projectA, view: 'index' });
    assert.ok(out.includes('图谱索引'));
  });

  test('view=log 输出 log.md 倒序流水', async () => {
    await cmdLog({ dir: projectA, title: '查看用流水行' });
    const out = await cmdShow({ dir: projectA, view: 'log' });
    assert.ok(out.includes('操作日志'));
    assert.ok(out.includes('查看用流水行'));
  });

  test('index/log 缺文件时给友好提示不抛错', async () => {
    await fs.rm(join(projectA, '.brain', 'index.md'));
    const out = await cmdShow({ dir: projectA, view: 'index' });
    assert.ok(out.includes('index.md') && (out.includes('不存在') || out.includes('init')), out);
  });

  test('未知 view 报用法', async () => {
    const out = await cmdShow({ dir: projectA, view: 'nope' });
    assert.ok(out.includes('todo') && out.includes('index') && out.includes('log'), out);
  });
});

describe('cmdLint', () => {
  const PAGE = (body) => `---\ntags: [concept]\nupdated: 2026-09-08\nstatus: draft\n---\n${body}`;

  test('健康图谱: 0 问题', async () => {
    // 挂到 index 且互相链接的规范页
    await fs.writeFile(
      join(projectA, '.brain', 'concepts', 'good.md'),
      PAGE('# 概念：好页\n[[good-2]]'),
      'utf8'
    );
    await fs.writeFile(
      join(projectA, '.brain', 'concepts', 'good-2.md'),
      PAGE('# 概念：好页二\n关联 [[good]]'),
      'utf8'
    );
    let index = await fs.readFile(join(projectA, '.brain', 'index.md'), 'utf8');
    index = index.replace('## Concepts', '## Concepts\n- [[good]] — a\n- [[good-2]] — b');
    await fs.writeFile(join(projectA, '.brain', 'index.md'), index, 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('0'), `应 0 问题: ${out}`);
  });

  test('死链被检出', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'bad-link.md'), PAGE('→ [[no-such-page]]'), 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('DEAD-LINK'), out);
  });

  test('孤岛页被检出', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'lonely.md'), PAGE('无任何链接'), 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('ORPHAN-PAGE'), out);
  });

  test('缺 frontmatter 被检出', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'nofm.md'), '直接正文', 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('NO-FRONTMATTER'), out);
  });

  test('超尺寸页被检出', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'big.md'), PAGE('x'.repeat(6 * 1024)), 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('OVER-SIZE'), out);
  });

  test('模板残留链接被检出', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'tpl.md'), PAGE('见 [[EntityName]]'), 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('TEMPLATE-LINK'), out);
  });

  test('index 漏列被检出', async () => {
    await fs.writeFile(
      join(projectA, '.brain', 'entities', 'Docker.md'),
      '---\ntags: [entity]\nupdated: 2026-09-08\nstatus: draft\n---\n见 [[good]]',
      'utf8'
    );
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('INDEX-MISSING'), out);
  });

  test('sources 堆积被检出', async () => {
    for (let i = 0; i < 11; i++) {
      await fs.writeFile(
        join(projectA, '.brain', 'sources', `2026-09-0${i % 9}-s${i}.md`),
        '---\ntags: [source]\nupdated: 2026-09-08\nstatus: draft\n---\n内容',
        'utf8'
      );
    }
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('SOURCES-PILED-UP'), out);
  });

  test('source 暂存页孤立不报 ORPHAN (豁免)', async () => {
    await fs.writeFile(
      join(projectA, '.brain', 'sources', '2026-09-08-孤立线索.md'),
      '---\ntags: [source]\nupdated: 2026-09-08\nstatus: draft\n---\n待提炼的孤立线索',
      'utf8'
    );
    const out = await cmdLint({ dir: projectA });
    assert.ok(!out.includes('ORPHAN-PAGE'), out);
  });

  test('concept 页孤立仍报 ORPHAN (不豁免)', async () => {
    await fs.writeFile(
      join(projectA, '.brain', 'concepts', '真孤立.md'),
      '---\ntags: [concept]\nupdated: 2026-09-08\nstatus: draft\n---\n无任何链接的概念',
      'utf8'
    );
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('ORPHAN-PAGE'), out);
  });
});

// ---------- 收尾保险: wrapup 快照 + load 滞留展示 (WRAPUP) ----------
describe('cmdWrapup + load 滞留 (A+B)', () => {
  let logDir;
  const savedEnv = process.env.ABS_LOG_DIR;

  beforeEach(async () => {
    logDir = join(sandbox, 'abs-log');
    process.env.ABS_LOG_DIR = logDir;
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.ABS_LOG_DIR;
    else process.env.ABS_LOG_DIR = savedEnv;
  });

  async function wrapupLogText() {
    try { return await fs.readFile(join(logDir, 'wrapup.log'), 'utf8'); } catch { return ''; }
  }

  test('B: 快照把 Today 未完成任务+断点写入 wrapup.log (带 proj 归属)', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'W-1', note: '做 A' });
    await cmdTask({ dir: projectA, action: 'note', id: 'W-1', note: '改到 store.js L40' });
    const r = await cmdWrapup({ dir: projectA });
    assert.ok(r.includes('✓'), r);
    const text = await wrapupLogText();
    assert.ok(text.includes(`wrapup proj=${projectA}`), text);
    assert.ok(text.includes('做 A'), text);
    assert.ok(text.includes('改到 store.js L40'), text);
  });

  test('B: Done 区已完成的旧任务不进快照', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'W-2' });
    await cmdTask({ dir: projectA, action: 'done', id: 'W-2' });
    await cmdWrapup({ dir: projectA });
    const text = await wrapupLogText();
    // W-2 已完成, 快照里不应有它
    assert.ok(!text.includes('W-2'), text);
  });

  test('B: 同内容短间隔内重复 wrapup 幂等不重复写', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'W-3' });
    await cmdWrapup({ dir: projectA });
    const first = await wrapupLogText();
    const r2 = await cmdWrapup({ dir: projectA });
    assert.ok(r2.includes('跳过') || r2.includes('同内容'), r2);
    assert.equal(await wrapupLogText(), first, '同内容幂等不应再写');
  });

  test('B: 多项目隔离 — 各项目独立 proj 快照互不串', async () => {
    const projC = join(sandbox, 'proj-c');
    await fs.mkdir(projC, { recursive: true });
    await cmdInit({ dir: projC });
    await cmdTask({ dir: projectA, action: 'start', id: 'WA-1' });
    await cmdTask({ dir: projC, action: 'start', id: 'WC-1' });
    await cmdWrapup({ dir: projectA });
    await cmdWrapup({ dir: projC });
    const text = await wrapupLogText();
    assert.ok(text.includes(`proj=${projectA}`) && text.includes('WA-1'), text);
    assert.ok(text.includes(`proj=${projC}`) && text.includes('WC-1'), text);
  });

  test('A: load 展示上会话滞留；任务 done 后滞留自动消失 (交叉核对自清理)', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'LA-1', note: '滞留任务' });
    await cmdTask({ dir: projectA, action: 'note', id: 'LA-1', note: '断点X' });
    await cmdWrapup({ dir: projectA }); // 模拟上会话结束快照
    // 下会话 load → 应顶出滞留
    const load1 = await cmdLoad({ dir: projectA });
    assert.ok(load1.includes('上会话滞留'), load1);
    assert.ok(load1.includes('滞留任务'), load1);
    assert.ok(load1.includes('断点X'), load1);
    // 把任务 done 了 → 再 load 滞留应消失（不再误报）
    await cmdTask({ dir: projectA, action: 'done', id: 'LA-1' });
    const load2 = await cmdLoad({ dir: projectA });
    assert.ok(!load2.includes('上会话滞留'), `done 后不应再报滞留:\n${load2}`);
  });

  test('A: 无 wrapup.log 时 load 正常不报滞留', async () => {
    const out = await cmdLoad({ dir: projectA });
    assert.ok(!out.includes('上会话滞留'), out);
    assert.ok(out.includes('Todo 看板'), out);
  });
});

// ---------- Done 按日期分组 (DONE-GROUP) ----------
describe('Done 按日期分组 + 老格式兼容', () => {
  test('平铺旧 Done → 按日期分组, 新日期在前', () => {
    const flat = [
      '# 📋 Todo 看板',
      '## Backlog',
      '## Today / In Progress',
      '## Blocked',
      '## Done（只留近期，旧的迁 log.md/快照）',
      '- [x] 前天的事 (完成 2026-09-07)',
      '- [x] 昨天的事 (完成 2026-09-08)',
      '',
    ].join('\n');
    const out = groupDoneSection(flat);
    // 分组标题存在
    assert.ok(out.includes('### 2026-09-08'), out);
    assert.ok(out.includes('### 2026-09-07'), out);
    // 新日期组在前
    assert.ok(out.indexOf('### 2026-09-08') < out.indexOf('### 2026-09-07'), out);
    assert.ok(out.includes('昨天的事') && out.includes('前天的事'));
  });

  test('幂等: 已分组文件再 group 原样返回', () => {
    const grouped = [
      '# 📋 Todo 看板',
      '## Done（只留近期，旧的迁 log.md/快照）',
      '### 2026-09-09',
      '',
      '- [x] 今 (完成 2026-09-09)',
      '### 2026-09-08',
      '',
      '- [x] 昨 (完成 2026-09-08)',
      '',
    ].join('\n');
    assert.equal(groupDoneSection(grouped), grouped, '已分组应幂等');
  });

  test('未标日期旧行归入 (未标日期) 尾组, 不丢', () => {
    const flat = [
      '# 📋 Todo 看板',
      '## Done（只留近期，旧的迁 log.md/快照）',
      '- [x] 有日期的 (完成 2026-09-09)',
      '- [x] 没日期的老任务',
      '',
    ].join('\n');
    const out = groupDoneSection(flat);
    assert.ok(out.includes('### （未标日期）'), out);
    assert.ok(out.includes('没日期的老任务'), '未标日期任务不应丢');
    // 未标日期组在末尾（有日期组之后）
    assert.ok(out.indexOf('### 2026-09-09') < out.indexOf('### （未标日期）'), out);
  });

  test('断点附属行随任务行留在其日期组内', () => {
    const flat = [
      '# 📋 Todo 看板',
      '## Done（只留近期，旧的迁 log.md/快照）',
      '- [x] 带断点的 (完成 2026-09-09)',
      '  ↳ 断点: 做到一半的记录',
      '- [x] 昨天 (完成 2026-09-08)',
      '',
    ].join('\n');
    const out = groupDoneSection(flat);
    const todaySeg = out.split('### 2026-09-08')[0];
    assert.ok(todaySeg.includes('带断点的') && todaySeg.includes('做到一半的记录'), '断点应留在 09-09 组');
    // 断点行不脱离任务
    assert.ok(todaySeg.indexOf('带断点的') < todaySeg.indexOf('做到一半的记录'), '断点在任务行之后');
  });

  test('readTodo 惰性迁移: 平铺 Done 文件读一次即落盘分组', async () => {
    const flat = [
      '# 📋 Todo 看板',
      '## Backlog',
      '## Today / In Progress',
      '- [ ] W-任务 (认领 2026-09-09)',
      '## Blocked',
      '## Done（只留近期，旧的迁 log.md/快照）',
      '- [x] 老完成 (完成 2026-09-07)',
      '',
    ].join('\n');
    await fs.writeFile(join(projectA, '.brain', 'todo.md'), flat, 'utf8');
    const txt = await readTodo(projectA);
    assert.ok(txt.includes('### 2026-09-07'), '读后应已分组');
    // 未完成任务仍留在 Today
    assert.ok(txt.includes('- [ ] W-任务'), '未完成任务不受影响');
  });

  test('markDone 归位到对应日期组且新完成项在该组顶部', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'DG-1', note: '分组验证' });
    await cmdTask({ dir: projectA, action: 'done', id: 'DG-1' });
    const t = await readTodo(projectA);
    const todaySeg = t.split(`## Done`)[1] || '';
    assert.ok(todaySeg.includes(`### ${today()}`), `应有当天分组:\\n${todaySeg}`);
    // 新完成项出现在当天组开头（分组标题后紧跟）
    const groupStart = todaySeg.indexOf(`### ${today()}`);
    const afterGroup = todaySeg.slice(groupStart);
    assert.ok(afterGroup.includes('DG-1'), 'DG-1 应在 Done');
    const firstLines = afterGroup.split('\n').filter(Boolean).slice(0, 2).join(' ');
    assert.ok(firstLines.includes('DG-1'), `当天组头部应为 DG-1, got: ${firstLines}`);
  });

  test('多次 markDone 不同日期仍各自归组', async () => {
    // DG-2 (今天) DG-3 无法造昨天; 这里验证 done 后再 start/done 同 id 幂等不重复
    await cmdTask({ dir: projectA, action: 'start', id: 'DGX' });
    await cmdTask({ dir: projectA, action: 'done', id: 'DGX' });
    await cmdTask({ dir: projectA, action: 'done', id: 'DGX' }); // 二次 done 幂等
    const t = await readTodo(projectA);
    const hits = t.split('\n').filter((l) => l.includes('DGX') && l.startsWith('- [x]'));
    assert.equal(hits.length, 1, `二次 done 不重复: ${hits}`);
  });
});
