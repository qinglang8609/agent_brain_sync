import { test } from "node:test";
import assert from "node:assert";
import { rankPage, matchPage, tagsOf, hasCJK } from "../../code/relevant.js";



test("tagsOf: 解析 frontmatter tags", () => {
  const body = "---\ntags: [concept, 部署, hook]\nid: x\n---\n正文";
  assert.deepEqual(tagsOf(body), ["concept", "部署", "hook"]);
});

test("tagsOf: 无 tags / 无 frontmatter -> []", () => {
  assert.deepEqual(tagsOf("---\nid: x\n---\n正文"), []);
  assert.deepEqual(tagsOf("就是一段正文"), []);
});

test("rankPage: tag 命中权重高于正文命中", () => {
  const withTag = "---\ntags: [concept, 部署]\n---\n正文";
  const bodyOnly = "---\ntags: [concept]\n---\n这里提到部署";
  const a = rankPage(withTag, "p1", ["部署"]);
  const b = rankPage(bodyOnly, "p2", ["部署"]);
  assert.ok(a.score > b.score, `tag 命中应更高: ${a.score} vs ${b.score}`);
  assert.deepEqual(a.via.tag, ["部署"]);
  assert.deepEqual(b.via.body, ["部署"]);
});

test("rankPage: 标题命中权重介于 tag 与正文之间", () => {
  const titleHit = rankPage("---\ntags: [concept]\n---\n正文", "deploy-flow", ["deploy"]);
  const bodyHit = rankPage("---\ntags: [concept]\n---\n提到 deploy", "other", ["deploy"]);
  assert.ok(titleHit.score > bodyHit.score, `${titleHit.score} > ${bodyHit.score}`);
  assert.deepEqual(titleHit.via.title, ["deploy"]);
});

test("rankPage: 无关短词不产生模糊假阳性", () => {
  // "不存在" 只有 [不存,存在] 两个 gram, 都常见 -> 不得靠模糊命中
  assert.equal(rankPage("随便一段中文正文", "p", ["zzzz不存在"]), null);
});

// ── 页 gram 缓存（2026-10-07 为修 load 慢而加）───────────────
//
// 背景：query 对每个词 × 每一页 调 rankPage（原 queryHint 已随自动带出移除），
//   而每次都对同一页重算整页 n-gram。实测 17 词 × 63 页 = 156ms，
//   CPU profile 显示 matchPage/ngrams 占 load 总耗时 82%。
//   加缓存后同样规模 23ms，load 端到端 191ms → 80ms。
//
// 这三个测试守的是「缓存不能改变结果 + 缓存真的生效」——
// 性能提升不能以正确性为代价；而正确性测试也抳不住性能退化（缓存写错键→永远 miss，
// 结果逐字不变，只有耗时变），故需单独一个「缓存确实命中」的测试。

test("页 gram 缓存: 缓存确实生效（防“写错键→永远 miss”的静默性能退化）", () => {
  // 为何单独要这一条（2026-10-07 实测）：把缓存键写错（如 inner.get(name+'x')）后，
  // 缓存永远 miss，但**计算结果逐字不变** —— 前两个正确性测试全绿，
  // 已实测验证过。只有计时能抳住它。
  //
  // 为何用相对比较而非绝对毫秒：CI 机器速度差异大，绝对阈值会假阳。
  // 同一进程内“缓存热”与“每页新 body”的对比，天然消除了机器差异。
  const q = ["并发写入", "互斥保护", "静默失效", "陈旧路径"];
  const body = "与查询词无关的中文正文甲乙丙丁戊己庚辛".repeat(300); // 够长，让 ngram 展开有可测开销

  // 冷：每次都换新页名，缓存键不同 → 每次都真算 ngram
  const tCold = Date.now();
  for (let i = 0; i < 200; i++) matchPage(body, "p" + i, q);
  const cold = Date.now() - tCold;

  // 热：固定页名，第二次起均命中缓存
  const tHot = Date.now();
  for (let i = 0; i < 200; i++) matchPage(body, "fixed", q);
  const hot = Date.now() - tHot;

  assert.ok(
    hot * 2 < cold,
    `缓存命中应明显快于每次现算（热 ${hot}ms vs 冷 ${cold}ms）` +
      "；若两者接近，说明缓存未生效（键写错/被清空）"
  );
});

