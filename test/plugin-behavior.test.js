// test/plugin-behavior.test.js — 插件**行为级**测试(非字符串断言)。
//
// 为什么单独一层: install.test.js 只做源码字符串断言, 而 op​encode 插件曾连中两坑
//   (① event 回调签名 ({name}) 错 ② export const 命名导出被加载器忽略) —— 两次字符串断言都过,
//   插件却从未触发。教训: "装上了" ≠ "加载了" ≠ "触发了", 必须真 import 生成的产物并驱动它。
//
// 本层直接 import 生成后的真实 .ts (Node 24 原生剥类型), 驱动真实事件序列, 断言:
//   1. 导出契约可被宿主加载 (pi: default 是函数; opencode: default.setup 是函数, v2 契约)
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

  // 2026-09-18: 收尾注入已停用 —— deliverAs:"followUp" 每轮 agent_end 抢一个 follow-up
  // turn, 用户实报「干到一半任务被打断」。埋点保留(证伪静默失效)。
  test('真改过文件 → 不再注入; 日志仍落痕; 节流状态不变', async () => {
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
    assert.equal(injected.length, 0, '不得再往对话里注入 follow-up 打断用户');
    const log = await hooksLog(logDir);
    assert.match(log, /pi:agent_end:seen/, '运维埋点须保留(区分事件没触发/被守卫拦下)');
    // 再触发仍不得注入
    await handlers.agent_end({ messages: [{ role: 'toolResult', toolName: 'write' }] }, { cwd: proj });
    assert.equal(injected.length, 0, '任何轮次都不得注入');
  });

  // ---- 以下一批用例(节流重置/并发竞态/多实例/素材拼装/note-vs-dev 判据)都在测
  // 「何时注入」。注入已停用(2026-09-18), 这些用例失去对象 → 整体删除, 不留
  // 无法失败的断言充数。守卫函数本身仍被 seen 埋点用例覆盖。

  test('今日已收尾的项目不注入', async () => {
    const mod = await loadPi(join(sandbox, 'log'));
    const { handlers, injected } = harness(mod.default);
    const proj = await makeProject('pi-done', true);
    await handlers.agent_end({ messages: [{ role: 'toolResult', toolName: 'edit' }] }, { cwd: proj });
    assert.equal(injected.length, 0, 'log.md 有今日 dev 记录则不再打扰');
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

  // ---- 开局 load 段「没走完就补」（2026-10-06 方案 A）----
  // 病根：标记原本在 before_agent_start 里就置了，而那个时点对话还没发出去。
  // 被 ESC/中断的那轮会把一次性标记烧掉且不回滚 → 之后永远 skip。
  // 判据：注入出的 [开工] 段（不是日志文本 —— 那只能证「代码跑过」，证不了「注入到了」）。
  describe('开局 load 段 送达确认', () => {
    /** 新会话 + 有图谱的项目，返回可驱动 before_agent_start 的上下文。
     *  每个用例独立 import 一次（模块级 flag 不跨 import 共享），避免用例间串状态。 */
    async function setupLoad(name, logDir) {
      const mod = await loadPi(logDir);
      const { handlers } = harness(mod.default);
      const proj = await makeProject(name);
      // 真实 .brain/todo.md，让 load 子进程有东西可读
      await fs.writeFile(join(proj, '.brain', 'todo.md'),
        '# Todo\n\n## Todo\n- [ ] t1 [[tester]] — 一条任务\n', 'utf8');
      const ctx = { cwd: proj };
      // session_start 重置 flag（真实宿主也会先发这个事件）
      await handlers.session_start({ reason: 'startup' }, { ...ctx, hasUI: false });
      // 驱动一轮 before_agent_start，返回本轮 [开工] 段推入与否。
      // dir 可覆盖 cwd —— 一个 pi 会话里 cwd 会随项目目录变（本插件的第二个坑）。
      const fireRound = async (dir = proj) => {
        const options = { promptGuidelines: [] };
        await handlers.before_agent_start({ prompt: 'hi', systemPromptOptions: options }, { cwd: dir });
        return options.promptGuidelines.filter((g) => g.startsWith('[开工] ')).length;
      };
      // 造第二个有图谱的项目（用于切目录用例）
      const makeOther = async (otherName) => {
        const other = await makeProject(otherName);
        await fs.writeFile(join(other, '.brain', 'todo.md'),
          '# Todo\n\n## Todo\n- [ ] t2 — 另一个项目的任务\n', 'utf8');
        return other;
      };
      return { handlers, fireRound, ctx, makeOther };
    }

    test('正常跑完一轮 → 注入一次，后续轮次不再注入', async () => {
      const { handlers, fireRound, ctx } = await setupLoad('pi-load-ok', join(sandbox, 'log'));
      assert.equal(await fireRound(), 1, '第一轮必须注入 [开工] 段');
      await handlers.agent_end({ messages: [] }, ctx); // 这轮真跑完 → 送达确认
      assert.equal(await fireRound(), 0, '已送达后不该重复注入');
    });

    test('★ 第一轮被中断(无 agent_end) → 第二轮必须补注入（本次回归点）', async () => {
      const logDir = join(sandbox, 'log-load-abort');
      const { fireRound, ctx } = await setupLoad('pi-load-abort', logDir);
      assert.equal(await fireRound(), 1, '第一轮注入');
      // 不调 agent_end —— 模拟 ESC / 中断掉的那轮
      assert.equal(await fireRound(), 1, '中断后必须补注入（改前这里是 0：标记已烧且不回滚）');
      const log = await hooksLog(logDir);
      assert.ok(!/load_delivered/.test(log), '没走完就不该有送达痕');
    });

    test('补注入的这轮跑完 → 之后才真正停', async () => {
      const logDir = join(sandbox, 'log-load-late');
      const { handlers, fireRound, ctx } = await setupLoad('pi-load-late', logDir);
      await fireRound();                 // 第一轮（将被中断）
      assert.equal(await fireRound(), 1, '补注入');
      await handlers.agent_end({ messages: [] }, ctx); // 这轮跑完了
      assert.equal(await fireRound(), 0, '送达后停');
      assert.match(await hooksLog(logDir), /load_delivered/, '送达必须有痕（可观测）');
    });

    test('边界: 新会话不得继承上一会话的已送达状态', async () => {
      const { handlers, fireRound, ctx } = await setupLoad('pi-load-sess', join(sandbox, 'log'));
      await fireRound();
      await handlers.agent_end({ messages: [] }, ctx); // 本会话送达
      assert.equal(await fireRound(), 0, '同会话内已停');
      await handlers.session_start({ reason: 'new' }, { ...ctx, hasUI: false }); // 开新会话
      assert.equal(await fireRound(), 1, '新会话必须重新摆一次开局状态');
    });

    // ★ 第二个 bug（2026-10-06 用户实报）：标记原是【会话级单值】，但 load 内容取自
    //   cwd/.brain/ —— 每个目录不同。任一目录拿到 load 后，其它目录全被永久跳过。
    //   日志干净复现：07:40:10 on@~/.agents → 07:40:17 delivered → 07:40:43 skip@agent_brain_sync
    test('★ 切目录必须重新注入（load 是按目录的，不能被别的目录烧掉标记）', async () => {
      const { handlers, fireRound, ctx, makeOther } = await setupLoad('pi-load-a', join(sandbox, 'log-cwd'));
      const other = await makeOther('pi-load-b');
      assert.equal(await fireRound(), 1, 'A 目录首轮注入');
      await handlers.agent_end({ messages: [] }, ctx); // A 送达
      assert.equal(await fireRound(), 0, 'A 目录已送达 → 同目录不再重复');
      // 切到 B 目录：改前这里是 0（B 看不到自己的 load），改后必须 1
      assert.equal(await fireRound(other), 1, '★ B 目录必须能拿到自己的 load（改前被 A 烧掉标记 → 0）');
      // 回 A：已达送 → 不再重复（证明“按目录”而非“一律重注”）
      assert.equal(await fireRound(), 0, '回到 A 不重复（避免每轮切来切去都重注）');
    });

    test('切目录后中断 → 那个目录仍要补注入（两条语义叠加）', async () => {
      const { handlers, fireRound, ctx, makeOther } = await setupLoad('pi-load-c', join(sandbox, 'log-cwd2'));
      const other = await makeOther('pi-load-d');
      await fireRound();
      await handlers.agent_end({ messages: [] }, ctx);   // A 送达
      assert.equal(await fireRound(other), 1, 'B 首轮注入');
      // 不调 agent_end —— B 这轮被 ESC/中断
      assert.equal(await fireRound(other), 1, 'B 没走完 → 下轮仍补（不得因“注入过”就当送达）');
      await handlers.agent_end({ messages: [] }, { cwd: other }); // B 这轮跑完
      assert.equal(await fireRound(other), 0, 'B 送达后才停');
    });
  });

  // ---- 首轮硬规则（方案 B，2026-10-06）----
  // 用户拍板：「开一个 pi 的第一次会话」除了 load，还要把 skill 里管「登记」的 3 条硬规则送一次。
  // 与常驻 6 条的区别：那 6 条每轮都在（已麻木），这 3 条只首轮出现一次。
  describe('首轮硬规则', () => {
    async function setup(name, logDir) {
      const mod = await loadPi(logDir);
      const { handlers } = harness(mod.default);
      const proj = await makeProject(name);
      const ctx = { cwd: proj };
      await handlers.session_start({ reason: 'startup' }, { ...ctx, hasUI: false });
      const fire = async () => {
        const options = { promptGuidelines: [] };
        await handlers.before_agent_start({ prompt: '帮我看看 git 历史', systemPromptOptions: options }, ctx);
        return options.promptGuidelines.filter((g) => g.startsWith('[开工规则] '));
      };
      return { handlers, fire, ctx };
    }

    test('★ 首轮送 3 条硬规则（含“先登记再动手”）', async () => {
      const { fire } = await setup('pi-rules-1', join(sandbox, 'log-rules'));
      const got = await fire();
      assert.equal(got.length, 1, '首轮必须送 [开工规则] 段');
      const text = got[0];
      // 三条都得在：① 先登记 ② 名字说清在干什么 ③ 不攒/超两轮即失控
      assert.match(text, /register it first/i, '① 先登记再动手');
      assert.match(text, /Before you touch any file/i, '① 必须早于碰文件');
      assert.match(text, /do not copy the user/i, '② 名字不抄原话');
      assert.match(text, /do not batch/i, '③ 不攒');
    });

    test('★ 只首轮送一次：送达后不再送（否则就变成噪音）', async () => {
      const { handlers, fire, ctx } = await setup('pi-rules-2', join(sandbox, 'log-rules'));
      assert.equal((await fire()).length, 1, '首轮送');
      await handlers.agent_end({ messages: [] }, ctx); // 送达
      assert.equal((await fire()).length, 0, '已达送 → 不再送（一次强提示，非常驻）');
    });

    test('中断那轮则下轮重送（与 load 同一机会）', async () => {
      const { fire } = await setup('pi-rules-3', join(sandbox, 'log-rules'));
      await fire(); // 被中断（无 agent_end）
      assert.equal((await fire()).length, 1, '没走完 → 下轮仍送');
    });

    test('开关：ABS_OPENING_RULES=0 可关掉', async () => {
      const prev = process.env.ABS_OPENING_RULES;
      process.env.ABS_OPENING_RULES = '0';
      try {
        const { fire } = await setup('pi-rules-4', join(sandbox, 'log-rules'));
        assert.equal((await fire()).length, 0, '关掉后不送');
      } finally {
        if (prev === undefined) delete process.env.ABS_OPENING_RULES; else process.env.ABS_OPENING_RULES = prev;
      }
    });
  });

  // ── hooks.log 轮转（2026-10-07）────────────────────────────
  //
  // 为何单独立一组：轮转逻辑原先只写在 hooks/event.sh 里（CC/Codex 那条路），
  // pi 这条路的 logHook 只 append、**没有轮转** —— 实测已攼到 1.22MB 而无人发觉。
  // 「靠一个副本里的逻辑保护另一条路径」是本项目反复踩的坑类。
  //
  // 这些用例驱动**真实插件代码**（写日志走真实的 logHook），不看源码字符串。
  //
  // ⚠ 隔离：不能先写好日志再调 loadPi —— loadPi 内部会跑 `abs install`，
  //   而 install 会重设 ABS_LOG_DIR，导致写入跑到别处（实测踩过：
  //   .1 里成了新日志、旧内容不变），看着像轮转 bug，实为测试环境串了。
  //   故改为：装一次插件拿 factory，每个用例自己建环境、自定 ABS_LOG_DIR。
  describe('hooks.log 轮转', () => {
    const cleanEnv = () => { delete process.env.ABS_LOG_MAX_BYTES; };

    /** 装一次 pi 插件（拿真实 factory），由各用例自己指定日志目录。 */
    async function piFactory() {
      await run(['install', '--agent', 'pi', '--yes']);
      const p = join(sandbox, 'pi', 'agent', 'extensions', 'abs.ts');
      return (await importTs(p)).default;
    }

    /** 在指定日志目录跑一次 session_start（触发真实 logHook）。 */
    async function fireWithLogDir(factory, logDir) {
      const prev = process.env.ABS_LOG_DIR;
      process.env.ABS_LOG_DIR = logDir;
      try {
        const handlers = {};
        factory({ on: (e, f) => { handlers[e] = f }, sendUserMessage: () => {} });
        await handlers.session_start({}, { cwd: sandbox });
        // logHook 是 fire-and-forget，等它落盘
        await new Promise((r) => setTimeout(r, 300));
      } finally {
        if (prev === undefined) delete process.env.ABS_LOG_DIR; else process.env.ABS_LOG_DIR = prev;
      }
    }

    test('超限 → 轮转成 .1，并重新开始写', async () => {
      const factory = await piFactory();
      const logDir = join(sandbox, 'log-rotate-1');
      await fs.mkdir(logDir, { recursive: true });
      const big = 1048576 + 100; // 略高于默认 1 MiB
      await fs.writeFile(join(logDir, 'hooks.log'), 'x'.repeat(big));

      await fireWithLogDir(factory, logDir);

      const rolled = await fs.readFile(join(logDir, 'hooks.log.1'), 'utf8').catch(() => null);
      assert.ok(rolled, '应生成 hooks.log.1');
      assert.equal(rolled.length, big, '.1 应原样保留旧内容（不是被截断/覆盖）');
      assert.ok(rolled.startsWith('xxxx'), '.1 应是那份旧日志（全是 x）');

      const now = await hooksLog(logDir);
      assert.ok(now.length < 4096, `新日志应重新开始（实际 ${now.length} 字节）`);
      assert.match(now, /session_start/, '轮转后仍要写本轮日志');
      cleanEnv();
    });

    test('未超限 → 不轮转，内容追加', async () => {
      const factory = await piFactory();
      const logDir = join(sandbox, 'log-rotate-2');
      await fs.mkdir(logDir, { recursive: true });
      await fs.writeFile(join(logDir, 'hooks.log'), '[old] 上次的行\n');

      await fireWithLogDir(factory, logDir);

      assert.equal(await fs.readFile(join(logDir, 'hooks.log.1'), 'utf8').catch(() => null), null, '不应轮转');
      const now = await hooksLog(logDir);
      assert.match(now, /上次的行/, '旧内容应保留（append 而非覆盖）');
      assert.match(now, /session_start/, '新行应追加');
      cleanEnv();
    });

    test('ABS_LOG_MAX_BYTES 可覆盖阈值', async () => {
      const factory = await piFactory();
      const logDir = join(sandbox, 'log-rotate-3');
      await fs.mkdir(logDir, { recursive: true });
      await fs.writeFile(join(logDir, 'hooks.log'), 'y'.repeat(2048));

      process.env.ABS_LOG_MAX_BYTES = '1024'; // 调小，2048 字节就超了
      try {
        await fireWithLogDir(factory, logDir);
        assert.ok(
          await fs.readFile(join(logDir, 'hooks.log.1'), 'utf8').catch(() => null),
          '调小阈值后 2048 字节应触发轮转'
        );
      } finally {
        cleanEnv();
      }
    });

    test('并发写入不丢旧日志（跨 await 竞态的回归）', async () => {
      // 为何单独立这条（2026-10-07）：去除串行队列时，上面三个用例仍然全绿 ——
      //   竞态是时序敏感的，单次触发不一定撞上（破坏验证实测：并发竞态没被抳住）。
      //   而它的后果是**静默丢历史**：A 刚 rename 完，B 把小文件又移成 .1，
      //   盖掉真正的 1MiB 旧日志。故这里用并发触发把它确定性撞出来。
      const factory = await piFactory();
      const logDir = join(sandbox, 'log-rotate-4');
      await fs.mkdir(logDir, { recursive: true });
      const big = 1048576 + 5000;
      await fs.writeFile(join(logDir, 'hooks.log'), 'x'.repeat(big));

      const prev = process.env.ABS_LOG_DIR;
      process.env.ABS_LOG_DIR = logDir;
      try {
        const handlers = {};
        factory({ on: (e, f) => { handlers[e] = f }, sendUserMessage: () => {} });
        // 并发触发多次（不等前一个完成）—— 真实场景下 logHook 就是 fire-and-forget
        await Promise.all(
          Array.from({ length: 5 }, () => handlers.session_start({}, { cwd: sandbox }))
        );
        await new Promise((r) => setTimeout(r, 500));
      } finally {
        if (prev === undefined) delete process.env.ABS_LOG_DIR; else process.env.ABS_LOG_DIR = prev;
      }

      const rolled = await fs.readFile(join(logDir, 'hooks.log.1'), 'utf8').catch(() => null);
      assert.ok(rolled, '并发下仍应生成 .1');
      assert.equal(rolled.length, big, '并发下 .1 必须仍是被替换的那份旧日志（不能被后续写覆盖）');
      assert.ok(rolled.startsWith('xxxx'), '.1 应是旧内容（全是 x）');
      cleanEnv();
    });
  });
});

