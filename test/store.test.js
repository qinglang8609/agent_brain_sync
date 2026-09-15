// test/store.test.js — store/todo 层单测（node:test，零外部依赖）。
// 覆盖: init/load/board/task/query/lint 命令 + todo 读写 + 定位层。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { cmdInit, cmdBoard, cmdStatus, cmdLoad, cmdTask, cmdLog, cmdQuery, cmdLint, cmdNote, cmdShow, cmdWrapup, cmdTodoArchive, cmdRule, cmdResolve, cmdSupersede, resolvePage, idOfPage, backfillPageId, statusOfPage, supersededByOf, clip, collapseIndex, indexTemplate, checkBrainShape, LEGACY_MARKS } from '../src/store.js';
import { readTodo, todoTemplate, today, addTask, normalizeTodo, groupDoneSection, insertDoneGrouped, upsertTask, findTaskLine, archiveDoneInText, renderArchivePage, doneDateOf, doneKindOf, withDoneKind, LEGACY_SECTION_RENAMES } from '../src/todo.js';
import { findBrainRoot, requireBrain, brainPath } from '../src/index.js';
import { strandedFor } from '../src/wrapup.js';

// ---------- 测试沙盒: 每个用例一个临时目录 ----------
let sandbox;
let projectA; // A 项目根（含 .brain/）
let projectB; // B 项目根（无 .brain/）→ 定位应为 null（不向上搜索）

async function mkProject(name) {
  const p = join(sandbox, name);
  await fs.mkdir(join(p, 'sub', 'deep'), { recursive: true });
  return p;
}

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-test-'));
  projectA = await mkProject('proj-a');
  projectB = await mkProject('proj-b');
  // 写操作现要求设置使用者姓名（否则报错不落盘）。测试统一用固定姓名，
  // 既避开依赖 ~/.abs/config.json，也直接断言标记内容。
  process.env.ABS_USER = 'tester';
  await cmdInit({ dir: projectA });
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

