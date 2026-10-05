// test/wrapup.test.js — 滞留快照的解析层（extractOpenTasks）。
//
// 为何单独测：它有一条**已实测复现过的静默失效**——
//   body 若带易变的状态标记（`[进行中]`），用户一改状态 body 就变，
//   而 strandedFor 用 body 精确比对 → 跨会话滞留提醒静默消失。
//   解法是剥掉状态标记让 body 状态无关；这条规则必须有测试钉住，
//   否则以后有人"顺手把那行正则删了"就再犯一次。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractOpenTasks, parseWrapup, wrapupLogPath, WRAPUP_MIN_INTERVAL_MS } from '../src/wrapup.js';

describe('extractOpenTasks — 只收未完成、body 状态无关', () => {
  const todo = [
    '## Todo',
    '- [ ] [进行中] task-a [[me]] — 做第一件事 (认领 2026-10-05)',
    '  ↳ 断点: 改到 src/x.js',
    '- [ ] [讨论中] task-b [[me]] — 方案待定 (认领 2026-10-05)',
    '- [ ] [滞留中] task-c [[me]] — 等数据',
    '## Done',
    '- [x] done-task [[me]] — 已完成',
    '',
  ].join('\n');

  test('只收 Todo 区的未完成项，Done 区不收', () => {
    const r = extractOpenTasks(todo);
    assert.equal(r.length, 3, `应为 3 条未完成，实际 ${r.length}`);
    assert.ok(!r.some((t) => t.body.includes('done-task')), 'Done 区的不该进来');
  });

  test('★ body 状态无关：改状态后 body 不变（否则跨会话提醒静默消失）', () => {
    const a = extractOpenTasks('## Todo\n- [ ] [进行中] task-a [[me]] — 做第一件事\n');
    const b = extractOpenTasks('## Todo\n- [ ] [滞留中] task-a [[me]] — 做第一件事\n');
    assert.equal(a[0].body, b[0].body, '状态一改 body 就变 → strandedFor 比对失败、提醒消失');
    assert.ok(!/进行中|滞留中/.test(a[0].body), `body 不该含状态标记: ${a[0].body}`);
  });

  test('剥掉认领/完成日期（它们也是易变的）', () => {
    const r = extractOpenTasks('## Todo\n- [ ] [进行中] t1 [[me]] — 干活 (认领 2026-10-05)\n');
    assert.ok(!/认领/.test(r[0].body), `不该留认领日期: ${r[0].body}`);
    assert.ok(r[0].body.includes('干活'));
  });

  test('断点行挂到上一条任务（不单独成条）', () => {
    const r = extractOpenTasks('## Todo\n- [ ] [进行中] t1 [[me]] — 干活\n  ↳ 断点: 改到 a.js\n');
    assert.equal(r.length, 1);
    assert.equal(r[0].bp.length, 1);
    assert.match(r[0].bp[0], /改到 a\.js/);
  });

  test('多条断点都收', () => {
    const r = extractOpenTasks(
      '## Todo\n- [ ] [进行中] t1 [[me]] — 干活\n  ↳ 断点: a\n  ↳ 卡点: b\n');
    assert.equal(r[0].bp.length, 2);
  });

  test('空/畸形输入不炸', () => {
    assert.deepEqual(extractOpenTasks(''), []);
    assert.deepEqual(extractOpenTasks(null), []);
    assert.deepEqual(extractOpenTasks('## Todo\n'), []);
    assert.doesNotThrow(() => extractOpenTasks('乱码\n- [ ] \n'));
  });
});

describe('wrapup — 路径与节流常量', () => {
  test('日志路径可用 ABS_LOG_DIR 覆盖（测试隔离靠它）', () => {
    const saved = process.env.ABS_LOG_DIR;
    process.env.ABS_LOG_DIR = '/tmp/abs-wrapup-probe';
    assert.equal(wrapupLogPath(), '/tmp/abs-wrapup-probe/wrapup.log');
    if (saved === undefined) delete process.env.ABS_LOG_DIR;
    else process.env.ABS_LOG_DIR = saved;
  });

  test('节流窗口是正的（防止每轮都写）', () => {
    assert.ok(WRAPUP_MIN_INTERVAL_MS > 0);
  });
});

describe('parseWrapup — 读回快照', () => {
  test('空内容 → 空结构（不炸）', () => {
    assert.doesNotThrow(() => parseWrapup(''));
    assert.doesNotThrow(() => parseWrapup(null));
  });
});
