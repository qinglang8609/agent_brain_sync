// src/brain/evolve.js — 知识自我进化：从图谱里看出「知识在往哪走」。
//
// 为何需要它（2026-11-02 用户定目标「可自我成长的知识库」）：
//   图谱现在能存能查，但不会告诉人「哪里在变好、哪里在堆积、哪里该合并」。
//   光靠人定期回头看，就是靠记忆维护记忆 —— 必然漏。
//
// 四条判据，都只**报告**不判断（判断是内容决策，程序不替人做）：
//   1. 被推翻的：哪些页已 superseded、被谁取代、有没有留下空链
//   2. 主题堆积：同一主题词下页数过多，说明该合并成规律页
//   3. 只进不出：有新页被建立但没人链它，等于没接进网络
//   4. stale：长期没改动、且没有任何入边的页 —— 考察是否该删
//
// 输出纪律：按类型折叠计数，同类超阈值只报条数 + 样例（见 read-side-output-must-not-scale）。

/** 收集进化信号。只读，不改任何东西。 */
export function evolveSignals(handle, { staleDays = 90, now = Date.now() } = {}) {
  const { db } = handle;
  const all = db.prepare("SELECT id, slug, project, layer, status, superseded_by, mtime FROM nodes WHERE is_ledger = 0").all();
  const byId = new Map(all.map((r) => [r.id, r]));
  const inbound = new Map();
  for (const r of db.prepare('SELECT dst, count(*) c FROM edges WHERE dst > 0 GROUP BY dst').all()) inbound.set(r.dst, r.c);
  const outbound = new Map();
  for (const r of db.prepare('SELECT src, count(*) c FROM edges WHERE src > 0 GROUP BY src').all()) outbound.set(r.src, r.c);

  // 1. 被推翻的 vs 单纯弃用
  //
  // 两者都是 status=superseded，但含义不同（2026-11-02 修正）：
  //   · 被取代  —— 有 superseded-by，指向新页（知识更新了）
  //   · 单纯弃用 —— 没有 superseded-by（如「需求已否决，本页存档设计」）
  // 原来把「没写 superseded-by」一律报成断链，于是用户每跑一次 evolve 都被提醒
  // 一件并不存在问题的事（实测：corp_agent 的 run-command-controlled-exec
  // 正文写着「需求已否决」，那是存档不是断链）。
  // 真断链只有一种：**写了 by、但指向的页不存在**。
  const superseded = all.filter((r) => r.status === 'superseded');
  const retired = superseded.filter((r) => !r.superseded_by);   // 单纯弃用，不报警
  const replaced = superseded.filter((r) => r.superseded_by);   // 真被取代
  const danglingSupersede = replaced.filter((r) =>
    !all.some((x) => x.slug === r.superseded_by && x.project === r.project));

  // 2. 主题堆积：按 tags 里的**业务标签**归类。
  //
  // 坑（2026-11-02 实测）：tags 的第一项是**页面类型**（concept/source/session-log/entity），
  //   拿它归类必然把 58 页 concept 报成「一组堆积」—— 那是类型不是主题，全是噪音。
  //   类型词是固定的几个，直接按白名单跳过；主题看第二项起。
  // 另：会话流水页不参与主题堆积判断。
  //   它们的 tags 里带 `todo-archive`/`历史`，按主题归类会把 13 个归档快照
  //   报成「该合并成规律页」—— 但归档快照本来就该各自独立（一天一文件是目录契约）。
  //   判据看 dir：sessions/ 下的都是流水，不是知识页。
  const TYPE_TAGS = new Set(['concept', 'source', 'synthesis', 'entity', 'session-log']);
  const tagBuckets = new Map();
  for (const row of db.prepare("SELECT tags, slug FROM nodes WHERE is_ledger = 0 AND dir != 'sessions' AND tags != ''").all()) {
    const parts = String(row.tags).replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    const topic = parts.find((x) => !TYPE_TAGS.has(x.toLowerCase()));
    if (!topic) continue;
    if (!tagBuckets.has(topic)) tagBuckets.set(topic, []);
    tagBuckets.get(topic).push(row.slug);
  }
  const piled = [...tagBuckets.entries()]
    .filter(([, v]) => v.length >= 8)                      // 一个主题下 8 页以上算堆积
    .sort((a, b) => b[1].length - a[1].length);

  // 3. 只进不出：有入边但没有出边 —— 说明它是终点，不连回别处
  const sinkOnly = all.filter((r) => (inbound.get(r.id) || 0) > 0 && !(outbound.get(r.id) || 0));

  // 4. stale：长期没改 + 没人链
  const staleMs = staleDays * 86400_000;
  const stale = all.filter((r) => (now - (r.mtime || 0) > staleMs) && !(inbound.get(r.id) || 0));

  return {
    total: all.length,
    superseded, replaced, retired, danglingSupersede,
    piled, sinkOnly, stale,
    byId, inbound, outbound,
  };
}

