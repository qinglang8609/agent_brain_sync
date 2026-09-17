// test/plugin-behavior.test.js — 插件**行为级**测试(非字符串断言)。
//
// 为什么单独一层: install.test.js 只做源码字符串断言, 而 op​encode 插件曾连中两坑
//   (① event 回调签名 ({name}) 错 ② export const 命名导出被加载器忽略) —— 两次字符串断言都过,
//   插件却从未触发。教训: "装上了" ≠ "加载了" ≠ "触发了", 必须真 import 生成的产物并驱动它。
//
// 本层直接 import 生成后的真实 .ts (Node 24 原生剥类型), 驱动真实事件序列, 断言:
//   1. 导出契约可被宿主加载 (pi: default 是函数; op​encode: default.server 是函数)
//   2. 注入条件正确 (只读不注入 / 写后注入一次 / 节流 / 今日已收尾不注入 / 无图谱不注入)
//   3. 技术日志有真实落痕 (证伪"静默失效"的唯一硬证据)
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(REPO, 'bin', 'abs.js');

let sandbox;
let HOME;
let CODEX_CFG;

function sbEnv(extra = {}) {
  return {
    ...process.env,
    HOME,
    ABS_USER: 'tester', // 写操作现要求设置姓名；指向沙箱避开真实配置
    ABS_CONFIG_DIR: join(sandbox, 'abs-cfg'),
    CLAUDE_CONFIG_DIR: join(sandbox, 'claude'),
    CODEX_HOME: CODEX_CFG,
    ABS_OPENCODE_HOME: join(sandbox, 'opencode'),
    ABS_PI_HOME: join(sandbox, 'pi'),
    ...extra,
  };
}

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: sandbox, env: sbEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
  });
}

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-plugin-'));
  HOME = join(sandbox, 'home');
  CODEX_CFG = join(sandbox, 'codex');
  await fs.mkdir(HOME, { recursive: true });
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

/** 造一个有 .brain 的项目; logHasToday=false 时 log.md 只有旧日期。 */
async function makeProject(name, logHasToday = false) {
  const proj = join(sandbox, name);
  await fs.mkdir(join(proj, '.brain'), { recursive: true });
  const d = new Date(), pad = (n) => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const line = logHasToday ? `## [${today} 10:00] dev | 已收尾\n` : '## [2020-01-01 00:00] dev | 旧\n';
  await fs.writeFile(join(proj, '.brain', 'log.md'), '# Activity Log\n' + line, 'utf8');
  return proj;
}

/** 导入生成的 .ts(靠 Node 原生类型剥离)。 */
async function importTs(path) {
  return import(pathToFileURL(path).href + `?t=${Date.now()}-${Math.random()}`);
}

/** 设 ABS_LOG_DIR 后导入(插件在调用时读该 env, 但显式在 import 前设定更稳)。 */
async function importTsWithLog(path, logDir) {
  process.env.ABS_LOG_DIR = logDir;
  return importTs(path);
}

/** 读技术日志。参数是 ABS_LOG_DIR 本身(即 .../log), 不是沙盒根。 */
function hooksLog(logDir) {
  return fs.readFile(join(logDir, 'hooks.log'), 'utf8').catch(() => '');
}

