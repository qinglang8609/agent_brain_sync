import { test } from "node:test";
import assert from "node:assert";
import { keywords, scorePage, pickRelevant, digest, renderRelevant, rankPage, tagsOf, hasCJK, topicStrength } from "../src/relevant.js";

test("topicStrength: 只数 tag/页名级命中，正文子串不计", () => {
  // 实测动机: hint 原取词拿词表前几个（无质量信号）→ 提示语变成废词。
  const pages = [
    { name: "hook-throttle", body: "---\ntags: [concept, hook]\n---\n正文" },
    { name: "other-page", body: "正文里提到 hook 但不在 tags/页名" },
    { name: "noise-page", body: "正文什么都不提" },
  ];
  const s = topicStrength(pages, ["hook", "nevermentioned"]);
  assert.equal(s.get("hook"), 1, "只有 tags/页名命中才算主题级（正文子串不算）");
  assert.equal(s.get("nevermentioned"), 0, "无命中应为 0（调用方据此剔除）");
});

test("topicStrength: 分离度可辨识 —— 好词高分、废词 0 分", () => {
  // 尺子实测（44 页图谱）: hook 6 / todo 4 / lock 2  vs  queryhint-noise 0 / 进行 0
  const pages = [
    { name: "a", body: "---\ntags: [hook]\n---\n" },
    { name: "b", body: "---\ntags: [hook, todo]\n---\n" },
    { name: "c", body: "---\ntags: [todo]\n---\n" },
  ];
  const s = topicStrength(pages, ["hook", "todo", "进行", "queryhint-noise"]);
  assert.ok(s.get("hook") > s.get("进行"), "好词强度应高于废词");
  assert.equal(s.get("进行"), 0);
  assert.equal(s.get("queryhint-noise"), 0);
});

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

test("keywords: 英文词 + 中文 2-gram, 去停用词", () => {
  const k = keywords("修复 cache 的失效逻辑");
  assert.ok(k.includes("cache"), "英文词应保留");
  assert.ok(!k.includes("abs") && !k.includes("the"), "停用词应去掉");
  assert.ok(k.some((x) => x.includes("失效")), "中文应切出 2-gram");
});

test("keywords: 太短的英文词丢掉 (避免噪音)", () => {
  const k = keywords("a b cd efg");
  assert.ok(!k.includes("a") && !k.includes("b") && !k.includes("cd"));
  assert.ok(k.includes("efg"));
});

test("scorePage: 标题命中权重高于正文", () => {
  const kws = ["cache"];
  const inTitle = scorePage("正文里也有 cache", "cache-design", kws);
  const inBody = scorePage("正文里也有 cache", "other-page", kws);
  assert.ok(inTitle.score > inBody.score, `标题命中应更高: ${inTitle.score} vs ${inBody.score}`);
});

test("scorePage: 同一关键词在正文出现多次有上限 (防长页霸榜)", () => {
  const kws = ["xword"];
  const many = scorePage("xword ".repeat(50), "p", kws);
  const few = scorePage("xword", "p", kws);
  assert.ok(many.score <= few.score + 2, `重复应封顶: ${many.score} vs ${few.score}`);
});

test("pickRelevant: 无关键词返回空 (不硬凑)", () => {
  const pages = [{ name: "a", body: "任意内容" }];
  assert.deepEqual(pickRelevant(pages, [], 3), []);
});

test("pickRelevant: 同分时按名字排序 (输出稳定)", () => {
  const pages = [
    { name: "zebra", body: "cache" },
    { name: "apple", body: "cache" },
  ];
  const r = pickRelevant(pages, ["cache"], 3);
  assert.deepEqual(r.map((p) => p.name), ["apple", "zebra"]);
});

test("pickRelevant: 只返回有命中的, 且受 top-N 限制", () => {
  const pages = [
    { name: "a", body: "cache" },
    { name: "b", body: "cache" },
    { name: "c", body: "cache" },
    { name: "d", body: "无关" },
  ];
  const r = pickRelevant(pages, ["cache"], 2);
  assert.equal(r.length, 2);
  assert.ok(!r.some((p) => p.name === "d"), "无命中不应返回");
});

test("digest: 优先 frontmatter description", () => {
  const body = "---\ntitle: X\ndescription: 这是描述\n---\n# 标题\n正文";
  assert.equal(digest(body), "这是描述");
});

test("digest: 无 frontmatter → 首个非标题行", () => {
  const body = "---\ntitle: X\n---\n# 标题\n\n第一段正文";
  assert.equal(digest(body), "第一段正文");
});

test("renderRelevant: 空结果不占体积", () => {
  assert.equal(renderRelevant([]), "");
});

test("renderRelevant: 含页名与摘要", () => {
  const out = renderRelevant([{ name: "foo", body: "第一行", score: 5, hit: ["a"] }]);
  assert.match(out, /\[\[foo\]\]/);
  assert.match(out, /第一行/);
});

test("端到端: 关键词从'正在干的活'推出该读哪页", () => {
  const pages = [
    { name: "file-write-locking", body: "---\ndescription: 并发写锁\n---\nabs 所有 md 都是读-改-写回" },
    { name: "npm-publish-flow", body: "---\ndescription: 发布流程\n---\n版本号与测试" },
  ];
  // 输入模拟"最近改的文件名 + 活跃任务"
  const kws = keywords("store.js 并发写 丢更新");
  const picked = pickRelevant(pages, kws, 2);
  assert.ok(picked.length >= 1, "应命中至少一页");
  assert.equal(picked[0].name, "file-write-locking", "应优先命中并发写那页");
});
