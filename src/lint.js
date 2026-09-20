// src/lint.js — 图谱体检（lint 检查逻辑）。
// 从 store.js 提取：cmdLint 过大（268 行），拆为 checkPage / checkGraph / checkFiles 三个子函数。
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { requireBrain, brainPath, BRAIN_DIR } from './index.js';
import { readRules, idOfPage, statusOfPage, supersededByOf, clip } from './store.js';
import { doneKindOf, doneDateOf } from './todo.js';

// ---------- 图谱遍历 ----------

export const PAGE_DIRS = ['entities', 'concepts', 'sources', 'syntheses', 'sessions'];

// concept/entity/synthesis 页的容量上限，超出提示"拆或外链"。
// 曾为 150L/5120B —— 实测偏紧：跨 4 项目 68 页里仅 2 页超限，且都只超一点
// （5463B / 5440B）；为满足它还把一页从 5319B 压到 4972B（内容受损、收益为零）。
// 放宽到 8KB：当前最大页 5463B，留约 50% 余量，但不至于失去"该拆了"的信号。
// 提成常量避免检查条件与提示文本各写一份而漂移。
const PAGE_MAX_LINES = 150;

/** 尾巴关键词：只要段名里带这些「动作词」，就认为作者在给「做完怎么确认」。
 *  为何不限定叫「验证」：实测 26 页段名高度分散（`## ✅ 处置` 17 次 > `## 🛠 解法`），
 *  只认「验证」会误报 7/11（64%）—— 噪音会让规则失去意义。 */
const TAIL_WORDS = '验证|检查|清单|测试|处置|做法|步骤|顺序|判据|信号|怎么';

/** concept 页是否有「尾」（可执行的东西）。
 *  两种真实形态都算：
 *   1. 有带动作词的段标题，且**段内有真内容** —— 排除 `abs concept` 骨架的
 *      `## 验证` + `<!-- 占位 -->`（只看标题会把未填的骨架误判为有尾）。
 *   2. 列表项形式，如 `3. 验证命令：\`cmd\``（hook-sh-not-bash / todo-rewrite-not-map 的写法）。
 *  逐行扫描而非复杂正则：需要「段边界」与「占位识别」，正则会难读且难改。 */
export function hasTail(body) {
  const lines = String(body || '').split('\n');
  const headRe = new RegExp(`^#{2,6}[^\\n]*(${TAIL_WORDS})`);
  for (let i = 0; i < lines.length; i++) {
    if (!headRe.test(lines[i])) continue;
    const lvl = lines[i].match(/^#+/)[0].length;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      const h = lines[j].match(/^(#+)\s/);
      if (h && h[1].length <= lvl) break;        // 本段结束，换下一段找
      if (!t) continue;
      if (t.startsWith('<!--') || t === '-->') continue; // 占位注释不算内容
      return true;
    }
  }
  return new RegExp(`^\\s*(?:\\d+\\.|[-*])\\s*\\**[^\\n]{0,20}(${TAIL_WORDS})`, 'm').test(String(body || ''));
}
const PAGE_MAX_BYTES = 8 * 1024;

// source 页超龄未提炼的天数阈值（SOURCE-UNDISTILLED）。
// 7 天 = 跨过至少一个完整工作周还没人提炼，基本等于被遗忘。
const SOURCE_STALE_DAYS = 7;
// draft 超龄阈值：新落的经验（abs note）默认 draft，指的是"还没核实过"。
// 长期停在 draft = 既没被核实也没被推翻，属"写了没人看"的堆积 —— 不自动改，只报。
const DRAFT_STALE_DAYS = 14;

// sources/ 目录文件数上限，超出提示提炼归档。与 cmdLoad 共用（load 做提醒，lint 做报错）。
export const SOURCES_MAX = 10;

// Rules 区条目上限（cmdLint 专用，cmdRule 有自己的 RULES_MAX）。
const LINT_RULES_MAX = 30;

