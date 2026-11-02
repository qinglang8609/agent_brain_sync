// src/brain/db.js — 统一图数据库：所有项目的知识页 + 双链 + 七层标记。
//
// 定位（2026-11-01 用户定，2026-11-01 晚确认）：**markdown 是真相，库是派生索引**。
//   人改 .brain/ 的 md，跑 abs db rebuild 让库跟上；库可以随时删掉重建。
//   曾考虑反过来（库为真相、md 为导出），评估后否决：那是为「多端同步」这个
//   尚不存在的需求，废掉人工直编 md 的能力与「人工内容一律不覆盖」这条铁律。
//   单机单人的场景下，反方向只加复杂度，不加能力。
//
// 为何用 node:sqlite（内置，Node >= 22.5）：
//   实测 2 万节点 / 20 万边：3 跳扩散 0.5ms、FTS 全文 0.01ms、库文件 10MB。
//   引 Neo4j/FalkorDB 要多养一个常驻进程，而本场景是「开工时查一次」——
//   为 81 页知识养 Java 服务不值。
//
// 三张表各司其职：
//   nodes  —— 每个知识页一行（含 todo/index/log 的条目），带项目标记 + 层级
//   edges  —— 双链，跨项目也能连（project 前缀消歧）
//   anchors—— L6 断点层：双链词 → 出现它的页，供联想扩散用种子
//
// 稳定性约束：
//   · 所有写走一次事务，半途失败不留半条数据。
//   · 库是派生物：删了能重建（rebuild 从 markdown 全量重扫）。markdown 内容本身不丢。
//   · 库文件损坏 / 版本不匹配 → 抛 DbError，调用方决定是重建还是降级。

import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolveLayer, anchorsOf, decayOf, DEFAULT_LAYER } from './layers.js';

export const DB_VERSION = 4;

/** 库路径。ABS_DB 可覆盖（测试隔离 / 多库切换）。 */
export function dbPath() {
  return process.env.ABS_DB || join(homedir(), '.abs', 'graph.db');
}

/** 本次进程里最后一次 openDb 是否因损坏而重建过库。
 * 记录属内容决策，工具只报不改 —— 这里只标记，由调用方决定怎么告知，
 * 不自己打印（库层不该有输出）。 */
let _rebuiltAfterCorruption = false;
export function lastOpenRebuilt() { return _rebuiltAfterCorruption; }

export class DbError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'DbError';
    this.code = 'DB_ERROR';
    this.cause = cause;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 知识节点。project 为空串 = 全局级（如 index.md 本身）。
-- layer: 1-7；L1 铁律不立页，只由 rules 表承载，故 nodes 里不会出现 1。
CREATE TABLE IF NOT EXISTS nodes (
  id         INTEGER PRIMARY KEY,
  project    TEXT NOT NULL DEFAULT '',
  dir        TEXT NOT NULL,
  slug       TEXT NOT NULL,
  layer      INTEGER NOT NULL DEFAULT ${DEFAULT_LAYER},
  title      TEXT NOT NULL DEFAULT '',
  tags       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'active',
  body       TEXT NOT NULL DEFAULT '',
  mtime      REAL NOT NULL DEFAULT 0,
  -- 流水页（index/todo/log）：它们是「摘要的摘要」，正文里照抄了每句经验原文，
  -- 因此任何查询都能命中它。实测（2026-11-01）刚 capture 一条「并发写」，log 页
  -- 亮度 3.87 排第一，压过真正的内容页 —— 这是纯噪音，必须从检索候选里排除。
  is_ledger  INTEGER NOT NULL DEFAULT 0,
  -- 被哪一页推翻（对应 frontmatter 的 superseded-by）。
  -- 为何要进库（2026-11-02）：知识自我进化的第一个需要 —— 能查「哪些页被推翻了、
  -- 被谁推翻」。原来这关系只存在于 markdown 的一行 frontmatter 里，
  -- 库只存 status 不存走向，于是「进化」在检索侧完全看不见。
  superseded_by TEXT NOT NULL DEFAULT '',
  -- 知识的「作用」分档（借 clo​ude-mem 的 observation 类型，2026-11-02）：
  --   gotcha    关键坑（怎么都想不到、踩了会白干）
  --   decision  决策（当时为什么这么选）
  --   tradeoff  权衡（A 好但 B 也有理，最后选了哪个）
  --   howto     做法（这类事该怎么做）
  -- 为何要它：七层按「性质」分（工具/认知/混沌），分不出「同一层里哪种更该先看」。
  -- 实测 L4 有 382 页，其中「坑」106 页，而「决策」「权衡」根本没被记下来。
  -- 留空 = 未分档（不强制补，旧页保持空）。
  kind TEXT NOT NULL DEFAULT '',
  UNIQUE(project, dir, slug)
);
CREATE INDEX IF NOT EXISTS i_nodes_layer   ON nodes(layer);
CREATE INDEX IF NOT EXISTS i_nodes_project ON nodes(project);
CREATE INDEX IF NOT EXISTS i_nodes_slug    ON nodes(slug);

