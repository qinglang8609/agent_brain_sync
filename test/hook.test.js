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

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-hook-'));
  HOME = join(sandbox, 'home');
  await fs.mkdir(HOME, { recursive: true });
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
      env: { ...process.env, HOME },
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
