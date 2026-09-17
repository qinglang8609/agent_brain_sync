import { test } from 'node:test';
import assert from 'node:assert';
import { promises as rm } from 'node:fs';
import { checkTaskForLeaks, verifyArms, ARMS, cmdAbInit, buildArmPrompt, armDir, checkCriterionComparable, checkWorktreeSnapshot } from '../src/ab.js';

// ---------- 泄题检查 ----------
// 三条规则各有真实来源：本仓 2026-09-16/17 做四轮对照实验，
// 三次题面泄题（明写环境 / 提示陷阱 / 提示验证入口），每次都导致两组都做对、测不出差异。
// 这组测试的作用是：别让第四次泄题再靠人眼发现。

test('checkTaskForLeaks: 抓「明写目标环境」(第一轮真实泄题)', () => {
  const t = '生产: 一个 alpine 容器, 里面只有 /bin/sh(busybox ash), 没有 bash';
  const hits = checkTaskForLeaks(t);
  assert.ok(hits.length > 0, '点名 alpine/busybox 应被判为泄题');
  assert.ok(hits.some((h) => h.kind.includes('明写目标环境')));
});

test('checkTaskForLeaks: 抓「提示有陷阱」(第二轮真实泄题)', () => {
  const t = '静默失败: 任何异常都不得让宿主看到报错 —— 宿主会吞掉 stdout/stderr';
  const hits = checkTaskForLeaks(t);
  assert.ok(hits.length > 0, '"静默失败/会被吞掉" 会把注意力引到陷阱上');
});

test('checkTaskForLeaks: 抓「提示验证入口」(第三轮真实泄题)', () => {
  const t = '现在 main.js 跑不起来, 是 report.js 的配置引用出了问题。请修好它。';
  const hits = checkTaskForLeaks(t);
  assert.ok(hits.length > 0, '"跑不起来" = 告诉它去跑一次就发现');
});

test('checkTaskForLeaks: 干净的题面不误报', () => {
  const t = '# 任务\n给 report.js 加一个函数, 计算页面大小。需求见下。';
  assert.deepEqual(checkTaskForLeaks(t), []);
});

test('checkTaskForLeaks: 空/undefined 不炸', () => {
  assert.deepEqual(checkTaskForLeaks(''), []);
  assert.deepEqual(checkTaskForLeaks(undefined), []);
});

test('checkTaskForLeaks: 命中项带 kind 与 why（能指导改题面）', () => {
  const hits = checkTaskForLeaks('注意这里是 dash 环境');
  assert.ok(hits.length > 0);
  for (const h of hits) {
    assert.ok(h.kind, '每条要有分类');
    assert.ok(h.hit, '要指出命中的原词');
    assert.ok(h.why, '要解释为什么算泄题 —— 否则不知道怎么改');
  }
});

// ---------- 分组自检 ----------
// 核心假设：两组只差 .brain/。这条必须真去查目录，
// 因为本仓把 .brain/ 提交进了 git → 快照会自带它 → 实验静默失效（实测踩过）。

test('verifyArms: 不存在的实验要报错而不是静默通过', async () => {
  const r = await verifyArms('这个实验名肯定不存在-xyz');
  assert.equal(r.ok, false, '缺目录不能算通过');
  assert.ok(r.problems.length > 0);
});

test('ARMS: 分组名稳定（A=对照无图谱, B=实验带图谱）', () => {
  assert.equal(ARMS.A, 'A轮');
  assert.equal(ARMS.B, 'B轮');
});

// ---------- init 前置校验 ----------
// 2026-09-17 实测踩到：从非仓库目录跑 init，会把 cwd 当仓库根，
// 然后在"复制 .brain/ 失败"上报一句**误导性**错误 —— 真因是 cwd 不对。
// 这条测试钉住"报错要指明真因"，避免下次又去 debug 错的地方。

test('cmdAbInit: 非 git 仓库目录要明确报错（不是"复制 .brain 失败"）', async () => {
  const out = await cmdAbInit({
    taskPath: '/tmp/abtest-leak-nonexistent.md', // 题面不需要存在：前置校验更早返回
    root: '/tmp',
    name: 'unit-check',
  });
  assert.match(out, /不是一个 git 仓库/, '应指明真因');
  assert.ok(!out.includes('复制 .brain/ 失败'), '不该报成复制失败（那会误导排查方向）');
});

// ---------- prompt 生成 ----------
// 2026-09-17 实测事故：我手写 prompt 时没给边界约束，B 组 agent
// `ls ..` 发现并排的对照组 → diff 拿到答案 → 拒绝交付。
// 故 prompt 必须由工具生成，且必须含边界约束。