export async function listPages(vault) {
  let indexText = '';
  try {
    indexText = await fs.readFile(join(vault, 'index.md'), 'utf8');
  } catch { /* no index yet */ }
  const pages = [];
  for (const d of PAGE_DIRS) {
    const dp = join(vault, d);
    let files;
    try {
      files = await fs.readdir(dp);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      const full = join(dp, f);
      const body = await fs.readFile(full, 'utf8').catch(() => '');
      const fm = body.match(/^---\n([\s\S]*?)\n---/);
      const links = [...new Set([...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].split('|')[0]))];
      pages.push({
        dir: d,
        // 带上 .brain/ 前缀：这串会原样出现在 lint 提示里，用户会拿它去找文件。
        // 坑: 曾经只给 vault 相对路径（concepts/x.md），用户到项目根找 concepts/ 找不到。
        rel: `${BRAIN_DIR}/${d}/${f}`,
        slug: f.replace(/\.md$/, ''),
        body,
        frontmatter: fm ? fm[1] : '',
        hasFrontmatter: body.startsWith('---\n'),
        links,
        lines: body.split('\n').length,
        bytes: Buffer.byteLength(body, 'utf8'),
        indexed: indexText.includes(`[[${f.replace(/\.md$/, '')}]]`),
        status: statusOfPage(body, fm ? fm[1] : ''),
        supersededBy: supersededByOf(body),
      });
    }
  }
  return pages;
}

// ---------- 页级检查 ----------

/** 单页检查：frontmatter / 链接 / 容量 / 尾巴 / index 登记。 */
function checkPage(pg, names, linkedNames, inbound) {
  const issues = [];
  if (!pg.hasFrontmatter) issues.push(`NO-FRONTMATTER: ${pg.rel}`);
  // ID-DRIFT: 页面写了 id 但已跟文件名(slug)不一致 = 改过名或改过 id。
  if (pg.hasFrontmatter) {
    const id = idOfPage(pg.body, pg.slug);
    if (id !== pg.slug) {
      issues.push(`ID-DRIFT: ${pg.rel} (frontmatter id=${id} ≠ 文件名 ${pg.slug}；` +
        `引用请用 [[${id}]] 或改回文件名)`);
    }
  }
  for (const ln of pg.links) {
    if (/^<.+>$/.test(ln) || /slug|Name|name|Date|页面名$/.test(ln)) {
      issues.push(`TEMPLATE-LINK: ${pg.rel} -> [[${ln}]]`);
    } else if (!names.has(ln)) {
      issues.push(`DEAD-LINK: ${pg.rel} -> [[${ln}]]`);
    }
  }
  const isTerminal = pg.dir === 'sources'
    || /todo归档$/.test(pg.slug)
    || (pg.dir === 'sessions' && /^log-/.test(pg.slug));
  if (!isTerminal && !pg.links.length && !linkedNames.has(pg.slug)) {
    issues.push(`ORPHAN-PAGE: ${pg.rel} (no links out, no links in)`);
  }
  if (['concepts', 'entities', 'syntheses'].includes(pg.dir) && !(inbound.get(pg.slug) || 0)) {
    issues.push(`NO-INBOUND: ${pg.rel} (无人链接到本页；在相关页的 ## 关联连接 挂一条 [[${pg.slug}]]）`);
  }
  if (/^#{2,6}[^\n]*知识冲突/m.test(pg.body) && /status: draft/.test(pg.frontmatter)) {
    issues.push(`UNRESOLVED-CONFLICT: ${pg.rel}`);
  }
  if (['concepts', 'entities', 'syntheses'].includes(pg.dir)) {
    if (pg.lines > PAGE_MAX_LINES || pg.bytes > PAGE_MAX_BYTES) {
      issues.push(`OVER-SIZE: ${pg.rel} (${pg.lines}L/${pg.bytes}B > ${PAGE_MAX_LINES}L/${PAGE_MAX_BYTES / 1024}KB; 拆或外链)`);
    }
  }
  if (pg.dir === 'concepts' && !hasTail(pg.body)) {
    issues.push(`NO-TAIL: ${pg.rel}（无「做完怎么确认」；尾巴写清跑什么/看什么/按什么判据，别只有头）`);
  }
  if (pg.dir !== 'sources' && !pg.indexed) {
    issues.push(`INDEX-MISSING: ${pg.rel} not listed as [[${pg.slug}]] in index.md`);
  }
  return issues;
}

// ---------- 跨页图谱检查 ----------

