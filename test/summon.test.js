// summon：会话总结托底的判据测试。
// 只测三件必须稳定的事：项目目录名规则、md5 判重、快照判重。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  projectDirName, scanProject, readLedger, writeLedger, markSummarized, digestSession,
} from '../src/brain/summon.js';

test('projectDirName: 只换斜杠，下划线与点原样保留', () => {
  // 坑（2026-11-01 实测）：曾用 replace(/[^A-Za-z0-9]/g,'-')，下划线也被换掉，
  // agent_brain_sync 变 agent-brain-sync，pi 的会话目录根本找不到。
  assert.equal(
    projectDirName('/Users/fanchao/Code/agent_brain_sync'),
    '--Users-fanchao-Code-agent_brain_sync--',
  );
  assert.equal(
    projectDirName('/Users/fanchao/.agents/skills/vibe-coding-help'),
    '--Users-fanchao-.agents-skills-vibe-coding-help--',
  );
});

/** 造一条最小会话 JSONL。content 是数组（pi 的真实格式）。 */
function sessionLine(ts, role, text) {
  return JSON.stringify({ type: 'message', timestamp: ts, message: { role, content: [{ type: 'text', text }] } });
}
function makeSession({ start, userTexts }) {
  const lines = [JSON.stringify({ type: 'session', version: 3, id: 'x', timestamp: start, cwd: '/p' })];
  for (const t of userTexts) lines.push(sessionLine(start, 'user', t));
  return lines.join('\n') + '\n';
}

async function sandbox() {
  const root = await fs.mkdtemp(join(tmpdir(), 'summon-'));
  const proj = join(root, 'proj');
  const sessions = join(proj, '.brain', 'sessions');
  await fs.mkdir(sessions, { recursive: true });
  const piDir = join(root, 'pi');
  await fs.mkdir(join(piDir, projectDirName(proj)), { recursive: true });
  return { root, proj, sessions, piDir, piSessions: join(piDir, projectDirName(proj)) };
}

async function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try { return await fn(); }
  finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

/** 把 mtime 拨到「非活跃」，否则 scanProject 会跳过它。 */
async function makeStale(file) {
  const old = new Date(Date.now() - 24 * 3600 * 1000);
  await fs.utimes(file, old, old);
}

