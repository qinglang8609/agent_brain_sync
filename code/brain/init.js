// code/brain/init.js — 建 .brain/ 骨架、结构体检、三个受管文件的模板。
// 从 store.js 拆出（2026-11-01）：职责单一（只管骨架的生与补），与 load/task/rules 无关。
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { getUser } from '../userconfig.js';
import { editFile, SKIP } from '../lock.js';
import { rebuildAnchorIndex, renderAnchorSection } from './page-meta.js';
import { todoTemplate, rebuildStructure } from '../todo/index.js';

/** 知识页所在的目录（与 lint 的 PAGE_DIRS 同源；这里只用于补元数据）。 */
const PAGE_DIRS_META = ['concepts', 'entities', 'sources', 'syntheses', 'sessions'];

const BRAIN_DIRS = ['entities', 'concepts', 'sources', 'syntheses', 'sessions'];
const BRAIN_FILES = ['index.md', 'log.md', 'todo.md'];

export async function cmdInit({ dir }) {
  const root = resolveProjectDir(dir);
  const brain = join(root, '.brain');
  try {
    await fs.access(brain);
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e;
    return createSkeleton(root, brain);
  }
  // 已存在 → 校验结构完整性；损坏则明确报错并指引 repair（不静默半初始化）
  const report = await reportBrain({ dir: root });
  if (report.ok) throw new Error(`已存在: ${brain} (abort)`);
  throw new Error(
    `已存在但结构不完整:\n  ${report.problems.join('\n  ')}\n` +
    `  → 轻则补齐: abs init --repair    重则重建: 删掉 ${brain} 后重跑 abs init`
  );
}

async function createSkeleton(root, brain) {
  for (const d of BRAIN_DIRS) await fs.mkdir(join(brain, d), { recursive: true });
  // 走 editFile 而不是 fs.writeFile：三个文件是受管表，写入必须过同一道闸门
  // （2026-10-18：原来直写盘，是个绕过口）。模板本身合法，闸门只做归一。
  for (const [f, tpl] of [['index.md', indexTemplate], ['log.md', logTemplate], ['todo.md', todoTemplate]]) {
    await editFile(join(brain, f), (cur) => (cur === null ? { text: tpl() } : SKIP));
  }
  // 建完就提示设姓名 —— 否则用户一路到第一次 todo add 才撞墙，
  // 中间 init/load 都不提，根本不知道该设。
  const who = await getUser();
  const hint = who ? '' : `\n  ⚠ 尚未设置使用者姓名，写操作(todo add/log/note)会先报错。\n    请先设置: abs config set user <你的名字>`;
  return `✓ 已建图谱 ${brain}\n  (模板见 SKILL.md「.brain/ 怎么组织」)${hint}`;
}

/** 结构体检：6 目录 + 3 文件逐一核对。ok=false 时 problems 列出缺失项。 */
export async function reportBrain({ dir }) {
  const root = resolveProjectDir(dir);
  const brain = join(root, '.brain');
  const problems = [];
  for (const d of BRAIN_DIRS) {
    try {
      const st = await fs.stat(join(brain, d));
      if (!st.isDirectory()) problems.push(`缺目录 ${d}/ (被文件占位)`);
    } catch {
      problems.push(`缺目录 ${d}/`);
    }
  }
  for (const f of BRAIN_FILES) {
    try {
      await fs.access(join(brain, f));
    } catch {
      problems.push(`缺文件 ${f}`);
    }
  }
  return { ok: problems.length === 0, problems, brain };
}

/** 给存量知识页补 frontmatter 的 layer / anchors（只补缺，不覆盖已有值）。
 *
 * 为何放在 --repair 里（2026-11-20）：repair 的语义就是「只补缺、不覆盖」，
 *   与这里完全一致；另起一个命令只会多一个记不住的名字。
 * 返回改了几页、各补了什么，好让调用方能报出来。 */
export async function backfillPageMeta(brain) {
  const { ensurePageMeta } = await import('./page-meta.js');
  const fixed = [];
  for (const d of PAGE_DIRS_META) {
    const dp = join(brain, d);
    let files;
    try { files = await fs.readdir(dp); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      const full = join(dp, f);
      const body = await fs.readFile(full, 'utf8').catch(() => null);
      if (body === null) continue;
      const slug = f.replace(/\.md$/, '');
      const au = (body.match(/^author:\s*(.+)$/m) || [])[1];
      const res = ensurePageMeta(body, { dir: d, self: slug, author: (au || '').trim() });
      if (!res.added.length || res.text === body) continue;
      await fs.writeFile(full, res.text, 'utf8');
      fixed.push(`${d}/${f}（+${res.added.join('+')}）`);
    }
  }
  return fixed;
}

