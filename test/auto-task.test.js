// test/auto-task.test.js — hook 自动登记的行为级测试。
//
// 背景: pi 的 promptGuidelines 常驻指引已注入(实检 414 次有痕), 但 agent 行为没变
//   —— 指引说"before you start", 而排查类工作没有清晰起点("我先看看怎么回事",
//   看明白了活儿已干完一半)。故改为 hook 侧自动登记。
//
// 纪律(来自 host-plugin-silent-failure): 必须真跑产物 + 驱动真实事件, 字符串断言不够。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { cmdInit, cmdAutoTask, cmdAutoTaskSweep, autoTaskId, autoTaskSlugFromNote } from '../src/store.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

let sandbox;
let project;

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-auto-task-'));
  project = join(sandbox, 'proj');
  process.env.ABS_USER = 'tester';
  process.env.ABS_CONFIG_DIR = join(sandbox, 'abs-cfg');
  delete process.env.ABS_AUTO_TASK;
  await cmdInit({ dir: project });
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

const todoText = () => fs.readFile(join(project, '.brain', 'todo.md'), 'utf8');

describe('autoTaskId — 抽关键词', () => {
  test('真实指令能抽出可读 id', () => {
    // 用今天真实的指令做样例（不是自造的好看句子）
    assert.ok(autoTaskId('还有 当用户输入 abs 现在不能自动调用skill'));
    assert.ok(autoTaskId('修复 opencode 插件加载失败'));
    assert.ok(autoTaskId('给 todo 加自动登记'));
  });

  test('纯对话/寒暄抽不出（宁可不登记也不脏看板）', () => {
    for (const s of ['在吗', '继续', 'abs', '好的', '嗯', 'hi', '收到']) {
      assert.equal(autoTaskId(s), null, `"${s}" 不该抽出 id`);
    }
  });

  test('疑问句不登记（用户提问不是开工指令）', () => {
    // 实报坑(2026-10-05): 用户问"为什么任务是这个啊", 被抽成任务登进看板 ——
    // 把用户的疑问变成待办很荒唐。提问/质疑/求助都不算"让我动手"。
    const qs = [
      '为什么任务是这个啊',
      '这个是为什么?',
      '怎么不生效呢',
      '能不能支持多会话',
      '什么是自动登记',
      '这个功能是谁加的？',
      '为什么会这样啊！',
    ];
    for (const q of qs) assert.equal(autoTaskId(q), null, `疑问句不该登记: "${q}"`);
  });

  test('空/纯符号抽不出', () => {
    assert.equal(autoTaskId(''), null);
    assert.equal(autoTaskId('   '), null);
    assert.equal(autoTaskId('。。。'), null);
    assert.equal(autoTaskId(null), null);
  });

  test('id 不含空白与危险字符（能安全进 todo 行）', () => {
    const id = autoTaskId('修 plugin 的 bug: 别把 [东西] 弄坏');
    assert.ok(id);
    assert.ok(!/\s/.test(id), `id 不该含空白: ${id}`);
    assert.ok(!/[[\]]/.test(id), `id 不该含方括号: ${id}`);
  });
});

describe('autoTaskSlugFromNote — 从断点提文件名', () => {
  test('断点里的文件名当 slug（"改了" 这种废名要避开）', () => {
    // 时机改动后: 抽不出用户关键词时用断点兜底。直接取首词会得到 `改了`，
    // 毫无信息量; 取文件名才有用。
    assert.equal(autoTaskSlugFromNote('改了 src/store.js'), '改 store');
    assert.equal(autoTaskSlugFromNote('本轮到 hooks/abs.pi.ts'), '改 abs.pi');
    assert.equal(autoTaskSlugFromNote('改了 /a/b/panel.test.js'), '改 panel.test');
  });

  test('断点里没文件名时退回抽关键词', () => {
    assert.equal(autoTaskSlugFromNote('修复面板刷新'), '修复面板刷新');
    assert.equal(autoTaskSlugFromNote('开始改文件'), '开始改文件');  // 无文件名但仍是可用的兜底名
    assert.equal(autoTaskSlugFromNote('在吗'), null);               // 纯寒暄 → 抽不出 → null
  });

  test('空/畸形输入不炸', () => {
    assert.equal(autoTaskSlugFromNote(''), null);
    assert.equal(autoTaskSlugFromNote(null), null);
    assert.equal(autoTaskSlugFromNote('.'), null);
  });
});

