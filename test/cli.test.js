// test/cli.test.js — abs CLI 入口 (bin/abs.js) 深度测试。
// 覆盖: 命令分发、参数解析 (--dir/--note/--id/--section)、无图谱报错+退出码、
//       各命令成功路径、log 带参/无参双语义、未知命令/未知 action 报错。
// 隔离: 每个用例一个临时目录作项目, child_process 以显式 --dir 调用, 绝不碰真实配置。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(REPO, 'bin', 'abs.js');

let sandbox;
let proj;

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-cli-'));
  proj = join(sandbox, 'proj');
  await fs.mkdir(proj, { recursive: true });
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

/** 跑一次 CLI, 返回 {code, stdout, stderr}。 */
function run(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: proj,
      env: { ...process.env, ...opts.env },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
  });
}

// ---------- init ----------
describe('cli: init', () => {
  test('init 建图谱, 再 init 报已存在且退出码非 0', async () => {
    const a = await run(['init', '--dir', proj]);
    assert.equal(a.code, 0, a.stderr);
    await fs.access(join(proj, '.brain', 'todo.md'));
    const b = await run(['init', '--dir', proj]);
    assert.notEqual(b.code, 0, '已存在应失败退出');
    assert.ok(b.stderr.includes('已存在') || b.stderr.includes('exists'), b.stderr);
  });

  test('init --repair 补缺不覆盖', async () => {
    await run(['init', '--dir', proj]);
    await fs.rm(join(proj, '.brain', 'sessions'), { recursive: true });
    await fs.writeFile(join(proj, '.brain', 'index.md'), '# 我的索引', 'utf8');
    const r = await run(['init', '--repair', '--dir', proj]);
    assert.equal(r.code, 0, r.stderr);
    await fs.access(join(proj, '.brain', 'sessions'));
    const idx = await fs.readFile(join(proj, '.brain', 'index.md'), 'utf8');
    assert.equal(idx, '# 我的索引', 'repair 不应覆盖已有文件');
  });
});