test('digestSession 能读出用户原话（content 是数组，不是字符串）', async () => {
  const { root, piSessions } = await sandbox();
  try {
    const f = join(piSessions, 'a.jsonl');
    await fs.writeFile(f, makeSession({
      start: '2026-10-01T10:00:00.000Z',
      userTexts: ['这条经验很重要', '继续'],
    }));
    const d = await digestSession(f);
    assert.equal(d.day, '2026-10-01');
    assert.deepEqual(d.users, ['这条经验很重要'], '「继续」这类无信息量单句要滤掉');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('活跃会话（文件仍在写）跳过，不记成已总结', async () => {
  const { root, proj, piSessions } = await sandbox();
  try {
    const f = join(piSessions, 'live.jsonl');
    await fs.writeFile(f, makeSession({ start: '2026-10-01T10:00:00.000Z', userTexts: ['正在聊'] }));
    // 不动 mtime = 刚写过 = 活跃
    const r = await withEnv({ ABS_PI_SESSIONS: join(root, 'pi') }, () => scanProject(proj));
    assert.equal(r.fresh.length, 0, '活跃会话不能进待总结');
    assert.equal(r.active.length, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('已有快照的那天整日跳过（人已经总结过）', async () => {
  const { root, proj, sessions, piSessions } = await sandbox();
  try {
    await fs.writeFile(join(sessions, 'log-2026-10-01.md'), '# 已有快照\n');
    const f = join(piSessions, 'a.jsonl');
    await fs.writeFile(f, makeSession({ start: '2026-10-01T10:00:00.000Z', userTexts: ['有内容'] }));
    await makeStale(f);
    const r = await withEnv({ ABS_PI_SESSIONS: join(root, 'pi') }, () => scanProject(proj));
    assert.equal(r.fresh.length, 0, '有快照就不该再吵');
    assert.equal(r.skipped.length, 1);
    assert.match(r.skipped[0].reason, /已有快照/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('md5 一致 → 跳过；md5 变了 → 进「有更新」要求补充总结', async () => {
  const { root, proj, piSessions } = await sandbox();
  try {
    const f = join(piSessions, 'a.jsonl');
    const ledgerFile = join(root, 'ledger.json');
    await fs.writeFile(f, makeSession({ start: '2026-10-02T10:00:00.000Z', userTexts: ['第一版'] }));
    await makeStale(f);

    const env = { ABS_PI_SESSIONS: join(root, 'pi'), ABS_SUMMON_LEDGER: ledgerFile };
    // 第一次：应该是 fresh
    const r1 = await withEnv(env, () => scanProject(proj));
    assert.equal(r1.fresh.length, 1);

    // 记账后再扫：md5 一致 → 跳过
    const book = { version: 1, files: {} };
    markSummarized(book, r1.fresh);
    await writeLedger(book, ledgerFile);
    const r2 = await withEnv(env, () => scanProject(proj));
    assert.equal(r2.fresh.length, 0);
    assert.equal(r2.changed.length, 0);
    // 走的是便宜预筛（size+mtime 未变），不是 md5 —— 见 scanProject 里的注释
    assert.equal(r2.skipped.filter((s) => /size\+mtime/.test(s.reason || '')).length, 1);

    // 会话被续写 → md5 变了 → 进 changed
    await fs.writeFile(f, makeSession({ start: '2026-10-02T10:00:00.000Z', userTexts: ['第一版', '又聊了一段'] }));
    await makeStale(f);
    const r3 = await withEnv(env, () => scanProject(proj));
    assert.equal(r3.changed.length, 1, '会话被续写必须要求补充总结');
    assert.equal(r3.fresh.length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('账本读写幂等，坏账本退化为空', async () => {
  const { root } = await sandbox();
  try {
    const p = join(root, 'l.json');
    await fs.writeFile(p, '{ 坏 json');
    const empty = await readLedger(p);
    assert.deepEqual(empty.files, {}, '坏账本不能炸，退化为空');

    const book = { version: 1, files: {} };
    markSummarized(book, [{ name: 'a.jsonl', md5: 'm1', day: '2026-10-01' }]);
    await writeLedger(book, p);
    const back = await readLedger(p);
    assert.equal(back.files['a.jsonl'].md5, 'm1');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('size/mtime 变了但内容没变 → 跳过并补记新 stat（不误报有更新）', async () => {
  const { root, proj, piSessions } = await sandbox();
  try {
    const f = join(piSessions, 'a.jsonl');
    const ledgerFile = join(root, 'ledger.json');
    const body = makeSession({ start: '2026-10-03T10:00:00.000Z', userTexts: ['内容不变'] });
    await fs.writeFile(f, body);
    await makeStale(f);

    const env = { ABS_PI_SESSIONS: join(root, 'pi'), ABS_SUMMON_LEDGER: ledgerFile };
    const r1 = await withEnv(env, () => scanProject(proj));
    assert.equal(r1.fresh.length, 1);
    const book = { version: 1, files: {} };
    markSummarized(book, r1.fresh);
    await writeLedger(book, ledgerFile);

    // 只触碰 mtime，内容一个字节都没改（模拟备份还原 / touch）
    const future = new Date(Date.now() - 3600 * 1000);
    await fs.utimes(f, future, future);

    const r2 = await withEnv(env, () => scanProject(proj));
    assert.equal(r2.changed.length, 0, '内容没变就不能报「有更新」');
    assert.equal(r2.fresh.length, 0);
    assert.equal(r2.skipped.filter((s) => /仅 stat 变化/.test(s.reason || '')).length, 1);

    // 补记后，再扫一次应当直接走便宜预筛
    const r3 = await withEnv(env, () => scanProject(proj));
    assert.equal(r3.skipped.filter((s) => /size\+mtime 未变/.test(s.reason || '')).length, 1,
      '第二次应当走 stat 预筛，不再读全文');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('abs log 落盘时带出待总结会话（收尾顺手深读）', async () => {
  const { root, proj, piSessions } = await sandbox();
  try {
    const f = join(piSessions, 'a.jsonl');
    await fs.writeFile(f, makeSession({ start: '2026-10-05T10:00:00.000Z', userTexts: ['配置必须跟库同目录'] }));
    await makeStale(f);

    const { cmdLog } = await import('../src/note.js');
    const out = await withEnv(
      { ABS_PI_SESSIONS: join(root, 'pi'), ABS_SUMMON_LEDGER: join(root, 'ledger.json'), ABS_USER: 'tester' },
      () => cmdLog({ dir: proj, title: '完成 测试任务' }),
    );
    assert.match(out, /✓ log/, 'log 本身要成功');
    assert.match(out, /场会话待总结/, '要带出待总结会话');
    assert.match(out, /配置必须跟库同目录/, '要给原话线索，不能只给个数');
    assert.match(out, /abs capture/, '要给下一步可执行的命令');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('summon:false 时不扫会话（note/capture 内部调用 log 的场景）', async () => {
  const { root, proj, piSessions } = await sandbox();
  try {
    const f = join(piSessions, 'a.jsonl');
    await fs.writeFile(f, makeSession({ start: '2026-10-06T10:00:00.000Z', userTexts: ['有内容'] }));
    await makeStale(f);

    const { cmdLog } = await import('../src/note.js');
    const out = await withEnv(
      { ABS_PI_SESSIONS: join(root, 'pi'), ABS_SUMMON_LEDGER: join(root, 'ledger.json'), ABS_USER: 'tester' },
      () => cmdLog({ dir: proj, title: '完成 X', summon: false }),
    );
    assert.match(out, /✓ log/);
    assert.doesNotMatch(out, /场会话待总结/, '内部调用不该带会话清单，否则每次写经验都刷一遍');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
