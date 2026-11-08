// ingest：把一场 pi 会话的摘要并进当天的 log-<日期>.md。测的是三条必须稳定的事 ——
//   ① 形状判定（改了代码 = 技术类，这是骨架选错就会写出编造内容的根）；
//   ② 与会话的挂钩（会话 id + 文件名必须写进段内，否则段与会话断链）；
//   ③ 不覆盖已填的段（人工内容优先，本仓硬规则）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  shapeOf, idsOf, headlineOf, cmdIngest, SHAPES,
  renderDigestSection, renderDayPage, ensureDigestFrontmatter, insertDigestSection, digestSectionOf,
} from '../src/brain/ingest.js';
import { projectDirName } from '../src/brain/summon.js';

// ---------- 纯函数：形状判定 ----------

test('shapeOf: 改了代码文件 → 技术类', () => {
  assert.equal(shapeOf(new Map([['/p/src/a.js', 1]])), 'tech');
  assert.equal(shapeOf(new Map([['/p/app.vue', 2], ['/p/x.ts', 1]])), 'tech');
});

test('shapeOf: 只改配置/文档/数据 → 业务操作类', () => {
  assert.equal(shapeOf(new Map([['/p/conf/a.yml', 1]])), 'ops');
  assert.equal(shapeOf(new Map([['/p/README.md', 3]])), 'ops');
  assert.equal(shapeOf(new Map([['/p/data.csv', 1]])), 'ops');
});

test('shapeOf: 一个文件都没改 → 讨论类', () => {
  assert.equal(shapeOf(new Map()), 'talk');
  // 改了认不出类型的东西（如无扩展名脚本），也归讨论类 —— 宁可少要求，不硬套技术骨架
  assert.equal(shapeOf(new Map([['/p/Makefile', 1]])), 'talk');
});

test('shapeOf: 混合改动按技术类算', () => {
  // 判据理由：技术类三段最严（要写验证命令）。混合时宁可多要求不可漏要求 ——
  // 漏了就等于放过一个「改了代码却没验证」的会话。
  const mixed = new Map([['/p/conf/a.yml', 1], ['/p/src/b.js', 1]]);
  assert.equal(shapeOf(mixed), 'tech');
});

// ---------- 纯函数：会话标识 ----------

test('idsOf: 从 pi 的文件名里取出日期与会话 id', () => {
  const r = idsOf('2026-11-05T03-35-14-951Z_01a1a9c6-6907-710f-94ca-bc0767530abd.jsonl');
  assert.equal(r.day, '2026-11-05');
  assert.equal(r.id, '01a1a9c6-6907-710f-94ca-bc0767530abd');
  assert.equal(r.short, '01a1a9c6');
});

test('idsOf: 文件名不合规时不编造 id，但 short 用哈希兜底', () => {
  const r = idsOf('random.jsonl');
  assert.equal(r.day, '', '抠不到日期就留空，由调用方补 today');
  assert.equal(r.id, '', '不编造会话 id（真实 id 由首行 session.id 兜底）');
  // short 不能留空：留空/固定值会让同一天多场互相覆盖（见「不撞名」那条）
  assert.match(r.short, /^[0-9a-f]{8}$/);
});

test('headlineOf: 取第一句有实质内容的用户发言', () => {
  assert.equal(headlineOf({ users: ['好的', '把超时改成 10 秒'] }), '把超时改成 10 秒');
  assert.equal(headlineOf({ users: [] }), '');
});

// ---------- 渲染 ----------

test('renderDigestSection: 三种形状各给各的骨架段（段标题降为 ###）', () => {
  const base = {
    digest: { users: ['说了点什么内容'], filesEdited: new Map(), toolCalls: 0, cwd: '/p' },
    ids: { day: '2026-11-05', id: 'sid-1', short: 'sid1', name: 'f.jsonl' },
    who: 'fanchao',
  };
  for (const [shape, sh] of Object.entries(SHAPES)) {
    const md = renderDigestSection({ ...base, shape });
    // 外面套了一层 `## 会话 <id8>`，骨架段必须降级 ——
    // 否则同一天两场会话会出现两个 `## 怎么解决的`，谁也分不清属于哪一场。
    assert.ok(md.startsWith(`## 会话 sid1\n`), `段开头应是容器标题: ${md.slice(0, 40)}`);
    for (const [title] of sh.sections) {
      assert.ok(md.includes(`### ${title}`), `${shape} 缺段: ${title}`);
    }
  }
  // 讨论类不该出现「验证什么命令」—— 那会让 agent 去编一个不存在的验证
  assert.ok(!renderDigestSection({ ...base, shape: 'talk' }).includes('验证什么命令'));
});