// ============================ pi ============================
describe('pi 扩展 行为级 (agent_end 收尾注入)', () => {
  async function loadPi(logDir) {
    await run(['install', '--agent', 'pi', '--yes']);
    const p = join(sandbox, 'pi', 'agent', 'extensions', 'abs.ts');
    return importTsWithLog(p, logDir);
  }

  function harness(absPiHook) {
    const handlers = {}, injected = [];
    absPiHook({ on: (e, f) => { handlers[e] = f }, sendUserMessage: (text, opts) => injected.push({ text, opts }) });
    return { handlers, injected };
  }

  test('导出契约: default 是函数, 且注册了 agent_end', async () => {
    const mod = await loadPi(join(sandbox, 'log'));
    assert.equal(typeof mod.default, 'function', 'pi 扩展必须 default 导出函数');
    const { handlers } = harness(mod.default);
    assert.ok(handlers.agent_end, '必须注册 agent_end');
    assert.ok(handlers.session_start, '必须注册 session_start');
  });

  test('只读会话不注入; bash 只读命令也不注入', async () => {
    const mod = await loadPi(join(sandbox, 'log'));
    const { handlers, injected } = harness(mod.default);
    const proj = await makeProject('pi-read');
    await handlers.agent_end({ messages: [{ role: 'toolResult', toolName: 'read' }] }, { cwd: proj });
    assert.equal(injected.length, 0, '只读 read 不应注入');
    await handlers.agent_end({ messages: [{ role: 'toolResult', toolName: 'bash', input: { command: 'git status' } }] }, { cwd: proj });
    assert.equal(injected.length, 0, 'bash 只读命令不应注入');
    await handlers.agent_end({ messages: [{ role: 'toolResult', toolName: 'grep' }] }, { cwd: proj });
    assert.equal(injected.length, 0, 'grep 不应注入');
  });

  test('真改过文件 → 注入一次, deliverAs=followUp, 日志有落痕; 再触发被节流', async () => {
    const logDir = join(sandbox, 'log');
    const mod = await loadPi(logDir);
    const { handlers, injected } = harness(mod.default);
    const proj = await makeProject('pi-write');
    const msgs = [
      { role: 'user', content: 'x' },
      { role: 'assistant', content: [] },
      { role: 'toolResult', toolName: 'read' },
      { role: 'toolResult', toolName: 'edit' },
    ];
    await handlers.agent_end({ messages: msgs }, { cwd: proj });
    assert.equal(injected.length, 1, '写后应注入一次');
    assert.equal(injected[0].opts.deliverAs, 'followUp', '流式中注入须用 followUp');
    assert.match(injected[0].text, /\[abs\] 本会话改过文件/, '注入文本应是 abs 事实提示');
    assert.ok(!injected[0].text.includes('\\n'), '注入文本不应残留转义 \\n');
    const log = await hooksLog(logDir);
    assert.match(log, /pi:agent_end:teardown-nudge/, '必须有真实落痕(证伪静默失效)');
    // 节流
    await handlers.agent_end({ messages: [{ role: 'toolResult', toolName: 'write' }] }, { cwd: proj });
    assert.equal(injected.length, 1, '每会话最多一次');
  });

  test('session_start 重置节流：同进程的第二个会话仍能注入', async () => {
    // 回归 2026-09-13 实报：同一天后续会话全部静默——
    // teardownNudged 声明在 absPiHook 作用域且 session_start 不重置，
    // 于是同一进程的第二个会话永久继承 true，后半场全部静默。
    const logDir = join(sandbox, 'log');
    const mod = await loadPi(logDir);
    const { handlers, injected } = harness(mod.default);
    const proj = await makeProject('pi-reset');
    const msgs = [{ role: 'toolResult', toolName: 'edit' }];
    await handlers.agent_end({ messages: msgs }, { cwd: proj });
    assert.equal(injected.length, 1, '首会话应注入');
    await handlers.session_start({}, { cwd: proj });
    await handlers.agent_end({ messages: msgs }, { cwd: proj });
    assert.equal(injected.length, 2, '新会话必须能再次注入（重置节流）');
  });

  test('并发 agent_end 只注入一次（跨 await 的检查-置位竞态回归）', async () => {
    // 回归 2026-09-17 实测定根因：~/.abs/log/hooks.log 里同会话 5 分钟注入 6 次，
    // 全日志 55 次。原实现是「先 `if (nudged) return` 检查 → 隔若干 await（logHook/loggedToday）
    // 才 teardownNudged = true」→ 并发调用全部先过检查、再各自置位 → 一起注入。
    // 而 agent_end 是**每轮 run 结束**都触发（不等于会话结束），并发是常态。
    // 修法：进函数第一个动作就置 in-flight（检查与置位间无 await）。
    const logDir = join(sandbox, 'log');
    const mod = await loadPi(logDir);
    const { handlers, injected } = harness(mod.default);
    const proj = await makeProject('pi-race');
    const msgs = [{ role: 'toolResult', toolName: 'edit' }];
    // 不 await 逐个跑 —— 模拟真实的同时触发
    await Promise.all([
      handlers.agent_end({ messages: msgs }, { cwd: proj }),
      handlers.agent_end({ messages: msgs }, { cwd: proj }),
      handlers.agent_end({ messages: msgs }, { cwd: proj }),
      handlers.agent_end({ messages: msgs }, { cwd: proj }),
      handlers.agent_end({ messages: msgs }, { cwd: proj }),
    ]);
    assert.equal(injected.length, 1, `并发 5 次只能注入 1 次，实际 ${injected.length} 次`);
    // seen 痕也不能重复（它同样被守卫，实测生产里泄漏了 6 次）
    const log = await hooksLog(logDir);
    const seen = (log.match(/agent_end:seen/g) || []).length;
    assert.equal(seen, 1, `agent_end:seen 应恰好一行，实际 ${seen} 行`);
    const nudges = (log.match(/agent_end:teardown-nudge/g) || []).length;
    assert.equal(nudges, 1, `teardown-nudge 落痕应恰好一条，实际 ${nudges} 条`);
  });

  test('重复注册扩展（多实例）仍共享节流（session_start 多次触发的回归）', async () => {
    // 回归 2026-09-17 实测：session_start 11 分钟内触发 8 次（00:07:58 一口气 3 次）——
    // 扩展被重复注册。原守卫声明在被反复调用的工厂函数里 → 每注册一份就多一份独立闭包，
    // “每会话一次”变成“每实例一次”。修法：状态提到模块级，同进程内只有一份。
    const logDir = join(sandbox, 'log');
    const mod = await loadPi(logDir);
    const proj = await makeProject('pi-multi');
    const msgs = [{ role: 'toolResult', toolName: 'edit' }];
    const a = harness(mod.default);   // 第 1 份注册
    const b = harness(mod.default);   // 第 2 份注册
    await Promise.all([
      a.handlers.agent_end({ messages: msgs }, { cwd: proj }),
      b.handlers.agent_end({ messages: msgs }, { cwd: proj }),
    ]);
    const total = a.injected.length + b.injected.length;
    assert.equal(total, 1, `两份实例合计只能注入 1 次，实际 ${total} 次`);
  });

  test('收尾提示带本会话素材（hook 机械记的用户原话+改过的文件）', async () => {
    const logDir = join(sandbox, 'log');
    const mod = await loadPi(logDir);
    const { handlers, injected } = harness(mod.default);
    const proj = await makeProject('pi-notes');
    await handlers.before_agent_start({ prompt: '这一轮的产出记一下' }, { cwd: proj });
    await handlers.turn_end({ toolResults: [{ toolName: 'edit', input: { file_path: 'src/todo.js' } }] }, { cwd: proj });
    await handlers.agent_end({ messages: [{ role: 'toolResult', toolName: 'edit' }] }, { cwd: proj });
    // 写文件本轮不再注入任何提醒（2026-09-15 撤销：每轮弹 Follow-up 太吵）。
    // 不再断言总数固定 —— 两种提醒都会发，顺序是登记在前、收尾在后。
    const teardown = injected.filter((m) => /本会话素材|收尾/.test(m.text));
    assert.equal(teardown.length, 1, `收尾提醒应恰好一条: ${injected.map((m) => m.text.slice(0, 40)).join(' | ')}`);
    assert.match(teardown[0].text, /本会话素材/, `应带素材标题: ${teardown[0].text.slice(-400)}`);
    assert.match(teardown[0].text, /user: 这一轮的产出记一下/, '应带用户原话');
    assert.match(teardown[0].text, /tool: src\/todo\.js/, '应带改过的文件');
    // 素材只能用一次：新会话重新累积（这里是刻意的：素材属于会话，不是全局）
    await handlers.session_start({}, { cwd: proj });
    await handlers.turn_end({ toolResults: [{ toolName: 'edit', input: { file_path: 'src/new.js' } }] }, { cwd: proj });
    await handlers.agent_end({ messages: [{ role: 'toolResult', toolName: 'edit' }] }, { cwd: proj });
    const t2 = injected.filter((m) => /本会话素材/.test(m.text));
    assert.match(t2[t2.length - 1].text, /tool: src\/new\.js/, '新会话素材应重新累积');
    assert.ok(!t2[t2.length - 1].text.includes('src/todo.js'), '不得重复上一会话的旧料');
  });

  // ---- 新增：写文件 = 任务开始 → 立刻提醒登记（不等 agent_end） ----

  test('今日已收尾的项目不注入', async () => {
    const mod = await loadPi(join(sandbox, 'log'));
    const { handlers, injected } = harness(mod.default);
    const proj = await makeProject('pi-done', true);
    await handlers.agent_end({ messages: [{ role: 'toolResult', toolName: 'edit' }] }, { cwd: proj });
    assert.equal(injected.length, 0, 'log.md 有今日 dev 记录则不再打扰');
  });

  // ===== 回归 2026-09-13: 节流误判导致后续会话静默 =====
  // abs note 也写 log.md（kind=note），旧判据 (^## [今天 HH:MM]) 把「沉淀了一条经验」
  // 当成「今天已收尾」→ 整天不再提醒 → 新冒的话题全部漏登。只认 kind=dev。
  test('今日只有 note（无 dev）→ 仍应注入（note 不是收尾）', async () => {
    const mod = await loadPi(join(sandbox, 'log'));
    const { handlers, injected } = harness(mod.default);
    const proj = await makeProject('pi-noteonly');
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    await fs.writeFile(join(proj, '.brain', 'log.md'),
      `# 🗒 Activity Log\n\n## [${today} 10:00] [[fanchao]] note | 只沉淀了经验\n`, 'utf8');
    await handlers.agent_end({ messages: [{ role: 'toolResult', toolName: 'edit' }] }, { cwd: proj });
    assert.equal(injected.length, 1, '只有 note 不得当已收尾');
    // 有 dev 则真的不打扰
    await fs.appendFile(join(proj, '.brain', 'log.md'),
      `## [${today} 11:00] [[fanchao]] dev | 真收尾\n`, 'utf8');
    await handlers.session_start({}, { cwd: proj });
    await handlers.agent_end({ messages: [{ role: 'toolResult', toolName: 'edit' }] }, { cwd: proj });
    assert.equal(injected.length, 1, '有 dev 记录后不再打扰');
  });

  // 守卫收紧: 曾用裸日期 substring(includes(today)) 判"今天收尾过",
  // 于是正文里任何一处提到今天的日期(任务行/引文/本提醒文本)都会把 nudge 永久压掉。
  // 必须只认 log.md 的条目头 '## [YYYY-MM-DD HH:MM]'。
  test('正文提到今天日期 ≠ 已收尾 (旧 substring 守卫的误判回归)', async () => {
    const mod = await loadPi(join(sandbox, 'log'));
    const { handlers, injected } = harness(mod.default);
    const proj = join(sandbox, 'pi-false-positive');
    await fs.mkdir(join(proj, '.brain'), { recursive: true });
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    // 无任何 '## [today HH:MM]' 条目头, 但正文里出现了今天的日期
    await fs.writeFile(
      join(proj, '.brain', 'log.md'),
      `# Activity Log\n\n> 目标: ${today} 前完成迁移\n## [2020-01-01 00:00] dev | 旧\n`,
      'utf8',
    );
    await handlers.agent_end({ messages: [{ role: 'toolResult', toolName: 'edit' }] }, { cwd: proj });
    assert.equal(injected.length, 1, '正文提到今天日期不应被当作已收尾');
  });

  // 可观测性: 无 seen 痕就无法区分「事件没触发」与「触发了但被守卫拦下」——
  // 本次排查时正因为只有 nudge 痕, 分不清 agent_end 到底有没有跑。
  test('首次 agent_end 无条件留 seen 痕 (可观测性: 区分未触发/被拦下)', async () => {
    const logDir = join(sandbox, 'log');
    const mod = await loadPi(logDir);
    const { handlers } = harness(mod.default);
    const proj = await makeProject('pi-seen', true); // 今日已收尾 → 不会 nudge
    await handlers.agent_end({ messages: [{ role: 'toolResult', toolName: 'edit' }] }, { cwd: proj });
    const log = await hooksLog(logDir);
    assert.match(log, /pi:agent_end:seen/, '即使被守卫拦下, 也必须有 seen 痕');
    assert.ok(!/teardown-nudge/.test(log), '被拦下时不应有 nudge 痕');
    // 只记一次, 不刷屏
    await handlers.agent_end({ messages: [{ role: 'toolResult', toolName: 'edit' }] }, { cwd: proj });
    const log2 = await hooksLog(logDir);
    assert.equal((log2.match(/agent_end:seen/g) || []).length, 1, 'seen 只记一次');
  });

  test('无 .brain 的项目不注入', async () => {
    const mod = await loadPi(join(sandbox, 'log'));
    const { handlers, injected } = harness(mod.default);
    const proj = join(sandbox, 'pi-nobrain');
    await fs.mkdir(proj, { recursive: true });
    await handlers.agent_end({ messages: [{ role: 'toolResult', toolName: 'edit' }] }, { cwd: proj });
    assert.equal(injected.length, 0, '无图谱不打扰');
  });
});