test('buildArmPrompt: 必须含工作边界约束（血的教训）', () => {
  const p = buildArmPrompt('x', 'B', '/tmp/demo');
  assert.match(p, /工作边界/, '要有边界段 —— 没有它 agent 会去探索周边目录');
  assert.match(p, /父目录|兄弟目录/, '要明确禁止看父/兄弟目录');
  assert.match(p, /\/tmp\/demo/, '要指明工作目录');
});

// 2026-09-17 第二次事故：只约束"读"不够。B 组为满足"让它真正生效"，
// 去写用户真实的 ~/.abs/hooks/ 下 7 个文件 —— 绕过工作目录，破坏真实环境。
// 任务需求本身在推着它越界，所以边界必须显式禁止"写外部文件"。
test('buildArmPrompt: 必须禁止写工作目录之外（真实事故：写穿了 ~/.abs/）', () => {
  const p = buildArmPrompt('x', 'B', '/tmp/demo');
  assert.match(p, /不要写这个目录之外/, '必须显式禁止外部写');
  assert.match(p, /\$HOME|~\/\.abs/, '要点名 $HOME/~/.abs 这类真实环境路径');
  assert.ok(/禁止|不要真的执行/.test(p), '要给出替代做法');
});

test('buildArmPrompt: 读约束与写约束都在（不能只留一个）', () => {
  const p = buildArmPrompt('x', 'A', '/tmp/demo');
  assert.match(p, /不要去列、读/, '读约束');
  assert.match(p, /不要写这个目录之外/, '写约束');
});

test('buildArmPrompt: A 组不提 .brain/（对照组的定义）', () => {
  const p = buildArmPrompt('x', 'A', '/tmp/demo');
  assert.ok(!p.includes('.brain'), '对照组 prompt 不该提到图谱 —— 提了就不是对照了');
});

test('buildArmPrompt: B 组要提示先读 .brain/', () => {
  const p = buildArmPrompt('x', 'B', '/tmp/demo');
  assert.match(p, /\.brain/, '实验组必须被告知有图谱');
});

test('buildArmPrompt: 除 .brain/ 那句外，两组 prompt 逐字相同', () => {
  // 边界约束必须对称，否则差异不只来自 .brain/
  const a = buildArmPrompt('x', 'A', '/tmp/demo');
  const b = buildArmPrompt('x', 'B', '/tmp/demo');
  // 剔除整句（含它带来的那个空行），再比对 —— 只删半句会留下空行差异，
  // 那是测试写法问题，不是 prompt 不对称（两次踩到）。
  const stripBrainHint = (s) =>
    s
      .split('\n')
      .filter((l) => !l.includes('.brain'))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n'); // 折叠因删行产生的多余空行
  assert.equal(stripBrainHint(a), stripBrainHint(b), '去掉图谱提示后两组 prompt 应完全一致');
});

// ---------- 覆盖守卫 ----------
// 2026-09-17 实测事故：agent 还在台子里干活时我重跑 init，旧目录被 rm -rf 抹掉。
// 那个 agent 没报错，而是自己找附近目录继续改，顺带看到了另一组 —— 数据报废且零信号。
// 故 init 默认拒绝覆盖同名实验，要重建得显式 --force。

test('cmdAbInit: 同名实验已存在时拒绝覆盖（防抹掉正在跑的 agent）', async () => {
  // 自建一个"已存在"的实验，再拿同名去 init —— 不依赖外部遗留目录
  const name = 'guard-unit-test';
  const first = await cmdAbInit({
    taskPath: '/tmp/abtest/real1.md',
    root: '/Users/fanchao/Code/agent_brain_sync',
    name,
  });
  assert.ok(!first.includes('拒绝覆盖'), `首次 init 不该被拒: ${first}`);
  const second = await cmdAbInit({
    taskPath: '/tmp/abtest/real1.md',
    root: '/Users/fanchao/Code/agent_brain_sync',
    name,
  });
  assert.match(second, /已存在，拒绝覆盖/);
  assert.match(second, /--force/, '要告诉用户怎么重建');
  // 清理：测完把台子删掉，别留垃圾
  await rm.rm(armDir(name, 'A'), { recursive: true, force: true });
  await rm.rm(armDir(name, 'B'), { recursive: true, force: true });
});

// ---------- 判据可比性自检 ----------
// 2026-09-17 三次实验失败的共同病根不是"两组没隔离"，而是**判据在两组上不等价**。
// 本仓已有的三道自检（只差 .brain/、目录互不可见、题面逐字相同）都查不到这一类。

test('checkCriterionComparable: 判据命令不存在（exit 127）要报"尺子坏了"', async () => {
  const name = 'crit-broken-cmd';
  await cmdAbInit({
    taskPath: '/tmp/abtest/real1.md',
    root: '/Users/fanchao/Code/agent_brain_sync',
    name,
  });
  const r = await checkCriterionComparable(name, 'this-cmd-does-not-exist-xyz');
  assert.ok(r.ran, '给了命令就该跑');
  assert.ok(
    r.problems.some((p) => /跑不起来|尺子坏了/.test(p)),
    `exit 127 必须被识别为尺子问题，而非作品失败: ${JSON.stringify(r.problems)}`,
  );
  await rm.rm(armDir(name, 'A'), { recursive: true, force: true });
  await rm.rm(armDir(name, 'B'), { recursive: true, force: true });
});