test('renderDigestSection: 会话挂钩写进段内（会话 id / 文件名 / cwd）', () => {
  const md = renderDigestSection({
    shape: 'talk',
    digest: { users: ['讨论一下方案'], filesEdited: new Map(), toolCalls: 0, cwd: '/proj/x' },
    ids: { day: '2026-11-05', id: 'abcd1234-full', short: 'abcd1234', name: 'f.jsonl' },
    who: 'fanchao',
  });
  assert.match(md, /^## 会话 abcd1234$/m);
  assert.match(md, /^> 挂钩: session=abcd1234-full · session-file=f\.jsonl · project=\/proj\/x$/m);
});

test('renderDayPage: 当天页带 kind/layer 标记（检索保护的唯一凭据）', () => {
  const md = renderDayPage({
    ids: { day: '2026-11-05' },
    who: 'fanchao',
    section: '## 会话 abcd1234\n\n### 谈成了什么\n<!-- 结论 -->\n',
  });
  assert.match(md, /^kind: session-digest$/m);
  assert.match(md, /^layer: 5$/m);
  assert.match(md, /^# 2026-11-05 记录$/m);
});

test('insertDigestSection: 会话段放在「📦 任务归档」之前', () => {
  const day = '# 2026-11-05 记录\n\n## 📦 任务归档\n\n### 2026-11-05\n\n- [x] 某任务\n';
  const out = insertDigestSection(day, '## 会话 abcd1234\n\n### 谈成了什么\n结论\n');
  assert.ok(out.indexOf('## 会话 abcd1234') < out.indexOf('## 📦 任务归档'), '会话在前、归档在后');
  assert.ok(out.includes('- [x] 某任务'), '归档内容一行不改');
  assert.ok(out.includes('### 谈成了什么'), '段内容原样写入');
});

test('ensureDigestFrontmatter: 已有当天页补上 kind/layer，其余字段不动', () => {
  const old = '---\ntags: [session-log, todo-archive, 历史]\nupdated: 2026-11-05\nstatus: reviewed\n---\n\n# 2026-11-05 记录\n';
  const out = ensureDigestFrontmatter(old);
  assert.match(out, /^kind: session-digest$/m);
  assert.match(out, /^layer: 5$/m);
  assert.ok(out.includes('tags: [session-log, todo-archive, 历史]'), 'tags 不替人改');
  assert.ok(out.includes('status: reviewed'), 'status 不替人改');
  // 已经有 kind 的页不重复插入
  assert.equal((ensureDigestFrontmatter(out).match(/^kind:/gm) || []).length, 1);
  // 没有 frontmatter 也不炸
  assert.equal(ensureDigestFrontmatter('# 无头页\n'), '# 无头页\n');
});

test('digestSectionOf: 段标题带会话 id 前 8 位（会话→段的反查凭据）', () => {
  assert.equal(digestSectionOf('abcd1234'), '## 会话 abcd1234');
  assert.equal(digestSectionOf(''), '## 会话 unknown');
});

// ---------- 落盘 ----------

/** 造一个真实目录结构：项目 + 它的 pi 会话目录。 */
async function sandbox() {
  const root = await fs.mkdtemp(join(tmpdir(), 'ingest-'));
  const proj = join(root, 'proj');
  await fs.mkdir(join(proj, '.brain', 'sessions'), { recursive: true });
  await fs.mkdir(join(proj, '.brain', 'concepts'), { recursive: true });
  await fs.writeFile(join(proj, '.brain', 'index.md'), '# 索引\n\n## Sessions\n\n## Concepts\n');
  const pi = join(root, 'pi');
  const piSessions = join(pi, projectDirName(proj));
  await fs.mkdir(piSessions, { recursive: true });
  return { root, proj, pi, piSessions };
}

function sessionFile({ id, day = '2026-11-05', user, edited = [], assistText = '改好了' }) {
  const lines = [JSON.stringify({ type: 'session', version: 3, id, timestamp: `${day}T01:00:00.000Z`, cwd: '/proj' })];
  lines.push(JSON.stringify({
    type: 'message', timestamp: `${day}T01:00:05.000Z`,
    message: { role: 'user', content: [{ type: 'text', text: user }] },
  }));
  const content = [{ type: 'text', text: assistText }];
  for (const p of edited) content.push({ type: 'toolCall', name: 'edit', arguments: { path: p } });
  lines.push(JSON.stringify({ type: 'message', timestamp: `${day}T01:01:00.000Z`, message: { role: 'assistant', content } }));
  return lines.join('\n') + '\n';
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

test('cmdIngest: 摘要并进当天的 log-<日期>.md，段标题带会话 id 前 8 位', async () => {
  const { proj, pi, piSessions } = await sandbox();
  const id = 'abcd1234-1111-2222-3333-444455556666';
  await fs.writeFile(
    join(piSessions, `2026-11-05T01-00-00-000Z_${id}.jsonl`),
    sessionFile({ id, user: '把登录超时改成 10 秒', edited: ['/proj/src/auth.js'] }),
  );
  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao' }, async () => {
    const out = await cmdIngest({ dir: proj, file: id });
    assert.match(out, /✓ 会话摘要/);
    const files = await fs.readdir(join(proj, '.brain', 'sessions'));
    assert.deepEqual(files, ['log-2026-11-05.md'], '一天一文件，不再一场一页');
    const body = await fs.readFile(join(proj, '.brain', 'sessions', files[0]), 'utf8');
    // 段 → 会话：id 与文件名都在（这是用户 2026-11-05 要求的挂钩）
    assert.match(body, new RegExp(`^> 挂钩: session=${id} `, 'm'));
    assert.match(body, /session-file=.*\.jsonl/);
    assert.match(body, /^kind: session-digest$/m, '带上检索保护的凭据');
    // 技术类骨架
    assert.ok(body.includes('### 验证什么命令'));
  });
});

test('cmdIngest: 同一天两场落进同一目录一个文件，两段都在', async () => {
  const { proj, pi, piSessions } = await sandbox();
  const idA = 'aaaa1111-1111-2222-3333-444455556666';
  const idB = 'bbbb2222-1111-2222-3333-444455556666';
  await fs.writeFile(join(piSessions, `2026-11-05T01-00-00-000Z_${idA}.jsonl`),
    sessionFile({ id: idA, user: '第一场', edited: ['/proj/a.js'] }));
  await fs.writeFile(join(piSessions, `2026-11-05T02-00-00-000Z_${idB}.jsonl`),
    sessionFile({ id: idB, user: '第二场', edited: ['/proj/b.js'] }));
  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao' }, async () => {
    await cmdIngest({ dir: proj, session: idA });
    await cmdIngest({ dir: proj, session: idB });
    const files = await fs.readdir(join(proj, '.brain', 'sessions'));
    assert.deepEqual(files, ['log-2026-11-05.md'], `只能有一个当天页: ${files}`);
    const body = await fs.readFile(join(proj, '.brain', 'sessions', files[0]), 'utf8');
    assert.ok(body.includes('## 会话 aaaa1111'), '第一场在');
    assert.ok(body.includes('## 会话 bbbb2222'), '第二场在（不能被第一场盖掉）');
  });
});