test("页 gram 缓存: 同输入重复调用结果完全一致（缓存不改变行为）", () => {
  const body = "并发写入需要互斥保护" + "数据完整性".repeat(200);
  const first = rankPage(body, "p", ["并发写"]);
  const second = rankPage(body, "p", ["并发写"]);
  const third = rankPage(body, "p", ["并发写"]);
  assert.deepEqual(second, first, "第二次（已命中缓存）应与第一次相同");
  assert.deepEqual(third, first, "第三次（已命中缓存）应与第一次相同");
});

test("页 gram 缓存: 同正文不同页名不串味（页名参与 gram，必须各自算）", () => {
  // 这是缓存最危险的失效形态：页名的 gram 被写进共享的缓存项，
  // 下一页同正文就开始拿别人的页名参与匹配。
  //
  // ⚠ 夹具必须走 fuzzy（ratio 路径），不能靠 exact ——
  //  exact 的 `text.includes(q) || name.includes(q)` 在 matchPage 里现算、根本不碰缓存，
  //  用它写的串味测试会**永远绿**（实测：把两级 Map 改成一级、把缓存值改成被污染，
  //  两个破坏都照样全绿 —— 空测试）。故这里用 matchPage 直接断言 overlap 数值。
  //
  // 夹具实测：正文不含查询词；页名 "lock-并发-page" 含 "并发" → overlap=1，
  //  其余页名 overlap=0。若两页共用缓存，第二个会拿到第一个的 gram。
  const body = "这段正文和查询词毫无关系内容甲乙丙丁戊己庚辛";
  const q = ["并发写入", "互斥保护", "静默失效", "陈旧路径"];
  const A = "lock-并发-page";
  const B = "zzz-yyy-page";

  const a1 = matchPage(body, A, q);
  const b1 = matchPage(body, B, q);
  assert.equal(a1.overlap, 1, "页名含「并发」→ 应重到 1（这是夹具成立的前提）");
  assert.equal(b1.overlap, 0, "页名无关 → 应为 0");

  // 交换顺序再跑（此时两边都已在缓存里），结果必须各自不变
  const b2 = matchPage(body, B, q);
  const a2 = matchPage(body, A, q);
  assert.equal(b2.overlap, 0, "命中缓存后 B 仍应为 0（若串味会变成 1）");
  assert.equal(a2.overlap, 1, "命中缓存后 A 仍应为 1");
});

test("rankPage: 英文词不走 2-gram 模糊兜底（实测：ratio 恒为 1）", () => {
  // 根因(2026-09-17 实测): "relevant" 的 7 个 gram(re,el,ev,va,an,nt) 在任意英文页里都有,
  // ratio 恒为 1.0, 稳过 FUZZY_MIN=0.6 -> 每页都命中。
  // 实测后果: 44 页图谱上 query relevant -> 30 命中全是 fuzzy, 而 "relevant" 在那些页里出现 0 次。
  //
  // 夹具为何长这样: 短页 gram 太少，ratio 到不了 0.6（实测 "a"/"store todo lock" 都不复现），
  // 必须含足够多个 re/el/ev/va —— 下列两句实测 ratio=0.71/0.86，会稳过旧门槛。
  const noise = "reveal evil valve relay";
  assert.equal(rankPage(noise, "unrelated-page", ["relevant"]), null,
    "英文词无精确命中时应沉默，而不是靠 gram 巧合命中");
  assert.equal(rankPage("relevance everywhere", "p", ["relevant"]), null);
  // 对照: 真精确命中仍要走精确路径（不是把英文查询整体关掉）
  assert.equal(rankPage("此处提到 relevant 一词", "p", ["relevant"]).kind, "exact");
  // 对照: 中文查询的模糊兜底必须保留（它才是该机制的设计对象）
  assert.ok(hasCJK("并发写") && !hasCJK("relevant"));
});