// ============================ op​encode ============================
describe('op​encode 插件 行为级 (session.idle 收尾注入)', () => {
  async function loadOc(logDir) {
    await run(['install', '--agent', 'opencode', '--yes']);
    const p = join(sandbox, 'opencode', 'plugins', 'abs.ts');
    return importTsWithLog(p, logDir);
  }

  test('导出契约: 有 default 且 default.server 是函数 (命名导出会被加载器忽略)', async () => {
    const mod = await loadOc(join(sandbox, 'log'));
    assert.ok('default' in mod, '必须有 default 导出(加载器取 default)');
    assert.equal(typeof mod.default.server, 'function', 'default.server 必须是函数');
    assert.equal(mod.default.id, 'abs');
    assert.ok(!mod.AbsPlugin, '不应存在命名导出 AbsPlugin');
  });

  test('server 返回 event 与 tool.execute.after 两个钩子', async () => {
    const mod = await loadOc(join(sandbox, 'log'));
    const proj = await makeProject('oc-hooks');
    const hooks = await mod.default.server({ client: { session: { promptAsync: async () => {} } }, directory: proj });
    assert.equal(typeof hooks.event, 'function');
    assert.equal(typeof hooks['tool.execute.after'], 'function');
  });


  test('只读不注入; 写后 idle 注入一次并落痕; 再 idle 节流', async () => {
    const logDir = join(sandbox, 'log');
    const mod = await loadOc(logDir);
    const proj = await makeProject('oc-write');
    const injected = [];
    const hooks = await mod.default.server({
      client: { session: { promptAsync: async (a) => injected.push(a) } },
      directory: proj,
    });
    // 只读: 无 tool.execute.after 写标记
    await hooks.event({ event: { type: 'session.created', properties: { sessionID: 's1' } } });
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    assert.equal(injected.length, 0, '只读不应注入');
    // 写后
    await hooks['tool.execute.after']({ tool: 'edit' });
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    assert.equal(injected.length, 1, '写后应注入一次');
    assert.equal(injected[0].path.id, 's1', '注入须指向当前 session');
    assert.match(injected[0].body.parts[0].text, /\[abs\] 本会话改过文件/);
    assert.ok(!injected[0].body.parts[0].text.includes('\\n'), '注入文本不应残留转义');
    const log = await hooksLog(logDir);
    assert.match(log, /opencode:session\.created/, 'session.created 应落痕');
    assert.match(log, /opencode:session\.idle:teardown-nudge/, '必须有真实落痕(证伪静默失效)');
    assert.ok(!log.includes('undefined'), '事件名不得是 undefined(曾因 ({name}) 签名错)');
    // 节流
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    assert.equal(injected.length, 1, '每会话最多一次');
  });

  test('今日已收尾不注入; 无 .brain 不注入', async () => {
    const mod = await loadOc(join(sandbox, 'log'));
    // 今日已收尾
    const done = await makeProject('oc-done', true);
    const inj1 = [];
    const h1 = await mod.default.server({ client: { session: { promptAsync: async (a) => inj1.push(a) } }, directory: done });
    await h1['tool.execute.after']({ tool: 'write' });
    await h1.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    assert.equal(inj1.length, 0, '今日已收尾不打扰');
    // 无图谱
    const nobrain = join(sandbox, 'oc-nobrain');
    await fs.mkdir(nobrain, { recursive: true });
    const inj2 = [];
    const h2 = await mod.default.server({ client: { session: { promptAsync: async (a) => inj2.push(a) } }, directory: nobrain });
    await h2['tool.execute.after']({ tool: 'edit' });
    await h2.event({ event: { type: 'session.idle', properties: { sessionID: 's2' } } });
    assert.equal(inj2.length, 0, '无图谱不打扰');
  });

  // 根因回归: "零 nudge" 曾被误解为 promptAsync 通道故障, 实际是 wroteFiles 守卫漏了 bash。
  // op​encode 里很多修改走 bash(heredoc/sed), 纯 bash 会话永远不置位 → 提醒静默不发。
  test('bash 写命令算改文件(置位), 只读 bash 不算', async () => {
    const mod = await loadOc(join(sandbox, 'log'));
    const cases = [
      [['bash', { command: 'sed -i s/a/b/ f.js' }], 1, 'bash 写命令应置位'],
      [['bash', { command: 'git status' }], 0, '只读 bash 不应置位'],
      [['bash', { command: 'ls -la' }], 0, '只读 bash 不应置位'],
      [['write', {}], 1, 'write 工具应置位'],
      [['read', {}], 0, '纯读不应置位'],
    ];
    for (const [toolArgs, want, msg] of cases) {
      const inj = [];
      const proj = await makeProject(`oc-gate-${toolArgs[0]}-${want}-${Math.random().toString(36).slice(2, 7)}`);
      const h = await mod.default.server({
        client: { session: { promptAsync: async (a) => inj.push(a) } },
        directory: proj,
      });
      await h['tool.execute.after']({ tool: toolArgs[0], args: toolArgs[1] });
      await h.event({ event: { type: 'session.idle', properties: { sessionID: 's' } } });
      assert.equal(inj.length, want, msg);
    }
  });

  test('首次 session.idle 无条件留 seen 痕 (可观测性)', async () => {
    const logDir = join(sandbox, 'log');
    const mod = await loadOc(logDir);
    const done = await makeProject('oc-seen', true); // 今日已收尾 → 不会 nudge
    const hooks = await mod.default.server({ client: { session: { promptAsync: async () => {} } }, directory: done });
    await hooks['tool.execute.after']({ tool: 'edit' });
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    const log = await hooksLog(logDir);
    assert.match(log, /opencode:session\.idle:seen/, '即使被守卫拦下, 也必须有 seen 痕');
    assert.ok(!/teardown-nudge/.test(log), '被拦下时不应有 nudge 痕');
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    const log2 = await hooksLog(logDir);
    assert.equal((log2.match(/session\.idle:seen/g) || []).length, 1, 'seen 只记一次');
  });

  // 根因回归(2026-09-16 审计#4, pi 侧 2026-09-13 同构实测): nudged/wroteFiles 声明在
  // server 工厂闭包里, session.created 不重置 → 同进程第二个会话继承 true, 永久静默。
  test('跨会话重置: 上会话已 nudge, 新 session.created 后同项目仍能再注入', async () => {
    const logDir = join(sandbox, 'log');
    const mod = await loadOc(logDir);
    const proj = await makeProject('oc-reset');
    const injected = [];
    const hooks = await mod.default.server({
      client: { session: { promptAsync: async (a) => injected.push(a) } },
      directory: proj,
    });
    // 会话1: 写 + idle → 注入一次并节流
    await hooks.event({ event: { type: 'session.created', properties: { sessionID: 's1' } } });
    await hooks['tool.execute.after']({ tool: 'edit' });
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    assert.equal(injected.length, 1, '会话1 应注入');
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    assert.equal(injected.length, 1, '会话1 节流');
    // 会话2 (同进程, 新 session.created): 必须重新计数, 而不是继承会话1的已nudge状态
    await hooks.event({ event: { type: 'session.created', properties: { sessionID: 's2' } } });
    await hooks['tool.execute.after']({ tool: 'edit' });
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's2' } } });
    assert.equal(injected.length, 2, '新会话必须重新注入(老代码继承 nudged=true 永久静默)');
    assert.equal(injected[1].path.id, 's2', '注入须指向新 session');
  });

  // 根因回归(2026-09-16 审计#2): loggedToday 旧判据只看「今天有没有行」,
  // `abs note`(kind=note) 也写 log.md → 沉淀一条经验就被当成「已收尾」, 整天不再提醒。
  // pi 侧已修(只认 dev|), 三宿主判据必须一致。
  test('今日只有 note 条目(kind=note)不算已收尾 → 仍注入', async () => {
    const logDir = join(sandbox, 'log');
    const mod = await loadOc(logDir);
    const proj = join(sandbox, 'oc-note-only');
    await fs.mkdir(join(proj, '.brain'), { recursive: true });
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    await fs.writeFile(join(proj, '.brain', 'log.md'),
      `# Activity Log\n## [${today} 10:00] [[x]] note | 沉淀了一条经验\n`, 'utf8');
    const injected = [];
    const hooks = await mod.default.server({
      client: { session: { promptAsync: async (a) => injected.push(a) } },
      directory: proj,
    });
    await hooks['tool.execute.after']({ tool: 'edit' });
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    assert.equal(injected.length, 1, 'note 条目不算收尾, 必须注入(旧判据会静默吞掉)');
  });
});