test('checkCriterionComparable: 基线已全绿要报"测不出改动"', async () => {
  const name = 'crit-already-green';
  await cmdAbInit({
    taskPath: '/tmp/abtest/real1.md',
    root: '/Users/fanchao/Code/agent_brain_sync',
    name,
  });
  // `true` 恒真 = 模拟"判据在起点就满足"，两组都会 PASS，差值必然 0
  const r = await checkCriterionComparable(name, 'true');
  assert.ok(
    r.problems.some((p) => /都已通过|测不出/.test(p)),
    `基线全绿必须报警，否则两组同 PASS 会被当成"无差异": ${JSON.stringify(r.problems)}`,
  );
  await rm.rm(armDir(name, 'A'), { recursive: true, force: true });
  await rm.rm(armDir(name, 'B'), { recursive: true, force: true });
});

test('checkCriterionComparable: 基线正确为红时不报（判据该跑前是红的）', async () => {
  const name = 'crit-correctly-red';
  await cmdAbInit({
    taskPath: '/tmp/abtest/real1.md',
    root: '/Users/fanchao/Code/agent_brain_sync',
    name,
  });
  const r = await checkCriterionComparable(name, 'false'); // 恒假 = 起点为红
  assert.equal(r.problems.length, 0, `基线为红是正常状态，不该报: ${JSON.stringify(r.problems)}`);
  assert.ok(r.ran);
  await rm.rm(armDir(name, 'A'), { recursive: true, force: true });
  await rm.rm(armDir(name, 'B'), { recursive: true, force: true });
});

// ---------- arm 目录后缀：A/B 必须不同 ----------
// 2026-09-17 实测：原 randSuffix 用多项式 h*31，种子只差末尾一个字符（...A vs ...B）
// 时 h 相差 1，再 slice(0,6) → 前 6 位 base36 完全一致。
// 后果：「随机后缀降低误撞」这层在多数实验名上根本没生效，两组在 /tmp 下并列可见。

test('armDir: A/B 的随机后缀必须不同（不是靠路径里的 A/B 段凑差别）', () => {
  // ⚠ 这里必须断言**后缀**，不能断言整个路径 ——
  // 路径里本来就有 `-A-` / `-B-` 段，两组永远不相等，
  // 于是 assert.notEqual(整个路径) 是**恒真的空测试**（初版就写错了，破坏验证才发现）。
  const suffixOf = (p) => p.split('/').pop().split('-').pop();
  for (const n of ['demo2', 'real1', 'x', 'exp', 'ab-test', 'a', '长实验名']) {
    const sa = suffixOf(armDir(n, 'A'));
    const sb = suffixOf(armDir(n, 'B'));
    assert.notEqual(
      sa, sb,
      `实验 ${n} 的 A/B 得到同一后缀 ${sa} —— 随机后缀没起作用（两组会并列可见）`,
    );
  }
});

test('armDir: 同实验同组重复调用要稳定（不能每次都变）', () => {
  assert.equal(armDir('stable', 'A'), armDir('stable', 'A'));
  assert.equal(armDir('stable', 'B'), armDir('stable', 'B'));
});

test('armDir: 不同实验要得到不同后缀', () => {
  const tags = new Set();
  for (let i = 0; i < 20; i++) tags.add(armDir('exp' + i, 'A'));
  assert.equal(tags.size, 20, '20 个不同实验名应得 20 个不同目录');
});

// ---------- 起点可比性（工作区脏 = 快照不含本次改动） ----------

test('checkWorktreeSnapshot: 脏工作区要报未提交改动数', async () => {
  const r = await checkWorktreeSnapshot('/Users/fanchao/Code/agent_brain_sync');
  assert.equal(typeof r.uncommitted, 'boolean');
  assert.equal(typeof r.n, 'number');
  // 本仓当前就是脏的（有未提交文件）—— 故这里应报 true；不是则说明 git 读取路径变了
  assert.ok(r.uncommitted, '本仓工作区当前有未提交改动，应报 true');
  assert.ok(r.n > 0);
});

test('checkWorktreeSnapshot: 非 git 目录不炸（返回 unknown）', async () => {
  const r = await checkWorktreeSnapshot('/tmp');
  assert.equal(r.uncommitted, false, '读不到 git 状态时不该误报"有改动"');
  assert.ok(r.unknown, '应标记为 unknown，让调用方知道这是"读不到"而非"很干净"');
});
