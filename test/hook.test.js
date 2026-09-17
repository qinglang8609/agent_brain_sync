// test/hook.test.js — 端到端 hook (hooks/event.sh 模板) 深度测试。
// 覆盖: 模板占位符替换、payload stdin → 技术日志落盘、stdout 以 { 开头(宿主契约)、
//       fire-and-forget 不阻塞、同一 payload 60s 内幂等只落一行、无图谱静默不崩。
// 隔离: 以沙盒 $HOME 起 /bin/sh 子进程; hook 日志落 $HOME/.abs/log/hooks.log, 不碰真实 ~/.abs。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVENT_TEMPLATE = join(REPO, 'hooks', 'event.sh');

let sandbox;
let HOME;
let MARK_DIR; // 沙盒内幂等 mark 目录, 注入 ABS_MARK_DIR 隔离(不碰真实 /tmp, 防残留互扰)

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-hook-'));
  HOME = join(sandbox, 'home');
  MARK_DIR = join(sandbox, 'marks');
  await fs.mkdir(HOME, { recursive: true });
  await fs.mkdir(MARK_DIR, { recursive: true });
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

/** 把模板渲染成沙盒里的可执行 hook 脚本(替换占位符, 指向真实 bin), 返回脚本路径。 */
async function renderHook(event, payloadHookOpts = {}) {
  const tpl = await fs.readFile(EVENT_TEMPLATE, 'utf8');
  const script = join(sandbox, `abs-${event}.sh`);
  let s = tpl
    .replaceAll('__ABS_BIN__', join(REPO, 'bin', 'abs.js'))
    .replaceAll('__NODE_BIN__', process.execPath)
    .replaceAll('__EVENT__', event);
  await fs.writeFile(script, s, 'utf8');
  await fs.chmod(script, 0o755);
  return script;
}

/** 以 stdin 喂 payload 跑 hook, 返回 {code, stdout, stderr}。 */
function runHook(script, payload) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', [script], {
      env: { ...process.env, HOME, ABS_MARK_DIR: MARK_DIR },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
    child.stdin.write(payload);
    child.stdin.end();
  });
}

const LOG_FILE = () => join(HOME, '.abs', 'log', 'hooks.log');

