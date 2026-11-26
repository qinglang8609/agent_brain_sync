// code/brain/layers.js — 七层知识分层：唯一的层级判据来源。
//
// 为何要这一层（2026-11-01 用户定）：知识性质不同，检索权重就该不同。
//   铁律和随口一句话混在同一张图里、检索时一视同仁，是当前的真实缺陷。
//   分层的唯一技术作用 = 每层的衰减/权重不同，不是分类好看。
//
// 七层（用户原话）：
//   L1 铁律  —— 任何智能体不可逾越。物理位置 = index.md 的 `## Rules` 区，不是页。
//   L2 规则  —— 执行规则。
//   L3 工具  —— 工具使用经验。
//   L4 认知  —— 踩坑、实用经验、总结、重点事件。（默认层）
//   L5 会话  —— 会话内容、todo 记录、任务总结。物理位置 = sessions/ + todo.md。
//   L6 断点  —— 双链词，即页面里 `[[链接]]` 的链接名。不是页，是词的索引。
//   L7 混沌  —— 未分辨信息、大量琐碎会话。物理位置 = sources/。
//
// 设计约束（「稳定可靠」的三条硬指标）：
//   1. 层归属唯一：每页有且只有一个 layer；缺省补 4；非法值报错，不静默当成 4。
//   2. 层不会漂：写入走 frontmatter，读取时校验，漂了能被 lint 查出来。
//   3. 降级不崩：缺字段/坏库/缺项目 → 按目录推层，继续能跑。

export const LAYERS = [
  { id: 1, key: 'law',    name: '铁律', decay: 0,    note: '永不衰减，每次检索必出' },
  { id: 2, key: 'rule',   name: '规则', decay: 0.2,  note: '执行规则' },
  { id: 3, key: 'tool',   name: '工具', decay: 0.4,  note: '工具使用经验' },
  { id: 4, key: 'cognition', name: '认知', decay: 0.6, note: '踩坑、经验、重点事件（默认层）' },
  { id: 5, key: 'session', name: '会话', decay: 0.75, note: '会话内容、todo、任务总结' },
  { id: 6, key: 'anchor', name: 'Anchors', decay: 0.85, note: '双链词索引，不占页面' },
  { id: 7, key: 'chaos',  name: '混沌', decay: 0.95, note: '未分辨的琐碎信息' },
];

export const DEFAULT_LAYER = 4;

const BY_ID = new Map(LAYERS.map((l) => [l.id, l]));

/** 目录 → 层 的降级映射。只在无 layer 字段时用（用户定的自动迁移规则）。 */
export const DIR_LAYER = {
  sessions: 5,
  sources: 7,
  concepts: 4,
  entities: 4,
  syntheses: 4,
};

/** 层元信息。非法 id 返回 null（调用方据此报错，不静默兜底）。 */
export function layerOf(id) {
  return BY_ID.get(Number(id)) || null;
}

/** 该层的衰减系数。L1 = 0 表示不衰减。 */
export function decayOf(id) {
  const l = layerOf(id);
  return l ? l.decay : BY_ID.get(DEFAULT_LAYER).decay;
}


/** 会话页的骨架段名（由 ingest.js 的 SHAPES 决定，这里只用于判「填没填」）。
 *  与 ingest 的 SHAPES 必须同步 —— 加新形状时两处都要改。 */
export const DIGEST_SECTIONS = ['出了什么问题', '怎么解决的', '验证什么命令',
  '做了什么操作', '结果怎样', '下次注意事项', '谈成了什么', '没结论的地方'];

/** 会话摘要的骨架段里有没有任何一段写了真内容。
 *
 * 为何要这个判据（2026-11-05 实测）：`ingest --auto` 每次关会话都落一张空骨架，
 *   而空骨架的「用户原话」段有高词频、正文又短 —— bm25 天然占优。
 *   实测造 20 张空骨架后查「登录超时」：前 12 名全是空页，
 *   真正讲过这个问题的知识页被彻底挤出结果。
 *   所以「未填」必须能被算出来，才能把它们排除出检索。
 *
 * 判据：骨架段内除占位注释与空行外还有没有真内容。
 * 不看 status —— 人可能填完忘了改 active，用 status 会漏判。
 * 只看骨架段，不数「用户原话/改过的文件」—— 那两段是素材，不是填写成果。
 *
 * 段标题层级不写死（2026-11-08）：摘要现在并进当天的 `log-<日期>.md`，
 *   骨架段降为 `###`（`## 会话 <id8>` 是容器）。同一段名叫 `##` 或 `###` 都算，
 *   段的结束判据改成「遇到同级或更高级的标题」。 */
export function digestFilled(body) {
  const lines = String(body || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^(#{2,4})\s+(.+?)\s*$/);
    if (!h || !DIGEST_SECTIONS.includes(h[2].trim())) continue;
    const lvl = h[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      const hh = t.match(/^(#+)\s/);
      if (hh && hh[1].length <= lvl) break;                  // 同级/更高级标题 = 本段结束
      if (!t) continue;
      if (t.startsWith('<!--') || t === '-->') continue;      // 占位注释不算填
      return true;
    }
  }
  return false;
}