test('cmdIngest: 只给 id 前 8 位也能定位会话', async () => {
  const { proj, pi, piSessions } = await sandbox();
  const id = 'deadbeef-1111-2222-3333-444455556666';
  await fs.writeFile(
    join(piSessions, `2026-11-05T01-00-00-000Z_${id}.jsonl`),
    sessionFile({ id, user: '讨论一下要不要换数据库' }),
  );
  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao' }, async () => {
    const out = await cmdIngest({ dir: proj, file: 'deadbeef' });
    assert.match(out, /✓ 会话摘要/);
    assert.match(out, /讨论类/);
  });
});

test('cmdIngest: 已有本场段默认不覆盖，--force 才重建', async () => {
  const { proj, pi, piSessions } = await sandbox();
  const id = 'cafe0000-1111-2222-3333-444455556666';
  const f = join(piSessions, `2026-11-05T01-00-00-000Z_${id}.jsonl`);
  await fs.writeFile(f, sessionFile({ id, user: '聊方案' }));
  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao' }, async () => {
    await cmdIngest({ dir: proj, file: id });
    const dst = join(proj, '.brain', 'sessions', 'log-2026-11-05.md');
    // 模拟人填过那一段
    await fs.writeFile(dst, '---\nkind: session-digest\n---\n\n# 2026-11-05 记录\n\n'
      + '## 会话 cafe0000\n\n我写的结论\n', 'utf8');

    const again = await cmdIngest({ dir: proj, file: id });
    assert.match(again, /不覆盖/);
    assert.match(await fs.readFile(dst, 'utf8'), /我写的结论/);

    const forced = await cmdIngest({ dir: proj, file: id, force: true });
    assert.match(forced, /✓ 会话摘要/);
    const after = await fs.readFile(dst, 'utf8');
    assert.ok(!after.includes('我写的结论'), '--force 重建那一段');
    assert.match(after, /^## 会话 cafe0000$/m, '段标题还在（只是内容回空骨架）');
  });
});