/** 跨页检查：sources 堆积/超龄、sessions 命名、superseded 悬挂、draft 超龄。 */
async function checkGraph(root, pages) {
  const issues = [];
  const nsrc = pages.filter((p) => p.dir === 'sources').length;
  if (nsrc > SOURCES_MAX) issues.push(`SOURCES-PILED-UP: sources/ has ${nsrc} files > ${SOURCES_MAX}; 提炼归档旧 source`);

  const conceptSlugs = new Set(pages.filter((p) => p.dir === 'concepts').map((p) => p.slug));
  const staleMs = SOURCE_STALE_DAYS * 86400 * 1000;
  for (const pg of pages) {
    if (pg.dir !== 'sources') continue;
    if (pg.links.some((ln) => conceptSlugs.has(ln))) continue;
    let ageMs = 0;
    try { ageMs = Date.now() - (await fs.stat(join(root, pg.rel))).mtimeMs; } catch { continue; }
    if (ageMs > staleMs) {
      issues.push(`SOURCE-UNDISTILLED: ${pg.rel}（${SOURCE_STALE_DAYS} 天未提炼成 concept；提炼后删 source 并清引用）`);
    }
  }

  // SESSIONS-NAMING: sessions/ 的一天一文件契约
  const sessByDate = new Map();
  for (const pg of pages) {
    if (pg.dir !== 'sessions') continue;
    const m = pg.slug.match(/^(?:log-)?(\d{4}-\d{2}-\d{2})/);
    if (!m) continue;
    const tags = String(pg.frontmatter).match(/^tags:\s*(.+)$/m)?.[1] || '';
    const tagList = tags.replace(/^\[|\]$/g, '').split(',').map((t) => t.trim());
    if (tagList.includes('archive')) continue;
    if (!sessByDate.has(m[1])) sessByDate.set(m[1], []);
    sessByDate.get(m[1]).push(pg.slug);
  }
  for (const [date, slugs] of sessByDate) {
    if (slugs.length > 1) {
      issues.push(`SESSIONS-SPLIT: ${date} 在 sessions/ 有 ${slugs.length} 个文件（${slugs.join('、')}）；` +
        `一天只应有一个 \`log-${date}.md\`：归档写进其「## 📦 任务归档」段，多主题写成多个 ## 子段`);
    } else if (!slugs[0].startsWith('log-')) {
      issues.push(`SESSIONS-NAMING: ${date} 的文件 \`${slugs[0]}.md\` 不是规范名；` +
        `应为 \`log-${date}.md\`（跑 abs todo archive 会并入；旧归档页可删）`);
    }
  }

  // SESSIONS-MISPLACED: sessions/ 里放了不属 sessions 的页
  for (const pg of pages) {
    if (pg.dir !== 'sessions') continue;
    const tags = String(pg.frontmatter).match(/^tags:\s*(.+)$/m)?.[1] || '';
    if (!/session-log|todo-archive|archive/.test(tags)) {
      issues.push(`SESSIONS-MISPLACED: ${pg.rel}（tags: ${tags.trim()} 不属 sessions/；` +
        `当天工作写进 \`log-<日期>.md\` 正文，暂存线索用 \`abs note\` 落 sources/）`);
    }
  }

  // SUPERSEDED-DANGLING
  for (const pg of pages) {
    if (pg.status !== 'superseded') continue;
    if (!pg.supersededBy) continue;
    const by = pg.supersededBy.replace(/^\[\[|\]\]$/g, '').trim();
    const names = new Set(pages.map((p) => p.slug));
    if (!names.has(by)) {
      issues.push(`SUPERSEDED-DANGLING: ${pg.rel} (superseded-by: ${by} —— 该页不存在，删页后未同步)`);
    }
  }

  // DRAFT-STALE
  for (const pg of pages) {
    if (pg.status !== 'draft') continue;
    if (pg.dir === 'sources') continue;
    let ageMs = 0;
    try { ageMs = Date.now() - (await fs.stat(join(root, pg.rel))).mtimeMs; } catch { continue; }
    if (ageMs > DRAFT_STALE_DAYS * 86400 * 1000) {
      const days = Math.floor(ageMs / 86400000);
      issues.push(`DRAFT-STALE: ${pg.rel}（已 ${days} 天停在 draft；核实后改 status: active，推翻则 abs supersede）`);
    }
  }
  return issues;
}

// ---------- 文件级检查（index / todo / rules） ----------

