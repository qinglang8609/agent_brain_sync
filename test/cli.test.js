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
  // 写操作现要求设置使用者姓名；子进程经 ...process.env 继承。
  // 指向沙盒配置目录，避免读到真实 ~/.abs/config.json 造成不一致。
  process.env.ABS_USER = 'tester';
  process.env.ABS_CONFIG_DIR = join(sandbox, 'abs-cfg');
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

/** 跑一次 CLI, 返回 {code, stdout, stderr}。
 * opts.env 里值为 undefined 的键会被删掉（用于「显式取消」beforeEach 设的 ABS_USER 等）。 */
function run(args, opts = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...opts.env };
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
    const child = spawn(process.execPath, [CLI, ...args], { cwd: proj, env });
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

// ---------- 子命令 --help 不得触发实际动作 ----------
// 坑(INSTALL-HELP-FOOTGUN): --help 原本只在顶层命令被识别。`abs install --help`
// 落到 parseArgv 的通用分支（o.help=true），而 install 分支根本不读它 → 用户想看帮助，
// 实际执行了全量安装，改了四宿主配置、写 15 个文件。同类命令都应有此守卫。
describe('cli: 子命令 --help 只打印用法', () => {
  /** 隔离的 HOME/配置根，用于断言"没有任何文件被写"。 */
  async function isolated() {
    const home = join(sandbox, 'help-home');
    await fs.mkdir(home, { recursive: true });
    return {
      HOME: home,
      CLAUDE_CONFIG_DIR: join(sandbox, 'help-cc'),
      CODEX_HOME: join(sandbox, 'help-cx'),
      ABS_OPENCODE_HOME: join(sandbox, 'help-oc'),
      ABS_PI_HOME: join(sandbox, 'help-pi'),
    };
  }
  async function countFiles(dir) {
    let n = 0;
    try {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (e.isDirectory()) n += await countFiles(join(dir, e.name));
        else n++;
      }
    } catch { /* 目录不存在算 0 */ }
    return n;
  }

  test('abs install --help 打印用法且不写任何文件', async () => {
    const env = await isolated();
    const r = await run(['install', '--help'], { env });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes('用法'), `应打印用法: ${r.stdout}`);
    assert.ok(!r.stdout.includes('▸'), `不得真的执行安装(进度前缀 ▸ 出现): ${r.stdout}`);
    assert.equal(await countFiles(env.HOME), 0, '不得写入任何文件');
    assert.equal(await countFiles(env.CLAUDE_CONFIG_DIR), 0, '不得改宿主配置');
  });

  test('abs uninstall --help 打印用法且不写任何文件', async () => {
    const env = await isolated();
    const r = await run(['uninstall', '--help'], { env });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes('用法'), `应打印用法: ${r.stdout}`);
    assert.ok(!r.stdout.includes('▸'), `不得真的执行卸载(进度前缀 ▸ 出现): ${r.stdout}`);
    assert.equal(await countFiles(env.HOME), 0, '不得写入任何文件');
  });
});

// ---------- note --tags 值解析 ----------
// 坑(NOTE-TAGS-BOOL): --tags 没有专门分支 → 落到 parseArgv 通用分支变成布尔 true，
// 于是 frontmatter 写成 `tags: [source, true]`，且 `abs,摘要` 还粘进了正文与标题。
describe('cli: note --tags 值解析', () => {
  beforeEach(() => run(['init', '--dir', proj]));

  test('--tags 的逗号分隔值写入 frontmatter，且不粘进正文', async () => {
    const r = await run(['note', '标签解析测试', '--tags', 'abs,摘要']);
    assert.equal(r.code, 0, r.stderr);
    const dir = join(proj, '.brain', 'sources');
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md'));
    assert.equal(files.length, 1, `应落一页: ${files.join(', ')}`);
    const body = await fs.readFile(join(dir, files[0]), 'utf8');
    const fm = body.split('---')[1] || '';
    assert.ok(fm.includes('abs'), `tags 应含 abs: ${fm}`);
    assert.ok(fm.includes('摘要'), `tags 应含 摘要: ${fm}`);
    assert.ok(!fm.includes('true'), `不得把 --tags 解析成布尔: ${fm}`);
    // 正文/标题不得粘上标签串
    const contentOnly = body.split('---').slice(2).join('---');
    assert.ok(!contentOnly.includes('abs,摘要'), `标签不得粘进正文: ${contentOnly.slice(0, 200)}`);
    assert.ok(!files[0].includes('abs-摘要'), `文件名不应含标签串: ${files[0]}`);
  });
});