describe('cmdAutoTask — 一会话一条', () => {
  test('首次指令登记一条 [进行中] 任务', async () => {
    const r = await cmdAutoTask({
      dir: project, session: 'sess001',
      prompt: '修复 opencode 插件加载失败', note: '改了 hooks/abs.opencode.ts',
    });
    assert.ok(r && r.includes('自动登记'), `应返回登记说明: ${r}`);
    const t = await todoText();
    // id 是给人看的【关键词】，不是会话 uuid（实报过 auto-01a10b96-372d-71 认不出）
    assert.match(t, /\[进行中\] auto-[^\s]*修复[^\s]*/, `id 应含指令关键词:\n${t}`);
    assert.ok(!/auto-sess001/.test(t), 'id 不该再用会话 id');
    assert.match(t, /自动登记 sess001/, '会话 id 应作为隐藏幂等键留在标记里');
    assert.match(t, /tester/, '应带作者标记');
    assert.match(t, /断点: 改了 hooks\/abs\.opencode\.ts/, '应落首次断点');
  });

  test('同一会话再调不新增第二条（只更新断点）', async () => {
    await cmdAutoTask({ dir: project, session: 'sess002', prompt: '做一件事 abcdef' });
    await cmdAutoTask({ dir: project, session: 'sess002', prompt: '又说了句别的', note: '到第二步了' });
    await cmdAutoTask({ dir: project, session: 'sess002', prompt: '继续说', note: '到第三步了' });
    const t = await todoText();
    const n = (t.match(/自动登记 sess002/g) || []).length;
    assert.equal(n, 1, `同会话只应有一条，实际 ${n} 处`);
    // 断点应是最新那条（不是累积）
    assert.match(t, /断点: 到第三步了/);
    assert.ok(!t.includes('到第二步了'), '旧断点应被替换，不累积');
  });

  test('不同会话各登记一条', async () => {
    await cmdAutoTask({ dir: project, session: 'sessA', prompt: '第一件事 abcdef' });
    await cmdAutoTask({ dir: project, session: 'sessB', prompt: '第二件事 ghijkl' });
    const t = await todoText();
    assert.ok(t.includes('自动登记 sessA') && t.includes('自动登记 sessB'), '两个会话各一条');
    assert.equal((t.match(/^- \[ \]/gm) || []).length, 2, '应为两条未完成');
  });

  test('抽不出关键词 → 不登记（不产生机器 id 垃圾条目）', async () => {
    const r = await cmdAutoTask({ dir: project, session: 'sessC', prompt: '在吗' });
    assert.equal(r, null);
    const t = await todoText();
    assert.ok(!t.includes('auto-sessC'), '不该登记');
  });

  test('ABS_AUTO_TASK=0 时完全不动（开关有效）', async () => {
    process.env.ABS_AUTO_TASK = '0';
    const r = await cmdAutoTask({ dir: project, session: 'sessD', prompt: '修 plugin 的 bug abcdef' });
    assert.equal(r, null);
    assert.ok(!(await todoText()).includes('auto-sessD'));
  });

  test('无 .brain 的项目不炸（当普通会话处理）', async () => {
    const bare = join(sandbox, 'no-brain');
    await fs.mkdir(bare, { recursive: true });
    await assert.rejects(
      () => cmdAutoTask({ dir: bare, session: 'x', prompt: '修 plugin abcdef' }),
      '无图谱应报错而非静默假成功',
    );
  });
});

describe('cmdAutoTaskSweep — 收尾清理', () => {
  test('把自动条目标 done，结语为【仅方案】不冒充【落地】', async () => {
    await cmdAutoTask({ dir: project, session: 'sweep1', prompt: '干点活 abcdef' });
    const r = await cmdAutoTaskSweep({ dir: project });
    assert.ok(r && r.includes('1 条'), `应清理 1 条: ${r}`);
    const t = await todoText();
    assert.ok(!/^\s*-\s+\[\s\]\s+\[[^\]]*\][^\n]*自动登记 sweep1/m.test(t), '不该还在未完成区');
    assert.match(t, /【仅方案】/, '自动条目结语应是仅方案');
  });

  test('不碰人工登记的真实任务', async () => {
    const { cmdTask } = await import('../src/store.js');
    await cmdTask({ dir: project, action: 'start', id: 'human-task', note: '人登记的真活' });
    await cmdAutoTask({ dir: project, session: 'sweep2', prompt: '自动的活 abcdef' });
    await cmdAutoTaskSweep({ dir: project });
    const t = await todoText();
    assert.match(t, /\[进行中\] human-task/, '人工任务必须原样留着');
  });

  test('没有自动条目时返回 null（不写空动作）', async () => {
    assert.equal(await cmdAutoTaskSweep({ dir: project }), null);
  });
});