/** index.md 反向检查 + todo Done 区堆积 + Rules 区检查。 */
async function checkFiles(vault, pages, indexLinks) {
  const issues = [];
  const names = new Set(pages.map((p) => p.slug));
  for (const f of await fs.readdir(vault).catch(() => [])) {
    if (f.endsWith('.md')) names.add(f.replace(/\.md$/, ''));
  }

  // index.md 反向检查
  for (const ln of indexLinks) {
    if (/slug|Name|name|Date|页面名$/.test(ln)) continue;
    if (!names.has(ln)) issues.push(`INDEX-DEAD-LINK: index.md -> [[${ln}]] (该页不存在, 删页后忘清 index?)`);
  }

  // Done 区堆积
  const todoTxt = await fs.readFile(join(vault, 'todo.md'), 'utf8').catch(() => '');
  const di = todoTxt.split('\n').findIndex((l) => l.startsWith('## Done'));
  if (di !== -1) {
    const doneLines = todoTxt.split('\n').slice(di + 1).filter((l) => l.trim()).length;
    const DONE_MAX = 60;
    if (doneLines > DONE_MAX) {
      issues.push(`DONE-PILED-UP: Done 区 ${doneLines} 行 > ${DONE_MAX}; 跑 \`abs todo archive\` 迁出旧日期组`);
    }
    const doneBody = todoTxt.split('\n').slice(di + 1);
    const noKind = doneBody.filter((l) => /^\s*- \[x\]/.test(l) && !doneKindOf(l));
    if (noKind.length) {
      const sample = (noKind[0].match(/- \[x\] (\S+)/) || [, '?'])[1];
      issues.push(
        `DONE-NO-KIND: Done 区 ${noKind.length} 条缺结语（如 ${sample}）。` +
        `逐条补 \`--as 落地|否决|仅方案\`（新条目：abs todo done <id> --as …）`,
      );
    }
    const noDate = doneBody.filter((l) => /^\s*- \[x\]/.test(l) && !doneDateOf(l));
    if (noDate.length) {
      const sample = (noDate[0].match(/- \[x\] (\S+)/) || [, '?'])[1];
      issues.push(
        `DONE-NO-DATE: Done 区 ${noDate.length} 条缺 \`(完成 YYYY-MM-DD)\`（如 ${sample}）。` +
        `手写的 [x] 不会自动盖日期 —— 补上后重跑；新条目一律走 \`abs todo done <id>\`。`,
      );
    }
  }

  // Rules 区检查
  {
    const idxTxt = await readFileOrNull(join(vault, 'index.md'));
    const { items, found } = readRules(idxTxt);
    if (found && items.length > LINT_RULES_MAX) {
      issues.push(`RULES-PILED-UP: Rules 区 ${items.length} 条 > ${LINT_RULES_MAX}；把长条目提炼成概念页，这里只留一句话`);
    }
    const longOnes = items.filter((l) => l.trim().length > 160);
    if (longOnes.length) {
      issues.push(`RULES-TOO-LONG: Rules 区 ${longOnes.length} 条超 160 字符（如 "${clip(longOnes[0].trim(), 40)}"）；展开写进概念页，这里只留一句话（不带链接）`);
    }
  }
  return issues;
}

async function readFileOrNull(p) {
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

// ---------- 入口 ----------

export async function cmdLint({ dir }) {
  let root;
  try {
    root = await requireBrain(dir || process.cwd());
  } catch {
    return `未找到 .brain/ 图谱。先在项目根运行: abs init`;
  }
  const vault = brainPath(root);
  const pages = await listPages(vault);
  const names = new Set(pages.map((p) => p.slug));
  for (const f of await fs.readdir(vault).catch(() => [])) {
    if (f.endsWith('.md')) names.add(f.replace(/\.md$/, ''));
  }
  const linkedNames = new Set(pages.flatMap((p) => p.links));
  const inbound = new Map();
  for (const p of pages) for (const ln of p.links) inbound.set(ln, (inbound.get(ln) || 0) + 1);
  let indexLinks = [];
  try {
    const idx = await fs.readFile(join(vault, 'index.md'), 'utf8');
    indexLinks = [...idx.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());
  } catch { /* 无 index 则不查 */ }

  const issues = [];
  for (const pg of pages) issues.push(...checkPage(pg, names, linkedNames, inbound));
  issues.push(...await checkGraph(root, pages));
  issues.push(...await checkFiles(vault, pages, indexLinks));

  const n = issues.length;
  return [
    ...(issues.length ? issues : []),
    '',
    `lint: ${n} problem(s).`,
    n === 0 ? '✓ 图谱健康' : '',
  ].filter(Boolean).join('\n');
}