// ---------- 定位层 (src/index.js) ----------
describe('findBrainRoot 定位', () => {
  test('只认当前目录自身的 .brain/', async () => {
    const root = await findBrainRoot(join(projectA, 'sub', 'deep'));
    assert.equal(root, null, '子目录不应向上穿透命中祖先图谱');
  });

  test('当前目录就是项目根时命中', async () => {
    const root = await findBrainRoot(projectA);
    assert.equal(root, projectA);
  });

  test('无图谱返回 null', async () => {
    const root = await findBrainRoot(projectB);
    assert.equal(root, null);
  });

  // 回归: 曾从 cwd 无限上爬，在 vault/家目录场景命中 ~/.brain，静默把项目挂到别人图谱上。
  test('祖先目录有 .brain/ 也不误命中', async () => {
    await cmdInit({ dir: sandbox }); // sandbox 建图谱
    await fs.rm(join(projectA, '.brain'), { recursive: true, force: true }); // A 自己无图谱
    const root = await findBrainRoot(projectA);
    assert.equal(root, null, '祖先有图谱不等于本项目有图谱');
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
  test('todoTemplate 只有两区（Todo/Done）', () => {
    const t = todoTemplate();
    for (const seg of ['## Todo', '## Done']) assert.ok(t.includes(seg), `缺分区 ${seg}`);
    // 精简后不该再有进行时分区（2026-09-13）
    for (const gone of ['## Backlog', '## Today / In Progress', '## Blocked']) {
      assert.ok(!t.includes(gone), `不该再有 ${gone}: ${t}`);
    }
  });

  test('addTask 在指定分区末尾插入', async () => {
    await addTask(projectA, { section: 'Backlog', text: 'X — 优先级:P1' });
    const t = await readTodo(projectA);
    const backlog = t.split('## Today')[0];
    assert.ok(backlog.includes('X — 优先级:P1'));
  });

  // 回归: id 定位曾用 l.includes(id) 子串匹配, 导致前缀相同的 id 互相覆盖 ——
  // 先建 T11 再建 T1 时, T1 误命中 T11 那一行并原地改写, T11 静默消失。
  test('前缀相同的 id 不互相覆盖 (T11 vs T1)', async () => {
    await upsertTask(projectA, { section: 'Todo', text: 'T11 — 第十一' });
    await upsertTask(projectA, { section: 'Todo', text: 'T1 — 第一个' });
    const t = await readTodo(projectA);
    assert.ok(t.includes('T11 — 第十一'), 'T11 必须还在(修前被 T1 覆盖而消失)');
    assert.ok(t.includes('T1 — 第一个'), 'T1 必须新增为独立一行');
    assert.equal((t.match(/^- \[ \] .*?T\d+/gm) || []).length, 2, `应有 2 条独立任务: ${t}`);
  });

  test('findTaskLine 全等比对, 不被前缀/子串误命中', () => {
    const lines = ['- [ ] [进行中] T11 — a', '- [ ] [进行中] T1 — b', '- [ ] TASK-10 — c'];
    assert.equal(findTaskLine(lines, 'T1'), 1, 'T1 应命中第 2 行而非 T11');
    assert.equal(findTaskLine(lines, 'T11'), 0);
    assert.equal(findTaskLine(lines, 'TASK-1'), -1, 'TASK-1 不应命中 TASK-10');
    assert.equal(findTaskLine(lines, 'TASK-10'), 2);
  });

  test('id 里混入零宽字符也能定位 (历史瑕疵容错)', () => {
    const lines = ['- [ ] CO\u200bDEX-HOOKS-FIX — a'];
    assert.equal(findTaskLine(lines, 'CODEX-HOOKS-FIX'), 0, '查干净 id 应命中含 ZWSP 的行');
    assert.equal(findTaskLine(lines, 'CO\u200bDEX-HOOKS-FIX'), 0, '查含 ZWSP 的 id 也应命中');
  });
});

// ---------- 老格式迁移 (用户报告: bootstrap 老模板 In Progress/Todo 与 B4 定稿冲突) ----------
describe('normalizeTodo 老格式迁移', () => {
  const OLD = [
    '# 📋 Todo Board',
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

  test('老格式 → 两区制：未完成一律进 Todo，内容不丢，状态转行首标记', () => {
    const out = normalizeTodo(OLD);
    assert.ok(out.includes('## Todo'), out);
    assert.ok(!out.includes('## Backlog') && !out.includes('## Today') && !out.includes('## Blocked'),
      `四区应归一为 Todo: ${out}`);
    // 未完成的内容全部保留（不论原来在哪个区）
    for (const frag of ['正在做的事', '老待办A', '老待办B', '卡住的事']) {
      assert.ok(out.includes(frag), `内容应保留 ${frag}: ${out}`);
    }
    // 状态信息由行首标记承接：原 Blocked → [滞留中]，其余 → [进行中]
    assert.ok(/- \[ \] \[进行中\] 老待办A/.test(out), `老待办应带[进行中]: ${out}`);
    assert.ok(/- \[ \] \[滞留中\] 卡住的事/.test(out), `原 Blocked 应带[滞留中]: ${out}`);
    assert.ok(out.includes('老完成'));
    // done 内容留在 Done 区
    assert.ok(out.split('## Done')[1].includes('老完成'), '已完成应留 Done 区');
  });

  test('两张迁移表互锁：LEGACY_MARKS 必须覆盖 LEGACY_SECTION_RENAMES', () => {
    // 两个迁移路径用两张独立表（todo.js 给 normalizeTodo，store.js 给 rebuildStructure）。
    // 历史上只改一张导致另一条路径认不出旧名（未完成任务被当非标准分区留末尾）。
    // 这条测试把"共享键必须两边一致"钉住，防单边改名。
    const marks = new Map(LEGACY_MARKS);
    const missing = LEGACY_SECTION_RENAMES.filter(([o]) => !marks.has(o));
    assert.deepEqual(missing, [], `LEGACY_MARKS 缺这些旧名（单边改名会静默回归）: ${JSON.stringify(missing)}`);
    const conflicts = LEGACY_SECTION_RENAMES.filter(([o, n]) => marks.has(o) && marks.get(o) !== n);
    assert.deepEqual(conflicts, [], `两表对同一旧名给出了不同新名: ${JSON.stringify(conflicts)}`);
  });

  test('wrapup body 状态无关：任务状态改了，跨会话滞留仍能认出', async () => {
    // 回归 2026-09-13（评审 P1）：状态标记曾被算进 body，而 strandedFor 用 body 精确比对
    // → abs todo state 一改，滞留提醒静默消失。body 必须剥掉行首状态标记。
    const { appendWrapup, strandedFor } = await import('../src/wrapup.js');
    const env = { ...process.env, ABS_LOG_DIR: join(sandbox, 'wu-log') };
    const prev = process.env.ABS_LOG_DIR;
    process.env.ABS_LOG_DIR = env.ABS_LOG_DIR;
    try {
      await cmdTask({ dir: projectA, action: 'start', id: 'WP-1', note: '做 W' });
      await appendWrapup(projectA);                       // 快照时是 [进行中]
      await cmdTask({ dir: projectA, action: 'state', id: 'WP-1', note: '滞留中' });
      const s1 = await strandedFor(projectA);
      assert.equal(s1.length, 1, `状态改过后仍应认出滞留: ${JSON.stringify(s1)}`);
      assert.ok(s1[0].body.includes('WP-1'), s1[0].body);
      assert.ok(!/\[(进行中|讨论中|滞留中)\]/.test(s1[0].body), `body 不该含状态标记: ${s1[0].body}`);
    } finally {
      if (prev === undefined) delete process.env.ABS_LOG_DIR; else process.env.ABS_LOG_DIR = prev;
    }
  });

  test('两种状态标记的覆盖 + state 空操作不写盘', async () => {
    // 评审 P2：[讨论中] 从未被任何测试用过；setStateMark 的 no-op 分支也没断言。
    for (const st of ['进行中', '讨论中', '滞留中']) {
      await cmdTask({ dir: projectA, action: 'start', id: 'ST-1', note: 'x' });
      await cmdTask({ dir: projectA, action: 'state', id: 'ST-1', note: st });
      const t = await readTodo(projectA);
      assert.ok(t.includes(`- [ ] [${st}] ST-1`), `状态应为 ${st}: ${t}`);
    }
    // no-op：同状态再设一次 → 文件字节不变
    const before = await readTodo(projectA);
    const r = await cmdTask({ dir: projectA, action: 'state', id: 'ST-1', note: '滞留中' });
    assert.match(r, /未找到|状态未变/, `同状态应报无变化: ${r}`);
    assert.equal(await readTodo(projectA), before, 'no-op 不该改盘');
  });

  test('upsertTask 保留已有状态标记（再 start 不重置状态）', async () => {
    // 评审 P2：只有默认状态的 re-start 被测过，状态保留分支未钉。
    await cmdTask({ dir: projectA, action: 'start', id: 'UP-1', note: 'x' });
    await cmdTask({ dir: projectA, action: 'state', id: 'UP-1', note: '讨论中' });
    await cmdTask({ dir: projectA, action: 'start', id: 'UP-1', note: '改了说明' });
    const t = await readTodo(projectA);
    assert.ok(t.includes('- [ ] [讨论中] UP-1'), `再 start 不该重置状态: ${t}`);
    assert.ok(t.includes('改了说明'), '说明应更新');
    assert.equal((t.match(/UP-1/g) || []).length, 1, `不该重复登记: ${t}`);
  });

  test('非默认状态的任务 done 后进 Done 且无状态残留', async () => {
    // 评审 P2：stripStateMark 从未在任何非默认状态下被跑到。
    await cmdTask({ dir: projectA, action: 'start', id: 'DN-1', note: 'x' });
    await cmdTask({ dir: projectA, action: 'state', id: 'DN-1', note: '讨论中' });
    await cmdTask({ dir: projectA, action: 'done', id: 'DN-1' });
    const t = await readTodo(projectA);
    const doneSec = t.split('## Done')[1] || '';
    assert.ok(doneSec.includes('DN-1'), `应归位 Done: ${t}`);
    const dnLine = doneSec.split('\n').find((l) => l.includes('DN-1'));
    assert.ok(!/\[(进行中|讨论中|滞留中)\]/.test(dnLine), `Done 行不该带状态标记: ${dnLine}`);
  });

  test('四区制存量文件：load 时的 rebuildStructure 也要能迁移（不只是 normalizeTodo）', async () => {
    // 回归 2026-09-13：normalizeTodo 与 rebuildStructure 是两条不同的迁移路径。
    // 只改 normalizeTodo 时，load（走 rebuildStructure/renames）仍认不出 Backlog/Blocked，
    // 会把它们当"非标准分区"原样留末尾 —— 未完成任务留在文件里但不再被当 TODO，
    // 或整段错位。本测试钉住 renames 里有这三条。
    const legacy = [
      '# 📋 Todo Board',
      '## Backlog', '- [ ] L-1 — 想做',
      '## Today / In Progress', '- [ ] L-2 [[tester]] — 在做 (认领 2026-09-10)',
      '  ↳ 断点: 改到 L40',
      '## Blocked', '- [ ] L-3 — 卡住',
      '## Done', '- [x] L-0 — 完了 (完成 2026-09-01)',
      '',
    ].join('\n');
    await fs.writeFile(join(projectA, '.brain', 'todo.md'), legacy, 'utf8');
    await checkBrainShape(projectA);            // load 走的就是这条
    const t = await fs.readFile(join(projectA, '.brain', 'todo.md'), 'utf8');
    // 只剩两区
    assert.ok(t.includes('## Todo') && t.includes('## Done'), `应归一为两区: ${t}`);
    for (const gone of ['## Backlog', '## Today / In Progress', '## Blocked']) {
      assert.ok(!t.includes(gone), `不该再有 ${gone}: ${t}`);
    }
    // 内容零丢失
    for (const frag of ['L-1 — 想做', 'L-2 [[tester]] — 在做', 'L-3 — 卡住', 'L-0 — 完了']) {
      assert.ok(t.includes(frag), `内容应保留 ${frag}: ${t}`);
    }
    // 断点随迁
    assert.ok(t.includes('↳ 断点: 改到 L40'), `断点应保留: ${t}`);
    // 幂等：再跑一次零变化
    const r2 = await checkBrainShape(projectA);
    assert.equal(r2.fixed.length, 0, `再跑应幂等: ${JSON.stringify(r2)}`);
  });

  test('新格式幂等: 已有 Todo/Done 区原样返回', () => {
    const t = todoTemplate();
    assert.equal(normalizeTodo(t), t);
  });

  test('迁移后 task done 能正确归位 (端到端)', async () => {
    await fs.writeFile(join(projectA, '.brain', 'todo.md'), OLD, 'utf8');
    const r = await cmdTask({ dir: projectA, action: 'start', id: 'MIG-1', note: '迁移后登记' });
    assert.ok(r.includes('登记'), r);
    const t = await readTodo(projectA);
    assert.ok(t.includes('## Todo'), `应已归一为两区制:\n${t}`);
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
    assert.ok(t.includes('T-1 [[tester]] — 做 X'), `作者应紧跟 id 且为 wikilink: ${t}`);
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
    // 坑: upsertTask 原位更新时会重建整行 —— 重建时若不把原 @author 带上，作者会静默丢失。
    assert.ok(t.includes('T-2 [[tester]] — v2'), `幂等更新后作者不得丢失: ${hits.join('\n')}`);
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

  test('已设姓名但人页缺失: 下次写入自动重建（不报错、不丢沉淀）', async () => {
    const personPath = join(projectA, '.brain', 'entities', 'tester.md');
    await cmdTask({ dir: projectA, action: 'start', id: 'T-P1' }); // 首次写 → 建页
    assert.ok(await fs.readFile(personPath, 'utf8').then(() => true, () => false), '首次写应建人页');
    await fs.rm(personPath); // 模拟被删/未同步
    await cmdTask({ dir: projectA, action: 'start', id: 'T-P2', note: '重建' });
    const back = await fs.readFile(personPath, 'utf8');
    assert.ok(back.includes('# tester'), `人页应重建: ${back}`);
    const index = await fs.readFile(join(projectA, '.brain', 'index.md'), 'utf8');
    assert.ok(index.includes('[[tester]]'), '重建后应重新登记 index');
  });

  test('旧 @name 行原位更新时保持旧形态（不静默改写历史行）', async () => {
    // 坑: extractAuthor 只认新 [[name]] 的话，遇到历史 @name 行会取不到作者 →
    // upsertTask 重建整行时把作者静默抹掉。两种形态必须都认。
    const todoPath = join(projectA, '.brain', 'todo.md');
    let t = await fs.readFile(todoPath, 'utf8');
    t = t.replace('## Todo', '## Todo\n- [ ] [进行中] T-OLD @legacy — 老行');
    await fs.writeFile(todoPath, t, 'utf8');
    await cmdTask({ dir: projectA, action: 'start', id: 'T-OLD', note: '新说明' });
    const after = await readTodo(projectA);
    assert.ok(after.includes('T-OLD @legacy — 新说明'), `旧 @name 应保留且不升级为 [[ ]]: ${after}`);
    assert.ok(!after.includes('[[legacy]]'), '旧行不应被静默改写成 wikilink');
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

  // 回归: log.md 是新在上，而 load 曾用 tailLines(取末尾) → 「最近动作」永远显示最旧几条。
  // 症状是"开机读状态最该看的一节长期是两天前的东西"，且不报错，很容易一直没发现。
  test('load 的「最近动作」取最新几条（不是最旧）', async () => {
    const logP = join(projectA, '.brain', 'log.md');
    // 需 >5 条，否则"最新 5 条"会把最旧的一条也包含进来，测不出差别
    const entries = Array.from({ length: 7 }, (_, i) => `## [2026-09-${String(10 - i).padStart(2, '0')} 10:00] dev | 第${i + 1}条`);
    entries[0] = '## [2026-09-10 10:00] dev | 最新一条 NEWEST-MARK';
    entries[6] = '## [2026-09-04 10:00] dev | 最旧一条 OLDEST-MARK';
    await fs.writeFile(logP, ['# 🗒 Activity Log', ...entries, ''].join('\n'), 'utf8');
    const out = await cmdLoad({ dir: projectA });
    assert.ok(out.includes('NEWEST-MARK'), `应显示最新条目: ${out}`);
    assert.ok(!out.includes('OLDEST-MARK'), `不该显示最旧条目: ${out}`);
    assert.ok(/最新 5 条/.test(out), `标签应写"最新": ${out}`);
  });

  test('load 输出 index + todo + log 三段', async () => {
    const out = await cmdLoad({ dir: projectA });
    // index.md 现在只以图谱清单计数呈现（Roadmap 已删，Rules 空则不占字节）
    assert.ok(out.includes('## Concepts'), `应输出 index 清单段: ${out}`);
    assert.ok(out.includes('Todo'));
    assert.ok(out.includes('log.md'));
  });

  // 回归: load/todo 曾全量打印 Done 区，而 Done 无上限增长 → 长历史项目上
  // abs load 直接把上下文塞满（实报：「另一台机器 abs load 塞了 40%」）。
  // 实测本仓库修复前 Done 占 load 输出的 68.8%（19.6KB/28.4KB）。
  test('load 输出不随 Done 区增长（按日期折叠计数）', async () => {
    const todoP = join(projectA, '.brain', 'todo.md');
    const base = await fs.readFile(todoP, 'utf8');
    const small = base.split('## Done')[0] + '## Done\n- [x] D-1 [[tester]] — 小事 (完成 2026-09-01) 【落地】\n';
    await fs.writeFile(todoP, small, 'utf8');
    const smallOut = await cmdLoad({ dir: projectA });

    // 塞 300 条 Done（~40KB），load 输出大小应基本不变
    const many = Array.from({ length: 300 }, (_, i) =>
      `- [x] D-BIG-${i} [[tester]] — 一条很长的历史任务说明文字用来模拟真实积累 (完成 2026-08-${String(1 + (i % 28)).padStart(2, '0')}) 【落地】`);
    await fs.writeFile(todoP, base.split('## Done')[0] + '## Done\n' + many.join('\n') + '\n', 'utf8');
    const bigOut = await cmdLoad({ dir: projectA });

    const growth = Buffer.byteLength(bigOut) / Buffer.byteLength(smallOut);
    assert.ok(growth < 1.5,
      `Done 从 1 条涨到 300 条，load 输出不得显著膨胀（实际 ${Buffer.byteLength(smallOut)}→${Buffer.byteLength(bigOut)}B, ×${growth.toFixed(2)}）`);
    assert.ok(bigOut.includes('300 条'), `应给出 Done 计数: ${bigOut.slice(-400)}`);
    assert.ok(!bigOut.includes('D-BIG-7 '), 'Done 明细不应进 load 输出');
    // 明细仍可拿（逃生口）
    const full = await cmdShow({ view: 'todo', dir: projectA, full: true });
    assert.ok(full.includes('D-BIG-7 '), '--full 应给全量明细');
  });

  // 回归: 日志条目本身可长达 800B+，5 条就 2.9KB。load 是开机读状态，每条按语义边界收口。
  test('load 的「最近动作」每条收口，不随日志条目变长而膨胀', async () => {
    const logP = join(projectA, '.brain', 'log.md');
    const long = 'X'.repeat(3000);
    await fs.writeFile(logP, ['# 🗒 Activity Log', `## [2026-09-10 10:00] dev | ${long}`, ''].join('\n'), 'utf8');
    const out = await cmdLoad({ dir: projectA });
    assert.ok(!out.includes(long), '超长日志条目应被收口，不原样进 load');
    const sec = out.split('--- 最近动作')[1] || '';
    assert.ok(Buffer.byteLength(sec) < 1200, `最近动作一段应受控，实际 ${Buffer.byteLength(sec)}B`);
  });

  // 回归: index 的 concept 清单带每页一句话描述，**隨图谱线性增长** ——
  // 本仓库 17 条占 load 输出 64%（2286/3571 tok），另一台 40 条的项目约 2.3 倍。
  // 与 Done 同类：都是"清单隨历史膨胀"。load 只需知道去哪个分区找，不需要每页写了什么。
  test('load 的 index 区不隨图谱页数增长（清单折成计数）', () => {
    const idxP = join(projectA, '.brain', 'index.md');
    const build = (n) => [
      '# 🗂 Graph Index', '', '## Rules', '', '> 硬规则一条。', '',
      '## Concepts',
      ...Array.from({ length: n }, (_, i) => `- [[concept-${i}]] — 一条相当时长的概念页描述文字用来模拟真实积累`),
      '## Sessions', '- [[log-1]] — 一次会话', '',
    ].join('\n');
    return (async () => {
      await fs.writeFile(idxP, build(3), 'utf8');
      const smallOut = await cmdLoad({ dir: projectA });
      await fs.writeFile(idxP, build(60), 'utf8');
      const bigOut = await cmdLoad({ dir: projectA });
      const growth = Buffer.byteLength(bigOut) / Buffer.byteLength(smallOut);
      assert.ok(growth < 1.3,
        `concept 从 3 条涨到 60 条，load 输出不得显著膨胀（${Buffer.byteLength(smallOut)}→${Buffer.byteLength(bigOut)}B, ×${growth.toFixed(2)}）`);
      assert.ok(bigOut.includes('## Concepts（60 页）'), `应给分区计数: ${bigOut.slice(0, 600)}`);
      assert.ok(!bigOut.includes('concept-59'), 'index 明细不应进 load 输出');
      // Rules 是内容不是清单：必须原样保留（否则 load 就失去意义了）
      assert.ok(bigOut.includes('> 硬规则一条。'), `Rules 内容不得被折叠掉: ${bigOut.slice(0, 800)}`);
      // Roadmap 已删（它是 AI 自己写的方向总结，会带偏会话）：模板/load 都不应再出现
      assert.ok(!bigOut.includes('## Roadmap'), `不应再有 Roadmap 区: ${bigOut.slice(0, 400)}`);
      // 逃生口：完整 index 仍可拿
      const full = await cmdShow({ view: 'index', dir: projectA });
      assert.ok(full.includes('concept-59'), 'abs index 应给完整清单');
    })();
  });

  test('collapseIndex: 清单只计数（Rules 交给 rulesSection 单独成段）', () => {
    const t = ['# H', '', '## Rules', '', '> 引用行', '', '## Concepts', '- [[a]] — x', '- [[b]] — y', '## Syntheses', ''].join('\n');
    const o = collapseIndex(t);
    assert.ok(o.includes('# H'), `文件头应原样: ${o}`);
    assert.ok(!o.includes('## Rules'), `Rules 不得重复输出（已单独成段）: ${o}`);
    assert.ok(o.includes('## Concepts（2 页）'), `应计数: ${o}`);
    assert.ok(o.includes('## Syntheses'), `空分区保留名字（不写 0 页）: ${o}`);
    assert.ok(!o.includes('[[a]]'), `清单行不得保留: ${o}`);
    assert.equal(collapseIndex(''), '');
  });




  test('indexTemplate 不含 Roadmap（旧项目的 Roadmap 会被归为非标准分区留末尾）', async () => {
    const t = indexTemplate();
    assert.ok(!t.includes('Roadmap'), `模板不应再有 Roadmap: ${t}`);
    assert.ok(t.includes('## Rules') && t.includes('## Concepts'), `模板分区应完整: ${t}`);
    // 存量项目带 Roadmap：结构核对不得弄丢其正文
    await fs.writeFile(join(projectA, '.brain', 'index.md'),
      '# 🗂 Graph Index\n\n## Roadmap\n\n**已落地**：X。\n\n## Rules\n\n- 一条。\n', 'utf8');
    await checkBrainShape(projectA);
    const after = await fs.readFile(join(projectA, '.brain', 'index.md'), 'utf8');
    assert.ok(after.includes('**已落地**：X。'), `旧 Roadmap 正文不得丢: ${after}`);
    assert.ok(after.includes('## Rules'), `标准分区保留: ${after}`);
  });

  test('rule add 门槛：纪律不是记事本（长度≤42 且不带链接）', async () => {
    // 2026-09-13 用户定：Rules 是最前面的项目纪律，每条一眼扫完；
    // 细节/出处/例子进 concepts/，Rules 不带 [[链接]]（它会被反复全量打印）。
    const long = '规'.repeat(43);
    const r1 = await cmdRule({ dir: projectA, action: 'add', text: long });
    assert.match(r1, /太长/, `超 42 应被拒: ${r1}`);
    const r2 = await cmdRule({ dir: projectA, action: 'add', text: '带链接的规则 [[some-page]]' });
    assert.match(r2, /不带链接/, `带链接应被拒: ${r2}`);
    const r3 = await cmdRule({ dir: projectA, action: 'add', text: '短纪律能加。' });
    assert.match(r3, /✓/, `短句应通过: ${r3}`);
    // 42 是边界内
    const r4 = await cmdRule({ dir: projectA, action: 'add', text: '边'.repeat(42) });
    assert.match(r4, /✓/, `42 字符应通过: ${r4}`);
    // hmm 43 已拒，故加不进两个
    const idx = await fs.readFile(join(projectA, '.brain', 'index.md'), 'utf8');
    assert.ok(idx.includes('短纪律能加。'), '应落盘');
    assert.ok(!idx.includes('some-page'), '带链接的不得落盘');
  });

  test('status 报告项目 + 各类页数', async () => {
    const out = await cmdStatus({ dir: projectA });
    assert.ok(out.includes('concepts/: 0 页'));
  });
});

// ---------- log ----------
describe('cmdLog', () => {
  test('追加一行且换行被清洗、超长在语义边界收口', async () => {
    await cmdLog({ dir: projectA, title: '[SessionStart]\nlong'.repeat(30) });
    const log = await fs.readFile(join(projectA, '.brain', 'log.md'), 'utf8');
    const line = log.split('\n').find((l) => l.startsWith('## ['));
    assert.ok(line, '应有流水行');
    assert.ok(!line.includes('\n'), '换行必须被清洗成单行');
    // 不再断言"被硬切到 120 字符" —— 旧行为会把句子切在词中间(见 LOG-TRUNC-100)。
    // 现仅在超长(>600)时于标点/空格边界收口, 且以 '…' 标识截断。
    assert.ok(line.length <= 620, `超长应收口到 600 + 时间戳前缀: ${line.length}`);
    assert.ok(!/(^|…)[\s,，、;；.。]+…$/.test(line), '收口处不应残留标点+空白');
  });

  test('超长摘要在标点边界收口, 且带省略号', async () => {
    await cmdLog({ dir: projectA, title: '这是一句完整的结论。'.repeat(61) });
    const log = await fs.readFile(join(projectA, '.brain', 'log.md'), 'utf8');
    const line = log.split('\n').find((l) => l.startsWith('## ['));
    assert.ok(line.endsWith('…'), `超长应带省略号收口: ${line.slice(-20)}`);
    assert.ok(!/[\s,，、;；.。]+…$/.test(line), '不应切出"标点+省略号"的残尾');
  });

  test('长摘要不被硬切在词中间（LOG-TRUNC-100 回归）', async () => {
    const long = '修复 revert-check 在 file-write-locking 场景下的假通过问题，并补齐回归测试。';
    await cmdLog({ dir: projectA, title: long });
    const log = await fs.readFile(join(projectA, '.brain', 'log.md'), 'utf8');
    assert.ok(log.includes(long), '未超限的摘要必须原样落盘，不得截断');
  });

  test('clip: 短文本原样、超长切在标点、无标点才硬切', () => {
    assert.equal(clip('abc', 10), 'abc');
    assert.equal(clip('一二三四五六七八九十', 20), '一二三四五六七八九十');
    const s = '第一句结束。第二句结束。第三句结束。第四句很长很长很长';
    assert.equal(clip(s, 14), '第一句结束。第二句结束…');
    assert.equal(clip('a'.repeat(50), 10), 'aaaaaaaaaa…', '无边界可切时硬切兜底');
    // 边界太靠前(不足一半)则宁可硬切, 不留残破短头
    assert.equal(clip(`短。${'x'.repeat(40)}`, 20), `短。${'x'.repeat(18)}…`, '边界太靠前则硬切');
  });

  test('note 文件名在标点边界收口，不切出残字（LOG-TRUNC-100 回归）', async () => {
    await cmdNote({
      dir: projectA,
      text: '排查摘要读起来抽象的问题：先怀疑写入侧被硬切，不要先去调 prompt。判据是统计落盘文本的行尾。',
    });
    const files = await fs.readdir(join(projectA, '.brain', 'sources'));
    const f = files.find((x) => x.includes('排查摘要'));
    assert.ok(f, `应生成源页: ${files.join(', ')}`);
    // 旧行为: 24 字硬切 → '...-硬切-不.md' (切出孤字 '不')
    assert.ok(!/-\S\.md$/.test(f), `文件名不应以单字残尾结束: ${f}`);
    assert.ok(f.endsWith('-先怀疑写入侧被硬切.md'), `应切在标点处: ${f}`);
    // 完整文本仍保留在页内
    const body = await fs.readFile(join(projectA, '.brain', 'sources', f), 'utf8');
    assert.ok(body.includes('判据是统计落盘文本的行尾。'), '完整标题必须保留在页内');
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
  test('state: 改行首状态标记（原地，不搬区）', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'TB-1', note: '做 W' });
    const r = await cmdTask({ dir: projectA, action: 'state', id: 'TB-1', note: '滞留中' });
    assert.ok(r.includes('滞留中'), r);
    const t = await readTodo(projectA);
    assert.ok(t.includes('- [ ] [滞留中] TB-1'), `应在原行改标记:\n${t}`);
    assert.ok(!t.includes('## Blocked'), '不该再有 Blocked 区');
    assert.ok(t.includes('做 W'), '说明不应丢');
    // 非法状态被拒
    await assert.rejects(() => cmdTask({ dir: projectA, action: 'state', id: 'TB-1', note: '莫名其妙' }));
  });

  test('note: 半成品断点原位补 ↳ 断点 行，不挪任务位置', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'TN-1', note: '做 V' });
    const r = await cmdTask({ dir: projectA, action: 'note', id: 'TN-1', note: '改到 store.js L40，卡在 markDone' });
    assert.ok(r.includes('✓') || r.includes('断点'), r);
    const t = await readTodo(projectA);
    const todoSec = t.split('## Todo')[1]?.split('## ')[0] || '';
    assert.ok(todoSec.includes('↳ 断点: 改到 store.js L40'), `断点行应在任务下:\n${t}`);
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

  test('state 未找到 id 时明确提示', async () => {
    const r = await cmdTask({ dir: projectA, action: 'state', id: 'NOPE2', note: '滞留中' });
    assert.ok(r.includes('NOPE2'), r);
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
    assert.ok(log.includes('note |') || log.includes('note @'), 'log 应有一行 note 流水');
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
    assert.ok(out.includes('Graph Index'));
  });

  test('view=log 输出 log.md 倒序流水', async () => {
    await cmdLog({ dir: projectA, title: '查看用流水行' });
    const out = await cmdShow({ dir: projectA, view: 'log' });
    assert.ok(out.includes('Activity Log'));
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

  // 回归: lint 提示里的路径带 .brain/ 前缀。
  // 曾经只给 vault 相对路径（concepts/x.md）→ 用户到项目根找 concepts/ 找不到（真实踩过）。
  test('lint 提示的路径带 .brain/ 前缀（可直接去项目里找）', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'over.md'),
      PAGE('# 概念：超长\n' + Array.from({ length: 160 }, (_, i) => `行 ${i}`).join('\n')), 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(/OVER-SIZE: \.brain\/concepts\/over\.md/.test(out), `应带 .brain/ 前缀: ${out}`);
    assert.ok(!/(^|[^.])concepts\/over\.md/.test(out.replace(/\.brain\/concepts/g, '')), `不该出现无前缀路径: ${out}`);
  });

  // 回归: .brain 顶层文件（index/log/todo）也是真实页。
  // 以前只把子目录当页 → [[todo]] 被判死链（误报），反过来逼用户删掉正确引用。
  test('链到顶层文件 [[todo]] 不算死链；真不存在的仍报', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'link-top.md'),
      PAGE('# 概念：链到顶层\n[[todo]] [[log]] [[index]] [[查无此页]]'), 'utf8');
    const idxP = join(projectA, '.brain', 'index.md');
    const idx = await fs.readFile(idxP, 'utf8');
    await fs.writeFile(idxP, idx.replace('## Sources', '## Sources\n- [[link-top]] — 链到顶层\n- [[todo]] — 看板'), 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(!/\[\[todo\]\]/.test(out), `[[todo]] 不该报死链: ${out}`);
    assert.ok(!/\[\[log\]\]/.test(out), `[[log]] 不该报死链: ${out}`);
    assert.ok(!/\[\[index\]\]/.test(out), `[[index]] 不该报死链: ${out}`);
    assert.ok(/\[\[查无此页\]\]/.test(out), `真死链仍要报: ${out}`);
  });

  // 回归: 这个检查曾经"永不触发" —— 路径写成 brainPath(vault,'todo.md')（多一层 .brain），
  // ENOENT 又被外层 try/catch 吞掉 → lint 永远 0 problem，静默失效。
  // 故这里既测"会报"，也测"报了之后归档能消掉"。
  test('Done 区堆积 → DONE-PILED-UP（且不是静默通过）', async () => {
    const rows = Array.from({ length: 70 }, (_, i) => `- [x] PILE-${i}  (完成 2026-09-10)`);
    await fs.writeFile(join(projectA, '.brain', 'todo.md'),
      ['# 📋 Todo Board', '## Backlog', '## Today / In Progress', '## Blocked', '## Done', '### 2026-09-10', '', ...rows, ''].join('\n'), 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(/DONE-PILED-UP/.test(out), `应报 Done 堆积: ${out}`);
  });

  test('Done 区精简时不报 DONE-PILED-UP', async () => {
    await fs.writeFile(join(projectA, '.brain', 'todo.md'),
      ['# 📋 Todo Board', '## Backlog', '## Today / In Progress', '## Blocked', '## Done',
        '### 2026-09-10', '', '- [x] ONE  (完成 2026-09-10)', ''].join('\n'), 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(!/DONE-PILED-UP/.test(out), `不该报: ${out}`);
  });

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
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'big.md'), PAGE('x'.repeat(9 * 1024)), 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('OVER-SIZE'), out);
  });

  // 上限从 5120B 放宽到 8KB（实测偏紧: 68 页里仅 2 页超限且都只超一点）。
  // 边界钉住：6KB 该放行，9KB 该报。
  test('容量上限为 8KB：6KB 放行、9KB 报 OVER-SIZE', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'six.md'), PAGE('x'.repeat(6 * 1024)), 'utf8');
    let out = await cmdLint({ dir: projectA });
    assert.ok(!/OVER-SIZE[^\n]*six\.md/.test(out), `6KB 不该报超限: ${out}`);
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'six.md'), PAGE('x'.repeat(9 * 1024)), 'utf8');
    out = await cmdLint({ dir: projectA });
    assert.ok(/OVER-SIZE[^\n]*six\.md/.test(out), `9KB 应报超限: ${out}`);
    assert.ok(/150L\/8KB/.test(out), `提示应反映新阈值(150L/8KB): ${out}`);
  });

  test('模板残留链接被检出', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'tpl.md'), PAGE('见 [[EntityName]]'), 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('TEMPLATE-LINK'), out);
  });

  // 回归: 占位符必然不在 names 里，若不短路就**同一条链接报两次**
  // （TEMPLATE-LINK 一条对 + DEAD-LINK 一条噪音），让 lint 输出虚胖且误导。
  test('模板占位只报 TEMPLATE-LINK，不再重复报 DEAD-LINK', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'tpl2.md'), PAGE('见 [[页面名]]'), 'utf8');
    const out = await cmdLint({ dir: projectA });
    const lines = out.split('\n').filter((l) => l.includes('tpl2.md'));
    assert.ok(lines.some((l) => l.startsWith('TEMPLATE-LINK')), `应报模板残留: ${out}`);
    assert.ok(!lines.some((l) => l.startsWith('DEAD-LINK')),
      `同一条占位符不得再报 DEAD-LINK: ${lines.join(' | ')}`);
  });

  // 描述语法的字面量 `[[<slug>]]`（尖括号不是合法 wikilink 字符）在任务描述里很常见，
  // 归为 TEMPLATE-LINK（非真链接），而非 DEAD-LINK。
  test('尖括号占位 [[<slug>]] 归为模板残留而非死链', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'tpl3.md'), PAGE('在 ### Archived 段留 [[<slug>]] 完成任务'), 'utf8');
    const out = await cmdLint({ dir: projectA });
    const lines = out.split('\n').filter((l) => l.includes('tpl3.md'));
    assert.ok(lines.some((l) => l.startsWith('TEMPLATE-LINK')), `应报模板残留: ${out}`);
    assert.ok(!lines.some((l) => l.startsWith('DEAD-LINK')), `不应报死链: ${lines.join(' | ')}`);
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

  // 回归: 删页/归档 source 后忘清 index 的残留引用。lint 原来只查 page→index (INDEX-MISSING),
  // 不查 index→page, 导致死引用静默留在入口文件里(实际踩过: 归档 7 个 source 后 index 仍列着)。
  test('index 列了不存在的页被检出 (INDEX-DEAD-LINK)', async () => {
    const idxP = join(projectA, '.brain', 'index.md');
    await fs.appendFile(idxP, '\n- [[ghost-page-xyz]] — 不存在的页\n', 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('INDEX-DEAD-LINK'), out);
    assert.ok(out.includes('ghost-page-xyz'), out);
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

  // NO-INBOUND: 有出边但无人指向。ORPHAN-PAGE 只抓"零出零入"，
  // 抓不到"连了 5 条出去却没人连它"的悬挂页（实测本仓 file-shape-check-on-load 即是）。
  test('有出边但零入边 → NO-INBOUND (ORPHAN 抓不到这种)', async () => {
    await fs.writeFile(
      join(projectA, '.brain', 'concepts', 'hangs.md'),
      PAGE('# 悬挂页\n链向 [[good]]\n关联 [[good]]'),
      'utf8'
    );
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('NO-INBOUND'), `应报悬挂: ${out}`);
    assert.ok(!out.includes('ORPHAN-PAGE: .brain/concepts/hangs.md'), `有出边不该报 ORPHAN: ${out}`);
  });

  test('有人链接后不再报 NO-INBOUND', async () => {
    await fs.writeFile(
      join(projectA, '.brain', 'concepts', 'pointed.md'),
      PAGE('# 被指向\n无出边'),
      'utf8'
    );
    await fs.writeFile(
      join(projectA, '.brain', 'concepts', 'pointer.md'),
      PAGE('# 指向者\n关联 [[pointed]]'),
      'utf8'
    );
    const out = await cmdLint({ dir: projectA });
    assert.ok(!out.includes('NO-INBOUND: .brain/concepts/pointed.md'), `被指向不该报: ${out}`);
  });

  // SOURCE-UNDISTILLED: source 超龄仍未链到任何 concept = 暂存了没归位。
  // 只数总量（SOURCES-PILED-UP）抓不到"4 个 source 里 3 个没提炼"。
  test('超龄未提炼的 source → SOURCE-UNDISTILLED (按 mtime 判龄)', async () => {
    const p = join(projectA, '.brain', 'sources', '2026-01-01-老线索.md');
    await fs.writeFile(p, '---\ntags: [source]\nupdated: 2026-01-01\nstatus: draft\n---\n没归结到概念页', 'utf8');
    const old = new Date(Date.now() - 10 * 86400 * 1000);
    await fs.utimes(p, old, old);
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('SOURCE-UNDISTILLED'), `应报未提炼: ${out}`);
  });

  test('新鲜 source 不报 SOURCE-UNDISTILLED (未超龄)', async () => {
    await fs.writeFile(
      join(projectA, '.brain', 'sources', '2026-09-13-今日线索.md'),
      '---\ntags: [source]\nupdated: 2026-09-13\nstatus: draft\n---\n刚记的',
      'utf8'
    );
    const out = await cmdLint({ dir: projectA });
    assert.ok(!out.includes('SOURCE-UNDISTILLED: .brain/sources/2026-09-13-今日线索.md'), `新鲜不该报: ${out}`);
  });

  test('source 链到 concept 后不再报 SOURCE-UNDISTILLED（即使超龄）', async () => {
    await fs.writeFile(
      join(projectA, '.brain', 'concepts', 'distilled-target.md'),
      PAGE('# 提炼目标\n无出边'),
      'utf8'
    );
    const p = join(projectA, '.brain', 'sources', '2026-01-02-已提炼.md');
    await fs.writeFile(p, '---\ntags: [source]\nupdated: 2026-01-02\nstatus: draft\n---\n## 关联连接\n- [[distilled-target]] — 已提炼', 'utf8');
    const old = new Date(Date.now() - 10 * 86400 * 1000);
    await fs.utimes(p, old, old);
    const out = await cmdLint({ dir: projectA });
    assert.ok(!out.includes('SOURCE-UNDISTILLED: .brain/sources/2026-01-02-已提炼.md'), `已提炼不该报: ${out}`);
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

  // wrapup.log 是只追加的, 与 hooks.log 同类有增长问题。
  // parseWrapup 用 byProj.set 覆盖, 前面的旧块永远不会被读到 = 死重量。
  test('超阈值轮转为 .1, 且不丢当前项目状态', async () => {
    await fs.mkdir(logDir, { recursive: true });
    // 先造一个真实快照(当前未完成任务), 再灌大文件把它顶过阈值
    await cmdWrapup({ dir: projectA });
    const real = await wrapupLogText();
    await fs.writeFile(join(logDir, 'wrapup.log'), 'x'.repeat(2 * 1024 * 1024) + '\n' + real, 'utf8');

    await cmdWrapup({ dir: projectA });

    const rotated = await fs.readFile(join(logDir, 'wrapup.log.1'), 'utf8');
    assert.ok(rotated.length > 2 * 1024 * 1024, '旧内容应整体移入 .1');
    const now = await wrapupLogText();
    assert.ok(now.length < 2 * 1024 * 1024, '当前文件应已瘦身');
    // 关键: 轮转后本项目状态仍可被读到(strandedFor 依赖 wrapup.log)
    const stranded = await strandedFor(projectA);
    assert.ok(Array.isArray(stranded), 'strandedFor 不应因轮转报错');
  });

  test('未超阈值不轮转 (常见路径零副作用)', async () => {
    await cmdWrapup({ dir: projectA });
    const before = await wrapupLogText();
    await cmdWrapup({ dir: projectA });
    const after = await wrapupLogText();
    assert.ok(after.startsWith(before.slice(0, 20)), '小文件应只追加、不移位');
    let hasRot = true;
    try { await fs.access(join(logDir, 'wrapup.log.1')); } catch { hasRot = false; }
    assert.equal(hasRot, false, '不应产生 wrapup.log.1');
  });

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
    assert.ok(out.includes('Todo Board'), out);
  });
});