/** 渲染成给人看的报告。按类型分组，同类超阈值只报样例。 */
export function renderEvolve(sig, { sample = 5, staleDays = 90 } = {}) {
  const out = [];
  const trunc = (arr, fmt) => {
    const shown = arr.slice(0, sample).map(fmt);
    if (arr.length > sample) shown.push(`  …另有 ${arr.length - sample} 条`);
    return shown;
  };

  out.push(`📈 图谱进化体检 — ${sig.total} 页`);
  out.push('');

  // 好消息放前面：推翻说明知识在更新
  if (sig.replaced.length) {
    out.push(`✓ 已推翻 ${sig.replaced.length} 页（知识在更新，不是坏事）`);
    out.push(...trunc(sig.replaced, (r) => `    ${r.slug} → ${r.superseded_by}`));
  } else {
    out.push('· 还没有被推翻的页 —— 要么知识很稳，要么没人回头修正');
  }
  if (sig.retired.length) {
    out.push(`· 另有 ${sig.retired.length} 页是单纯弃用（需求否决/方案作废），不是断链`);
    out.push(...trunc(sig.retired, (r) => `    ${r.slug}`));
  }
  out.push('');

  if (sig.danglingSupersede.length) {
    out.push(`⚠ ${sig.danglingSupersede.length} 页写了取代者但目标页不存在（历史断了）`);
    out.push(...trunc(sig.danglingSupersede, (r) => `    ${r.slug}`));
    out.push('  修: abs supersede <旧页> --by <新页>');
    out.push('');
  }

  if (sig.piled.length) {
    out.push(`⚠ 主题堆积 ${sig.piled.length} 组（同一主题下页数多，考虑合并成规律页）`);
    out.push(...trunc(sig.piled, ([tag, list]) => `    ${tag}: ${list.length} 页`));
    out.push('');
  }

  if (sig.sinkOnly.length) {
    out.push(`· 只被链、不链别人 ${sig.sinkOnly.length} 页（是终点，不回连——若它其实是枢纽，该补出链）`);
    out.push(...trunc(sig.sinkOnly, (r) => `    ${r.slug}  (入 ${sig.inbound.get(r.id)})`));
    out.push('');
  }

  if (sig.stale.length) {
    out.push(`· ${staleDays} 天没动且无人链 ${sig.stale.length} 页（可能该删或该接进网络）`);
    out.push(...trunc(sig.stale, (r) => {
      const days = Math.round((Date.now() - r.mtime) / 86400_000);
      return `    ${r.slug}  (${days} 天前)`;
    }));
    out.push('');
  }

  const issues = sig.danglingSupersede.length + sig.piled.length + sig.stale.length;
  out.push(issues === 0
    ? '✓ 没有需要立刻处理的进化问题'
    : `共 ${issues} 处待处理。这只是体检，改不改由你判断 —— 程序不替人做内容决策。`);
  return out.join('\n');
}