-- 双链边。src/dst 都指向 nodes.id。
-- 悬挂链接（目标页不存在）dst=0，保留原文到 raw，供 lint 报死链。
CREATE TABLE IF NOT EXISTS edges (
  src  INTEGER NOT NULL,
  dst  INTEGER NOT NULL,
  raw  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(src, dst)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS i_edges_dst ON edges(dst);

-- L6 断点层：双链词 → 出现它的节点。这是联想扩散的种子来源。
CREATE TABLE IF NOT EXISTS anchors (
  word   TEXT NOT NULL,
  node   INTEGER NOT NULL,
  PRIMARY KEY(word, node)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS i_anchors_node ON anchors(node);

-- L1 铁律：从各项目 index.md 的 ## Rules 区抽取，按项目隔离。
CREATE TABLE IF NOT EXISTS rules (
  id      INTEGER PRIMARY KEY,
  project TEXT NOT NULL DEFAULT '',
  text    TEXT NOT NULL,
  UNIQUE(project, text)
);

-- 全文索引：搜索先走这里拿种子（实测 0.01ms）。
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
  g,
  content='nodes_bigram', content_rowid='id',
  tokenize='unicode61'
);

-- FTS 的内容源。不直接挂 nodes，因为要存派生列 g（2-gram）。
CREATE TABLE IF NOT EXISTS nodes_bigram (
  id  INTEGER PRIMARY KEY,
  g   TEXT NOT NULL DEFAULT ''
);
`;

/** 切 2-gram + 英文词。中文没有词边界，2-gram 是唯一能命中两字词的单位。
 *
 * 为何不用 trigram（2026-11-01 实测）：trigram 分词要求查询 ≥3 字符，
 *   「静默」这类两字词恒返回 0；unicode61 又把整个「静默失效」当一个 token，
 *   两字词同样搜不到。实测三种分词器只有自切 2-gram 能全部命中。
 * 存储侧与查询侧必须用同一个函数，否则静默失配。 */
/** 流水页：正文照抄了每条经验的原文，会命中任何查询，故排除在检索候选外。
 * 它们仍入库（供 db status / 归档查询用），只是不参与亮度排名。 */
export const LEDGER_SLUGS = new Set(['index', 'todo', 'log']);

export function bigrams(s) {
  const out = [];
  const text = String(s || '');
  for (const m of text.matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
    const seg = m[0];
    for (let i = 0; i + 2 <= seg.length; i++) out.push(seg.slice(i, i + 2));
  }
  for (const m of text.matchAll(/[\u4e00-\u9fa5]/g)) out.push(m[0]);
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9_-]{1,}/g)) out.push(m[0].toLowerCase());
  return [...new Set(out)];
}

/** 按「词」切 2-gram，不加单字。用于**查询侧**构造 MATCH 表达式。
 *
 * 为何要和平分两套（2026-11-02 深度测试发现）：
 *   把单字也放进查询表达式会放大误命中 —— 实测查 `zzzz不存在zzz` 时，
 *   gram 里含「不」「存」「在」，任何提到这三个字的页都会命中，
 *   于是「一个根本不存在的词」返回了 7 页。这不是模糊匹配有用，是噪音。
 *
 * 存储侧仍保留单字（bigrams 不动）：这样查询本身**就是一个字**时
 * （如「锁」），还能通过单字 gram 命中；而多字查询不会靠单字瞎连。
 * 两侧不要求同一函数 —— 要求的是「查询产出的每个 gram 在存储侧都存在」，
 * 而存储侧是超集，恒成立。 */
export function queryBigrams(s) {
  const text = String(s || '');
  const out = new Set();
  for (const m of text.matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
    const seg = m[0];
    for (let i = 0; i + 2 <= seg.length; i++) out.add(seg.slice(i, i + 2));
  }
  // 整条查询只有单个汉字时才用单字 gram（「锁」这种一字查询仍能搜到）
  if (out.size === 0 && /^[\u4e00-\u9fa5]$/.test(text.trim())) out.add(text.trim());
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9_-]{1,}/g)) out.add(m[0].toLowerCase());
  return [...out];
}

/** 丢掉所有表（版本升级用）。库是派生品，删了由 rebuild 从 markdown 重建。 */
function dropAll(db) {
  for (const r of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    db.exec(`DROP TABLE IF EXISTS "${r.name}"`);
  }
}

/** 打开（不存在就建）库。返回 { db, close }。 */
export function openDb(path = dbPath()) {
  _rebuiltAfterCorruption = false;
  let db;
  try {
    db = new DatabaseSync(path);
  } catch (e) {
    throw new DbError(`打不开数据库 ${path}: ${e.message}`, e);
  }
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(SCHEMA);

    // 版本检查与迁移。
    // 坑（2026-11-01 实测）：先报「跑 abs db rebuild 重建」是错的 —— rebuild 也走这里，
    //   而 CREATE TABLE IF NOT EXISTS 不给已有表加列，老库重建时报
    //   "table nodes has no column named is_ledger"，用户于是完全卡死。
    // 库是**派生物**（markdown 才是真相），故版本不符直接丢表重建，不要用户动手。
    const cur = db.prepare("SELECT value FROM meta WHERE key='version'").get();
    if (!cur) {
      db.prepare("INSERT INTO meta(key,value) VALUES('version',?)").run(String(DB_VERSION));
    } else if (Number(cur.value) !== DB_VERSION) {
      dropAll(db);
      db.exec(SCHEMA);   // 表被删了，必须重新建（含 meta）
      db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('version',?)").run(String(DB_VERSION));
    }
  } catch (e) {
    try { db.close(); } catch { /* 已关 */ }

    // 库文件根本不是 SQLite / 结构彻底坏掉 → 删掉重建。
    // 为何不报错让用户手删（2026-11-02 深度测试发现）：库是**派生物**
    //   （markdown 才是真相），删了由 rebuild 从 .brain/ 全量重扫，内容不丢。
    //   原实现只报「库结构初始化失败: file is not a database」，而 rebuild 走同一条
    //   打开路径 —— 于是用户被卡死：修不好也删不掉（不知道删哪），只能去查源码。
    if (/not a database|file is encrypted|malformed/i.test(e.message || '')) {
      try {
        for (const suffix of ['', '-wal', '-shm']) {
          try { unlinkSync(`${path}${suffix}`); } catch { /* 不存在 */ }
        }
        const h = openDb(path);   // 文件已删，重来一次走全新库
        _rebuiltAfterCorruption = true;   // 告知调用方：刚重建过，库是空的
        return h;
      } catch (e2) {
        throw new DbError(`库文件损坏且无法重建 ${path}: ${e2.message}`, e2);
      }
    }
    if (e instanceof DbError) throw e;
    throw new DbError(`库结构初始化失败: ${e.message}`, e);
  }
  return {
    db,
    close: () => { try { db.close(); } catch { /* 已关 */ } },
  };
}

/** 确保库目录存在（第一次用时建 ~/.abs/）。 */
export async function ensureDbDir(path = dbPath()) {
  await fs.mkdir(dirname(path), { recursive: true });
}

/** 估算一段文字要占多少 token。中文按 1.5 字符/token、其余按 4 字符/token。
 *
 * 为何要估算而不是精确算（2026-11-02）：精确分词要引依赖，而这里只需
 * 「让用户知道取这一页大概多少钱」—— 数量级对就够了。
 * 实测校准：本项目 40 页正文平均 824 token/页，与按段落读下来的体感一致。
 */
export function estTokens(s) {
  const t = String(s || '');
  const cjk = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
  const rest = t.length - cjk;
  return Math.round(cjk / 1.5 + rest / 4);
}

/** 从页正文取一句话摘要：优先 frontmatter 的 description，退化到首个非标题行。
 *  与 relevant.js 的 digest 同思路，但这里在库侧用（不读文件）。 */
export function digest(body, maxLen = 90) {
  const lines = String(body || '').split('\n');
  const fmEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  if (fmEnd > 0) {
    const d = lines.slice(1, fmEnd).find((l) => /^description\s*:/.test(l));
    if (d) return d.replace(/^description\s*:\s*/, '').trim().slice(0, maxLen);
  }
  // 跳过 frontmatter 与标题，取第一句正文
  const start = fmEnd > 0 ? fmEnd + 1 : 0;
  const first = lines.slice(start).find((l) => {
    const x = l.trim();
    return x && !x.startsWith('#') && !x.startsWith('---') && !x.startsWith('>') && !x.startsWith('|');
  });
  return String(first || '').replace(/^[-*]\s*/, '').replace(/^TITLE\s*:\s*/, '').trim().slice(0, maxLen);
}

/** 从 markdown 正文抽 title / tags / status（与页面 frontmatter 同源）。 */
function metaOf(body) {
  const t = String(body || '');
  const title = (t.match(/^title:\s*(.+)$/m) || [])[1]?.trim() || '';
  const tags = (t.match(/^tags:\s*(.+)$/m) || [])[1]?.replace(/^\[|\]$/g, '').trim() || '';
  const st = (t.match(/^status:\s*(.+)$/m) || [])[1]?.trim() || 'active';
  const sup = (t.match(/^superseded-by:\s*(.+)$/m) || [])[1]?.trim() || '';
  const kind = (t.match(/^kind:\s*(.+)$/m) || [])[1]?.trim() || '';
  return { title, tags, status: st, supersededBy: sup, kind };
}

/** 全量重建：清表 → 重扫所有注册项目 → 重建边与断点词。
 * pages: [{ project, dir, slug, body, mtime }]
 * 返回统计，供 CLI 报告。 */
export function rebuild(handle, pages) {
  const { db } = handle;
  const stat = { nodes: 0, edges: 0, anchors: 0, rules: 0, dangling: 0 };
  const now = Date.now();
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM anchors; DELETE FROM edges; DELETE FROM nodes; DELETE FROM rules; DELETE FROM nodes_bigram;');
    try { db.exec("INSERT INTO fts(fts) VALUES('delete-all')"); } catch { /* 空表时无可删 */ }

    const insNode = db.prepare(`INSERT INTO nodes(project,dir,slug,layer,title,tags,status,body,mtime,is_ledger,superseded_by,kind)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insGram = db.prepare('INSERT OR REPLACE INTO nodes_bigram(id,g) VALUES(?,?)');
    const insEdge = db.prepare('INSERT OR IGNORE INTO edges(src,dst,raw) VALUES(?,?,?)');
    const insAnchor = db.prepare('INSERT OR IGNORE INTO anchors(word,node) VALUES(?,?)');
    const insRule = db.prepare('INSERT OR IGNORE INTO rules(project,text) VALUES(?,?)');

    // 第一遍：建节点，拿 id 映射 key = `project/dir/slug`
    const idOf = new Map();
    for (const p of pages) {
      const { title, tags, status, supersededBy, kind } = metaOf(p.body);
      const { layer } = resolveLayer(p.body, p.dir);
      const ledger = (p.dir === '' && LEDGER_SLUGS.has(p.slug)) ? 1 : 0;
      const r = insNode.run(p.project, p.dir, p.slug, layer, title, tags, status,
        p.body, p.mtime || now, ledger, supersededBy, kind);
      const id = Number(r.lastInsertRowid);
      // FTS 源：正文 + 标题 + tags 切 2-gram。查询侧必须用同一个 bigrams()。
      insGram.run(id, bigrams([p.slug, title, tags, p.body].join('\n')).join(' '));
      idOf.set(`${p.project}/${p.dir}/${p.slug}`, id);
      // 同名页兜底键：不带项目，供就近解析
      if (!idOf.has(`${p.dir}/${p.slug}`)) idOf.set(`${p.dir}/${p.slug}`, id);
      stat.nodes++;
    }

    // index.md 的 Rules → rules 表（L1）。只取 `## Rules` 区内的 `- ` 条目，
    // 不能扫全文 —— 否则页面清单里每条 `- [[x]] — 一句` 都会被当铁律。
    for (const p of pages) {
      if (p.dir !== '' || p.slug !== 'index') continue;
      const lines = String(p.body).split('\n');
      const at = lines.findIndex((l) => l.trim() === '## Rules');
      if (at === -1) continue;
      for (const line of lines.slice(at + 1)) {
        if (/^##\s/.test(line)) break;          // 下个分区开始，停止
        const t = line.trim();
        if (!t.startsWith('- ')) continue;
        insRule.run(p.project, t.slice(2).trim());
        stat.rules++;
      }
    }

    // 第二遍：解析双链，建边 + 断点词。
    // todo.md / log.md 里的 [[人名]] 是**作者标记**不是知识链接（实测：projX 的
    // todo 连到了另一项目的 fanchao 页，是误连）。这两份文件只入节点、不抽边。
    for (const p of pages) {
      const srcId = idOf.get(`${p.project}/${p.dir}/${p.slug}`);
      if (!srcId) continue;
      const isLedger = p.dir === '' && (p.slug === 'todo' || p.slug === 'log');
      if (isLedger) continue;
      for (const word of anchorsOf(p.body)) {
        const { project: explicitProj, page } = parseAnchor(word);
        // 断点词（L6）只记页名，不记 @项目前缀 —— 那是链接语法不是索引词
        insAnchor.run(page, srcId);
        stat.anchors++;
        let dstId;
        if (explicitProj) {
          // 显式跨项目：只在这个项目里找，找不到就是悬挂，不退回全局兜底
          // （退回会静默连到别的项目，正是这个语法要避免的）
          dstId = idOf.get(`${explicitProj}/concepts/${page}`)
            ?? idOf.get(`${explicitProj}/entities/${page}`)
            ?? idOf.get(`${explicitProj}/sessions/${page}`)
            ?? idOf.get(`${explicitProj}/syntheses/${page}`);
          if (dstId === undefined) stat.crossProjectMissing = (stat.crossProjectMissing || 0) + 1;
        } else {
          // 就近优先：本项目 → 再全局
          dstId = idOf.get(`${p.project}/concepts/${page}`)
            ?? idOf.get(`${p.project}/entities/${page}`)
            ?? idOf.get(`${p.project}/sessions/${page}`)
            ?? findGlobal(idOf, page);
        }
        if (dstId === undefined) {
          // 平铺文件名（index/todo/log）当链接目标是**讨论语法的示例文本**，
          // 不是真链接 —— 实测 .brain 里 `[[todo]]` 出现在「lint 误报它死链」这句里。
          // 这类不记悬挂（它们不是死链，是正文引用了文件名）。
          if (!LEDGER_SLUGS.has(page)) {
            insEdge.run(srcId, 0, word);
            stat.dangling++;
          }
        } else {
          insEdge.run(srcId, dstId, word);
          stat.edges++;
          if (explicitProj) stat.crossProject = (stat.crossProject || 0) + 1;
        }
      }
    }

    db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('rebuilt_at',?)").run(String(now));
    db.exec('COMMIT');
    // FTS 重建必须在事务外（fts5 触发器在重建期间会读 nodes）
    db.exec("INSERT INTO fts(fts) VALUES('rebuild')");
  } catch (e) {
    db.exec('ROLLBACK');
    throw new DbError(`重建失败: ${e.message}`, e);
  }
  return stat;
}