// ---------- Done 按日期分组 (DONE-GROUP) ----------
describe('Done 按日期分组 + 老格式兼容', () => {
  test('平铺旧 Done → 按日期分组, 新日期在前', () => {
    const flat = [
      '# 📋 Todo Board',
      '## Backlog',
      '## Today / In Progress',
      '## Blocked',
      '## Done',
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
      '# 📋 Todo Board',
      '## Done',
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
      '# 📋 Todo Board',
      '## Done',
      '- [x] 有日期的 (完成 2026-09-09)',
      '- [x] 没日期的老任务',
      '',
    ].join('\n');
    const out = groupDoneSection(flat);
    assert.ok(out.includes('### Undated'), out);
    assert.ok(out.includes('没日期的老任务'), '未标日期任务不应丢');
    // 未标日期组在末尾（有日期组之后）
    assert.ok(out.indexOf('### 2026-09-09') < out.indexOf('### Undated'), out);
  });

  test('断点附属行随任务行留在其日期组内', () => {
    const flat = [
      '# 📋 Todo Board',
      '## Done',
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
      '# 📋 Todo Board',
      '## Backlog',
      '## Today / In Progress',
      '- [ ] W-任务 (认领 2026-09-09)',
      '## Blocked',
      '## Done',
      '- [x] 老完成 (完成 2026-09-07)',
      '',
    ].join('\n');
    await fs.writeFile(join(projectA, '.brain', 'todo.md'), flat, 'utf8');
    const txt = await readTodo(projectA);
    assert.ok(txt.includes('### 2026-09-07'), '读后应已分组');
    assert.ok(txt.includes('## Todo'), `应归一为两区制: ${txt}`);
    // 未完成任务仍在 Todo（且带状态标记）
    assert.ok(txt.includes('- [ ] [进行中] W-任务'), `未完成任务不受影响: ${txt}`);
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

// ---------- Done 归档（abs todo archive） ----------
// 规则（用户定）: ①只保留近 N 天 ②任一天有未完成则整天不归档 ③归档成一个文件 + Done 尾部留标记行
describe('Done 归档', () => {
  const mk = (lines) => ['# 📋 Todo Board', '## Backlog', '## Today / In Progress', '## Blocked', '## Done', ...lines, ''].join('\n');

  test('只归档超过保留天数的日期组（近 3 天保留）', () => {
    const t = mk([
      '### 2026-09-10', '', '- [x] A  (完成 2026-09-10)', '',
      '### 2026-09-09', '', '- [x] B  (完成 2026-09-09)', '',
      '### 2026-09-08', '', '- [x] C  (完成 2026-09-08)', '',
      '### 2026-09-07', '', '- [x] D  (完成 2026-09-07)', '',
    ]);
    const r = archiveDoneInText(t, { keepDays: 3, from: '2026-09-10', slug: 'S' });
    assert.deepEqual(r.archived.map((g) => g.date), ['2026-09-07'], '只 09-07 该归档');
    assert.equal(r.count, 1);
    for (const d of ['2026-09-10', '2026-09-09', '2026-09-08']) {
      assert.ok(r.text.includes(d), `${d} 应保留`);
    }
    assert.ok(!r.text.includes('### 2026-09-07'), '09-07 组应已迁出');
  });

  test('某天有未完成任务 → 整天不归档（不拆半天）', () => {
    const t = mk([
      '### 2026-09-07', '', '- [x] DONE-ONE  (完成 2026-09-07)', '- [ ] STILL-OPEN  (完成 2026-09-07)', '',
      '### 2026-09-06', '', '- [x] OK-ONE  (完成 2026-09-06)', '',
    ]);
    const r = archiveDoneInText(t, { keepDays: 3, from: '2026-09-10', slug: 'S' });
    assert.deepEqual(r.archived.map((g) => g.date), ['2026-09-06'], '只 09-06 归档');
    assert.ok(r.text.includes('STILL-OPEN'), '含未完成任务的整天必须留着');
    assert.ok(r.text.includes('DONE-ONE'), '同一天的已完成任务也不能被单独迁走');
    assert.ok(r.skipped.some((s) => s.date === '2026-09-07' && /未完成/.test(s.reason)), JSON.stringify(r.skipped));
  });

  test('归档后 Done 尾部有 ### Archived 标记行（完成任务 N 条）', () => {
    const t = mk(['### 2026-09-06', '', '- [x] X  (完成 2026-09-06)', '- [x] Y  (完成 2026-09-06)', '']);
    const r = archiveDoneInText(t, { keepDays: 3, from: '2026-09-10' });
    assert.ok(r.text.includes('### Archived'), '应有 ### Archived 区');
    assert.ok(r.text.includes('- [[2026-09-06-todo归档]] 完成任务 2 条'), r.text);
  });

  test('未标日期组保守不归档', () => {
    const t = mk(['### Undated', '', '- [x] NODATE  ', '']);
    const r = archiveDoneInText(t, { keepDays: 3, from: '2026-09-10', slug: 'S' });
    assert.equal(r.archived.length, 0);
    assert.ok(r.text.includes('NODATE'));
    assert.ok(r.skipped.some((s) => /未标日期/.test(s.date)));
  });

  // ### Archived 区按日期倒序（新的在上），与 Done 日期组同风格；
  // 否则顺序 = 归档先后，多次归档后读起来是乱的（如 08/09/07）。
  test('归档标记行按日期倒序排列', () => {
    const t = mk([
      '### 2026-09-07', '', '- [x] C  (完成 2026-09-07)', '',
      '### Archived', '- [[2026-09-08-todo归档]] 完成任务 22 条', '- [[2026-09-09-todo归档]] 完成任务 6 条', '',
    ]);
    const r = archiveDoneInText(t, { keepDays: 1, from: '2026-09-10' });
    const order = [...r.text.matchAll(/\[\[(\d{4}-\d{2}-\d{2})-todo归档\]\]/g)].map((m) => m[1]);
    assert.deepEqual(order, ['2026-09-09', '2026-09-08', '2026-09-07'], `应倒序: ${order}`);
  });

  // 回归: ### Archived 区在 Done 内部，若被 parseDoneUnits 吃掉，markDone 重建 Done 时会丢
  test('### Archived 区在 markDone / 惰性分组重建后不丢', () => {
    const withArchive = mk(['### 2026-09-10', '', '- [x] A  (完成 2026-09-10)', '', '### Archived', '- [[S]] 完成任务 3 条', '']);
    const afterDone = insertDoneGrouped(withArchive, ['- [x] NEW  (完成 2026-09-10)']);
    assert.ok(afterDone.includes('[[S]]'), 'insertDoneGrouped(markDone 路径) 不能丢归档区');
    const flat = mk(['- [x] OLD  (完成 2026-09-10)', '', '### Archived', '- [[S]] 完成任务 3 条', '']);
    assert.ok(groupDoneSection(flat).includes('[[S]]'), '平铺迁移不能丢归档区');
  });

  // 每天一个文件 → ### Archived 区每天一行；各天计数独立，互不覆盖
  test('多天归档: 每天一行标记（计数各自独立、不重复）', () => {
    const t = mk(['### 2026-09-06', '', '- [x] X  (完成 2026-09-06)', '']);
    const once = archiveDoneInText(t, { keepDays: 1, from: '2026-09-10' });
    assert.ok(once.text.includes('- [[2026-09-06-todo归档]] 完成任务 1 条'), once.text);
    const withSecond = once.text + '### 2026-09-05\n\n- [x] Y  (完成 2026-09-05)\n- [x] Z  (完成 2026-09-05)\n';
    const twice = archiveDoneInText(withSecond, { keepDays: 1, from: '2026-09-10' });
    assert.ok(twice.text.includes('- [[2026-09-06-todo归档]] 完成任务 1 条'), '旧天标记应保留');
    assert.ok(twice.text.includes('- [[2026-09-05-todo归档]] 完成任务 2 条'), twice.text);
    assert.equal((twice.text.match(/\[\[2026-09-06-todo归档\]\]/g) || []).length, 1, '同 slug 只一行');
  });

  test('cmdTodoArchive 端到端: 建归档页 + 改 todo + 登记 index', async () => {
    const todoP = join(projectA, '.brain', 'todo.md');
    await fs.writeFile(todoP, mk([
      '### 2026-09-10', '', '- [x] KEEP  (完成 2026-09-10)', '',
      '### 2026-09-04', '', '- [x] OLD-A  (完成 2026-09-04)', '  ↳ 断点: 当时的细节', '',
    ]), 'utf8');
    const out = await cmdTodoArchive({ dir: projectA, keepDays: 3 });
    assert.ok(out.startsWith('✓'), out);
    const todo = await fs.readFile(todoP, 'utf8');
    assert.ok(!todo.includes('OLD-A'), '旧任务应已迁出 todo');
    assert.ok(todo.includes('### Archived') && todo.includes('完成任务 1 条'), todo);
    const page = await fs.readFile(join(projectA, '.brain', 'sessions', '2026-09-04-todo归档.md'), 'utf8');
    assert.ok(page.includes('OLD-A') && page.includes('当时的细节'), '归档页应保留原文含断点');
    const idx = await fs.readFile(join(projectA, '.brain', 'index.md'), 'utf8');
    assert.ok(idx.includes('[[2026-09-04-todo归档]]'), 'index 应登记归档页');
  });

  // 回归: 归档页是新生成页，若无双链会被 lint 判 ORPHAN（曾如此）。
  // 归档页是历史数据倾倒 + 已登记 index，属"终端页"，应与 sources/ 一样豁免。
  test('归档后 lint 干净（归档页不被判 ORPHAN）', async () => {
    const todoP = join(projectA, '.brain', 'todo.md');
    await fs.writeFile(todoP, mk([
      '### 2026-09-10', '', '- [x] KEEP  (完成 2026-09-10)', '',
      '### 2026-09-04', '', '- [x] OLD  (完成 2026-09-04)', '',
    ]), 'utf8');
    await cmdTodoArchive({ dir: projectA, keepDays: 3 });
    const out = await cmdLint({ dir: projectA });
    assert.ok(!/ORPHAN-PAGE: \.brain\/sessions\/.*todo归档/.test(out), `归档页不该是孤儿: ${out}`);
    assert.ok(!/INDEX-MISSING: \.brain\/sessions\/.*todo归档/.test(out), `归档页应已登记 index: ${out}`);
  });

  test('dry-run 不动文件', async () => {
    const todoP = join(projectA, '.brain', 'todo.md');
    const before = mk(['### 2026-09-04', '', '- [x] OLD  (完成 2026-09-04)', '']);
    await fs.writeFile(todoP, before, 'utf8');
    const out = await cmdTodoArchive({ dir: projectA, keepDays: 3, dryRun: true });
    assert.ok(out.includes('dry-run'), out);
    assert.equal(await fs.readFile(todoP, 'utf8'), before, 'dry-run 不应改动 todo.md');
  });

  test('无可归档时明确说明（不静默）', async () => {
    // 坑: 曾用写死的 '2026-09-10' 配 keepDays:3 —— 它在写下的那天算"近期"，
    // 自然日一过 cutoff 就不成立了（实际在 09-13 午夜后开始失败），变成定时炸弹。
    // 日期必须相对 today() 算，否则这个测试会随真实时间自己烂掉。
    await fs.writeFile(join(projectA, '.brain', 'todo.md'),
      mk(['### ' + today(), '', `- [x] NEW  (完成 ${today()})`, '']), 'utf8');
    const out = await cmdTodoArchive({ dir: projectA, keepDays: 3 });
    assert.ok(out.includes('无可归档'), out);
  });
});

// ---------- Done 结语契约 ----------
// 为什么需要: `[x]` 原同时表示「真落地」「评估后不做」「仅设计过」。实测翻车:
// 把"跑通后又被撤销"的 daemon 条当成已落地 → 基于假记录得出错误结论。
// 记录可被信任比记录多寡重要一个量级，故用测试钉死写入侧与 lint。
describe('Done 结语契约', () => {
  async function doneLines() {
    const t = await readTodo(projectA);
    return t.split('\n').filter((l) => /^\s*- \[x\]/.test(l));
  }

  test('done 默认结语为【落地】', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'K-1', note: 'x' });
    await cmdTask({ dir: projectA, action: 'done', id: 'K-1' });
    const ls = await doneLines();
    assert.ok(ls[0].includes('【落地】'), ls[0]);
    assert.equal(doneKindOf(ls[0]), '落地');
  });

  test('--as 否决 / 仅方案 写入正确且落在 (完成 …) 之前', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'K-2', note: 'x' });
    await cmdTask({ dir: projectA, action: 'done', id: 'K-2', as: '否决' });
    await cmdTask({ dir: projectA, action: 'start', id: 'K-3', note: 'y' });
    await cmdTask({ dir: projectA, action: 'done', id: 'K-3', as: '仅方案' });
    const ls = await doneLines();
    const k2 = ls.find((l) => l.includes('K-2'));
    const k3 = ls.find((l) => l.includes('K-3'));
    assert.equal(doneKindOf(k2), '否决');
    assert.equal(doneKindOf(k3), '仅方案');
    // 顺序: 结语在完成日期之前，保证 doneDateOf 仍能取到日期（分组依赖它）
    assert.match(k2, /【否决】 \(完成 \d{4}-\d{2}-\d{2}\)/);
    assert.ok(doneDateOf(k2), `结语插错位置导致日期丢失: ${k2}`);
  });

  test('非法 --as 抛错且不落盘', async () => {
    await cmdTask({ dir: projectA, action: 'start', id: 'K-4', note: 'x' });
    await assert.rejects(
      () => cmdTask({ dir: projectA, action: 'done', id: 'K-4', as: '随便' }),
      /--as 只接受/,
    );
    const t = await readTodo(projectA);
    assert.ok(t.includes('- [ ] [进行中] K-4'), `非法 as 时任务应保持未完成: ${t}`);
  });

  test('withDoneKind 幂等: 重复调用不叠标记', () => {
    let l = '- [x] X — n (完成 2026-09-12)';
    l = withDoneKind(l, '落地');
    l = withDoneKind(l, '否决');
    assert.equal((l.match(/【/g) || []).length, 1, l);
    assert.equal(doneKindOf(l), '否决', '应原位替换而非叠加');
  });

  test('lint 抓出缺结语的 Done 条目', async () => {
    await fs.mkdir(join(projectA, '.brain'), { recursive: true });
    await fs.writeFile(join(projectA, '.brain', 'todo.md'),
      ['# 📋 Todo Board', '## Backlog', '', '## Today / In Progress', '', '## Blocked',
       '## Done', '', '### 2026-09-11', '',
       '- [x] NO-KIND — 没标 (完成 2026-09-11)', '',
       '- [x] HAS-KIND — 标了 【落地】 (完成 2026-09-11)', ''].join('\n'), 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('DONE-NO-KIND'), out);
    assert.ok(out.includes('1 条缺结语'), `应只报 1 条(已标的不算): ${out}`);
  });

  test('lint: Done 条目全带结语时不报', async () => {
    await fs.mkdir(join(projectA, '.brain'), { recursive: true });
    await fs.writeFile(join(projectA, '.brain', 'todo.md'),
      ['# 📋 Todo Board', '## Backlog', '', '## Today / In Progress', '', '## Blocked',
       '## Done', '', '### 2026-09-11', '',
       ...['落地', '否决', '仅方案'].map((k, i) => `- [x] OK-${i} — n 【${k}】 (完成 2026-09-11)`), ''].join('\n'), 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(!out.includes('DONE-NO-KIND'), out);
  });

  // 回归(日期契约): 结语是人抄的、日期是工具盖的 —— 人替工具代笔时只抄语义部分。
  // 后果不只是排版：无日期行归 `### Undated` 尾组，而归档靠日期判天数
  // → 这些行**永远无法被 abs todo archive 迁出**（todo.js:300 保守跳过），
  // 即一条漏日期 = 一条永久钉住 Done 区、拖大 abs load 输出的行。
  test('lint 抓出任写的 [x] 缺 (完成 日期)（结语抄了、日期没抄）', async () => {
    await fs.mkdir(join(projectA, '.brain'), { recursive: true });
    await fs.writeFile(join(projectA, '.brain', 'todo.md'),
      ['# 📋 Todo Board', '## Backlog', '', '## Today / In Progress', '', '## Blocked',
       '## Done', '', '### 2026-09-11', '',
       '- [x] NO-DATE — 手写漏日期 【落地】', '',
       '- [x] HAS-DATE — 走工具盖了 【落地】 (完成 2026-09-11)', ''].join('\n'), 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('DONE-NO-DATE'), out);
    assert.ok(out.includes('1 条'), `应只报 1 条(有日期的不算): ${out}`);
    assert.ok(!out.includes('DONE-NO-KIND'), '本条都带结语，不应报缺结语');
  });

  test('lint: Done 条目日期齐全时不报 DONE-NO-DATE', async () => {
    await fs.mkdir(join(projectA, '.brain'), { recursive: true });
    await fs.writeFile(join(projectA, '.brain', 'todo.md'),
      ['# 📋 Todo Board', '## Backlog', '', '## Today / In Progress', '', '## Blocked',
       '## Done', '', '### 2026-09-11', '',
       '- [x] D1 【落地】 (完成 2026-09-11)', ''].join('\n'), 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(!out.includes('DONE-NO-DATE'), `日期齐全不应报: ${out}`);
  });
});