test('cmdIngest --force 只重建本场那一段：同一天其他场次不受影响', async () => {
  const { proj, pi, piSessions } = await sandbox();
  const idA = 'cafe1111-1111-2222-3333-444455556666';
  const idB = 'cafe2222-1111-2222-3333-444455556666';
  await fs.writeFile(join(piSessions, `2026-11-05T01-00-00-000Z_${idA}.jsonl`),
    sessionFile({ id: idA, user: '第一场', edited: ['/proj/a.js'] }));
  await fs.writeFile(join(piSessions, `2026-11-05T02-00-00-000Z_${idB}.jsonl`),
    sessionFile({ id: idB, user: '第二场', edited: ['/proj/b.js'] }));
  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao' }, async () => {
    await cmdIngest({ dir: proj, session: idA });
    await cmdIngest({ dir: proj, session: idB });
    const dst = join(proj, '.brain', 'sessions', 'log-2026-11-05.md');
    // 两段都写上人工结论，然后只 --force 第一场
    const cur = await fs.readFile(dst, 'utf8');
    await fs.writeFile(dst, cur
      .replace('### 出了什么问题\n<!-- 具体症状 / 报错 / 复现条件 -->', '### 出了什么问题\n第一场的结论')
      .replace('### 出了什么问题\n<!-- 具体症状 / 报错 / 复现条件 -->', '### 出了什么问题\n第二场的结论'), 'utf8');
    await cmdIngest({ dir: proj, session: idA, force: true });
    const after = await fs.readFile(dst, 'utf8');
    assert.ok(!after.includes('第一场的结论'), '第一场被重建');
    assert.ok(after.includes('第二场的结论'), '第二场不该被动');
  });
});

test('cmdIngest: 没有真实用户输入的会话不生成页（空会话）', async () => {
  const { proj, pi, piSessions } = await sandbox();
  const id = 'fee10000-1111-2222-3333-444455556666';
  await fs.writeFile(join(piSessions, `2026-11-05T01-00-00-000Z_${id}.jsonl`), sessionFile({ id, user: '好' }));
  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao' }, async () => {
    const out = await cmdIngest({ dir: proj, file: id });
    assert.match(out, /没有真实用户输入/);
    assert.deepEqual(await fs.readdir(join(proj, '.brain', 'sessions')), []);
  });
});

// ---------- --last / --auto（hook 机械触发用） ----------

test('cmdIngest --last: 取最近写过的那场会话（按 mtime，不按文件名时间戳）', async () => {
  const { proj, pi, piSessions } = await sandbox();
  const older = '11111111-1111-2222-3333-444455556666';
  const newer = '22222222-1111-2222-3333-444455556666';
  // 名字上的时间戳：newer 反而更早 —— 专门踩「按文件名排序」那个坑。
  // 跨天续聊时文件名里的时间是会话**开始**时刻，不再是最新的。
  const fOlder = join(piSessions, `2026-11-05T01-00-00-000Z_${older}.jsonl`);
  const fNewer = join(piSessions, `2026-11-01T01-00-00-000Z_${newer}.jsonl`);
  await fs.writeFile(fOlder, sessionFile({ id: older, user: '早一场会话', edited: ['/proj/a.js'] }));
  await fs.writeFile(fNewer, sessionFile({ id: newer, user: '后一场会话', edited: ['/proj/b.js'] }));
  // 把 fNewer 的 mtime 拨到更晚
  const t = new Date(Date.now() + 60_000);
  await fs.utimes(fNewer, t, t);

  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao' }, async () => {
    const out = await cmdIngest({ dir: proj, last: true });
    assert.match(out, /✓ 会话摘要/);
    const files = await fs.readdir(join(proj, '.brain', 'sessions'));
    // 落的是 mtime 更晚的那场，虽然它的文件名日期更早
    assert.deepEqual(files, ['log-2026-11-01.md']);
    const body = await fs.readFile(join(proj, '.brain', 'sessions', files[0]), 'utf8');
    assert.ok(body.includes('## 会话 22222222'), `该落 mtime 更晚那场: ${body.slice(0, 200)}`);
  });
});

test('cmdIngest --auto: 纯聊天会话跳过，不生成页', async () => {
  const { proj, pi, piSessions } = await sandbox();
  const id = '33333333-1111-2222-3333-444455556666';
  await fs.writeFile(join(piSessions, `2026-11-05T01-00-00-000Z_${id}.jsonl`),
    sessionFile({ id, user: '你觉得这个方案怎么样，我们讨论下' }));
  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao' }, async () => {
    const out = await cmdIngest({ dir: proj, last: true, auto: true });
    assert.match(out, /跳过/);
    assert.deepEqual(await fs.readdir(join(proj, '.brain', 'sessions')), []);
  });
});