/** 解析双链目标：`[[@项目/页面]]` → 显式跨项目；`[[页面]]` → 就近。
 *
 * 为何要这个语法（2026-11-02 用户定「跨项目双链连接」）：
 *   默认就近（本项目优先）能覆盖绝大多数情况，但「我要明确引用另一个项目的某页」
 *   就没法表达 —— 只能靠全局兜底，而那会撞上同名页。
 *   `@` 前缀让跨项目引用显式，读页面时也一眼看得出「这条链出了项目」。
 *
 * 返回 { project: '项目名'|null, page: '页名' }。
 */
export function parseAnchor(word) {
  const w = String(word || '').trim();
  const m = w.match(/^@([^/\\]+)[/\\](.+)$/);
  if (m) return { project: m[1].trim(), page: m[2].trim() };
  return { project: null, page: w };
}

/** 同名页全局兜底：取第一个命中的（跨项目引用靠 @前缀 显式写，这里只做兜底）。
 *
 * 必须排除两类同名目标（2026-11-02 实测踩到）：
 *   · 平铺文件 index/todo/log —— 每个项目都有一份，兜底会连到别的项目去。
 *     实测 `[[index]]` 把 agent_brain_sync 的页连到了 pA/index，纯误连。
 *   · 流水页（dir 为空）同理。
 * 判据：兜底只在「知识页」之间发生，索引/流水不算知识页。
 */