// ============================ op​encode ============================
describe('op​encode 插件 行为级', () => {

// opencode v2: setup(api) 里订阅事件, 不再返回 hooks 对象。
// 测试沿用"拿到一个 dispatch(event) 函数"的写法, 这里做等价适配。
async function ocDispatch(mod, { directory, logDir: _logDir, injected } = {}) {
  const handlers = [];
  const api = {
    event: { subscribe: (fn) => handlers.push(fn) },
    location: { directory },
    client: injected ? { session: { promptAsync: async (a) => injected.push(a) } } : undefined,
  };
  await mod.default.setup(api);
  return (type) => handlers[0]({ type, properties: { sessionID: 's1' } });
}

  async function loadOc(logDir) {
    await run(['install', '--agent', 'opencode', '--yes']);
    const p = join(sandbox, 'opencode', 'plugins', 'abs.ts');
    return importTsWithLog(p, logDir);
  }

  test('导出契约: 有 default 且 default.setup 是函数 (opencode v2 契约)', async () => {
    const mod = await loadOc(join(sandbox, 'log'));
    assert.ok('default' in mod, '必须有 default 导出(加载器取 default)');
    // opencode v2 只认 { id, effect } 或 { id, setup }; v1 的 { id, server } 已移除,
    // 用 server 会让插件加载失败并在 TUI 报 "Plugin failed"。
    assert.equal(typeof mod.default.setup, 'function', 'default.setup 必须是函数(v2 契约)');
    assert.equal(mod.default.id, 'abs');
    assert.equal(mod.default.server, undefined, 'v1 的 server 字段不得残留');
    assert.ok(!mod.AbsPlugin, '不应存在命名导出 AbsPlugin');
  });

  // 2026-09-18: 收尾注入已停用(用户实报「干活干一会就中断」), 连同 tool.execute.after
  // (唯一用途是给注入置 wroteFiles) 一起删除。插件现在只剩 event 一个钩子。
  test('setup 只注册 event 订阅一个通道(注入相关的 tool.execute.after 已删除)', async () => {
    const mod = await loadOc(join(sandbox, 'log'));
    const proj = await makeProject('oc-hooks');
    const handlers = [];
    await mod.default.setup({
      event: { subscribe: (fn) => handlers.push(fn) },
      location: { directory: proj },
    });
    assert.equal(handlers.length, 1, '只应注册一个事件订阅');
    assert.equal(typeof handlers[0], 'function');
  });

  test('任何事件都不得注入; session.idle 留 seen 痕; 事件名不得 undefined', async () => {
    const logDir = join(sandbox, 'log');
    const mod = await loadOc(logDir);
    const proj = await makeProject('oc-write');
    const injected = [];
    const dispatch = await ocDispatch(mod, { directory: proj, injected });
    await dispatch('session.created');
    await dispatch('session.idle');
    await dispatch('session.idle');
    await dispatch('session.deleted');
    assert.equal(injected.length, 0, '不得再往对话里注入打断用户');
    const log = await hooksLog(logDir);
    assert.match(log, /session\.created/, 'session.created 应落痕');
    assert.match(log, /session\.idle:seen/, 'idle 应留 seen 痕(区分未触发/被拦下)');
    assert.equal((log.match(/session\.idle:seen/g) || []).length, 1, 'seen 只记一次');
    assert.ok(!log.includes('undefined'), '事件名不得是 undefined(曾因 ({name}) 签名错)');
  });

  test('新 session.created 重置埋点状态 (否则第二个会话永久不留痕)', async () => {
    const logDir = join(sandbox, 'log');
    const mod = await loadOc(logDir);
    const proj = await makeProject('oc-reset');
    const dispatch = await ocDispatch(mod, { directory: proj });
    await dispatch('session.created');
    await dispatch('session.idle');
    await dispatch('session.created');
    await dispatch('session.idle');
    const log = await hooksLog(logDir);
    assert.equal((log.match(/session\.idle:seen/g) || []).length, 2, '每个会话各留一次 seen 痕');
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
    // 不同 payload → 不同 FINGER, 各自合法 (幂等只保证"同一 payload 不重复")。
    //
    // 2026-09-17 改：旧断言查"mark 名里含本分钟 STAMP"，那是在断言**旧命名方案本身**。
    // 命名前缀时间戳正是 bug 根源（跨分钟→mark 路径变→幂等失效，窗口从 60s 退化为 1s），
    // 已改为"mark 名含指纹 + 内置时间戳"。故这里改断**意图**：不得堆积超龄 mark。
    // 判据用 mark 文件内的时间戳（新方案），不依赖名字或平台日期工具。
    const hookMarks = marks.filter((f) => f.startsWith('abs-hook-'));
    assert.ok(hookMarks.length >= 1, '本次应有 mark');
    const nowSec = Math.floor(Date.now() / 1000);
    const stale = [];
    for (const f of hookMarks) {
      const raw = (await fs.readFile(join(markDir, f), 'utf8')).trim();
      const ts = Number(raw);
      // 非数字（旧格式/损坏）或超龄 60s → 都算该清未清
      if (!Number.isFinite(ts) || ts <= 0 || nowSec - ts >= 60) stale.push(`${f}(${raw})`);
    }
    assert.equal(stale.length, 0, `不应残留超龄 mark: ${stale.join(',')}`);
    // 回归：本测试的命门是"跨分钟也保持幂等"，故断言 mark 名**不含分钟戳**
    // （含了就是旧命名回来了，窗口会退化为 1s）。
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
    assert.ok(!hookMarks.some((f) => f.includes(stamp)),
      `mark 名不得含分钟戳（跨分钟会破坏 60s 幂等）: ${hookMarks.join(',')}`);
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

// ---------------------------------------------------------------------------
// todo 面板（2026-10-03）：解析 + 渲染。
// 这一层是纯函数测试 —— 面板的 bug 都在“解析/截断/结构符”里，不需要驱 UI。
// 下列用例都是审查时真实发现的缺陷，锁住它们（不是为盖率而写）。
describe('pi 扩展 todo 面板 解析与渲染', () => {
  async function loadPanelFns() {
    await run(['install', '--agent', 'pi', '--yes']);
    const p = join(sandbox, 'pi', 'agent', 'extensions', 'abs.ts');
    return importTsWithLog(p, join(sandbox, 'log'));
  }

  // ===== 会话 id 注入（2026-10-09）=====
  // 为何要测：todo 行尾的 `(认领 日期 <sid>)` 要 LLM 自己填，
  // 而它填的值来自这里注入的 sid（用户原话：「sid 让 llm 自己给答案吧」）。
  // 注入断了 = LLM 根本不知道自己的 sid = 功能静默失效。
  test('★ 注入本会话 sid（LLM 登记时要拿这个值）', async () => {
    const { injectSessionGuideline, SESSION_MARK } = await loadPanelFns();
    const opts = {};
    assert.equal(injectSessionGuideline(opts, '01a11eae'), true);
    const line = opts.promptGuidelines.find((g) => g.startsWith(SESSION_MARK));
    assert.ok(line, '必须注入');
    assert.ok(line.includes('01a11eae'), '必须含真实 sid');
  });

  test('★ 取不到 sid 时不注入（不写空值、不伪造）', async () => {
    const { injectSessionGuideline, SESSION_MARK } = await loadPanelFns();
    const opts = {};
    assert.equal(injectSessionGuideline(opts, ''), false);
    assert.equal(opts.promptGuidelines.filter((g) => g.startsWith(SESSION_MARK)).length, 0);
  });

  test('★ 每轮替换不叠加（与看板段同构）', async () => {
    const { injectSessionGuideline, SESSION_MARK } = await loadPanelFns();
    const opts = {};
    injectSessionGuideline(opts, 'aaa');
    injectSessionGuideline(opts, 'bbb');
    const hits = opts.promptGuidelines.filter((g) => g.startsWith(SESSION_MARK));
    assert.equal(hits.length, 1, '应替换而非堆叠');
    assert.ok(hits[0].includes('bbb'));
  });

  // 看板解析必须能吃下带 sid 的 `(认领 日期 sid)` ——
  // 原正则写死了 \d{4}-\d{2}-\d{2}，多一个 sid 就整个不匹配，desc 会带上整段。
  test('★ 带 sid 的认领段必须被剥干净（desc 不留残渣）', async () => {
    const { parseOpenTasks } = await loadPanelFns();
    const md = [
      '## Todo',
      '- [ ] T1 [[fanchao]] — 描述 (认领 2026-10-09 01a11eae)',
      '- [ ] T2 [[fanchao]] — 无会话描述 (认领 2026-10-09)',
    ].join('\n');
    const r = parseOpenTasks(md, 10, 'fanchao');
    assert.equal(r.rows[0].desc, '描述', `带 sid 时 desc 应干净: ${JSON.stringify(r.rows[0].desc)}`);
    assert.equal(r.rows[1].desc, '无会话描述', '无 sid 时 desc 同样干净');
  });

  // ★ 看板必须显示会话归属（2026-10-09 实测发现的真缺口）——
  //   写进 todo 的 sid 若不在看板上露出来，LLM 就分不清「哪条是自己的」，
  //   功能实际是断的（原实现把整个 (认领 …) 连 sid 一起剥掉了）。
  test('★ 看板标出会话归属：本会话 / 别的会话 / 公海', async () => {
    const { boardGuideline } = await loadPanelFns();
    const md = [
      '## Todo',
      '- [ ] mine [[fanchao]] — 我的 (认领 2026-10-09 01a11ea9)',
      '- [ ] other [[fanchao]] — 别人的 (认领 2026-10-09 01a11f2a)',
      '- [ ] free [[fanchao]] — 公海的 (认领 2026-10-09)',
    ].join('\n');
    const g = boardGuideline(md, 'fanchao', [], '01a11ea9');
    assert.ok(g.includes('[本会话]'), `自己的要标本会话: ${g}`);
    assert.ok(g.includes('[会话 01a11f2a]'), `别人的要标出 sid: ${g}`);
    const freeLine = g.split('\n').find((l) => l.includes('free'));
    assert.ok(!freeLine.includes('[会话'), `公海的不该带会话标: ${freeLine}`);
  });

  test('★ 没有 mySid（降级）时不标「本会话」，但别人的仍标出 sid', async () => {
    const { boardGuideline } = await loadPanelFns();
    const md = ['## Todo', '- [ ] other [[fanchao]] — 别人的 (认领 2026-10-09 01a11f2a)'].join('\n');
    const g = boardGuideline(md, 'fanchao', [], '');
    assert.ok(!g.includes('[本会话]'), `无 mySid 不该认领: ${g}`);
    assert.ok(g.includes('[会话 01a11f2a]'), '别人的 sid 仍要露出来');
  });

  test('作者过滤：显示自己的 + 无作者的，隐藏别人的', async () => {
    const { parseOpenTasks } = await loadPanelFns();
    const md = [
      '## Todo',
      '- [ ] mine [[fanchao]] — 我的',
      '- [ ] other [[bob]] — 别人的',
      '- [ ] bare — 没标作者',
      '## Done',
      '- [x] finished [[fanchao]] — 已完成不计',
    ].join('\n');
    const r = parseOpenTasks(md, 10, 'fanchao');
    const ids = r.rows.map((t) => t.id);
    assert.deepEqual(ids, ['mine', 'bare'], `应只显示自己的+无作者的: ${JSON.stringify(ids)}`);
  });

  // 审查发现的真 bug：原先边解析边过滤，被滤掉的条目下方的断点会挂到它上面那条。
  test('断点不串台：别人的断点不挂到我的任务下', async () => {
    const { parseOpenTasks } = await loadPanelFns();
    const md = [
      '## Todo',
      '- [ ] mine-a [[fanchao]] — 我的任务A',
      '- [ ] other-b [[bob]] — 别人的任务',
      '  ↳ 断点: 这是别人的断点',
      '- [ ] mine-c [[fanchao]] — 我的任务C',
    ].join('\n');
    const r = parseOpenTasks(md, 10, 'fanchao');
    const a = r.rows.find((t) => t.id === 'mine-a');
    assert.equal(a.note, '', `mine-a 不该拿到别人的断点: ${a.note}`);
  });

  test('自己的断点正确归到自己名下', async () => {
    const { parseOpenTasks } = await loadPanelFns();
    const md = [
      '## Todo',
      '- [ ] mine-a [[fanchao]] — 我的',
      '  ↳ 断点: 改到 hooks/abs.pi.ts:120',
    ].join('\n');
    const r = parseOpenTasks(md, 10, 'fanchao');
    assert.match(r.rows[0].note, /hooks\/abs\.pi\.ts:120/);
  });

  test('断点行不单独计为一条任务', async () => {
    const { parseOpenTasks } = await loadPanelFns();
    const md = ['## Todo', '- [ ] a', '  ↳ 断点: x', '- [ ] b'].join('\n');
    assert.equal(parseOpenTasks(md, 10, '').total, 2);
  });

  // ★ 对齐（用户 2026-10-05 定）：注入给 LLM 的看板 与 面板显示 必须一致。
  //   两者都走 parseOpenTasks（同源），但渲染不同 —— 这条钉住「渲染别漏东西」。
  //   实测踩过：首版 guidelines 漏了断点（对齐了也接不上），且 desc 空时拖个空破折号。
  test('guidelines 与面板对齐：任务/状态/断点三项都在', async () => {
    const { boardGuideline } = await loadPanelFns();
    const md = [
      '## Todo',
      '- [ ] [进行中] t1 [[fanchao]] — 第一件事',
      '  ↳ 断点: 改到 src/x.js',
      '- [ ] [讨论中] t2 [[fanchao]]',
    ].join('\n');
    const g = boardGuideline(md, 'fanchao');
    assert.ok(g, '看板非空时应返回内容');
    for (const frag of ['t1', '进行中', '第一件事', 'src/x.js', 't2', '讨论中']) {
      assert.ok(g.includes(frag), `guidelines 应含 ${frag}:\n${g}`);
    }
    // desc 为空时不拖空破折号（MCP 只给 id 时常见）
    assert.ok(!/t2 —\s*$/m.test(g), `t2 无描述时不该拖空破折号:\n${g}`);
  });

  // ★ 2026-10-06 改契约：看板空曾经 return null（不注入）。现已改为**摆出「（空）」这个事实**——
  //   原因：开工那一刻（用户说第一句话、filesSeen 还空）恰是看板空的时候，=那正是最该对齐的时刻
  //   却什么都不注入。日志 todo_guide=on 掩盖了它（那个 on 只表示六条常驻指引装了）。
  test('看板空仍摆出「（空）」这个事实（不是提醒，只是别让开工那刻没东西可看）', async () => {
    const { boardGuideline } = await loadPanelFns();
    const g = boardGuideline('## Todo\n## Done\n', 'fanchao');
    assert.ok(g, '看板空也该输出（「空」是事实）');
    assert.ok(g.includes('（空'), `空看板应标明（空）:\n${g}`);
    // 2026-10-06：空看板要说完整（有图谱但零任务）—— 只摆「（空）」会被读成「一切正常」，
    // 用户实报就是因此动手没登记。降级成旧的裸「（空）」该被这条拦住。
    assert.ok(/本目录有.*图谱/.test(g) && /一条未完成任务都没有/.test(g),
      `空看板应说清「有图谱、零任务」而不是只摆「（空）」:\n${g}`);
    // 纯事实：不得夹带劝告/催促（那是被删过三次的「提醒」路线）。
    // 2026-10-06 实测踩过：曾写「若本次要改这个项目，先把它登成一条任务」—— 就是劝告。
    assert.ok(!/记得|别忘了|请登记|应该登记|先把它登成/.test(g), `不得夹带劝告:\n${g}`);
  });

  // 作者过滤（另一件事，与本页改动无关）：别人的任务不算我的 → 不注入。
  // 单独立一条，别被上面「空看板」的改动顺手带走。
  test('全是别人的任务时不注入（作者过滤）', async () => {
    const { boardGuideline } = await loadPanelFns();
    assert.equal(boardGuideline('## Todo\n- [ ] x [[fanchao]]', 'bob'), null, '别人的任务不算');
  });

  // ★ 反复对齐（用户 2026-10-05 定）：「对齐永远是反反复复的，不厌其烦」。
  //   但反复注入不能堆叠，且看板变了要换、空了要清 —— 否则对齐撒谎。
  test('反复对齐：不堆叠 / 变了就换 / 空了清干净', async () => {
    const { boardGuideline, injectTodoGuidelines } = await loadPanelFns();
    const mk = (md) => boardGuideline(md, 'fanchao');
    const boards = (o) => o.promptGuidelines.filter((g) => g.startsWith('[看板] '));
    const opts = { promptGuidelines: [] };

    // ① 同一轮/相邻轮反复注入：只保留一份（反复是工作方式，不是堆叠）
    injectTodoGuidelines(opts, mk('## Todo\n- [ ] [进行中] t1 [[fanchao]] — 干活\n'));
    injectTodoGuidelines(opts, mk('## Todo\n- [ ] [进行中] t1 [[fanchao]] — 干活\n'));
    assert.equal(boards(opts).length, 1, `反复注入应只留一份:\n${JSON.stringify(boards(opts))}`);

    // ② 看板变了：旧快照必须换掉（换而不是追加）
    injectTodoGuidelines(opts, mk('## Todo\n- [ ] [进行中] t2 [[fanchao]] — 新活\n'));
    assert.ok(boards(opts)[0].includes('t2') && !boards(opts)[0].includes('t1'),
      `应换成新看板:\n${boards(opts)[0]}`);

    // ③ 看板空了：旧快照必须清掉（曾只清非空分支 → 残留旧任务，对齐撒谎）
    injectTodoGuidelines(opts, null);
    assert.equal(boards(opts).length, 0, '看板空后不该残留旧看板');

    // ④ 再次有活：能重新注入
    injectTodoGuidelines(opts, mk('## Todo\n- [ ] [进行中] t3 [[fanchao]] — 又来\n'));
    assert.equal(boards(opts).length, 1);
    assert.ok(boards(opts)[0].includes('t3'));

    // 静态 6 条始终在（不被看板挤掉）
    assert.equal(opts.promptGuidelines.length - boards(opts).length, 6,
      '静态指引条数应恒为 6');
  });

  test('宽度截断：CJK 按 2 列，永不溢出且尾部有省略号', async () => {
    const { renderPanelLines } = await loadPanelFns();
    const fg = (c, s) => `\x1b[2m${s}\x1b[0m`;
    const data = {
      total: 2,
      rows: [
        { state: '进行中', id: 'a', desc: '中文描述测试', note: '' },
        { state: '进行中', id: 'b', desc: 'x'.repeat(200), note: '很长的断点内容'.repeat(10) },
      ],
      hidden: 0,
    };
    const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const dw = (s) => {
      let w = 0;
      for (const ch of strip(s)) {
        const cp = ch.codePointAt(0) || 0;
        const wide = (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0x1f300 && cp <= 0x1f64f);
        w += wide ? 2 : 1;
      }
      return w;
    };
    for (const width of [40, 80, 120]) {
      const lines = renderPanelLines(data, 'me', width, fg);
      for (const l of lines) {
        assert.ok(dw(l) <= width, `width=${width} 溢出(${dw(l)}): ${strip(l)}`);
      }
    }
  });

  // 审查发现的视觉 bug：末条带断点时原本全篇没有 └─ 收尾，看着像被截断。
  test('结构符：末条永远用 └─（即使它带断点），其他用 ├─', async () => {
    const { renderPanelLines } = await loadPanelFns();
    const fg = (c, s) => s;
    const data = {
      total: 2,
      rows: [
        { state: '进行中', id: 'a', desc: 'A', note: '' },
        { state: '进行中', id: 'b', desc: 'B', note: 'B 的断点' },
      ],
      hidden: 0,
    };
    const lines = renderPanelLines(data, 'me', 80, fg);
    const taskLines = lines.filter((l) => l.includes('[进行中]'));
    assert.ok(taskLines[0].startsWith('├─'), `首条应 ├─: ${taskLines[0]}`);
    assert.ok(taskLines[1].startsWith('└─'), `末条（带断点）应 └─: ${taskLines[1]}`);
  });

  test('上描边满宽（不得留余量，否则右侧缺一块）', async () => {
    const { renderPanelLines } = await loadPanelFns();
    // 用真 ANSI 包装模拟 pi 的 theme.fg
    const fg = (c, s) => `\x1b[38;5;240m${s}\x1b[0m`;
    const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const data = { total: 1, rows: [{ state: '进行中', id: 'x', desc: 'd', note: '' }], hidden: 0 };
    for (const w of [40, 80, 120]) {
      const line = renderPanelLines(data, 'me', w, fg, 0, '')[0];
      const got = [...strip(line)].length;
      // 对齐 pi 自己的 DynamicBorder："─".repeat(Math.max(1, width))
      assert.equal(got, w, `width=${w} 描边应满宽，实际 ${got}（差了 ${w - got} 列）`);
    }
  });

  // ★ 2026-10-06 用户要求反转了旧行为：「即便 todo 没有列表，也要在 pi 上显示」。
  //   旧行为（空→不渲染任何行→面板自动隐藏）已作废。
  //   理由：一进 pi 就看不见面板 = 不知道 abs 活着没（跟「看不到 load」同一类问题）。
  test('空任务列表 → 仍渲染框+标题+（无未完成任务）一行', async () => {
    const { renderPanelLines } = await loadPanelFns();
    const lines = renderPanelLines({ total: 0, rows: [], hidden: 0 }, 'me', 80, (c, s) => s);
    assert.ok(lines.length > 0, '空看板也要画面板（不得返回空数组）');
    const text = lines.join('\n');
    assert.ok(text.includes('📋 todo'), `标题要在:\n${text}`);
    assert.ok(text.includes('（无未完成任务）'), `要摆明“无任务”这个事实:\n${text}`);
    // 纯事实：不得夹带劝告（「记得登记」那类已被 13 次尝试证明无效）。
    assert.ok(!/记得|别忘了|请登记|应该登记/.test(text), `不得夹带劝告:\n${text}`);
  });

  // 动画（2026-10-03 用户需求）：三个小符依次由空心变实心，只给「进行中」的行。
  test('动画：只有「进行中」行带三帧符，其余不带', async () => {
    const { renderPanelLines } = await loadPanelFns();
    const fg = (c, s) => s;
    const data = {
      total: 2,
      rows: [
        { state: '进行中', id: 'doing', desc: '干活', note: '' },
        { state: '滞留中', id: 'wait', desc: '等着', note: '' },
      ],
      hidden: 0,
    };
    const lines = renderPanelLines(data, 'me', 80, fg, 0);
    const doing = lines.find((l) => l.includes('doing'));
    const wait = lines.find((l) => l.includes('wait'));
    assert.match(doing, /[○●]{3}/, `进行中行应有三符动画: ${doing}`);
    assert.ok(!/[○●]{3}/.test(wait), `滞留中行不该有动画: ${wait}`);
  });

  test('动画：animPhase=-1 时完全不显示（开关作用）', async () => {
    const { renderPanelLines } = await loadPanelFns();
    const fg = (c, s) => s;
    const data = { total: 1, rows: [{ state: '进行中', id: 'x', desc: '', note: '' }], hidden: 0 };
    const lines = renderPanelLines(data, 'me', 80, fg, -1);
    assert.ok(!/[○●]{3}/.test(lines.join('\n')), '关闭时不该出现动画符');
  });

  // 昵称（2026-10-03 用户需求）：用户给定的俏皮话池里随机抽，附在作者名后。
  test('昵称：随机抽取且确定性可测（注入 rnd）', async () => {
    const { pickNickname } = await loadPanelFns();
    const first = pickNickname(() => 0);
    const last = pickNickname(() => 0.999999);
    assert.ok(first.length > 0 && last.length > 0, '应都抽到非空');
    assert.notEqual(first, last, '边界应取到不同条目');
    assert.equal(pickNickname(() => 0.5), pickNickname(() => 0.5), '同一 rnd 应得同一结果（确定性）');
    for (let i = 0; i < 200; i++) {
      const n = pickNickname();
      assert.ok(typeof n === 'string' && n.length > 0, `第 ${i} 次抽到空值`);
    }
  });

  // 审查发现（2026-10-03）：原池子正文长 9-15 字，标题会被窄终端截断。
  // 用户定下 4-8 字，并把池子扩到 50+ 条。两条不变式都锁住。
  test('昵称池：每条以 emoji 开头，正文 4-8 字，总条数 50+', async () => {
    const { pickNickname } = await loadPanelFns();
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(pickNickname());
    assert.ok(seen.size >= 50, `池子应有 50+ 条: ${seen.size}`);
    // 每条 = emoji + 空格 + 正文
    const badEmoji = [...seen].filter((s) => !/^\p{Extended_Pictographic}/u.test(s));
    assert.equal(badEmoji.length, 0, `以下条目缺 emoji: ${badEmoji.join(' | ')}`);
    const badLen = [...seen].filter((s) => {
      const body = s.replace(/^\p{Extended_Pictographic}[\uFE0F\u200D\s]*/u, '').trim();
      const n = [...body].length;
      return n < 4 || n > 8;
    });
    assert.equal(badLen.length, 0, `以下条目正文不在 4-8 字: ${badLen.join(' | ')}`);
  });

  test('昵称：ABS_TODO_NICK=0 时关掉', async () => {
    const { pickNickname } = await loadPanelFns();
    const old = process.env.ABS_TODO_NICK;
    process.env.ABS_TODO_NICK = '0';
    try {
      assert.equal(pickNickname(), '', '开关开时应返回空串');
    } finally {
      if (old === undefined) delete process.env.ABS_TODO_NICK;
      else process.env.ABS_TODO_NICK = old;
    }
  });

  test('昵称：附在作者名后，窄宽度不溢出', async () => {
    const { renderPanelLines } = await loadPanelFns();
    const fg = (c, s) => s;
    const data = { total: 1, rows: [{ state: '进行中', id: 'x', desc: '', note: '' }], hidden: 0 };
    const nick = '📞 听到电话铃响就窒息的接听恐惧症';
    const wide = renderPanelLines(data, 'fanchao', 200, fg, -1, nick)[1];
    assert.match(wide, /fanchao/, '应含作者名');
    assert.match(wide, /接听恐惧症/, `应含昵称: ${wide}`);
    const narrow = renderPanelLines(data, 'fanchao', 40, fg, -1, nick);
    const strip2 = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const dw2 = (s) => {
      let w = 0;
      for (const ch of strip2(s)) {
        const cp = ch.codePointAt(0) || 0;
        const wideCh = (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0x1f300 && cp <= 0x1f64f);
        w += wideCh ? 2 : 1;
      }
      return w;
    };
    for (const l of narrow) assert.ok(dw2(l) <= 40, `窄宽度溢出(${dw2(l)}): ${strip2(l)}`);
    const plain = renderPanelLines(data, 'fanchao', 200, fg, -1, '')[1];
    assert.ok(!plain.includes('·'), `无昵称不该有分隔符: ${plain}`);
  });

  test('动画帧：6 帧循环且每帧宽度固定（不拖宽面板）', async () => {
    const { todoAnimFrame } = await loadPanelFns();
    const seq = [];
    for (let p = 0; p < 6; p++) {
      const f = todoAnimFrame(p);
      assert.equal([...f].length, 3, `帧应为 3 列: ${f}`);
      seq.push(f);
    }
    // 不断言“6 帧各不相同” —— 帧序列含回退（呼吸感），本就该有重复元素。
    // 断言真实意图：起点全空心、中途全实心、且确实在变化。
    assert.equal(seq[0], '○○○', `首帧应全空心: ${seq[0]}`);
    assert.ok(seq.includes('●●●'), `应有一帧全实心: ${seq.join(',')}`);
    assert.ok(new Set(seq).size >= 3, `帧应有变化: ${seq.join(',')}`);
    // 循环：第 7 帧回到第 1 帧
    assert.equal(todoAnimFrame(6), todoAnimFrame(0), '应循环回第 0 帧');
    // 负数相位不该抛（防御）
    assert.equal([...todoAnimFrame(-1)].length, 3);
  });
});

// ============================ pi 扩展: 面板生命周期 ============================
// 注: 本组原为「hook 侧自动登记」的测试，该功能已于 v1.15.2 整体移除
//   （用户实报"卡顿 + 看板冒出大量 auto-TBD-xxx 待命名"：agent_end 每轮 spawn
//   一个 node 进程、占位条目直接写看板）。设计教训见 concept
//   auto-todo-register-design 的"为什么最后删掉自动登记"。
//   此处只保留仍然有效的【面板重绘】修复。
describe('pi 扩展 面板重绘', () => {
  /** 造一个项目并装扩展。 */
  async function setupPanel() {
    const proj = join(sandbox, 'panel-proj');
    await fs.rm(proj, { recursive: true, force: true });
    await fs.mkdir(join(proj, '.brain'), { recursive: true });
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    await fs.writeFile(join(proj, '.brain', 'index.md'), '# idx\n', 'utf8');
    await fs.writeFile(join(proj, '.brain', 'log.md'), `# log\n\n## [${day} 00:00] dev | x\n`, 'utf8');
    await fs.writeFile(join(proj, '.brain', 'todo.md'), '# todo\n\n## Todo\n\n## Done\n', 'utf8');
    await run(['install', '--agent', 'pi', '--yes']);
    const mod = await importTsWithLog(
      join(sandbox, 'pi', 'agent', 'extensions', 'abs.ts'), join(sandbox, 'log'));
    const handlers = {};
    mod.default({ on: (e, f) => { (handlers[e] ||= []).push(f) }, getActiveTools: () => [] });
    return { proj, handlers, ctx: { cwd: proj, sessionManager: { getSessionId: () => 'p1' } } };
  }

  test('任务全完成后面板消失，且主动请求重绘（否则屏幕冻结在旧帧）', async () => {
    // 实报坑(2026-10-05): 任务标完后面板仍显示"进行中", 按 ESC/重启才正常。
    // 根因: 唯一重绘入口是动画定时器; "全部完成"→ needAnim=false → stopAnimTimer()
    //   → 从此无人请求重绘 → 数据清了但屏幕没刷。消失路径必须自己 requestRender。
    // 面板按作者过滤（currentUser 读 ABS_USER / 配置）—— 定住它，否则面板被滤空。
    process.env.ABS_USER = 'tester';
    const { proj, handlers, ctx } = await setupPanel();
    await fs.writeFile(join(proj, '.brain', 'todo.md'),
      '# todo\n\n## Todo\n- [ ] [进行中] t1 [[tester]] — 干点活\n\n## Done\n', 'utf8');

    let renders = 0, widget = 'unset';
    // 模拟真实 pi：setWidget 传 factory 时宿主会调它（tui 引用由此进入扩展）。
    const ui = {
      setWidget: (k, v) => {
        widget = v === undefined ? 'hidden' : 'shown';
        if (typeof v === 'function') v({ requestRender: () => { renders++; } }, { fg: (c, s) => s });
      },
    };
    const c = { ...ctx, ui };
    await handlers['turn_end'][0]({}, c);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(widget, 'shown', '有任务时面板应显示');

    await fs.writeFile(join(proj, '.brain', 'todo.md'),
      '# todo\n\n## Todo\n\n## Done\n### 2026-10-05\n- [x] t1 【落地】\n', 'utf8');
    const before = renders;
    await handlers['turn_end'][0]({}, c);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(widget, 'shown', '任务清空后面板仍要显示（2026-10-06 改；旧行为是隐藏）');
    assert.ok(renders > before, `重绘仍必须发生（否则屏幕不刷）: ${before} → ${renders}`);
  });
});