// ============================ CC/Co​dex Stop 收尾注入 ============================
// CC/Co​dex 的"主动推"只能走 Stop hook 的 stdout: 回 {"decision":"block","reason":...}
// 把 agent 拉回一轮。纯写 wrapup.log 只是记日志, agent 永远不会读到。
// 本层直接驱动渲染后的真实 shell hook, 断言 stdout 契约与四条件守卫。
describe('CC/Co​dex Stop hook 收尾注入 (decision:block)', () => {
  /** 按安装时的真实替换渲染 hook 脚本。 */
  async function renderHook(event) {
    const tpl = await fs.readFile(join(REPO, 'hooks', 'event.sh'), 'utf8');
    const src = tpl
      .replaceAll('__ABS_BIN__', CLI)
      .replaceAll('__NODE_BIN__', process.execPath)
      .replaceAll('__EVENT__', event);
    const p = join(sandbox, `hook-${event}.sh`);
    await fs.writeFile(p, src, 'utf8');
    await fs.chmod(p, 0o755);
    return p;
  }

  /** 以给定 payload 调 hook, 返回 stdout。 */
  function invoke(scriptPath, payload, env = {}) {
    return new Promise((resolve) => {
      const c = spawn('bash', [scriptPath], { cwd: sandbox, env: sbEnv(env) });
      let out = '';
      c.stdout.on('data', (d) => (out += d));
      c.stdin.end(payload);
      c.on('close', () => resolve(out.trim()));
    });
  }

  /** 造项目 + 带 Write 足迹的 transcript, 返回 Stop payload。 */
  async function makeStopCtx(name, { wrote = true, logToday = false, session = 'ses_A' } = {}) {
    const proj = await makeProject(name, logToday);
    const trans = join(sandbox, `${name}-trans.jsonl`);
    await fs.writeFile(trans, JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: wrote ? 'Write' : 'Read' }] },
    }) + '\n', 'utf8');
    return { proj, payload: JSON.stringify({ session_id: session, cwd: proj, transcript_path: trans }) };
  }

  test('条件全过 → echo decision:block 且 reason 含 abs 提示 (合法 JSON)', async () => {
    const h = await renderHook('Stop');
    const { payload } = await makeStopCtx('cc-push');
    const out = await invoke(h, payload, { ABS_MARK_DIR: join(sandbox, 'marks') });
    const j = JSON.parse(out); // 不合法宿主会告警
    assert.equal(j.decision, 'block', '必须 block 才能把 agent 拉回一轮');
    assert.match(j.reason, /\[abs\] 本会话改过文件/, 'reason 应是 abs 事实提示');
  });

  test('非 Stop 事件 → 放行 {}', async () => {
    const h = await renderHook('SessionStart');
    assert.equal(await invoke(h, '{}'), '{}', '非 Stop 一律放行');
  });

  test('纯只读会话不注入', async () => {
    const h = await renderHook('Stop');
    const { payload } = await makeStopCtx('cc-readonly', { wrote: false });
    assert.equal(await invoke(h, payload, { ABS_MARK_DIR: join(sandbox, 'm1') }), '{}');
  });

  test('log.md 今日已有条目 → 不注入', async () => {
    const h = await renderHook('Stop');
    const { payload } = await makeStopCtx('cc-done', { logToday: true });
    assert.equal(await invoke(h, payload, { ABS_MARK_DIR: join(sandbox, 'm2') }), '{}');
  });

  test('无 .brain 的项目不注入', async () => {
    const h = await renderHook('Stop');
    const nb = join(sandbox, 'cc-nobrain');
    await fs.mkdir(nb, { recursive: true });
    const payload = JSON.stringify({ session_id: 's', cwd: nb, transcript_path: join(sandbox, 'cc-push-trans.jsonl') });
    assert.equal(await invoke(h, payload, { ABS_MARK_DIR: join(sandbox, 'm3') }), '{}');
  });

  test('同 session 第二次 Stop 不重复注入 (每会话一次)', async () => {
    const h = await renderHook('Stop');
    const { payload } = await makeStopCtx('cc-once', { session: 'ses_ONCE' });
    const env = { ABS_MARK_DIR: join(sandbox, 'm4') };
    const first = await invoke(h, payload, env);
    assert.equal(JSON.parse(first).decision, 'block', '首次应注入');
    assert.equal(await invoke(h, payload, env), '{}', '同 session 已推过则不再打扰');
  });

  test('坏 payload 永不阻塞 (总是合法 JSON)', async () => {
    const h = await renderHook('Stop');
    const out = await invoke(h, 'not-json', { ABS_MARK_DIR: join(sandbox, 'm5') });
    assert.doesNotThrow(() => JSON.parse(out));
  });

  // 死循环防护 —— 本 hook 会回 decision:block 把 agent 拉回一轮, 而那一轮结束后
  // Stop 会再 fire。若守卫失效就是无限自激(官方 #55754 曾烧掉整个会话配额)。
  test('stop_hook_active=true → 绝不再推 (官方防重入字段)', async () => {
    const h = await renderHook('Stop');
    const { proj } = await makeStopCtx('cc-reentry');
    // 先确认确实是"条件全过"的上下文
    const on = JSON.stringify({ session_id: 'ses_R1', cwd: proj, transcript_path: join(sandbox, 'cc-reentry-trans.jsonl') });
    assert.equal(JSON.parse(await invoke(h, on, { ABS_MARK_DIR: join(sandbox, 'm6') })).decision, 'block', '前置: 应注入');
    const re = JSON.stringify({ session_id: 'ses_R2', cwd: proj, transcript_path: join(sandbox, 'cc-reentry-trans.jsonl'), stop_hook_active: true });
    assert.equal(await invoke(h, re, { ABS_MARK_DIR: join(sandbox, 'm7') }), '{}', 'stop_hook_active=true 必须放行');
  });

  // session_id 缺失时旧实现会"无节流"(if (sid) 整段跳过) → 每次 Stop 都注入 → 死循环。
  // 现退化为按 项目+日期 节流, 保证任何情况下都能自刹。
  test('缺 session_id 也不无节流 (退化为项目+日期节流)', async () => {
    const h = await renderHook('Stop');
    const { proj } = await makeStopCtx('cc-nosid');
    const payload = JSON.stringify({ cwd: proj, transcript_path: join(sandbox, 'cc-nosid-trans.jsonl') });
    const env = { ABS_MARK_DIR: join(sandbox, 'm8') };
    const first = await invoke(h, payload, env);
    assert.equal(JSON.parse(first).decision, 'block', '首次(无 id)仍应注入一次');
    assert.equal(await invoke(h, payload, env), '{}', '无 id 时第二次必须被项目级节流拦下(否则死循环)');
  });

  // 回归(2026-09-16 实测): event.sh 的幂等 mark 只写不删 ——
  // STAMP 是分钟级, 每分钟一个新文件, 永不回收 → 实测堆了 361 个。
  test('event.sh 幂等 mark 不堆积 (旧分钟的被清理)', async () => {
    const h = await renderHook('Stop');
    const markDir = join(sandbox, 'm-projkey');
    // 同名项目, 两个不同的父目录(模拟 tmpXXXX 不同)
    const mk = async (tag, name) => {
      const proj = join(sandbox, tag, name);
      await fs.mkdir(join(proj, '.brain'), { recursive: true });
      return proj;
    };
    const projA = await mk('tmpAAA', 'projx');
    const projB = await mk('tmpBBB', 'projx');
    const trA = join(sandbox, 'tr-a.jsonl');
    const trB = join(sandbox, 'tr-b.jsonl');
    await fs.writeFile(trA, '"Edit"');
    await fs.writeFile(trB, '"Edit"');

    const r1 = await invoke(h, JSON.stringify({ cwd: projA, transcript_path: trA }), { ABS_MARK_DIR: markDir });
    assert.equal(JSON.parse(r1).decision, 'block', '第一次应注入');
    // 另一个 tmp 下的同名项目: 节流应在【项目级】命中(因为无 session_id)
    const r2 = await invoke(h, JSON.stringify({ cwd: projB, transcript_path: trB }), { ABS_MARK_DIR: markDir });
    assert.equal(r2, '{}', '不同 tmp 的同名项目应被同一 key 节流');

    const marks = (await fs.readdir(markDir).catch(() => [])).filter((f) => f.endsWith('.mark'));
    // 同一分钟内不同 payload → 不同 FINGER, 各自合法 (幂等只保证"同一 payload 不重复")
    // 关键: 不得残留【非本分钟】的 mark。
    const hookMarks = marks.filter((f) => f.startsWith('abs-hook-'));
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
    const stale = hookMarks.filter((f) => !f.includes(stamp));
    assert.equal(stale.length, 0, `不应残留非本分钟 mark: ${stale.join(',')}`);
    assert.ok(hookMarks.length >= 1, '本分钟应有 mark');
  });

  // 日志轮转: hooks.log 是 append-only 热路径, 无上限会无限增长。
  test('hooks.log 超阈值 → 轮转成 .1 并截断', async () => {
    const logDir = join(sandbox, 'rot');
    await fs.mkdir(logDir, { recursive: true });
    await fs.writeFile(join(logDir, 'hooks.log'), 'x'.repeat(5000));
    const h = await renderHook('UserPromptSubmit');
    await invoke(h, '{}', { ABS_MARK_DIR: join(sandbox, 'm9'), ABS_LOG_DIR: logDir, ABS_LOG_MAX_BYTES: '1000' });
    const rotated = await fs.readFile(join(logDir, 'hooks.log.1'), 'utf8').catch(() => '');
    const now = await fs.readFile(join(logDir, 'hooks.log'), 'utf8');
    assert.equal(rotated.length, 5000, '旧内容应移到 .1');
    assert.ok(now.length < 5000, '当前 hooks.log 应已截断');
    assert.match(now, /logrotate/, '应留一行轮转痕迹便于事后解释');
  });

  test('未超阈值不动文件 (常见路径零副作用)', async () => {
    const logDir = join(sandbox, 'rot-small');
    await fs.mkdir(logDir, { recursive: true });
    const marker = 'KEEP-' + 'a'.repeat(50);
    await fs.writeFile(join(logDir, 'hooks.log'), marker);
    const h = await renderHook('UserPromptSubmit');
    await invoke(h, '{}', { ABS_MARK_DIR: join(sandbox, 'm10'), ABS_LOG_DIR: logDir, ABS_LOG_MAX_BYTES: '1000000' });
    const now = await fs.readFile(join(logDir, 'hooks.log'), 'utf8');
    assert.ok(now.startsWith(marker), '小文件应只追加、不移位/截断');
    assert.equal(await fs.readFile(join(logDir, 'hooks.log.1'), 'utf8').catch(() => null), null, '不应产生 .1');
  });
});