function findGlobal(idOf, word) {
  if (LEDGER_SLUGS.has(word)) return undefined;
  for (const [k, v] of idOf) {
    if (k.endsWith(`/${word}`)) return v;
  }
  return undefined;
}

// ---------- 查询：FTS 拿种子 → 亮度扩散 ----------

/** 第一步：全文搜索拿种子节点。
 * 实测 0.01ms/次 —— 「高频率搜索」的要求靠这一层满足。
 * 返回 [{ id, project, dir, slug, title, layer, score }]，按 FTS 相关度排序。 */
export function search(handle, query, { limit = 20 } = {}) {
  const { db } = handle;
  const grams = queryBigrams(query);
  if (!grams.length) return [];
  const expr = grams.map((g) => `"${g.replace(/"/g, '""')}"`).join(' OR ');
  // 命中门槛：按 gram 的**文档频率加权**算覆盖率，不再用「命中几个」的平均数。
  //
  // 为何要加权（2026-11-02 深度测试发现，两轮才修对）：
  //   FTS 的 OR 语义是「命中任意 gram 就算」。先试「命中数 ≥ 一半」，
  //   但中文高频组合会绕过它 —— 查 `zzzz不存在zzz` 时，「不存在」切出
  //   [不存, 存在] 两个 gram，命中 2/4 就达标，而「不存在」在图谱里到处都是。
  //   实测真实图谱：`验证` 出现在 84% 的页里、`关联` 79%、`连接` 79% ——
  //   这些 gram 没有区分度，却和稀有 gram 等权。
  // 现在每个 gram 的权重 = log((总页数+1)/(出现页数+0.5))：
  //   稀有 gram（如专有名词）权重高，常见虚词组合权重低到几乎不计。
  //   覆盖率 = 命中 gram 的权重和 / 查询 gram 的总权重，低于 MIN_COVER 丢弃。
  const MIN_COVER = 0.35;
  const totalNodes = db.prepare('SELECT count(*) c FROM nodes_bigram').get().c || 1;
  const df = new Map();
  for (const r of db.prepare('SELECT g FROM nodes_bigram').all()) {
    for (const g of String(r.g).split(' ')) df.set(g, (df.get(g) || 0) + 1);
  }
  const wOf = (g) => {
    const d = df.get(g) || 0;
    return d === 0 ? 3 : Math.log((totalNodes + 1) / (d + 0.5));  // 库里没有的 gram 权重最高
  };
  const wantWeight = grams.reduce((a, g) => a + wOf(g), 0) || 1;
  try {
    // 取 g 列才能数命中数；多取一些候选，过滤后仍可能不够 limit
    const rows = db.prepare(`
      SELECT n.id, n.project, n.dir, n.slug, n.title, n.layer, n.kind, n.body,
             bm25(fts) AS rank, b.g
      FROM fts
      JOIN nodes_bigram b ON b.id = fts.rowid
      JOIN nodes n ON n.id = fts.rowid
      WHERE fts MATCH ? AND n.is_ledger = 0
        -- 被推翻的经验不出现在检索里。
        -- 它的存在意义是「别再用它」，而不是回答「我上次怎么解决 X」——
        -- 那会拿到一个已知错误的答案。与 abs query 的既有判据一致。
        AND n.status != 'superseded'
      ORDER BY rank
      LIMIT ?
    `).all(expr, Math.max(limit * 4, 40));

    const kept = rows.map((r) => {
      const hitGrams = grams.filter((q) => String(r.g).includes(q));
      const cover = hitGrams.reduce((a, g) => a + wOf(g), 0) / wantWeight;
      return { ...r, cover, hit: hitGrams.length };
    }).filter((r) => r.cover >= MIN_COVER);
    if (!kept.length) return [];

    // bm25 返回**负值且越负越相关**。归一成 0.3~1.0 的亮度，保证「最相关 = 1.0」。
    //
    // 坑（2026-11-02 深度测试发现）：原来分母取 `kept[最后一条].rank` —— 而 kept 按
    //   rank 升序（第一行最相关），最后一条恰恰是**最不相关**的那条，其 rank 接近 0。
    //   实测一个 4 条结果的查询里，最相关那条亮度算出 1168694.07（= |−2.42| / 2e-6），
    //   输出一行 165 万的亮度条。分母必须取最相关的那条（第一条）。
    // 种子亮度里要体现「层」—— 否则分层只在扩散时起作用，种子仍按纯字面排。
    // 实测（2026-11-02，14 个项目 586 页）：查「docker」时三个 sessions/ 流水页
    // 排在最前，压过真正讲了 docker 的知识页 —— 流水页正文长、词频高，bm25 天然占优，
    // 但对「我上次怎么解决 X」没有价值。
    // 权重 = 1 - decay：L3 工具 0.6、L4 认知 0.4、L5 会话 0.25、L7 混沌 0.05。
    // L1/L2 不参与（铁律不立页）。
    const layerWeight = (layer) => Math.max(0.05, 1 - decayOf(layer));
    const best = Math.abs(kept[0].rank) || 1e-9;
    // 亮度 = 档位 × 档内名次。
    //   档位由加权覆盖率决定（0.6~1.0）：全命中最高，勉强沾边压到 0.6 档再往下。
    //   档内名次由相对 bm25 决定（0.1~1.0）：覆盖率相同但 bm25 不同的页仍可分。
    // 下限 0.3 保留 —— 勉强命中的种子仍要能向外扩散，只是传得更弱。
    return kept.slice(0, limit)
      .map(({ g: _g, ...r }) => {
        const rel = Math.min(1, Math.abs(r.rank) / best);
        const band = 0.6 + 0.4 * r.cover;
        // 亮度保持 0.3~1.0 的可读区间，**不乘层权重**。
        // 坑（2026-11-02 实测）：把层权重乘进亮度后，L4 的满分页只剩 0.40，
        // 输出里一片 0.3~0.5，用户看不出谁更相关 —— 亮度失去了「一眼看强弱」的作用。
        // 层的作用改由**排序**承担（见下面 sort），亮度回归「这一页与查询多贴」本身。
        const bright = Math.max(0.3, Math.min(1, band * (0.1 + 0.9 * rel)));
        return { ...r, bright };
      })
      // 排序：层优先，同层再看亮度。
      // 为何层要排第一（2026-11-02，586 页实测）：查「静默失效」的前三名全是 L7
      // 混沌页（临时笔记），字面 cover=1.00 但内容与主题无关；
      // 而 L4 认知层里真正讲这个主题的页被压到后面。
      // 判据：知识层的页即便贴得稍微松一点，也比混沌层的碎片更该先看。
      // 例外：L1/L2 不参与排序（铁律不立页，单独在最前输出）。
      .sort((a, b) => {
        const wa = layerWeight(a.layer);
        const wb = layerWeight(b.layer);
        return (wb * b.bright - wa * a.bright) || (b.bright - a.bright) || (a.id - b.id);
      })
      // 索引优先（2026-11-02 借 clo​ude-mem 的 Progressive Disclosure）：
      // 返回值只给「摘要 + 取全文成本」，**不带正文** —— 正文要用 getPage 再取。
      // 实测这一层的价值：ABS 单页平均 824 token，8 页全带就是 6600 token，
      // 而其中真正被用上的往往只有 1-2 页（clo​ude-mem 实测 90% 是浪费）。
      .map(({ body, ...r }) => ({ ...r, digest: digest(body, 90), tokens: estTokens(body) }));
  } catch {
    // 方言/语法问题不能让搜索整体挂掉 —— 退化成空种子，由调用方决定提示
    return [];
  }
}