/** init --repair: 只补缺失骨架，绝不覆盖已有文件。 */
export async function cmdRepair({ dir, anchors = false } = {}) {
  const root = resolveProjectDir(dir);
  const brain = join(root, '.brain');
  try {
    await fs.access(brain);
  } catch {
    return createSkeleton(root, brain); // 整个图谱都没有 = 全新建
  }
  const fixed = [];
  for (const d of BRAIN_DIRS) {
    try {
      const st = await fs.stat(join(brain, d));
      if (!st.isDirectory()) {
        await fs.rm(join(brain, d), { force: true });
        await fs.mkdir(join(brain, d), { recursive: true });
        fixed.push(`${d}/`);
      }
    } catch {
      await fs.mkdir(join(brain, d), { recursive: true });
      fixed.push(`${d}/`);
    }
  }
  for (const [f, tpl] of [['index.md', indexTemplate], ['log.md', logTemplate], ['todo.md', todoTemplate]]) {
    try {
      await fs.access(join(brain, f));
    } catch {
      // 同 createSkeleton：补齐也走 editFile 的口子（已存在则 cur 非 null，不覆盖）
      await editFile(join(brain, f), (cur) => (cur === null ? { text: tpl() } : SKIP));
      fixed.push(f);
    }
  }
  // 存量页补 layer / anchors，再按新 anchors 重建 index.md 的断点段（2026-11-20）
  const pageFixed = await backfillPageMeta(brain);
  const anchor = await rebuildAnchorIndex(brain, { append: anchors });

  const anchorNote = anchor.changed ? `断点索引 ${anchor.words} 词` : '';
  const pageLine = pageFixed.length
    ? `\n  页面元数据补了 ${pageFixed.length} 张: ${pageFixed.slice(0, 5).join('、')}${pageFixed.length > 5 ? ' …' : ''}`
    : '';
  const touched = [...fixed, ...(pageFixed.length ? ['页面元数据'] : []), ...(anchorNote ? [anchorNote] : [])];
  if (!touched.length) return `✓ 结构完整，无需修复: ${brain}`;
  return `✓ 已补齐 ${touched.join(', ')} → ${brain}${pageLine}\n  (已有文件一律不覆盖)`;
}

function resolveProjectDir(dir) {
  // 必须显式回退 cwd: resolve(undefined) 会抛 ERR_INVALID_ARG_TYPE，
  // 并不像看上去那样「自动回退」。曾误删此分支为 resolve(dir)，把 abs init/load/board
  // 不带 --dir 全部变成裸栈崩溃。
  return resolve(dir || process.cwd());
}

export function indexTemplate() {
  // 同 todoTemplate：由 rebuildStructure 生成，模板 = 重排结果，不会来回抖。
  // ★ 无 `## Sessions`（2026-11-16 用户定）：会话页/归档页不再往 index 登记，
  //   目录不再兼当第二张表。存量库的该段由 RETIRED_SECTIONS 整段删除。
  return rebuildStructure(
    ['# 🗂 Graph Index', '',
      '本文件唯一入口。每新建/大改一页，同步在此分类下加一行 [[页面名]] — 一句话。', '',
      '## Rules', '## Concepts', '## Entities', '## Sources', '## Syntheses',
      // `## 断点` 是生成的跨页关键词索引（2026-11-20）。
      // 用 renderAnchorSection 生成空态占位 —— 与重建方同源，模板不会与重建结果漂开
      // （否则新库刚建好 lint 就报 ANCHOR-INDEX-STALE）。
      ...renderAnchorSection(new Map())].join('\n'),
    {
      h1: '# 🗂 Graph Index',
      // 无 `## Roadmap`：它是 AI 自己写的方向总结，会被 load 反复读到并带偏后续会话
      // （“看似是总结指引，其实是 AI 的总结指引” —— 2026-09-13 用户决策删除）。
      order: ['## Rules', '## Concepts', '## Entities', '## Sources', '## Syntheses', '## 断点'],
    },
  ).text;
}

export function logTemplate() {
  // ★ 占位符必须是注释形式，不能是真条目形状（2026-10-05 实测）：
  //   原来写的是 `## [YYYY-MM-DD] ingest | 沉淀 <slug>` —— 看起来像条目，
  //   但它不是真日期、也不是真 kind，条目形状闸门上线后**模板自己就非法**，
  //   新条目插到它上面后它掉到第 4 行，直接把写入卡死。
  //   用 HTML 注释保留「怎么写」的提示，同时不参与任何解析。
  return [
    '# 🗒 Activity Log', '',
    '<!-- 每条一行：## [YYYY-MM-DD HH:MM] [[作者]] kind | 正文（kind: note|dev|concept|ingest） -->', ''
  ].join('\n');
}