// ============================ 零宽字符守卫 ============================
// 本仓库高发坑: 'op​encode' 一词在源码里带 ZWSP(U+200B)。在**标识符**或**路径/参数**里
// 混入 ZWSP 会直接语法错、或让 CLI 认不出 agent 名。此处钉死"不带 ZWSP 的 agent 名必须可用",
// 防止再次出现 'op<ZWSP>encode' 这种认不出的写法。
describe('零宽字符守卫 (ZWSP)', () => {
  const ZWSP = String.fromCharCode(0x200b);

  test('CLI 识别不带 ZWSP 的 agent 名 (opencode/pi/codex/claude-code)', async () => {
    for (const a of ['opencode', 'pi', 'codex', 'claude-code']) {
      const r = await run(['install', '--agent', a, '--yes']);
      assert.equal(r.code, 0, `agent "${a}" 应被识别: ${r.stderr}`);
      assert.ok(!r.stderr.includes('未知 agent'), `agent "${a}" 不应是未知: ${r.stderr}`);
    }
  });

  test('生成的插件产物里, 标识符与路径参数不含 ZWSP', async () => {
    await run(['install', '--agent', 'opencode', '--yes']);
    await run(['install', '--agent', 'pi', '--yes']);
    const oc = await fs.readFile(join(sandbox, 'opencode', 'plugins', 'abs.ts'), 'utf8');
    const pi = await fs.readFile(join(sandbox, 'pi', 'agent', 'extensions', 'abs.ts'), 'utf8');
    for (const [name, src] of [['opencode', oc], ['pi', pi]]) {
      // 标识符/关键字/字符串字面量里不得有 ZWSP; 注释里的 ZWSP 无害(与仓库既有风格一致)
      const codeOnly = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      assert.ok(!codeOnly.includes(ZWSP), `${name} 代码行(非注释)不应含 ZWSP`);
    }
  });

  // 坑(2026-09-16 审计#3): 上两条只护输入侧与产物, 漏了「打印给用户」的字符串。
  // help 文本里的 op​encode/cl​aude-code 曾带 ZWSP → 用户复制到终端, CLI 报「未知 agent」。
  // 守卫靶子扩到输出侧: bin/abs.js 所有 console.* 行不得含真实 ZWSP 字节。
  test('用户可见输出(console.*)不含 ZWSP —— 复制不坏', async () => {
    const src = await fs.readFile(join(REPO, 'bin', 'abs.js'), 'utf8');
    const bad = src.split('\n')
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => /console\.(log|error|warn)/.test(l) && l.includes(ZWSP))
      .map(([n]) => n);
    assert.deepEqual(bad, [], `console 输出行含 ZWSP(复制即坏): 行 ${bad.join(', ')}`);
  });

  // 端到端: 帮助文本里列出的每个宿主名, 用户原样复制去 --agent 必须能被识别。
  // 这正是 ZWSP 坑的真实受害路径: 复制 help 里的 cl​aude-code → 「未知 agent」。
  test('帮助里的宿主名可复制直接使用 (end-to-end)', async () => {
    const h = await run(['help']);
    const line = h.stdout.split('\n').find((l) => l.includes('install') && l.includes('agent'));
    assert.ok(line, 'help 应有 install 行');
    // 新版帮助宿主名在 subUsage 里: abs install --help 的 --agent 行
    const sub = await run(['install', '--help']);
    const agentLine = sub.stdout.split('\n').find((l) => l.includes('只装一个宿主'));
    assert.ok(agentLine, `install --help 应有 --agent 行: ${sub.stdout.slice(0, 200)}`);
    const list = agentLine.split(':')[1].split('|').map((s) => s.trim()).filter(Boolean);
    assert.ok(list.length >= 3, `install --help 应列出宿主名: ${sub.stdout.slice(0, 200)}`);
    for (const a of list) {
      assert.ok(!a.includes(ZWSP), `宿主名 "${a}" 含 ZWSP, 用户复制必坏`);
    }
  });
});