// ---------- 端到端: payload → 技术日志 ----------
describe('hook: 事件落技术日志', () => {
  test('SessionStart payload 写入 hooks.log, stdout 以 { 开头', async () => {
    const script = await renderHook('SessionStart');
    const r = await runHook(script, '{"session_id":"s1","prompt":"hi"}');
    assert.equal(r.code, 0);
    assert.ok(r.stdout.trim().startsWith('{'), `stdout 应以 { 开头: ${JSON.stringify(r.stdout)}`);
    // 等后台子进程写完日志
    await new Promise((res) => setTimeout(res, 300));
    const log = await fs.readFile(LOG_FILE(), 'utf8');
    assert.ok(log.includes('SessionStart'), log);
    assert.ok(log.includes('session_id'), `应含 payload 摘要: ${log}`);
    // 时间戳前缀：日志靠它排序/定位。2026-09-17 实测发现这里没锁 ——
    // 把 event.sh 的 date 输出删掉，本文件 5 条测试全绿（缺口真实存在）。
    // 故对整行断言格式，而不是只 includes 事件名。
    const line = log.split('\n').filter((l) => l.includes('] SessionStart ')).pop();
    assert.ok(line, `应有 SessionStart 事件行: ${log}`);
    assert.match(
      line,
      /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] SessionStart /,
      `行首应为 [YYYY-MM-DD HH:MM:SS] 时间戳: ${JSON.stringify(line)}`,
    );
  });

  test('payload 截断到 120 字符(长输入不刷爆)', async () => {
    const script = await renderHook('UserPromptSubmit');
    const long = 'x'.repeat(5000);
    await runHook(script, long);
    await new Promise((res) => setTimeout(res, 300));
    const log = await fs.readFile(LOG_FILE(), 'utf8');
    const line = log.split('\n').filter((l) => l.includes('UserPromptSubmit')).pop();
    assert.ok(line.length <= 160, `行应截断: ${line.length}`);
  });

  test('同一 payload 60s 内幂等: 跑两次只落一行', async () => {
    const script = await renderHook('Stop');
    await runHook(script, '{"reason":"user_interrupt"}');
    await new Promise((res) => setTimeout(res, 200));
    await runHook(script, '{"reason":"user_interrupt"}');
    await new Promise((res) => setTimeout(res, 300));
    const log = await fs.readFile(LOG_FILE(), 'utf8');
    const hits = log.split('\n').filter((l) => l.includes('{"reason":"user_interrupt"') && l.includes('Stop'));
    assert.equal(hits.length, 1, `幂等应只落 1 行, 实际 ${hits.length}:\n${log}`);
  });

  test('幂等身份不得含分钟时间：跨分钟仍能认出同一 payload', async () => {
    // 回归 2026-09-17 实测定根因：旧实现把 mark 名钉在 STAMP=$(date +%Y%m%d%H%M)（分钟级）上，
    // 于是两次调用只要**跨过分钟边界**，mark 路径就不同 → 幂等失效 → 落 2 行。
    // 文档与测试都承诺「60s 内幂等」，而实际窗口最坏退化为 **1 秒**。
    // 这是 `同一 payload 60s 内幂等` 那条偶发失败的真因（不是测试写得不好）。
    //
    // 为何不直接等一分钟：测试不该等 60s。
    // 为何不能只改 mark 内容：旧代码**不读内容**（身份在文件名里），改了等于没改，测试会假通过
    //   （实测确认：只改内容时旧代码下本测试仍全绿）——故这里改断**身份方案本身**。
    // 判据：同一 payload 的 mark 身份必须与墙上时间无关，否则跨分钟必重复。
    const script = await renderHook('Stop');
    const payload = '{"reason":"cross-minute"}';
    await runHook(script, payload);
    await new Promise((res) => setTimeout(res, 300));
    const marks = (await fs.readdir(MARK_DIR)).filter((f) => f.startsWith('abs-hook-'));
    assert.ok(marks.length >= 1, `应有 mark: ${marks.join(',')}`);
    // 命门断言：mark 名不得包含分钟级时间戳。
    // 旧代码名形如 abs-hook-<finger>-<YYYYMMDDHHmm>.mark → 每过一分钟就换一个身份。
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const minuteStamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
    assert.ok(!marks.some((f) => f.includes(minuteStamp)),
      `mark 身份不得含分钟戳（否则跨分钟破坏 60s 幂等）: ${marks.join(',')}`);
    // 且身份必须只由 payload 指纹决定：同一 payload 反复调用应始终指向同一个 mark
    const before = marks.slice().sort().join(',');
    await runHook(script, payload);
    await new Promise((res) => setTimeout(res, 300));
    const after = (await fs.readdir(MARK_DIR)).filter((f) => f.startsWith('abs-hook-')).sort().join(',');
    assert.equal(after, before, `同一 payload 的 mark 身份应稳定不变: ${before} → ${after}`);
  });

  test('超过 60s 的 mark 允许再记（窗口不能无限大）', async () => {
    // 与上一条成对：只验“不重复”会漏掉“永远不再记”的反向失效。
    const script = await renderHook('Stop');
    const payload = '{"reason":"expired"}';
    await runHook(script, payload);
    await new Promise((res) => setTimeout(res, 300));
    const marks = (await fs.readdir(MARK_DIR)).filter((f) => f.startsWith('abs-hook-'));
    for (const m of marks) {
      await fs.writeFile(join(MARK_DIR, m), String(Math.floor(Date.now() / 1000) - 61));
    }
    await runHook(script, payload);
    await new Promise((res) => setTimeout(res, 300));
    const log = await fs.readFile(LOG_FILE(), 'utf8');
    const hits = log.split('\n').filter((l) => l.includes(payload) && l.includes('Stop')).length;
    assert.equal(hits, 2, `超龄后应可再记: ${hits} 行\n${log}`);
  });

  test('不同 payload 各落一行', async () => {
    const script = await renderHook('UserPromptSubmit');
    await runHook(script, '{"text":"prompt-A"}');
    await runHook(script, '{"text":"prompt-B"}');
    await new Promise((res) => setTimeout(res, 300));
    const log = await fs.readFile(LOG_FILE(), 'utf8');
    assert.ok(log.includes('prompt-A') && log.includes('prompt-B'), log);
  });

  test('无图谱也静默成功(技术日志独立于 .brain, 不因缺项目崩)', async () => {
    // HOME 里无任何项目图谱 —— hook 只写 ~/.abs/log, 不调 abs CLI 定位
    const script = await renderHook('SessionStart');
    const r = await runHook(script, '{}');
    assert.equal(r.code, 0, r.stderr);
    await new Promise((res) => setTimeout(res, 300));
    await fs.access(LOG_FILE());
  });
});
