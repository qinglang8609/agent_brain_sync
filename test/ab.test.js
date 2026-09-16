import { test } from 'node:test';
import assert from 'node:assert';
import { promises as rm } from 'node:fs';
import { checkTaskForLeaks, verifyArms, ARMS, cmdAbInit, buildArmPrompt, armDir } from '../src/ab.js';

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