test('cmdIngest --auto: 改过文件的会话照落（判据是改文件，不是工具调用数）', async () => {
  const { proj, pi, piSessions } = await sandbox();
  const id = '44444444-1111-2222-3333-444455556666';
  await fs.writeFile(join(piSessions, `2026-11-05T01-00-00-000Z_${id}.jsonl`),
    sessionFile({ id, user: '改一下登录超时', edited: ['/proj/src/a.js'] }));
  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao' }, async () => {
    const out = await cmdIngest({ dir: proj, last: true, auto: true });
    assert.match(out, /✓ 会话摘要/);
    assert.equal((await fs.readdir(join(proj, '.brain', 'sessions'))).length, 1);
  });
});

test('cmdIngest: 落页不写 log.md（--auto 每次关会话都跑，写成流水会刷屏）', async () => {
  const { proj, pi, piSessions } = await sandbox();
  const id = '55555555-1111-2222-3333-444455556666';
  await fs.writeFile(join(proj, '.brain', 'log.md'), '# 🗒 Activity Log\n\n');
  await fs.writeFile(join(piSessions, `2026-11-05T01-00-00-000Z_${id}.jsonl`),
    sessionFile({ id, user: '改一下登录超时', edited: ['/proj/src/a.js'] }));
  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao' }, async () => {
    await cmdIngest({ dir: proj, last: true, auto: true });
    const log = await fs.readFile(join(proj, '.brain', 'log.md'), 'utf8');
    assert.ok(!/会话页/.test(log), `不该往 log.md 写流水，实际:\n${log}`);
  });
});

// ---------- 未填会话页在 abs load 里的送达 ----------
// 病根：ingest/hook 落的是**空骨架**，内容要人填。原来落盘后没有任何地方看得见，
// 等于「采集了不消化」—— 本仓已经踩过几次的同一个病。
// 守的边界：只数条数 + 给页名，不贴正文（读取侧输出不得随规模增长）。

import { cmdLoad } from '../src/store.js';

/** 写一张当天页。filled=false 时保留骨架占位（= ingest 刚落的原样）。 */
async function writeDigestPage(dir, { slug, filled = false, kind = 'session-digest' }) {
  const p = join(dir, '.brain', 'sessions', `${slug}.md`);
  const body = filled
    ? '### 出了什么问题\n登录超时 504\n\n### 怎么解决的\n改客户端超时'
    : '### 出了什么问题\n<!-- 具体症状 -->\n\n### 怎么解决的\n<!-- 根因 -->';
  await fs.writeFile(p, `---\ntags: [session-log, session-digest, 会话]\nlayer: 5\nkind: ${kind}\nstatus: draft\n---\n\n`
    + `# 2026-11-05 记录\n\n## 会话 aaaa1111\n\n> 挂钩: session=aaaa1111-full · session-file=f.jsonl\n\n${body}\n`, 'utf8');
  return p;
}

test('abs load: 未填的当天页被摆到顶部', async () => {
  const { proj } = await sandbox();
  await writeDigestPage(proj, { slug: 'log-2026-11-05' });
  const out = await cmdLoad({ dir: proj });
  // 2026-11-08 load 三件套收口：只回一行计数，不列页名
  assert.match(out, /未填会话页 1 张/);
  assert.ok(!out.includes('log-2026-11-05'), `不列页名: ${out}`);
});

test('abs load: 已填的当天页不提醒（判据是段内有真内容，不是 status）', async () => {
  const { proj } = await sandbox();
  // 故意留着 status: draft —— 人可能填完忘了改 status，
  // 用 status 当判据会漏报/反复提示，所以只看骨架段填没填。
  await writeDigestPage(proj, { slug: 'log-2026-11-05', filled: true });
  const out = await cmdLoad({ dir: proj });
  assert.ok(!/未填会话页/.test(out), `已填不该提醒: ${out}`);
});

test('abs load: 手写的 sessions 页不被催（只认 kind: session-digest）', async () => {
  const { proj } = await sandbox();
  await writeDigestPage(proj, { slug: 'log-2026-11-05', kind: 'gotcha' });
  const out = await cmdLoad({ dir: proj });
  assert.ok(!/未填会话页/.test(out), `手写页不该被催: ${out}`);
});

test('abs load: 未填页多时只回一行计数，不列页名', async () => {
  const { proj } = await sandbox();
  for (let i = 1; i <= 9; i++) {
    await writeDigestPage(proj, { slug: `log-2026-11-0${i}` });
  }
  const out = await cmdLoad({ dir: proj });
  assert.match(out, /未填会话页 9 张/);
  // 2026-11-08 收口：不列页名（守读取侧不随规模增长）；排序逻辑留在 unfilledSessionSection
  assert.ok(!/log-2026-11-0[0-9]/.test(out.split('未填会话页')[1] || ''), `不列页名: ${out}`);
});