// ---------- page id: 改名不改引用 ----------
// 设计要点（为什么不上 uuid/哈希）：id 默认 = 建页时的 slug，人可读可手写，
// 且旧页无 id 时回退 slug → 存量页零迁移。哈希随内容变，uuid 不可读且要全量迁移。
describe('page id (abs resolve)', () => {
  test('idOfPage: 有 id 行读 id，无 id 行回退 slug', () => {
    assert.equal(idOfPage('---\nid: my-id\ntags: [x]\n---\n# H', 'file-slug'), 'my-id');
    assert.equal(idOfPage('---\ntags: [x]\n---\n# H', 'file-slug'), 'file-slug');
    // 无 frontmatter 的裸 md 也不能炸
    assert.equal(idOfPage('# H only', 'bare'), 'bare');
  });

  test('resolvePage: 按 slug 命中；改名后按 id 仍能找回', async () => {
    const cdir = join(projectA, '.brain', 'concepts');
    // 建一个「已改过名」的页：文件名是新名，frontmatter 留着旧 id
    await fs.writeFile(join(cdir, 'new-name.md'),
      '---\nid: old-name\ntags: [concept]\nupdated: 2026-01-01\n---\n\n# 页\n', 'utf8');
    const bySlug = await resolvePage(projectA, 'new-name');
    assert.equal(bySlug.slug, 'new-name');
    const byId = await resolvePage(projectA, 'old-name');
    assert.ok(byId, '按旧 id 应能找回改名后的页');
    assert.equal(byId.slug, 'new-name');
    assert.equal(byId.id, 'old-name');
    assert.equal(await resolvePage(projectA, 'zzz-none'), null);
  });

  test('lint 抓 ID-DRIFT: frontmatter id 与文件名不一致', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'drifted.md'),
      '---\nid: original-slug\ntags: [concept]\nupdated: 2026-01-01\n---\n\n# 页\n', 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('ID-DRIFT'), out);
    assert.ok(out.includes('drifted.md'), out);
  });

  test('lint 不因 id==slug 误报 ID-DRIFT', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'same.md'),
      '---\nid: same\ntags: [concept]\nupdated: 2026-01-01\n---\n\n# 页\n\n[[todo]]\n', 'utf8');
    const out = await cmdLint({ dir: projectA });
    // 只断言没有 ID-DRIFT 类问题 —— 该页可能因其它规则(如 NO-INBOUND)被列，
    // 那些与本机制无关，一并 grep 文件名会把无关问题当成失败。
    assert.ok(!/ID-DRIFT[^\n]*same\.md/.test(out), `id==slug 不应报 ID-DRIFT: ${out}`);
  });

  test('backfillPageId: 给存量页补 id，已有 id 不动', async () => {
    const cdir = join(projectA, '.brain', 'concepts');
    const f = join(cdir, 'legacy.md');
    await fs.writeFile(f, '---\ntags: [concept]\nupdated: 2026-01-01\n---\n\n# 老页\n', 'utf8');
    assert.equal(await backfillPageId(f, 'legacy'), 'added');
    const after = await fs.readFile(f, 'utf8');
    assert.ok(/^id: legacy$/m.test(after), after);
    // id 必须落在 frontmatter 内（第一个 --- 与第二个 --- 之间），不能跑到正文
    const fmEnd = after.indexOf('\n---', 3);
    assert.ok(after.indexOf('id: legacy') < fmEnd, `id 应在 frontmatter 内: ${after}`);
    // 二次调用幂等
    assert.equal(await backfillPageId(f, 'legacy'), 'exists');
  });

  test('cmdResolve: 命中给路径，未命中给逃生口', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'r1.md'),
      '---\nid: r1\ntags: [concept]\nupdated: 2026-01-01\n---\n\n# 页\n', 'utf8');
    const ok = await cmdResolve({ dir: projectA, refs: ['r1'] });
    assert.ok(ok.includes('.brain/concepts/r1.md') || ok.includes('concepts/r1.md'), ok);
    const miss = await cmdResolve({ dir: projectA, refs: ['zzz'] });
    assert.ok(miss.includes('未找到'), miss);
  });

  test('cmdNote 落页时写 id（新页自带改名安全的句柄）', async () => {
    await cmdNote({ dir: projectA, text: 'id 化验证用的一条经验 xyzid', tags: 'idtest' });
    const files = (await fs.readdir(join(projectA, '.brain', 'sources'))).filter((f) => f.endsWith('.md'));
    const hit = files.find((f) => f.includes('xyzid'));
    assert.ok(hit, `应落一个含 xyzid 的 source: ${files.join(',')}`);
    const body = await fs.readFile(join(projectA, '.brain', 'sources', hit), 'utf8');
    assert.ok(/^id: /m.test(body), `新页 frontmatter 应有 id: ${body.slice(0, 200)}`);
    assert.ok(body.includes(`id: ${hit.replace(/\.md$/, '')}`), 'id 应等于建页时的 slug');
  });
});