// ---------- argv 解析契约 ----------
// 坑: parseArgv 曾是 117 行手写 if-else；改用 node:util.parseArgs 后，语义靠这段钉住。
// 重点: --no-mcp / --no-skill 是**负向开关**，必须转成 mcp:false / skill:false，
// 若哪天又退回携带 true 的原样值，install 会把「不要 MCP」理解成「要 MCP」。
// 断言方式: 跑 `abs install --help`（只打印用法、不写盘），看它是否认得这些 flag。
describe('cli: argv 解析', () => {
  // 从外部可观测的代理: install --no-mcp 与 --no-skill 不得被当成未知参数而报错
  test('--no-mcp / --no-skill 被识别为合法 flag（不报未知参数）', async () => {
    for (const flag of ['--no-mcp', '--no-skill']) {
      const r = await run(['install', flag, '--help']);
      assert.equal(r.code, 0, `${flag} 应被接受: ${r.stderr}`);
      assert.ok(r.stdout.includes('用法'), `应打印 install 用法: ${r.stdout}`);
    }
  });

  test('负向开关真的生效: install --no-mcp 不注册 MCP', async () => {
    // 自建隔离 env（同 help 测试的做法: 四宿主配置根均指向沙盒）
    const env = {
      HOME: join(sandbox, 'argv-home'),
      CLAUDE_CONFIG_DIR: join(sandbox, 'argv-cc'),
      CODEX_HOME: join(sandbox, 'argv-cx'),
      ABS_OPENCODE_HOME: join(sandbox, 'argv-oc'),
      ABS_PI_HOME: join(sandbox, 'argv-pi'),
    };
    const r = await run(['install', '--agent', 'claude-code', '--no-mcp', '--no-skill', '--yes'], { env });
    assert.equal(r.code, 0, r.stderr);
    // 未注册 MCP → settings.json 里不应有 mcpServers.abs
    const settings = await fs.readFile(join(env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8').catch(() => '');
    assert.ok(!settings.includes('mcpServers'), `--no-mcp 不得注册 MCP: ${settings.slice(0, 300)}`);
  });

  test('--keep-days 传值（非布尔）且 --dry-run 为开关', async () => {
    await run(['init', '--dir', proj]);
    const r = await run(['todo', 'archive', '--keep-days', '7', '--dry-run']);
    assert.equal(r.code, 0, r.stderr);
    // 值真被读到: 输出里提到保留天数(而非把 '7' 当位置参数报错)
    assert.ok(!r.stderr.includes('不认识多余参数'), `--keep-days 的值不得被当位置参数: ${r.stderr}`);
  });

  test('未知 --flag 不抛异常（历史行为: 静默收下）', async () => {
    const r = await run(['lint', '--totally-unknown']);
    assert.equal(r.code, 0, `未知 flag 不应崩: ${r.stderr}`);
  });

  // ---- 以下三条是 parseArgs 迁移的真实回归面（曾各自由现一次 P0） ----
  // 坑1: parseArgs 会把**任何** `-` 开头的 token 当选项，连正文一起吃。
  // 回归面: abs note "-X 是个坑" 曾静默丢掉正文、只建空目录。
  test('以 - 开头的正文不被当短选项吃掉', async () => {
    await run(['init', '--dir', proj]);
    const r = await run(['note', '-X 是个坑', '--dir', proj]);
    assert.equal(r.code, 0, r.stderr);
    const dir = join(proj, '.brain', 'sources');
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md'));
    assert.equal(files.length, 1, `正文不得丢失（sources 应有 1 页）: ${files.join(', ')}`);
    const body = await fs.readFile(join(dir, files[0]), 'utf8');
    assert.ok(body.includes('-X 是个坑'), `正文应完整保留: ${body.slice(0, 300)}`);
  });

  // 坑2: 旧版只认 `--` 长选项 → `-x` 落位置参数被 rejectExtra 拒。
  // parseArgs 把 `-x` 当短选项静默吃掉 → lint 照跑。现已隔离恢复旧行为。
  test('裸 -x 仍被当作多余参数拒绝（不得静默吃掉）', async () => {
    await run(['init', '--dir', proj]);
    const r = await run(['lint', '-x', '--dir', proj]);
    assert.notEqual(r.code, 0, `-x 应被拒绝: ${r.stdout}`);
    assert.ok(r.stderr.includes('不认识多余参数'), `应报多余参数: ${r.stderr}`);
  });

  // 坑3: parseArgs 对「声明的 string 选项缺值」不报错，而把值设成 true，
  // 一路传到 resolve(true) 才抛裸栈。现在在 parseArgv 里就拦下并给清晰用法。
  test('声明的 string 选项缺值时报清晰错误（不裸栈）', async () => {
    const r = await run(['init', '--dir']);
    assert.notEqual(r.code, 0);
    assert.ok(r.stderr.includes('缺少值'), `应报缺值: ${r.stderr}`);
    assert.ok(!r.stderr.includes('ERR_INVALID_ARG_TYPE'), `不得泄裸栈: ${r.stderr}`);
  });

  // 坑4: resolve(undefined) 抛 ERR_INVALID_ARG_TYPE，**不**自动回退 cwd。
  // 不带 --dir 时 store.js 必须显式回退 cwd，否则 init/load/board 全崩。
  test('不带 --dir 时回退当前目录（不崩）', async () => {
    const r = await run(['init']);
    assert.equal(r.code, 0, `init 不带 --dir 应成功: ${r.stderr}`);
    assert.ok(r.stdout.includes('已建图谱'), r.stdout);
    await fs.access(join(proj, '.brain', 'todo.md')); // 建在了 cwd(= proj)
  });

  // 坑5: teardown mark 曾用裸 homedir() 拼路径 → 彽过 ABS_LOG_DIR，
  // 测试注入沙盒永远隔离不到它（会往真实 ~/.abs/log/ 写 mark，污染真机去重状态）。
  // 断言: HOME 与 ABS_LOG_DIR 分开时，mark 落 ABS_LOG_DIR，绝不落 HOME。
  test('teardown mark 落 ABS_LOG_DIR，不落 HOME/.abs/log', async () => {
    await run(['init', '--dir', proj]);
    const logDir = join(sandbox, 'td-log');
    const fakeHome = join(sandbox, 'td-home'); // ≠ logDir，老代码会写到这
    await fs.mkdir(fakeHome, { recursive: true });
    // transcript 里带 Write 工具足迹 → 满足「本会话改过文件」守卫
    const trans = join(sandbox, 'trans.jsonl');
    await fs.writeFile(trans,
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write' }] } }) + '\n', 'utf8');
    const payload = JSON.stringify({ session_id: 'ses_TD', cwd: proj, transcript_path: trans });
    const r = await run(['teardown-check', '--payload', payload],
      { env: { HOME: fakeHome, ABS_LOG_DIR: logDir } });
    assert.match(r.stdout, /^push:/, `应触发注入: ${r.stdout}`);
    await fs.access(join(logDir, 'teardown-ses_TD.mark')); // 老代码: 这里失败
    await assert.rejects(() => fs.access(join(fakeHome, '.abs', 'log', 'teardown-ses_TD.mark')),
      'mark 不得写到 HOME/.abs/log');
  });
});

// ---------- 使用者姓名（作者标记）----------
// 需求: 运行 abs 时检查用户姓名, 未设置则要求设置; todo/log/生成文档标 @name。
// 关键设计: **只在写操作检查** —— hook 会在会话结束非交互调 abs wrapup / teardown-check,
// 那儿拦人会卡断收尾流程。故这里必须显式断言只读命令与 hook 命令不受影响。
describe('cli: 使用者姓名与作者标记', () => {
  /** 隔离配置目录 + 显式姓名/无名，避免读到真实 ~/.abs/config.json。 */
  function envNoUser(extra = {}) {
    // ABS_USER 显式置 undefined = 删掉它（空串不生效：getUser 会跳过空值，
    // 从而让 beforeEach 设的 'tester' 泄露进来）。同理 ABS_CONFIG_DIR 指向沙箱。
    return { ABS_CONFIG_DIR: join(sandbox, 'u-cfg'), ABS_USER: undefined, ...extra };
  }
  function envUser(name = 'fanchao', extra = {}) {
    return { ABS_CONFIG_DIR: join(sandbox, 'u-cfg'), ABS_USER: name, ...extra };
  }

  test('未设姓名: 写操作报错并给出设置命令', async () => {
    await run(['init', '--dir', proj], { env: envNoUser() });
    for (const args of [
      ['todo', 'add', 'T1', '--note', 'x', '--dir', proj],
      ['log', '完成某事', '--dir', proj],
      ['note', '某经验', '--dir', proj],
    ]) {
      const r = await run(args, { env: envNoUser() });
      assert.notEqual(r.code, 0, `${args.join(' ')} 应被拦下`);
      assert.ok(r.stderr.includes('尚未设置使用者姓名'), `应报未设置: ${r.stderr}`);
      assert.ok(r.stderr.includes('abs config set user'), `应给出设置命令: ${r.stderr}`);
    }
    // 确认真的没落盘
    const todo = await fs.readFile(join(proj, '.brain', 'todo.md'), 'utf8').catch(() => '');
    assert.ok(!todo.includes('T1'), `未设姓名时不得落盘: ${todo}`);
  });

  test('未设姓名: 只读命令与 hook 命令不受影响', async () => {
    await run(['init', '--dir', proj], { env: envNoUser() });
    // 只读：必须照常工作
    for (const args of [['load', '--dir', proj], ['status', '--dir', proj], ['lint', '--dir', proj], ['log', '--dir', proj]]) {
      const r = await run(args, { env: envNoUser() });
      assert.equal(r.code, 0, `只读命令 ${args[0]} 不应被姓名守卫拦: ${r.stderr}`);
    }
    // hook 路径：收尾自动化调它们，绝不能因缺姓名而失败
    const w = await run(['wrapup', '--dir', proj], { env: envNoUser() });
    assert.equal(w.code, 0, `abs wrapup 不应被拦(会卡断收尾): ${w.stderr}`);
    const t = await run(['teardown-check', '--payload', '{}'], { env: envNoUser() });
    assert.equal(t.code, 0, `abs teardown-check 不应被拦: ${t.stderr}`);
  });

  test('config set user 落盘, config 可查看, 坏字符被拒', async () => {
    const env = envNoUser();
    const set = await run(['config', 'set', 'user', 'fanchao'], { env });
    assert.equal(set.code, 0, set.stderr);
    assert.ok(set.stdout.includes('fanchao'), set.stdout);
    // 落盘到 ABS_CONFIG_DIR 而非真实 ~/.abs
    const cfg = JSON.parse(await fs.readFile(join(env.ABS_CONFIG_DIR, 'config.json'), 'utf8'));
    assert.equal(cfg.user, 'fanchao');
    // show 能读到落盘值（删掉 ABS_USER，强制走文件）
    const envFileOnly = { ABS_CONFIG_DIR: env.ABS_CONFIG_DIR, ABS_USER: undefined };
    const show = await run(['config'], { env: envFileOnly });
    assert.ok(show.stdout.includes('fanchao'), `config 应显示已设姓名: ${show.stdout}`);
    // 含空格的姓名被拒（@name 标记无法解析带空格的名字）
    const bad = await run(['config', 'set', 'user', 'fan chao'], { env });
    assert.notEqual(bad.code, 0);
    assert.ok(bad.stderr.includes('不能含空格'), bad.stderr);
    // 其它非法字符（如 $）同样被拒
    const bad2 = await run(['config', 'set', 'user', 'fa$n'], { env });
    assert.notEqual(bad2.code, 0);
    assert.ok(bad2.stderr.includes('不支持的字符'), bad2.stderr);
  });

  test('设姓名后: todo 行标 @name, 且 config 文件持久生效', async () => {
    await run(['init', '--dir', proj], { env: envNoUser() });
    await run(['config', 'set', 'user', 'fanchao'], { env: envNoUser() });
    // 只留 ABS_CONFIG_DIR，删掉 ABS_USER → 必须从文件读到
    const env = { ABS_CONFIG_DIR: join(sandbox, 'u-cfg'), ABS_USER: undefined };
    const r = await run(['todo', 'add', 'T1', '--note', '做点事', '--dir', proj], { env });
    assert.equal(r.code, 0, r.stderr);
    const todo = await fs.readFile(join(proj, '.brain', 'todo.md'), 'utf8');
    assert.ok(/- \[ \] T1 @fanchao — 做点事 \(认领 \d{4}-\d{2}-\d{2}\)/.test(todo),
      `todo 行应为 'ID @name — 说明 (认领 date)': ${todo}`);
  });

  test('log 行标 @name（作者前置于 kind）', async () => {
    await run(['init', '--dir', proj], { env: envNoUser() });
    const env = envUser('alice');
    const r = await run(['log', '完成作者标记', '--dir', proj], { env });
    assert.equal(r.code, 0, r.stderr);
    const log = await fs.readFile(join(proj, '.brain', 'log.md'), 'utf8');
    assert.ok(/^## \[[\d-]+ [\d:]+\] @alice dev \| 完成作者标记/m.test(log),
      `log 行格式应为 '[时间] @name kind | 内容': ${log}`);
  });

  test('note 页 frontmatter 含 author 字段（四项 tags/author/updated/status）', async () => {
    await run(['init', '--dir', proj], { env: envNoUser() });
    const env = envUser('bob');
    const r2 = await run(['note', '经验一条', '--tags', '坑', '--dir', proj], { env });
    assert.equal(r2.code, 0, r2.stderr);
    const dir = join(proj, '.brain', 'sources');
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md'));
    const body = await fs.readFile(join(dir, files[0]), 'utf8');
    const fm = body.split('---')[1] || '';
    assert.ok(fm.includes('author: bob'), `frontmatter 应含 author: ${fm}`);
    assert.ok(fm.includes('tags:'), 'tags 仍应在');
    assert.ok(fm.includes('updated:'), 'updated 仍应在');
    assert.ok(fm.includes('status:'), 'status 仍应在');
  });

  test('ABS_USER 覆盖配置文件（临时身份，不改落盘）', async () => {
    await run(['init', '--dir', proj], { env: envNoUser() });
    await run(['config', 'set', 'user', 'fileuser'], { env: envNoUser() });
    const env = { ABS_CONFIG_DIR: join(sandbox, 'u-cfg'), ABS_USER: 'envuser' };
    await run(['todo', 'add', 'T2', '--note', 'x', '--dir', proj], { env });
    const todo = await fs.readFile(join(proj, '.brain', 'todo.md'), 'utf8');
    assert.ok(todo.includes('@envuser'), `环境变量应优先: ${todo}`);
    assert.ok(!todo.includes('@fileuser'), `不得用文件里的名字: ${todo}`);
  });
});