test('abs load: 未填页多时也不逐条列（同一行里只给计数）', async () => {
  const { proj } = await sandbox();
  for (let i = 1; i <= 9; i++) {
    await writeDigestPage(proj, { slug: `log-2026-12-0${i}` });
  }
  const out = await cmdLoad({ dir: proj });
  const sec = out.split('未填会话页')[1] || '';
  assert.match(out, /未填会话页 9 张/);
  assert.equal(sec.split('\n').filter((l) => /^\s*- /.test(l)).length, 0, `不该逐条列: ${sec}`);
});

// ---------- 审查修复（2026-11-05）----------

test('★ --mark 记的是真 md5，不是空串（否则内容没变也报「有更新」）', async () => {
  // 审查发现的 bug：原来写 md5:''，而 scanProject 用 rec.md5 === md5 判重 ——
  // 空串永不等于真 md5。后果：size/mtime 一变且当天没快照时，一字未改的会话
  // 被报成「有更新（会话被续写，需补充）」。
  const { proj, pi, piSessions } = await sandbox();
  const id = '66666666-1111-2222-3333-444455556666';
  const f = join(piSessions, `2026-11-05T01-00-00-000Z_${id}.jsonl`);
  await fs.writeFile(f, sessionFile({ id, user: '改一下登录超时', edited: ['/proj/src/a.js'] }));
  const ledger = join(proj, 'ledger.json');
  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao', ABS_SUMMON_LEDGER: ledger }, async () => {
    await cmdIngest({ dir: proj, last: true, auto: true, mark: true });
    const book = JSON.parse(await fs.readFile(ledger, 'utf8'));
    const rec = Object.values(book.files)[0];
    assert.equal(rec.md5.length, 32, `md5 应是 32 位十六进制真值，实际 "${rec.md5}"`);
  });
});

test('★ 记账后只改 mtime（内容未变）→ 不报「有更新」', async () => {
  const { proj, pi, piSessions } = await sandbox();
  const id = '77777777-1111-2222-3333-444455556666';
  const f = join(piSessions, `2026-11-05T01-00-00-000Z_${id}.jsonl`);
  await fs.writeFile(f, sessionFile({ id, user: '改一下登录超时', edited: ['/proj/src/a.js'] }));
  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao' }, async () => {
    await cmdIngest({ dir: proj, last: true, auto: true });
    // 删掉当天页：本测要验的是账本（md5）那条路，不是「当天页里已有摘要」那条
    await fs.rm(join(proj, '.brain', 'sessions'), { recursive: true, force: true });
    await fs.mkdir(join(proj, '.brain', 'sessions'), { recursive: true });
    // 内容与大小都没动，只把 mtime 拨到 2 小时前（避开 30 分钟活跃跳过）
    const t = new Date(Date.now() - 2 * 3600 * 1000);
    await fs.utimes(f, t, t);
    // 走 md5 分支的前提是 size+mtime 预筛不中；mtime 已变，故直接查结果
    const { scanProject } = await import('../src/brain/summon.js');
    const r = await scanProject(proj);
    assert.equal(r.changed.length, 0, `内容没变不该进「有更新」，实际: ${JSON.stringify(r.changed.map((x) => x.name))}`);
  });
});

// ---------- headlineOf 判据修正（2026-11-05 实测）----------
// 原来取「第一句 ≥6 字的话」，真实会话里第一句常是**粘贴的需求文档**，
// 结果 index 里那条摘要完全没法读，还得手工改。zj_shop 那场抓出来是：
//   「附件：小程序商城开发详细功能清单 一、项目概述 本项目为小程序商城开发…」
test('headlineOf: 跳过长文档（粘贴的需求清单）', () => {
  const doc = '附件：小程序商城开发详细功能清单 一、项目概述 本项目为小程序商城开发，基于已有源码二次开发';
  assert.equal(headlineOf({ users: [doc] }), '', '全是文档体 → 返回空，让 agent 填');
});

test('headlineOf: 短而具体的需求被选中', () => {
  assert.equal(
    headlineOf({ users: ['把登录接口的超时从 3 秒改成 10 秒，现在老是 504'] }),
    '把登录接口的超时从 3 秒改成 10 秒，现在老是 504',
  );
});

test('headlineOf: 跳过寒暄，取后面的真需求', () => {
  assert.equal(headlineOf({ users: ['好的', '助力卡限量改成活动级'] }), '助力卡限量改成活动级');
});

test('headlineOf: 文档体在前、正常句在后 → 取后面的', () => {
  const doc = '附件：小程序商城开发详细功能清单 一、项目概述 本项目为小程序商城开发';
  assert.equal(headlineOf({ users: [doc, '会员价要读付费会员等级'] }), '会员价要读付费会员等级');
});

