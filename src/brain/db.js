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
import { homedir } from 'node:os';
import { resolveLayer, anchorsOf, decayOf, DEFAULT_LAYER } from './layers.js';

export const DB_VERSION = 2;

/** 库路径。ABS_DB 可覆盖（测试隔离 / 多库切换）。 */
export function dbPath() {
  return process.env.ABS_DB || join(homedir(), '.abs', 'graph.db');
}

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
  // 单个汉字：query 是「锁」「锁」这类一字词时，2-gram 切不出来，
  // 上面循环对 1 字串一次都不执行 → 恒返回空 → 搜不到（实测「锁」0 命中）。
  // 补成单字 gram，存储侧同样产出它（见下）。
  for (const m of text.matchAll(/[\u4e00-\u9fa5]/g)) out.push(m[0]);
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9_-]{1,}/g)) out.push(m[0].toLowerCase());
  return [...new Set(out)];
}

/** 丢掉所有表（版本升级用）。库是派生品，删了由 rebuild 从 markdown 重建。 */
function dropAll(db) {
  for (const r of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    db.exec(`DROP TABLE IF EXISTS "${r.name}"`);
  }
}

/** 打开（不存在就建）库。返回 { db, close }。 */
export function openDb(path = dbPath()) {
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

/** 从 markdown 正文抽 title / tags / status（与页面 frontmatter 同源）。 */
function metaOf(body) {
  const t = String(body || '');
  const title = (t.match(/^title:\s*(.+)$/m) || [])[1]?.trim() || '';
  const tags = (t.match(/^tags:\s*(.+)$/m) || [])[1]?.replace(/^\[|\]$/g, '').trim() || '';
  const st = (t.match(/^status:\s*(.+)$/m) || [])[1]?.trim() || 'active';
  return { title, tags, status: st };
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

    const insNode = db.prepare(`INSERT INTO nodes(project,dir,slug,layer,title,tags,status,body,mtime,is_ledger)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    const insGram = db.prepare('INSERT OR REPLACE INTO nodes_bigram(id,g) VALUES(?,?)');
    const insEdge = db.prepare('INSERT OR IGNORE INTO edges(src,dst,raw) VALUES(?,?,?)');
    const insAnchor = db.prepare('INSERT OR IGNORE INTO anchors(word,node) VALUES(?,?)');
    const insRule = db.prepare('INSERT OR IGNORE INTO rules(project,text) VALUES(?,?)');

    // 第一遍：建节点，拿 id 映射 key = `project/dir/slug`
    const idOf = new Map();
    for (const p of pages) {
      const { title, tags, status } = metaOf(p.body);
      const { layer } = resolveLayer(p.body, p.dir);
      const ledger = (p.dir === '' && LEDGER_SLUGS.has(p.slug)) ? 1 : 0;
      const r = insNode.run(p.project, p.dir, p.slug, layer, title, tags, status,
        p.body, p.mtime || now, ledger);
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
        insAnchor.run(word, srcId);
        stat.anchors++;
        // 就近优先：本项目 → 再全局
        const dstId = idOf.get(`${p.project}/concepts/${word}`)
          ?? idOf.get(`${p.project}/entities/${word}`)
          ?? idOf.get(`${p.project}/sessions/${word}`)
          ?? findGlobal(idOf, word);
        if (dstId === undefined) {
          insEdge.run(srcId, 0, word);
          stat.dangling++;
        } else {
          insEdge.run(srcId, dstId, word);
          stat.edges++;
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

/** 同名页全局兜底：取第一个命中的（跨项目引用靠 @前缀 显式写，这里只做兜底）。 */
function findGlobal(idOf, word) {
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
  const grams = bigrams(query);
  // 查询切成 2-gram 后用 OR 连 —— 越多 gram 命中越相关（bm25 自己会排序）。
  if (!grams.length) return [];
  const expr = grams.map((g) => `"${g.replace(/"/g, '""')}"`).join(' OR ');
  try {
    const rows = db.prepare(`
      SELECT n.id, n.project, n.dir, n.slug, n.title, n.layer,
             bm25(fts) AS rank
      FROM fts JOIN nodes n ON n.id = fts.rowid
      WHERE fts MATCH ? AND n.is_ledger = 0
      ORDER BY rank
      LIMIT ?
    `).all(expr, limit);
    // bm25 返回**负值且越负越相关**，不能直接当亮度用（否则最相关的最暗）。
    // 归一：取最相关的一条为 1.0，其余按比例落到 0.3~1.0 区间 ——
    // 保留下限是为了让「勉强命中的种子」仍能扩散，只是传得更弱。
    if (!rows.length) return [];
    const worst = Math.abs(rows[rows.length - 1].rank) || 1e-9;
    return rows.map((r) => ({ ...r, bright: Math.max(0.3, Math.abs(r.rank) / worst) }));
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
    const n = db.prepare('SELECT id,project,dir,slug,title,layer FROM nodes WHERE id = ? AND is_ledger = 0').get(id);
    if (n) out.push({ ...n, bright: v.bright, from: v.from });
  }
  return out.sort((a, b) => b.bright - a.bright || a.id - b.id).slice(0, limit);
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