// ---------- task ----------
describe('cli: todo', () => {
  beforeEach(() => run(['init', '--dir', proj]));

  test('start 登记 + done 归位 (默认 --dir = 进程 cwd)', async () => {
    const s = await run(['todo', 'start', 'T1', '--note', '做事']);
    assert.equal(s.code, 0, s.stderr);
    const d = await run(['todo', 'done', 'T1']);
    assert.equal(d.code, 0, d.stderr);
    const t = await run(['todo']);
    assert.ok(t.stdout.includes('T1'));
  });

  // abs todo 无参 = 看板(只读), 不再是报错
  test('无子命令 = 看板, 零退出', async () => {
    const r = await run(['todo']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(/Todo 看板|Today \/ In Progress/.test(r.stdout), r.stdout);
  });

  // 回归: 曾经 `abs todo add x` 静默打印看板、exit 0、不写盘(用户以为成功)
  test('未知子命令报错且非零退出 (不再静默吞掉)', async () => {
    const r = await run(['todo', 'frobnicate', 'T1']);
    assert.notEqual(r.code, 0, '未知子命令必须非零退出');
    assert.ok(/未知子命令/.test(r.stderr), r.stderr);
    assert.ok(/add \/ start \/ note \/ blocked \/ done/.test(r.stderr), '应列出可用子命令');
  });

  test('add 与 start 等价', async () => {
    const a = await run(['todo', 'add', 'EQ-A', '--note', 'via add']);
    assert.equal(a.code, 0, a.stderr);
    const b = await run(['todo', 'start', 'EQ-B', '--note', 'via start']);
    assert.equal(b.code, 0, b.stderr);
    const t = await fs.readFile(join(proj, '.brain', 'todo.md'), 'utf8');
    assert.ok(t.includes('EQ-A'), 'add 应登记成功');
    assert.ok(t.includes('EQ-B'), 'start 应仍可用');
  });

  test('已改名命令 task/board 报错并提示新写法', async () => {
    const r1 = await run(['task', 'start', 'X']);
    assert.notEqual(r1.code, 0);
    assert.ok(/已改名/.test(r1.stderr) && /abs todo/.test(r1.stderr), r1.stderr);
    const r2 = await run(['board']);
    assert.notEqual(r2.code, 0);
    assert.ok(/abs todo/.test(r2.stderr), r2.stderr);
  });

  // 回归: 只读命令以前静默吞掉多余参数
  test('只读命令遇多余参数报错 (不再静默)', async () => {
    for (const c of ['status', 'lint', 'load', 'index', 'wrapup']) {
      const r = await run([c, 'junk']);
      assert.notEqual(r.code, 0, `abs ${c} junk 应报错`);
      assert.ok(/不认识多余参数/.test(r.stderr), `${c}: ${r.stderr}`);
    }
  });

  test('blocked / note 断点实时落盘', async () => {
    await run(['todo', 'start', 'TB', '--note', 'x']);
    const n = await run(['todo', 'note', 'TB', '--note', '改到 L40']);
    assert.equal(n.code, 0, n.stderr);
    assert.ok(n.stdout.includes('断点'), n.stdout);
    const b = await run(['todo', 'blocked', 'TB', '--note', '端口占用']);
    assert.equal(b.code, 0, b.stderr);
    const t = await run(['todo']);
    assert.ok(t.stdout.includes('端口占用'));
  });

  test('start 幂等: 同 id 不重复登记', async () => {
    await run(['todo', 'start', 'TIDEM', '--note', 'v1']);
    await run(['todo', 'start', 'TIDEM', '--note', 'v2']);
    const t = await run(['todo']);
    const hits = t.stdout.split('\n').filter((l) => l.includes('TIDEM') && l.startsWith('- [ ]'));
    assert.equal(hits.length, 1, `应只一行:\n${t.stdout}`);
  });
});

// ---------- note ----------
describe('cli: note (经验暂存)', () => {
  beforeEach(() => run(['init', '--dir', proj]));
  test('note 落 sources/ 且进 index/log', async () => {
    const r = await run(['note', '一个要暂存的经验', '--tags', '坑,docker']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes('✓'), r.stdout);
    const idx = await fs.readFile(join(proj, '.brain', 'index.md'), 'utf8');
    assert.ok(idx.includes('Sources') && idx.includes('经验'), idx);
  });
  test('note 空文本报用法', async () => {
    const r = await run(['note', '   ']);
    assert.equal(r.code, 0); // 空文本不抛, 回用法
    assert.ok(r.stdout.includes('用法'), r.stdout);
  });
});

// ---------- query / lint ----------
describe('cli: query / lint', () => {
  beforeEach(() => run(['init', '--dir', proj]));
  test('query 多词 OR 命中', async () => {
    await fs.writeFile(join(proj, '.brain', 'concepts', 'c-x.md'),
      '---\ntags: [concept]\nupdated: 2026-09-08\nstatus: draft\n---\n专属词 abc 在此\n', 'utf8');
    const r = await run(['query', '专属词']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes('c-x'), r.stdout);
  });
  test('lint 健康图谱 0 问题', async () => {
    const r = await run(['lint']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes('0'), r.stdout);
  });
});

// ---------- 无图谱时的行为 ----------
describe('cli: 无 .brain/ 图谱', () => {
  // 空 proj 无图谱 → load/todo/status 都应非零退出并提示 abs init
  for (const cmd of [['load'], ['todo'], ['status']]) {
    test(`${cmd[0]} 无图谱时非零退出且提示 abs init`, async () => {
      const r = await run(cmd);
      assert.notEqual(r.code, 0);
      assert.ok(r.stderr.includes('abs init') || r.stderr.includes('图谱'), r.stderr);
    });
  }
  test('lint 无图谱时优雅提示(退出 0, 与 load/status 的报错不同)', async () => {
    // lint/query 是可「随处跑」的体检 —— 无图谱返回提示而非抛错, 契约见 cmdLint 的 try/catch
    const r = await run(['lint']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes('abs init'), r.stdout);
  });
  test('query 无图谱给提示(不崩)', async () => {
    const r = await run(['query', 'x']);
    assert.ok(r.stdout.includes('abs init'), r.stdout);
  });
});

// ---------- log 双语义 ----------
describe('cli: log 带参=写 / 无参=看', () => {
  test('log "标题" 写一行; log 无参查看', async () => {
    await run(['init', '--dir', proj]);
    const w = await run(['log', '完成一轮收尾']);
    assert.equal(w.code, 0, w.stderr);
    const r = await run(['log']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes('完成一轮收尾'), r.stdout);
  });
});

// ---------- 未知命令 ----------
describe('cli: wrapup (收尾保险快照)', () => {
  beforeEach(async () => {
    await run(['init', '--dir', proj]);
  });
  test('wrapup 快照未完成任务; load 展示滞留', async () => {
    const logDir = join(sandbox, 'abs-log');
    await run(['todo', 'start', 'CW-1', '--note', '做X'], { env: { ABS_LOG_DIR: logDir } });
    const w = await run(['wrapup'], { env: { ABS_LOG_DIR: logDir } });
    assert.equal(w.code, 0, w.stderr);
    assert.ok(w.stdout.includes('✓'), w.stdout);
    const l = await run(['load'], { env: { ABS_LOG_DIR: logDir } });
    assert.ok(l.stdout.includes('上会话滞留'), l.stdout);
    assert.ok(l.stdout.includes('做X'), l.stdout);
  });
  test('任务 done 后 load 不再报滞留 (自清理)', async () => {
    const logDir = join(sandbox, 'abs-log2');
    await run(['todo', 'start', 'CW-2', '--note', '做Y'], { env: { ABS_LOG_DIR: logDir } });
    await run(['wrapup'], { env: { ABS_LOG_DIR: logDir } });
    await run(['todo', 'done', 'CW-2'], { env: { ABS_LOG_DIR: logDir } });
    const l = await run(['load'], { env: { ABS_LOG_DIR: logDir } });
    assert.ok(!l.stdout.includes('上会话滞留'), l.stdout);
  });
});

// ---------- 未知命令 ----------
describe('cli: 未知命令/help', () => {
  test('未知命令非零退出', async () => {
    const r = await run(['nonsense']);
    assert.notEqual(r.code, 0);
    assert.ok(r.stderr.includes('未知命令'), r.stderr);
  });
  test('help 零退出并含用法', async () => {
    const r = await run(['help']);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes('abs init'), r.stdout);
  });

  // 回归: 用户报"abs update 看不到新版本" —— 因为当时根本没有 update/--version 命令。
  // 升级是 install/uninstall 之外的第三个自我管理动作, 必须有入口。
  test('--version / -v / version 输出包版本且零退出', async () => {
    const pkg = JSON.parse(await fs.readFile(join(REPO, 'package.json'), 'utf8'));
    for (const a of ['--version', '-v', 'version']) {
      const r = await run([a]);
      assert.equal(r.code, 0, `${a} 应零退出: ${r.stderr}`);
      assert.equal(r.stdout.trim(), pkg.version, `${a} 应输出 ${pkg.version}`);
    }
  });

  test('help 列出 update 与 --version (自我管理命令可发现)', async () => {
    const r = await run(['help']);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes('abs update'), 'help 应列出 abs update');
    assert.ok(r.stdout.includes('--version'), 'help 应列出 --version');
  });
});