// 命名兜底（2026-11-05 实测）。
// 病根：文件名匹配不上时 idsOf 退成哈希（不编造 id），同一天两场认不出的会话
// 靠 short 区分 —— 否则两场会落成同一个 `## 会话 unknown` 段，
// 第二场直接撞上「已有不覆盖」，静默丢掉一场会话。
// 真实 485 个文件目前 100% 匹配，这是给「将来 pi 改命名规则」留的护栏。
test('idsOf: 文件名认不出时按哈希区分，不撞名', () => {
  const a = idsOf('2026-11-05T01-00-00-000Z_badx1.jsonl');
  const b = idsOf('2026-11-05T02-00-00-000Z_badx2.jsonl');
  assert.equal(a.day, '2026-11-05', '日期仍要从文件名里抠出来');
  assert.equal(b.day, '2026-11-05');
  assert.notEqual(a.short, b.short, '不同文件必须得到不同 short，否则会互相覆盖');
  assert.match(a.short, /^[0-9a-f]{8}$/);
});

test('cmdIngest: 文件名认不出时仍用首行 session.id 挂钩', async () => {
  const { proj, pi, piSessions } = await sandbox();
  // 故意用不符合 pi 命名规则的文件名，但首行 session.id 是真的
  const realId = '99999999-1111-2222-3333-444455556666';
  await fs.writeFile(join(piSessions, '2026-11-05T01-00-00-000Z_weird-name.jsonl'),
    sessionFile({ id: realId, user: '改一下登录超时', edited: ['/proj/src/a.js'] }));
  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao' }, async () => {
    const out = await cmdIngest({ dir: proj, last: true });
    assert.match(out, /✓ 会话摘要/);
    const files = await fs.readdir(join(proj, '.brain', 'sessions'));
    assert.equal(files.length, 1);
    const body = await fs.readFile(join(proj, '.brain', 'sessions', files[0]), 'utf8');
    // 关键：挂钩不能断 —— 文件名认不出时也要写进真实 id
    assert.match(body, new RegExp(`^> 挂钩: session=${realId} `, 'm'), `必须用首行 id 兜底: ${body.slice(0, 300)}`);
  });
});

// 落页即记账（2026-11-05 实测）。
// 病根：原来只有 --mark 才写账本，于是已落页的会话**永远停在「未总结」名单里**
// —— summon 反复催同一场，而人已经能看到那张页了。
// 催一个已存在的东西，比不提醒更糟：它训练人忽略这条提醒。
test('★ 落页就记账，不用 --mark（否则 summon 一直催已落页的会话）', async () => {
  const { proj, pi, piSessions } = await sandbox();
  const id = 'abcd0000-1111-2222-3333-444455556666';
  const ledger = join(proj, 'ledger.json');
  await fs.writeFile(join(piSessions, `2026-11-05T01-00-00-000Z_${id}.jsonl`),
    sessionFile({ id, user: '改一下登录超时', edited: ['/proj/src/a.js'] }));
  // 拨到非活跃
  const t = new Date(Date.now() - 2 * 3600 * 1000);
  await fs.utimes(join(piSessions, `2026-11-05T01-00-00-000Z_${id}.jsonl`), t, t);

  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao', ABS_SUMMON_LEDGER: ledger }, async () => {
    await cmdIngest({ dir: proj, last: true, auto: true });   // 注意：没给 mark
    const book = JSON.parse(await fs.readFile(ledger, 'utf8'));
    assert.ok(Object.keys(book.files).length === 1, `不给 --mark 也要记账，实际账本: ${JSON.stringify(book.files)}`);

    const { scanProject } = await import('../src/brain/summon.js');
    const r = await scanProject(proj);
    assert.equal(r.fresh.length, 0, `已落页的不该再出现在「未总结」: ${JSON.stringify(r.fresh.map((x) => x.name))}`);
  });
});

