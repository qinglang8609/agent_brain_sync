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
    assert.equal(r2.skipped.filter((s) => /md5/.test(s.reason || '')).length, 1);

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
