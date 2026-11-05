// src/brain/layers.js — 七层知识分层：唯一的层级判据来源。
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
  { id: 6, key: 'anchor', name: '断点', decay: 0.85, note: '双链词索引，不占页面' },
  { id: 7, key: 'chaos',  name: '混沌', decay: 0.95, note: '未分辨的琐碎信息' },
];

export const LAYER_IDS = LAYERS.map((l) => l.id);
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

/** 解析页面 fullmatch 里的 layer 字段。
 * 返回 { layer, source, error }：
 *   source='frontmatter' 明确写了；'dir' 按目录推的；'default' 两者都没有。
 *   error 非空表示字段存在但非法 —— 调用方必须报出来，不能当正常。
 */
export function resolveLayer(body, dirName) {
  const m = String(body || '').match(/^layer:\s*(.+)$/m);
  if (m) {
    const raw = m[1].trim();
    const n = Number(raw);
    if (Number.isInteger(n) && BY_ID.has(n)) return { layer: n, source: 'frontmatter', error: null };
    return {
      layer: DIR_LAYER[dirName] ?? DEFAULT_LAYER,
      source: 'dir',
      error: `layer 非法（读到 "${raw}"，应为 1-7 的整数）`,
    };
  }
  const byDir = DIR_LAYER[dirName];
  if (byDir) return { layer: byDir, source: 'dir', error: null };
  return { layer: DEFAULT_LAYER, source: 'default', error: null };
}

/** 模板占位符 —— 它们出现在正文里是在**讨论语法**，不是真链接。
 * 实测（2026-11-01）：.brain 里 `[[作者]]` `[[页面名]]` `[[slug]]` 被当成真双链，
 * 污染断点词表并被报成悬挂链接。排除它们是判据，不是特例。 */
const PLACEHOLDER = new Set([
  '作者', '页面名', 'slug', '页面', '页名', '名称', 'x', 'y', 'foo', 'bar',
  // 讨论「双链 vs wiki」时提到的词（2026-11-02 实测：log-2026-09-17 里
  // 「抽词前剥掉 [[wiki]]」是指令，不是链接到某个 wiki 页）
  'wiki',
]);

/** 占位符形状：`[[TOOLS:...]]`、`[[A...B]]`、`[[前缀:xxx]]` 这类。
 * 它们是「描述语法时写的方括号」，不是真链接。
 * 判据（2026-11-02）：含省略号，或含冒号且冒号前是纯大写字母（像常量/枚举写法）。 */
function isPlaceholderShape(t) {
  if (/[.．]{2,}|\.\.\.|…/.test(t)) return true;          // 省略号
  if (/^[A-Z_]+[：:]/.test(t)) return true;                 // TOOLS:xxx 这类
  return false;
}

/** 提取页面里的双链词（L6 断点层的数据来源）。
 * `[[x]]` / `[[x|别名]]` / `[[x#小节]]` 都取 x。
 * 代码块与行内代码里的 `[[x]]` 是示例，不算。 */
export function anchorsOf(body) {
  const out = new Set();
  let text = String(body || '');
  // 去掉围栏代码块与行内代码 —— 那里面的双链是文档示例
  text = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
    const t = m[1].trim();
    if (!t) continue;
    if (PLACEHOLDER.has(t)) continue;
    if (isPlaceholderShape(t)) continue;
    // 纯符号/纯数字的不是页名
    if (!/[\p{L}\p{N}]/u.test(t)) continue;
    out.add(t);
  }
  return [...out];
}

/** 校验一页的层是否与目录相符，供 lint 用。
 * 只报「明确写了 layer 且与目录默认层冲突」的情况 —— 那是人有意为之的，
 * 值得看一眼；纯按目录推的不报（否则每页都是噪音）。 */
export function layerConflict(body, dirName) {
  const r = resolveLayer(body, dirName);
  if (r.error) return r.error;
  if (r.source !== 'frontmatter') return null;
  const expect = DIR_LAYER[dirName];
  if (!expect || expect === r.layer) return null;
  return `layer: ${r.layer} 与目录 ${dirName}/（默认 ${expect}）不符`;
}

/** 会话页的骨架段名（由 ingest.js 的 SHAPES 决定，这里只用于判「填没填」）。
 *  与 ingest 的 SHAPES 必须同步 —— 加新形状时两处都要改。 */
export const DIGEST_SECTIONS = ['出了什么问题', '怎么解决的', '验证什么命令',
  '做了什么操作', '结果怎样', '下次注意事项', '谈成了什么', '没结论的地方'];

/** 会话页的三段骨架里有没有任何一段写了真内容。
 *
 * 为何要这个判据（2026-11-05 实测）：`ingest --auto` 每次关会话都落一张空骨架，
 *   而空骨架的「用户原话」段有高词频、正文又短 —— bm25 天然占优。
 *   实测造 20 张空骨架后查「登录超时」：前 12 名全是空页，
 *   真正讲过这个问题的知识页被彻底挤出结果。
 *   所以「未填」必须能被算出来，才能把它们排除出检索。
 *
 * 判据：骨架段内除占位注释与空行外还有没有真内容。
 * 不看 status —— 人可能填完忘了改 active，用 status 会漏判。
 * 只看骨架段，不数「用户原话/改过的文件」—— 那两段是素材，不是填写成果。 */
export function digestFilled(body) {
  const lines = String(body || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^##\s+(.+?)\s*$/);
    if (!h || !DIGEST_SECTIONS.includes(h[1].trim())) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (/^##\s/.test(t)) break;                            // 下一段开始
      if (!t) continue;
      if (t.startsWith('<!--') || t === '-->') continue;      // 占位注释不算填
      return true;
    }
  }
  return false;
}

/** 这一页是不是「没人填过的会话页骨架」。入库时算一次，存成 unfilled 列。
 * 非会话页一律 false（只有 ingest 落的页才可能是空骨架）。 */
export function isUnfilledDigest(body) {
  const t = String(body || '');
  if (!/^kind:\s*session-digest$/m.test(t)) return false;
  return !digestFilled(t);
}
