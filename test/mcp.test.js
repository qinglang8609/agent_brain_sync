// test/mcp.test.js — MCP server (bin/mcp.js) 深度测试。
// 覆盖: stdio JSON-RPC 握手、8 个工具转接调用、无 .brain 时 isError 语义、
//       多项目隔离(resolve 定位正确项目)、未知 action 报错。
// 隔离: 每用例临时项目目录; mcp 以沙盒 cwd 起子进程, ABS_LOG=0 不写真 ~/.abs。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const MCP = join(REPO, 'bin', 'mcp.js');
const ABS = join(REPO, 'bin', 'abs.js');

let sandbox;
let projA;
let projB;
let child = null;
let nextId = 1;

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-mcp-'));
  projA = join(sandbox, 'proj-a');
  projB = join(sandbox, 'proj-b');
  await fs.mkdir(join(projA, 'sub', 'deep'), { recursive: true });
  await fs.mkdir(join(projB, 'sub'), { recursive: true });
});

afterEach(async () => {
  if (child) { try { child.kill(); } catch {} child = null; }
  await fs.rm(sandbox, { recursive: true, force: true });
});

async function startServer(cwd, envOverride = {}) {
  child = spawn(process.execPath, [MCP], {
    cwd: cwd || sandbox,
    env: { ...process.env, ABS_LOG: '0', ABS_USER: 'tester', ABS_CONFIG_DIR: join(sandbox, 'abs-cfg'), ...envOverride },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // 丢弃 stderr(不干扰); 等待子进程起来
  child.stderr.on('data', () => {});
  // MCP 无就绪信号, 用 initialize 握手兜底
}

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const req = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    let buf = '';
    const timeout = setTimeout(() => reject(new Error(`超时: ${method}`)), 5000);
    const onData = (d) => {
      buf += d;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === id) {
          clearTimeout(timeout);
          child.stdout.off('data', onData);
          resolve(msg);
        }
      }
    };
    child.stdout.on('data', onData);
    child.stdin.write(req);
  });
}

async function initHandshake() {
  await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'abs-test', version: '1' },
  });
}

function textOf(resp) {
  return resp?.result?.content?.[0]?.text ?? '';
}

/** 调一个 MCP 工具（tools/call）。tools 调用必须走标准协议 method，而非直呼工具名。 */
function tool(name, args = {}) {
  return call('tools/call', { name, arguments: args });
}

/** 用 abs CLI 在 proj 建图谱。 */
async function initBrain(proj) {
  await new Promise((res) => {
    const c = spawn(process.execPath, [ABS, 'init', '--dir', proj]);
    c.on('close', () => res());
  });
}

// ---------- 握手 + 工具清单 ----------
describe('mcp: 握手 + 工具清单', () => {
  test('initialize + tools/list 返回 8 个工具', async () => {
    await startServer();
    await initHandshake();
    const r = await call('tools/list', {});
    const names = (r.result?.tools || []).map((t) => t.name);
    for (const n of ['abs_board', 'abs_load', 'abs_status', 'abs_task', 'abs_query', 'abs_lint', 'abs_note', 'abs_resolve_project']) {
      assert.ok(names.includes(n), `缺工具 ${n}`);
    }
  });
});

// ---------- resolve_project 定位 ----------
describe('mcp: resolve_project', () => {
  test('只看当前目录: 子目录不再向上穿透', async () => {
    await initBrain(projA);
    await startServer();
    const r = await tool('abs_resolve_project', { cwd: join(projA, 'sub', 'deep') });
    assert.ok(textOf(r).includes('abs init'), `子目录不应命中祖先图谱: ${textOf(r)}`);
  });

  test('无图谱给提示(不抛错)', async () => {
    await startServer();
    const r = await tool('abs_resolve_project', { cwd: projB });
    assert.ok(textOf(r).includes('abs init'), textOf(r));
  });
});