// ---------- 插件模板源文件守卫 ----------
// 为什么需要: 模板原本是嵌在 install.js 里的模板字符串(671 行)，测试只能读"生成产物"
// 间接断言，模板本身写坏要在安装后才暴露。外置成真文件后可直测源文件，
// 且 @@占位符@@ 未替换会直接产出坏 TS（静默失效的一种），故在源头钉死。
describe('插件模板源文件 (hooks/*.ts)', () => {
  const TPL = {
    'abs.opencode.ts': { need: ['@@MARK@@'], forbid: ['@@ABS_BIN@@'] },
    'abs.pi.ts': { need: ['@@ABS_BIN@@', '@@MARK@@'], forbid: [] },
  };

  for (const [name, spec] of Object.entries(TPL)) {
    test(`${name} 存在且占位符齐备`, async () => {
      const p = join(REPO, 'hooks', name);
      const src = await fs.readFile(p, 'utf8');
      for (const k of spec.need) assert.ok(src.includes(k), `${name} 缺占位符 ${k}`);
      for (const k of spec.forbid) assert.ok(!src.includes(k), `${name} 不会用到 ${k}，不应出现`);
    });

    test(`${name} 占位符替换后语法可解析 (node --check)`, async () => {
      const p = join(REPO, 'hooks', name);
      const src = await fs.readFile(p, 'utf8');
      // 替换为合法值后语法检查 —— 占位符位残不符时会在这里炸出
      const filled = src
        .replace(/@@ABS_BIN@@/g, '/tmp/abs.js')
        .replace(/@@MARK@@/g, '// abs-managed');
      const tmp = join(sandbox, `chk-${name.replace(/[^\w.]/g, '_')}.mts`);
      await fs.writeFile(tmp, filled, 'utf8');
      const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${name} 替换后语法错误:\n${r.stderr}`);
    });
  }
});