// --session 精确定位（2026-11-05 实测）。
// 病根：hook 原来只传 --last，按 mtime 选文件。同时开两个会话时会选错 ——
// 实测关会话 A 却落了 B 的页（B 的 jsonl 更新）。hook 那侧本来就能拿到会话 id，
// 传下来就能精确定位，不用猜。
test('★ --session 指定会话，不受 mtime 影响（多会话场景）', async () => {
  const { proj, pi, piSessions } = await sandbox();
  const idA = 'aaaa1111-1111-2222-3333-444455556666';
  const idB = 'bbbb2222-1111-2222-3333-444455556666';
  const fA = join(piSessions, `2026-11-05T01-00-00-000Z_${idA}.jsonl`);
  const fB = join(piSessions, `2026-11-05T02-00-00-000Z_${idB}.jsonl`);
  await fs.writeFile(fA, sessionFile({ id: idA, user: '会话 A 的内容', edited: ['/proj/a.js'] }));
  await fs.writeFile(fB, sessionFile({ id: idB, user: '会话 B 的内容', edited: ['/proj/b.js'] }));
  // B 的 mtime 更新 —— --last 会选它，--session 不该受影响
  const t = new Date(Date.now() - 2 * 3600 * 1000);
  await fs.utimes(fA, t, t);
  const t2 = new Date(Date.now() - 3600 * 1000);
  await fs.utimes(fB, t2, t2);

  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao' }, async () => {
    const out = await cmdIngest({ dir: proj, session: idA, auto: true });
    assert.match(out, /✓ 会话摘要/);
    const files = await fs.readdir(join(proj, '.brain', 'sessions'));
    assert.deepEqual(files, ['log-2026-11-05.md'],
      `只能落这一天页（--last 会选错场次），实际: ${files}`);
    const body = await fs.readFile(join(proj, '.brain', 'sessions', files[0]), 'utf8');
    assert.ok(body.includes('## 会话 aaaa1111'), `必须落 A 那一场: ${body.slice(0, 300)}`);
    assert.ok(!body.includes('## 会话 bbbb2222'), '不该把 B 也落进来');
  });
});

test('--session 支持截断 id（hook 传来的 16 位前缀）', async () => {
  const { proj, pi, piSessions } = await sandbox();
  const id = 'cccc3333-1111-2222-3333-444455556666';
  await fs.writeFile(join(piSessions, `2026-11-05T01-00-00-000Z_${id}.jsonl`),
    sessionFile({ id, user: '某场会话', edited: ['/proj/a.js'] }));
  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao' }, async () => {
    const out = await cmdIngest({ dir: proj, session: 'cccc3333-1111-22', auto: true });
    assert.match(out, /✓ 会话摘要/, `16 位前缀要能匹配: ${out}`);
  });
});

test('--session 指向不存在的会话时明说找不到，不静默落错页', async () => {
  const { proj, pi, piSessions } = await sandbox();
  const id = 'dddd4444-1111-2222-3333-444455556666';
  await fs.writeFile(join(piSessions, `2026-11-05T01-00-00-000Z_${id}.jsonl`),
    sessionFile({ id, user: '别的会话', edited: ['/proj/a.js'] }));
  await withEnv({ ABS_PI_SESSIONS: pi, ABS_USER: 'fanchao' }, async () => {
    const out = await cmdIngest({ dir: proj, session: 'ffffffff-9999', auto: true });
    assert.match(out, /找不到/, `应明确报找不到: ${out}`);
    assert.deepEqual(await fs.readdir(join(proj, '.brain', 'sessions')), [],
      '找不到时绝不能退回 --last 落到别的会话上');
  });
});

// 半句不能当标题（2026-11-05 实测）。
// 本场会话自己的页被抓成「找一下所有会话中 关于 会话总结提炼的信息，我/」——
// 用户在打字中途按了回车，那个 `/` 是断的。
// 这种东西进 index 比空着更糟：它看起来像标题，实际什么也没说。
test('headlineOf: 没说完的半句不能当标题', () => {
  const cases = [
    '找一下所有会话中 关于 会话总结提炼的信息，我/',   // 斜杠结尾
    '我觉得应该这样，',                                  // 逗号结尾
    '这个要和',                                          // 连接词结尾
    '配置在',                                            // 介词结尾
  ];
  for (const u of cases) {
    assert.equal(headlineOf({ users: [u] }), '', `半句不该当标题: ${u}`);
  }
});

test('headlineOf: 「的/了」结尾不算半句（中文完整句的高频结尾）', () => {
  // 判据必须先排除这两字 —— 实测把它们收进「未完成」词表会误杀大量正常诉求：
  //   「优化一下 abs 命令，去掉不必要的」「这个功能不想要了」都是完整意思。
  const cases = [
    '优化一下 abs 命令，去掉不必要的',
    '这个功能不想要了',
    '需求变了',
  ];
  for (const u of cases) {
    assert.ok(headlineOf({ users: [u] }), `完整句不该被拦: ${u}`);
  }
});

test('headlineOf: 跳过半句取下一句完整的', () => {
  assert.equal(
    headlineOf({ users: ['找一下所有会话中 关于 会话总结提炼的信息，我/', '我们要优化一下会话总结功能 以abs的 7层思考机制'] }),
    '我们要优化一下会话总结功能 以abs的 7层思考机制',
  );
});

test('headlineOf: 句子中间有逗号不算半句', () => {
  // 判据必须锚定结尾 —— 否则「优化一下命令，去掉不必要的」会被误杀
  assert.equal(
    headlineOf({ users: ['优化一下 abs 命令，一些不必要的 该去的去掉'] }),
    '优化一下 abs 命令，一些不必要的 该去的去掉',
  );
});