// ---------- 工具调用 (proj-a 有图谱) ----------
describe('mcp: 工具调用', () => {
  beforeEach(async () => {
    await initBrain(projA);
    await startServer(projA);
  });

  test('abs_task start → abs_board 反映任务', async () => {
    await tool('abs_task', { action: 'start', id: 'M1', note: '做 M', cwd: projA });
    const b = await tool('abs_board', { cwd: projA });
    assert.ok(textOf(b).includes('M1'), textOf(b));
  });

  test('abs_task done 归位 Done', async () => {
    await tool('abs_task', { action: 'start', id: 'MD', note: 'x', cwd: projA });
    await tool('abs_task', { action: 'done', id: 'MD', cwd: projA });
    const b = await tool('abs_board', { cwd: projA });
    assert.ok(/Done/.test(textOf(b)), textOf(b));
  });

  test('abs_note 落 sources; abs_query 可检索', async () => {
    await tool('abs_note', { text: 'MCP 专属经验 xyzq9', cwd: projA });
    const q = await tool('abs_query', { terms: ['xyzq9'], cwd: projA });
    assert.ok(textOf(q).includes('xyzq9') || /命中/.test(textOf(q)), textOf(q));
  });

  test('abs_lint 健康图谱 0 问题', async () => {
    const r = await tool('abs_lint', { cwd: projA });
    assert.ok(/0/.test(textOf(r)), textOf(r));
  });

  test('abs_load 返回 index+todo+log 三段', async () => {
    const r = await tool('abs_load', { cwd: projA });
    assert.ok(textOf(r).includes('Graph Index') && textOf(r).includes('Todo'), textOf(r));
  });

  test('abs_task 未知 action → isError', async () => {
    const r = await tool('abs_task', { action: 'nope', id: 'M', cwd: projA });
    assert.ok(r.result?.isError || r.error, JSON.stringify(r));
  });
});

// ---------- 无 .brain 项目 / 隔离 ----------
describe('mcp: 无图谱与隔离', () => {
  test('proj-b 无图谱: abs_board isError 且提示 abs init', async () => {
    await startServer(projB);
    const r = await tool('abs_board', { cwd: projB });
    assert.ok(r.result?.isError, '无图谱应 isError');
    assert.ok(textOf(r).includes('abs init'), textOf(r));
  });

  test('proj-b 深处不误命中兄弟 proj-a', async () => {
    await initBrain(projA); // 只有 A 有 .brain
    await startServer(sandbox);
    // proj-b 向上走: proj-b → sandbox → /tmp..., 不会横跳 proj-a
    const r = await tool('abs_board', { cwd: join(projB, 'sub') });
    assert.ok(r.result?.isError, `proj-b 不应命中 proj-a: ${textOf(r)}`);
  });
});

// ---------- 请求跟踪日志 (mcp.log) ----------
// 回归: withTrace 曾定义了但 9 处工具都没包它 → mcp.log 从不生成。
// 症状是"少了个日志"(无报错、无异常), 静默缺失藏了很久, 故用测试钉死。
describe('mcp: 请求跟踪日志 (mcp.log)', () => {
  test('每次工具调用写一行 (含 tool/耗时/结果)', async () => {
    const logDir = join(sandbox, 'mcplog');
    await fs.mkdir(logDir, { recursive: true });
    await initBrain(projA);
    await startServer(projA, { ABS_LOG_DIR: logDir, ABS_LOG: '1' });
    await tool('abs_board', { cwd: projA });
    // 等日志落盘(追加写是异步的)
    let text = '';
    for (let i = 0; i < 20 && !text; i++) {
      await new Promise((r) => setTimeout(r, 50));
      text = await fs.readFile(join(logDir, 'mcp.log'), 'utf8').catch(() => '');
    }
    assert.ok(text.includes('tool=abs_board'), `mcp.log 应记录工具名: ${text}`);
    assert.ok(/OK \d+ms/.test(text), `应记录耗时与结果: ${text}`);
  });

  test('失败调用也留痕 (isError → ERR)', async () => {
    const logDir = join(sandbox, 'mcplog2');
    await fs.mkdir(logDir, { recursive: true });
    await startServer(sandbox, { ABS_LOG_DIR: logDir, ABS_LOG: '1' });
    // 无 .brain 的项目 → isError
    await tool('abs_board', { cwd: projB });
    let text = '';
    for (let i = 0; i < 20 && !text; i++) {
      await new Promise((r) => setTimeout(r, 50));
      text = await fs.readFile(join(logDir, 'mcp.log'), 'utf8').catch(() => '');
    }
    assert.ok(/tool=abs_board .*ERR/.test(text), `失败也应留痕: ${text}`);
  });
});
