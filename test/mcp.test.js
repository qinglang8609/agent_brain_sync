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
// 一个用例内可能多次 startServer(覆盖 child), 只 kill 最后一个会漏掉前一个 →
// 泄漏的 mcp.js 留着 stdin 不放, node --test 等它退出 → 整个测试进程挂死。
// 故全部登记, afterEach 统一收尸。
let children = [];
let nextId = 1;

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-mcp-'));
  projA = join(sandbox, 'proj-a');
  projB = join(sandbox, 'proj-b');
  await fs.mkdir(join(projA, 'sub', 'deep'), { recursive: true });
  await fs.mkdir(join(projB, 'sub'), { recursive: true });
});

afterEach(async () => {
  for (const c of children) { try { c.kill(); } catch {} }
  children = [];
  child = null;
  await fs.rm(sandbox, { recursive: true, force: true });
});

async function startServer(cwd, envOverride = {}) {
  child = spawn(process.execPath, [MCP], {
    cwd: cwd || sandbox,
    env: {
      ...process.env, ABS_LOG: '0', ABS_USER: 'tester',
      ABS_CONFIG_DIR: join(sandbox, 'abs-cfg'),
      // 库也要隔离（2026-11-05）：abs_search 走 ~/.abs/graph.db，
      // 而多个测试文件并行跑时会同时 rebuild 同一个库 → "database is locked"。
      // 默认落到沙盒，需要真库的测试用 envOverride 显式覆盖。
      ABS_DB: join(sandbox, 'graph.db'),
      ...envOverride,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // 丢弃 stderr(不干扰); 等待子进程起来
  child.stderr.on('data', () => {});
  children.push(child);
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
  test('initialize + tools/list 暴露核心工具（含 abs_concept）', async () => {
    await startServer();
    await initHandshake();
    const r = await call('tools/list', {});
    const names = (r.result?.tools || []).map((t) => t.name);
    for (const n of ['abs_load', 'abs_status', 'abs_task', 'abs_query', 'abs_lint', 'abs_note', 'abs_concept', 'abs_resolve_project']) {
      assert.ok(names.includes(n), `缺工具 ${n}`);
    }
  });

  // abs_concept: 只给结构不给内容（判断不自动化）。
  test('abs_concept 建出带「验证」段的骨架并登记 index', async () => {
    await initBrain(projA);
    await startServer();
    await initHandshake();
    const r = await tool('abs_concept', { slug: 'mcp-concepted', title: 'MCP 建的页', cwd: projA });
    assert.ok(textOf(r).includes('mcp-concepted'), textOf(r));
    const body = await fs.readFile(join(projA, '.brain', 'concepts', 'mcp-concepted.md'), 'utf8');
    assert.ok(body.includes('## 验证'), `骨架该有验证段: ${body}`);
    assert.ok(body.includes('## 触发场景'), `骨架该有触发场景: ${body}`);
    const idx = await fs.readFile(join(projA, '.brain', 'index.md'), 'utf8');
    assert.ok(idx.includes('[[mcp-concepted]]'), `应登记进 index: ${idx}`);
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

  test('abs_task start → abs_load 的看板段反映任务', async () => {
    await tool('abs_task', { action: 'start', id: 'M1', note: '做 M', cwd: projA });
    const b = await tool('abs_load', { cwd: projA });
    assert.ok(textOf(b).includes('M1'), textOf(b));
  });

  // ===== 会话 id 走 MCP（2026-10-09）=====
  // ★ 为何必须测：LLM 平时就是用 MCP 工具认领任务的（不会去敲 CLI）。
  //   若 schema 不收 session，prompt 里摆的 sid 就白摆了 —— 功能对 LLM 基本失效。
  //   （本项目已有同类教训：schema 漏字段 → 传了也被静默丢掉，见下面 as 那条。）
  // 新格式（2026-11-16）：会话是行尾的方括号标签，不再是 `(认领 日期 sid)`。
  test('★ abs_task start 带 session → 行尾写会话标签', async () => {
    await tool('abs_task', { action: 'start', id: 'MS', note: '多会话', cwd: projA, session: '01a11eae' });
    const md = await fs.readFile(join(projA, '.brain', 'todo.md'), 'utf8');
    assert.match(md, /\[01a11eae\]\s*$/m, md);
  });

  test('★ 不传 session → 不带会话标签', async () => {
    await tool('abs_task', { action: 'start', id: 'MN', note: '无会话', cwd: projA });
    const md = await fs.readFile(join(projA, '.brain', 'todo.md'), 'utf8');
    const line = md.split('\n').find((l) => l.includes('[MN]'));
    assert.ok(line && !/\[[0-9a-f]{8}-/.test(line), `不该凭空编会话: ${line}`);
  });

  test('★ MCP 路径：done 保留登记时的会话标签（谁收尾看 log）', async () => {
    await tool('abs_task', { action: 'start', id: 'MT', note: 'A 的任务', cwd: projA, session: '01a11eae' });
    await tool('abs_task', { action: 'done', id: 'MT', note: 'B 收尾', as: '落地', cwd: projA, session: '01a11f2a' });
    const md = await fs.readFile(join(projA, '.brain', 'todo.md'), 'utf8');
    const line = md.split('\n').find((l) => l.includes('[MT]'));
    assert.match(line, /\[01a11eae\]/, `登记者标签: ${md}`);
    assert.ok(!/01a11f2a/.test(line), `行上只留一个会话标签: ${line}`);
  });

  test('abs_task done 归位 Done', async () => {
    await tool('abs_task', { action: 'start', id: 'MD', note: 'x', cwd: projA });
    await tool('abs_task', { action: 'done', note: '做完', id: 'MD', cwd: projA });
    const b = await tool('abs_load', { cwd: projA });
    assert.ok(/Done/.test(textOf(b)), textOf(b));
  });

  // ★ 2026-11-09：子项也能标四态（LLM 走 MCP，不走 CLI）。
  //   与 session 那条同一类风险：schema 收了 n 但调用处不传 → 静默失效。
  test('★ abs_task state + n → 改第 n 条子项的状态', async () => {
    await tool('abs_task', { action: 'start', id: 'MCS', note: '主任务', cwd: projA });
    await tool('abs_task', { action: 'note', id: 'MCS', note: '子项一', cwd: projA });
    await tool('abs_task', { action: 'note', id: 'MCS', note: '子项二', cwd: projA });
    await tool('abs_task', { action: 'state', id: 'MCS', note: '滞留中', n: 2, cwd: projA });
    const md = await fs.readFile(join(projA, '.brain', 'todo.md'), 'utf8');
    assert.match(md, /^ {2}- \[-\] .*子项二/m, `第 2 条子项应带标记（[-]）:\n${md}`);
    assert.match(md, /^ {2}- \[ \] .*子项一/m, `第 1 条不该被动:\n${md}`);
    // 不带 n = 改任务本身
    await tool('abs_task', { action: 'state', id: 'MCS', note: '搁置', cwd: projA });
    const md2 = await fs.readFile(join(projA, '.brain', 'todo.md'), 'utf8');
    assert.ok(/^- \[~\]/m.test(md2) && md2.includes('[MCS]'), `不带 n 应改任务（[~] = 搁置）:\n${md2}`);
    assert.match(md2, /^ {2}- \[-\] .*子项二/m, md2);
  });

  // 2026-11-16：结语（【落地/否决/仅方案】）与 as 已取消 —— 传了不落盘、也不报错。
  test('abs_task done 的 note/as 不再落盘（结语已取消）', async () => {
    const read = async () => await fs.readFile(join(projA, '.brain', 'todo.md'), 'utf8');
    await tool('abs_task', { action: 'start', id: 'MA', note: 'x', cwd: projA });
    const r1 = await tool('abs_task', { action: 'done', id: 'MA', note: '验证: 全绿', cwd: projA });
    assert.ok(!r1.result?.isError, JSON.stringify(r1));
    const t = await read();
    const line = t.split('\n').find((l) => l.includes('[MA]'));
    assert.ok(line.startsWith('- [x]'), line);
    assert.ok(!/验证: 全绿|【/.test(line), `结语不该落盘: ${line}`);
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

  test('abs_load 返回 未完成+用法+log 三段', async () => {
    const r = await tool('abs_load', { cwd: projA });
    assert.ok(textOf(r).includes('未完成') && textOf(r).includes('用法') && textOf(r).includes('log.md'), textOf(r));
  });

  test('abs_task 未知 action → isError', async () => {
    const r = await tool('abs_task', { action: 'nope', id: 'M', cwd: projA });
    assert.ok(r.result?.isError || r.error, JSON.stringify(r));
  });
});

// ---------- 无 .brain 项目 / 隔离 ----------
describe('mcp: 无图谱与隔离', () => {
  test('proj-b 无图谱: abs_load isError 且提示 abs init', async () => {
    await startServer(projB);
    const r = await tool('abs_load', { cwd: projB });
    assert.ok(r.result?.isError, '无图谱应 isError');
    assert.ok(textOf(r).includes('abs init'), textOf(r));
  });

  test('proj-b 深处不误命中兄弟 proj-a', async () => {
    await initBrain(projA); // 只有 A 有 .brain
    await startServer(sandbox);
    // proj-b 向上走: proj-b → sandbox → /tmp..., 不会横跳 proj-a
    const r = await tool('abs_load', { cwd: join(projB, 'sub') });
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
    await tool('abs_load', { cwd: projA });
    // 等日志落盘(追加写是异步的)
    let text = '';
    for (let i = 0; i < 20 && !text; i++) {
      await new Promise((r) => setTimeout(r, 50));
      text = await fs.readFile(join(logDir, 'mcp.log'), 'utf8').catch(() => '');
    }
    assert.ok(text.includes('tool=abs_load'), `mcp.log 应记录工具名: ${text}`);
    assert.ok(/OK \d+ms/.test(text), `应记录耗时与结果: ${text}`);
  });

  test('失败调用也留痕 (isError → ERR)', async () => {
    const logDir = join(sandbox, 'mcplog2');
    await fs.mkdir(logDir, { recursive: true });
    await startServer(sandbox, { ABS_LOG_DIR: logDir, ABS_LOG: '1' });
    // 无 .brain 的项目 → isError
    await tool('abs_load', { cwd: projB });
    let text = '';
    for (let i = 0; i < 20 && !text; i++) {
      await new Promise((r) => setTimeout(r, 50));
      text = await fs.readFile(join(logDir, 'mcp.log'), 'utf8').catch(() => '');
    }
    assert.ok(/tool=abs_load .*ERR/.test(text), `失败也应留痕: ${text}`);
  });
});

// 删除任务（2026-11-05）：用户报「每次删除任务可烦人了」——
// 原来 MCP 只暴露 state=搁置（先不做、留在看板上），没有真正的删除。
test('abs_task action=remove 能删掉任务（含子项）', async () => {
  await initBrain(projA);
  await startServer();
  await initHandshake();
  await tool('abs_task', { cwd: projA, action: 'start', id: 'MCP-RM', note: '要删的' });
  await tool('abs_task', { cwd: projA, action: 'note', id: 'MCP-RM', note: '子项' });

  const r = await tool('abs_task', { cwd: projA, action: 'remove', id: 'MCP-RM' });
  assert.match(textOf(r), /已删除任务 MCP-RM/, textOf(r));

  const md = await fs.readFile(join(projA, '.brain', 'todo.md'), 'utf8');
  assert.ok(!md.includes('MCP-RM'), `任务该消失:\n${md}`);
  assert.ok(!md.includes('子项'), `子项也该消失:\n${md}`);
});