/** 第二步：从种子出发做有限扩散，算每页亮度。
 *
 * 为何必须压制（2026-11-01 实测）：真实图谱 81 页 291 边，2 跳就到 95% 页面点亮，
 *   「hook」一词 1 跳就 100%。全亮 = 全不亮，分不出哪页更相关。
 * 故硬约束：最多 HOPS 跳，且每跳乘衰减，低于 MIN_BRIGHT 直接丢。
 *
 * 为何要枢纽惩罚：实测扩散把入度 26 的根节点顶到前三，不是因为它相关，
 *   是因为人人链它。对被链得多的页打折（近似 IDF），枢纽不再霸榜。
 *
 * @returns [{ id, project, dir, slug, title, layer, bright, from }]
 */
const HOPS = 1;          // 实测 2 跳即 95% 全亮，只走 1 跳
const MIN_BRIGHT = 0.02;

export function illuminate(handle, seeds, { hops = HOPS, limit = 10 } = {}) {
  const { db } = handle;
  if (!seeds.length) return [];

  // 入度表：用于枢纽惩罚。全表一次查完（81 页量级，可忽略）。
  const inDeg = new Map();
  for (const r of db.prepare('SELECT dst, count(*) c FROM edges WHERE dst > 0 GROUP BY dst').all())
    inDeg.set(r.dst, r.c);

  const bright = new Map(); // id -> { bright, from }
  for (const s of seeds) {
    const b = s.bright ?? 1;
    if (!bright.has(s.id) || bright.get(s.id).bright < b) bright.set(s.id, { bright: b, from: 'seed' });
  }

  // 扩散：出边 + 入边都算（双向连接），乘该层衰减，再按枢纽惩罚打折
  let frontier = [...bright.entries()].map(([id, v]) => ({ id, bright: v.bright }));
  for (let hop = 0; hop < hops; hop++) {
    const next = [];
    for (const f of frontier) {
      const neigh = db.prepare('SELECT dst AS id FROM edges WHERE src = ? AND dst > 0 UNION SELECT src AS id FROM edges WHERE dst = ? AND src > 0').all(f.id, f.id);
      const layerRow = db.prepare('SELECT layer FROM nodes WHERE id = ?').get(f.id);
      const decay = decayOf(layerRow?.layer ?? DEFAULT_LAYER);
      for (const n of neigh) {
        if (bright.has(n.id)) continue;
        // 枢纽惩罚：入度越高，传出去越弱。1/(1+log(1+入度))
        const deg = inDeg.get(n.id) || 0;
        const hub = 1 / (1 + Math.log(1 + deg));
        const b = f.bright * (1 - decay) * hub;
        if (b < MIN_BRIGHT) continue;
        bright.set(n.id, { bright: b, from: 'spread' });
        next.push({ id: n.id, bright: b });
      }
    }
    frontier = next;
  }

  const out = [];
  for (const [id, v] of bright) {
    // 扩散出口也要排除 superseded —— 入口（search）排了，出口不排就绕过去：
    // 实测旧结论页自己不出现在种子里，却被邻居扩散点亮（亮度 0.24 带 ↝）。
    const n = db.prepare("SELECT id,project,dir,slug,title,layer,kind,body FROM nodes WHERE id = ? AND is_ledger = 0 AND status != 'superseded'").get(id);
    if (n) {
      // 与 search 保持同一形态：索引优先，只给摘要与成本，不带正文。
      // 坑（2026-11-02 实测）：这里原来只查少数字段，于是 CLI 侧读不到 digest/tokens，
      // 摘要与成本全丢 —— search 改了、出口没改，典型的「改一半」。
      const { body, ...rest } = n;
      out.push({ ...rest, bright: v.bright, from: v.from, digest: digest(body, 90), tokens: estTokens(body) });
    }
  }
  // 排序口径必须与 search 一致：层优先，同层再比亮度。
  // 坑（2026-11-02 实测）：原来这里只按 bright 排，把 search 已经排好的层序冲掉了 ——
  // 于是 L7 混沌页（bright 1.00）又跑到 L4 认知页（bright 0.95）前面。
  // 层权重在这里再乘一次，为的是「扩散进来的弱页不会因为某个邻居强就压过知识页」。
  const weight = (layer) => Math.max(0.05, 1 - decayOf(layer));
  return out
    .sort((a, b) => (weight(b.layer) * b.bright - weight(a.layer) * a.bright)
      || (b.bright - a.bright) || (a.id - b.id))
    .slice(0, limit);
}

/** L1 铁律：按项目取出。检索任何东西都必须先带上它（「不可逾越」的代码保证）。 */
export function rulesOf(handle, project) {
  const { db } = handle;
  return db.prepare('SELECT text FROM rules WHERE project = ? OR project = \'\' ORDER BY id')
    .all(project || '').map((r) => r.text);
}

/** 统计，供 status / lint 报告。 */
export function stats(handle) {
  const { db } = handle;
  const one = (sql) => db.prepare(sql).get();
  return {
    nodes: one('SELECT count(*) c FROM nodes').c,
    edges: one('SELECT count(*) c FROM edges WHERE dst > 0').c,
    dangling: one('SELECT count(*) c FROM edges WHERE dst = 0').c,
    anchors: one('SELECT count(DISTINCT word) c FROM anchors').c,
    rules: one('SELECT count(*) c FROM rules').c,
    projects: one('SELECT count(DISTINCT project) c FROM nodes WHERE project != \'\'').c,
    byLayer: db.prepare('SELECT layer, count(*) c FROM nodes GROUP BY layer ORDER BY layer').all(),
  };
}