// 断点（anchors）命中要真的影响排序（2026-11-20）：锚点写进页里但不给权重，
// 就只是死数据 —— 本仓踩过「定义了判据却没接到使用侧」。
test('断点命中加权：anchors 命中与字面命中同分时，断点命中排前面', async () => {
    const { promises: fs } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { cmdQuery } = await import('../../code/query.js');
    const dir = await fs.mkdtemp(join(tmpdir(), 'abs-anchor-'));
    const brain = join(dir, '.brain');
    for (const d of ['concepts', 'entities', 'sources', 'syntheses', 'sessions']) {
      await fs.mkdir(join(brain, d), { recursive: true });
    }
    await fs.writeFile(join(brain, 'index.md'), '# idx\n', 'utf8');
    // 两页正文完全相同（字面命中一样），只有 anchors 不同 —— 差别只应来自断点加权。
    const page = (id, anchors) => `---\ntags: [concept]\nid: ${id}\nlayer: 4\nanchors: [${anchors}]\nstatus: active\n---\n\n# 页 ${id}\n\nwidget 相关内容\n\n## 验证\n看输出\n`;
    await fs.writeFile(join(brain, 'concepts', 'a-anchor.md'), page('a-anchor', 'widget'), 'utf8');
    await fs.writeFile(join(brain, 'concepts', 'b-plain.md'), page('b-plain', '别的词'), 'utf8');
    const out = await cmdQuery({ dir, terms: ['widget'] });
    const aIdx = out.indexOf('a-anchor');
    const bIdx = out.indexOf('b-plain');
    assert.ok(aIdx >= 0 && bIdx >= 0, out);
    assert.ok(aIdx < bIdx, `断点命中应排前面:\n${out}`);
    assert.ok(/\[断点: widget\]/.test(out), `命中渠道要标出来:\n${out}`);
    await fs.rm(dir, { recursive: true, force: true });
});

// 断点词是短语，查询词往往只是它的一部分（2026-11-23）：
//   原来只认整词相等，查「入口出口」激活不了断点「入口出口同一判据」——
//   等于要求用户把断点词逐字背下来。改成双向包含，与 tag 命中同口径。
test('断点命中：查询词是断点词的一部分也算激活', async () => {
  const { promises: fs } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { cmdQuery } = await import('../../code/query.js');
  const dir = await fs.mkdtemp(join(tmpdir(), 'abs-anchor-part-'));
  const brain = join(dir, '.brain');
  for (const d of ['concepts', 'entities', 'sources', 'syntheses', 'sessions']) {
    await fs.mkdir(join(brain, d), { recursive: true });
  }
  await fs.writeFile(join(brain, 'index.md'), '# idx\n', 'utf8');
  const page = (id, anchors) =>
    `---\ntags: [concept]\nid: ${id}\nlayer: 4\nanchors: [${anchors}]\nstatus: active\n---\n\n# 页 ${id}\n\n入口出口 保持一致\n\n## 验证\n看输出\n`;
  await fs.writeFile(join(brain, 'concepts', 'a-part.md'), page('a-part', '入口出口同一判据'), 'utf8');
  await fs.writeFile(join(brain, 'concepts', 'b-plain.md'), page('b-plain', '别的词'), 'utf8');
  const out = await cmdQuery({ dir, terms: ['入口出口'] });
  assert.ok(/\[断点: 入口出口同一判据\]/.test(out), `部分词也要激活断点:\n${out}`);
  assert.ok(out.indexOf('a-part') < out.indexOf('b-plain'), `断点页应排前面:\n${out}`);
  await fs.rm(dir, { recursive: true, force: true });
});