// ---------- page status: 经验的生命周期（active/superseded/draft） ----------
// 存在的理由：经验写进去就永远躺在那里 —— 推翻时删不掉（人工内容不覆盖），
// 读的时候又看不见 → 旧经验持续骗下一个会话。核心契约是「推翻 = 改一行 frontmatter，
// 不删文件不丢历史」，且被推翻的内容默认不再出现在检索结果里。
describe('page status (abs supersede)', () => {
  test('statusOfPage: 无字段/未知值都当 active（存量页零迁移）', () => {
    assert.equal(statusOfPage('---\nid: a\n---\n# H'), 'active');
    assert.equal(statusOfPage('---\nstatus: reviewed\n---\n# H'), 'active', '旧的 reviewed 值归为 active');
    assert.equal(statusOfPage('---\nstatus: superseded\n---\n# H'), 'superseded');
    assert.equal(statusOfPage('---\nstatus: draft\n---\n# H'), 'draft');
    assert.equal(statusOfPage('', ''), 'active');
  });

  test('cmdSupersede: 标记失效并写 superseded-by（不删文件）', async () => {
    const cdir = join(projectA, '.brain', 'concepts');
    await fs.writeFile(join(cdir, 'old-way.md'),
      '---\nid: old-way\ntags: [concept]\nupdated: 2026-01-01\nstatus: active\n---\n\n# 老做法\n\n[[todo]]\n', 'utf8');
    await fs.writeFile(join(cdir, 'new-way.md'),
      '---\nid: new-way\ntags: [concept]\nupdated: 2026-01-01\n---\n\n# 新做法\n\n[[todo]]\n', 'utf8');
    const out = await cmdSupersede({ dir: projectA, refs: ['old-way'], by: 'new-way' });
    assert.ok(out.includes('superseded'), out);
    const body = await fs.readFile(join(cdir, 'old-way.md'), 'utf8');
    assert.ok(/^status: superseded$/m.test(body), body);
    assert.ok(/^superseded-by: new-way$/m.test(body), body);
    assert.ok(body.includes('# 老做法'), '文件不能被删/清空，历史要留');
  });

  test('cmdSupersede 幂等：重复标记不重复写', async () => {
    const cdir = join(projectA, '.brain', 'concepts');
    await fs.writeFile(join(cdir, 'a.md'), '---\nid: a\ntags: [concept]\n---\n\n# A\n', 'utf8');
    await cmdSupersede({ dir: projectA, refs: ['a'] });
    const out2 = await cmdSupersede({ dir: projectA, refs: ['a'] });
    assert.ok(/已是 superseded/.test(out2), out2);
    const body = await fs.readFile(join(cdir, 'a.md'), 'utf8');
    assert.equal((body.match(/status:/g) || []).length, 1, `status 行不应重复: ${body}`);
  });

  test('cmdSupersede: --by 指向不存在的页 → 拒绝（防写悬空引用）', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'b.md'), '---\nid: b\n---\n\n# B\n', 'utf8');
    const out = await cmdSupersede({ dir: projectA, refs: ['b'], by: 'no-such-page' });
    assert.ok(out.includes('没有这页'), out);
    const body = await fs.readFile(join(projectA, '.brain', 'concepts', 'b.md'), 'utf8');
    assert.ok(!/superseded-by/.test(body), '拒绝时不应写盘');
  });

  test('query 默认隐藏 superseded，--all 可见且给计数', async () => {
    const cdir = join(projectA, '.brain', 'concepts');
    await fs.writeFile(join(cdir, 'live.md'),
      '---\nid: live\ntags: [concept]\n---\n\n# LIVE 关键词 zebra\n', 'utf8');
    await fs.writeFile(join(cdir, 'dead.md'),
      '---\nid: dead\ntags: [concept]\nstatus: superseded\n---\n\n# DEAD 关键词 zebra\n', 'utf8');
    const def = await cmdQuery({ dir: projectA, terms: ['zebra'] });
    assert.ok(def.includes('live'), def);
    assert.ok(!def.includes('dead'), `被推翻的不应出现在默认结果: ${def}`);
    assert.ok(/1 页 superseded 已隐藏/.test(def), `应告知隐藏了几条: ${def}`);
    const all = await cmdQuery({ dir: projectA, terms: ['zebra'], includeSuperseded: true });
    assert.ok(all.includes('dead') && all.includes('live'), all);
  });

  test('query 标注 draft（未核实的经验要让人看得见）', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'dd.md'),
      '---\nid: dd\ntags: [concept]\nstatus: draft\n---\n\n# DD 关键词 quokka\n', 'utf8');
    const out = await cmdQuery({ dir: projectA, terms: ['quokka'] });
    assert.ok(/draft 未核实/.test(out), `draft 应被标注: ${out}`);
  });

  test('lint 抓 SUPERSEDED-DANGLING（取代者页不存在）', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'dangling.md'),
      '---\nid: dangling\ntags: [concept]\nstatus: superseded\nsuperseded-by: ghost-page\n---\n\n# D\n', 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(out.includes('SUPERSEDED-DANGLING'), out);
    assert.ok(out.includes('ghost-page'), out);
  });

  test('lint 不误报：superseded 无 superseded-by 是合法状态', async () => {
    await fs.writeFile(join(projectA, '.brain', 'concepts', 'abandoned.md'),
      '---\nid: abandoned\ntags: [concept]\nstatus: superseded\n---\n\n# A\n\n[[todo]]\n', 'utf8');
    const out = await cmdLint({ dir: projectA });
    assert.ok(!/SUPERSEDED-DANGLING[^\n]*abandoned/.test(out), `无取代者不该报: ${out}`);
  });

  test('abs note 落的新页是 draft（未经核实）', async () => {
    await cmdNote({ dir: projectA, text: '生命周期验证用经验 statusprobe' });
    const files = (await fs.readdir(join(projectA, '.brain', 'sources'))).filter((f) => f.includes('statusprobe'));
    assert.ok(files.length, '应落 source 页');
    const body = await fs.readFile(join(projectA, '.brain', 'sources', files[0]), 'utf8');
    assert.ok(/^status: draft$/m.test(body), `新经验应为 draft: ${body.slice(0, 300)}`);
  });
});
describe('load 顶部「待消化」提示（与滞留同构的送达机制）', () => {
  /** 往 sources/ 放 n 条占位 source。 */
  async function fillSources(n) {
    const d = join(projectA, '.brain', 'sources');
    await fs.rm(d, { recursive: true, force: true });
    await fs.mkdir(d, { recursive: true });
    for (let i = 1; i <= n; i++) {
      await fs.writeFile(join(d, `2026-09-15-fake-${i}.md`),
        `---\ntags: [source]\nupdated: 2026-09-15\n---\n# 占位${i}\n\n## 关联连接\n`, 'utf8');
    }
  }

  // 坑（实现时踩到）: root 是【项目根】，图谱在 root/.brain/ 下。首版忘走 brainPath
  // 直接用 join(root,'sources') → ENOENT 被 catch 吞成 0 → 提示永不出现（又一个静默失效）。
  // 故此处必须断言"真会提示"，只测"不报错"是测不出这个 bug 的。
  test('sources 超阈值时在 Rules 之前提示；未超则不提', async () => {
    await fillSources(11);
    const out = await cmdLoad({ dir: projectA });
    assert.ok(out.includes('待消化'), `11 条应提示: ${out}`);
    const iRemind = out.indexOf('待消化');
    const iRules = out.indexOf('--- Rules');
    assert.ok(iRules === -1 || iRemind < iRules, '提示应在 Rules 之前（开工必经的顶部）');
  });

  test('边界: 恰好 10 条不提示（阈值是 >，不是 >=）', async () => {
    await fillSources(10);
    const out = await cmdLoad({ dir: projectA });
    assert.ok(!out.includes('待消化'), `10 条不该提示: ${out}`);
  });

  test('下划线开头的文件（模板）不计入', async () => {
    await fillSources(11);
    await fs.writeFile(join(projectA, '.brain', 'sources', '_template.md'),
      '---\ntags: [source]\n---\n# 模板\n', 'utf8');
    const out = await cmdLoad({ dir: projectA });
    assert.ok(out.includes('有 11 条'), `模板不该被计数（应仍为 11）: ${out}`);
  });
});
