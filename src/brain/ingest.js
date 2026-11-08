// src/brain/ingest.js — 把一场 pi 会话生成一张**会话页**，并与会话记录双向挂钩。
//
// 为何要它（2026-11-05 用户定）：abs 原来只沉淀「编程经验与教训」——
//   所有落盘管道都压成「触发场景/❌表现/🛠解法/验证」四段（note.js 的 concept 骨架），
//   于是会话里那些「谈成了什么决定」「这次干了什么活」全没有落点。
//   实测：全机 485 场 pi 会话，只有 27 天有快照，最多提过 66 场；
//   而且 92 场通读下来只提炼出 3 条规律 —— 因为多数会话是「干具体的活」，不是修 bug。
//   要做大型知识图谱，会话本身就得成为一等知识。
//
// 与 summon 的分工：summon 回答「哪几场没总结」（只读，不写盘）；
//   本模块回答「这场会话留下了什么」（写盘，但**只写素材，不写结论**）。
//   判断仍是 agent 的 —— 这里不猜语义，只把会话里**已经存在的**事实整理成页。
//
// 双向挂钩（用户 2026-11-05 要求「资料要与 pi 的会话挂钩」）：
//   页 → 会话：段内的 `挂钩: session=… session-file=… project=…` 一行
//   会话 → 页：段标题 `## 会话 <会话 id 前 8 位>`，拿会话文件就能在当天页里反查
//             有没有被总结过（summon 的 md5 账本同理）。
//   为什么不把「页路径」回写进 jsonl：pi 的会话文件是宿主的产物，
//   往里加字段既越界又会让 md5 变化，导致账本把已总结的会话又当成「有更新」。
//
// 落点为何是「当天的 log-<日期>.md」而不是「一场一张 session-<日期>-s<id8>.md」
// （2026-11-08 用户定）：同一天多场会话会散成多个文件，而且 todo.md 的归档行用
//   `[[log-<日期>]]`、这里用 `[[session-…]]`，同一个东西两套名字。
//   用户原话：「生成的文件标签要一致」「这些乱名称 不标准的名称……以后绝对不允许出现」。
//   现约定：sessions/ 只收 `log-<日期>[-<slug>].md`，lint 的 SESSIONS-NAMING 强制。

import { promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { requireBrain, brainPath } from '../index.js';
import { requireUser, atTag } from '../userconfig.js';
import { today } from '../todo.js';
import { registerInIndex } from '../note.js';
import { clip } from '../text.js';
import { editFile, SKIP } from '../lock.js';
import { DIR_LAYER } from './layers.js';
import { digestSession, sessionsRoot, projectDirName, updateLedger, markSummarized, ledgerPath, md5Of } from './summon.js';

/** 会话页的三种形状。形状由「改了什么东西」机械判定，不让模型猜。 */
export const SHAPES = {
  tech: {
    key: 'tech', label: '技术类',
    when: '改了代码文件（.js/.ts/.py/.vue 等）',
    sections: [
      ['出了什么问题', '具体症状 / 报错 / 复现条件'],
      ['怎么解决的', '根因 + 改了哪里'],
      ['验证什么命令', '跑什么确认已修好'],
    ],
  },
  ops: {
    key: 'ops', label: '业务操作类',
    when: '改了数据/配置/文档，没动代码',
    sections: [
      ['做了什么操作', '对哪些数据/配置/文档做了什么'],
      ['结果怎样', '结果、数字、可见变化'],
      ['下次注意事项', '再干一次要当心什么'],
    ],
  },
  talk: {
    key: 'talk', label: '讨论类',
    when: '一场文件都没改（聊需求、问方案、做决策）',
    sections: [
      ['谈成了什么', '结论 / 决定 / 达成的共识'],
      ['没结论的地方', '开着的问题、还没定的取舍'],
    ],
  },
};

/** 代码文件扩展名。判据只看扩展名，不看目录 —— 目录约定各项目不同。 */
const CODE_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|vue|svelte|py|go|rs|java|kt|c|cc|cpp|h|hpp|rb|php|swift|sh|sql)$/i;
/** 数据/配置/文档扩展名。两者都不命中时按「讨论类」算。 */
const OPS_EXT = /\.(json|ya?ml|toml|ini|conf|env|md|txt|csv|xml|html|css|scss|less)$/i;

/** 从改过的文件集合判形状。
 * 混合改动时按「有代码改动就是技术类」——
 * 因为技术类的三段最严（要写验证命令），宁可多要求不可漏要求。 */
export function shapeOf(files) {
  const list = [...files.keys()];
  if (!list.length) return 'talk';
  const code = list.filter((p) => CODE_EXT.test(p)).length;
  if (code) return 'tech';
  const ops = list.filter((p) => OPS_EXT.test(p)).length;
  if (ops) return 'ops';
  return 'talk';
}

/** 会话文件名 → 能定位它的标识。
 *
 * 正常形态：`2026-11-05T03-35-14-951Z_<uuid>.jsonl`
 * （实测全机 485 个会话文件 100% 匹配，pi 的 id 确实是十六进制 uuid）。
 *
 * ★ 匹配不上时**不能**退化成固定字符串（2026-11-05 实测踩到）：
 *   原来退成 `sunknown`，于是同一天两场「认不出文件名」的会话会落成同一个
 *   `session-<日期>-sunknown.md`，后来的静默覆盖前面的 —— 悄无声息地丢一场会话。
 *   改为取文件名哈希：认不出也保证不同文件 → 不同页。
 *   （真实数据目前 100% 匹配，所以这是给「将来 pi 改了命名规则」留的护栏。） */
function idsOf(file) {
  const name = basename(file);
  const m = name.match(/^(\d{4}-\d{2}-\d{2})T[^_]*_([0-9a-f-]{8,})\.jsonl$/);
  if (m) return { name, day: m[1], id: m[2], short: m[2].slice(0, 8) };
  // 兜底：日期尽量从文件名里抠（形如 2026-11-05），抠不到就用今天；
  // short 用文件名 md5 前 8 位 —— 唯一，且同一文件每次结果相同。
  const dayM = name.match(/(\d{4}-\d{2}-\d{2})/);
  const h = createHash('md5').update(name).digest('hex').slice(0, 8);
  return { name, day: dayM ? dayM[1] : '', id: '', short: h };
}

/** 会话用户原话 → 「这场会话在干什么」的一行主旨。
 *
 * 边界：这是**机械提取**，不是语义总结。
 * 不给「AI 总结的主旨」—— 那需要模型，而本命令不调模型。
 * agent 拿到素材后自己写主旨，这正是「工具落点、判断归 agent」的分工。
 *
 * ★ 判据：优先短句，跳过长文档（2026-11-05 实测修正）。
 *   原来取「第一句够长（≥6 字）的话」，结果真实会话里第一句常是**粘贴进来的需求文档**
 *   ——zj_shop 那场抓出来是：「附件：小程序商城开发详细功能清单 一、项目概述 本项目为…
 *   下面是功能明细。二、详细功能明细（一）基础模块 1. 店铺信息配置…」
 *   这种东西进 index 完全没法读，还得手工改。
 *
 *   新判据按三条打分，取第一个命中的：
 *     ① 长度在 6~40 字之间（够具体又不像文档）
 *     ② 不含文档特征标记（一、/（一）/附件：/功能明细/项目概述 这类）
 *     ③ 不含换行与连续空白（粘贴体通常有大段排版）
 *   全不命中就返回空串 —— 让 title 留占位、由 agent 填，好过塞一段文档进去。 */
const DOC_MARKERS = /(附件[:：]|项目概述|功能明细|详细功能|^[一二三四五六七八九十]、|（[一二三四五六七八九十]）|\d+[.、]\s*\S{2,6}[:：])/;

export function headlineOf(digest) {
  const users = (digest.users || []).map((u) => u.replace(/\s+/g, ' ').trim());
  // 优先：短、非文档体、且**句子是说完的**
  for (const u of users) {
    if (!usableHeadline(u)) continue;
    const len = Array.from(u).length;
    if (len < 6 || len > 40) continue;
    return clip(u, 40);
  }
  // 退一步：允许长一点，其余条件不变
  for (const u of users) {
    if (!usableHeadline(u)) continue;
    return clip(u, 40);
  }
  return '';
}

/** 这句话适合当标题吗（与长度无关的那些条件）。
 *
 * ★ 「说完没有」这条是 2026-11-05 实测补的：用户第一句话常是**被回车打断的半句**。
 *   本场会话自己的页就被抓成「找一下所有会话中 关于 会话总结提炼的信息，我/」
 *   —— 用户在打字中途按了回车，那个 `/` 是断的。这种东西进 index 比空着更糟：
 *   它看起来像个标题，实际什么也没说。
 *   判据：结尾不能是未完成信号（斜杠、逗号、连接词、冒号、开引号）。
 *   「句号/问号/叹号结尾」当然可以；没有标点但语义完整（如「优化一下命令」）也放行。 */
// 判据只收「几乎不可能出现在完整句尾」的信号。
// ★ 刻意不含「的 / 了」：它们看着像没说完，实际是中文完整句的高频结尾
//   （「不想要了」「去掉不必要的」），收进来会把大量正常句子误杀
//   —— 实测这两条一条被拦、一条被拦，而它们都是完整的诉求。
const UNFINISHED_END = /(?:[/、,，;；:：]|(?:和|与|或|在|把|被|对|给|让|使|因为|但是|然后|还是|或者))$/;

function usableHeadline(u) {
  const t = String(u || '').trim();
  if (!t) return false;
  if (DOC_MARKERS.test(t)) return false;   // 粘贴的文档体
  if (UNFINISHED_END.test(t)) return false; // 没说完的半句
  return true;
}

/** 会话段的标题：`## 会话 <会话 id 前 8 位>`。
 *  这就是「会话 → 段」的反查凭据 —— 拿会话文件在当天页里搜这行即可。 */
export function digestSectionOf(short) {
  return `## 会话 ${short || 'unknown'}`;
}

/** 当天页的骨架。会话摘要并进来后，一页就是「这一天的一切」：
 *  多个 `## 会话 <id8>` 段 + `## 📦 任务归档` 段（后者由 abs todo archive 追写）。 */
export function renderDayPage({ ids, who, section }) {
  const day = ids.day || today();
  return [
    '---',
    'tags: [session-log, session-digest, 会话]',
    `layer: ${DIR_LAYER.sessions}`,
    'kind: session-digest',
    `author: ${who}`,
    `updated: ${day}`,
    'status: draft',
    '---',
    '',
    `# ${day} 记录`,
    '',
    '> 本页 = 该日的一切：会话摘要（一场一段 `## 会话 <id8>`）+ 从 `todo.md` Done 区迁出的任务明细。',
    '',
    section.replace(/\s*$/, ''),
    '',
  ].join('\n');
}

/** 已有当天页被并入会话摘要时，补上「这页含会话摘要」的 frontmatter 标记。
 *
 * 为何必须补（2026-11-05 实测的检索保护）：空骨架会话段有高词频、正文又短，
 *   bm25 天然占优 —— 实测 20 张空骨架把真知识页全挤出结果。保护靠两条，
 *   两条都只认 `kind: session-digest`：db 的 unfilled 列（整页排除出检索）
 *   与 0.5 亮度折扣。缺 kind 就等于这层保护失效。
 * 已存在的 tags/status/updated 一律不动 —— 那是那天的记录，机器不替它改。 */
export function ensureDigestFrontmatter(body) {
  const t = String(body || '');
  if (!t.startsWith('---\n')) return t;
  const end = t.indexOf('\n---', 3);
  if (end === -1) return t;
  const fm = t.slice(4, end);
  const add = [];
  if (!/^kind:\s/m.test(fm)) add.push('kind: session-digest');
  if (!/^layer:\s/m.test(fm)) add.push(`layer: ${DIR_LAYER.sessions}`);
  if (!add.length) return t;
  return `---\n${fm.replace(/\s*$/, '')}\n${add.join('\n')}${t.slice(end)}`;
}

/** 把会话段并进当天页。位置：`## 📦 任务归档` 之前（会话在前、归档在后）；
 *  没有归档段就放到 `## 关联连接` 之前；都没有就追加到末尾。 */
export function insertDigestSection(body, section) {
  const t = String(body || '');
  const lines = t.split('\n');
  const at = ['## 📦 任务归档', '## 关联连接']
    .map((h) => lines.findIndex((l) => l.trim() === h))
    .filter((i) => i !== -1)
    .sort((a, b) => a - b)[0];
  const block = section.replace(/\s*$/, '');
  if (at === undefined) return `${t.replace(/\s*$/, '')}\n\n${block}\n`;
  const head = lines.slice(0, at).join('\n').replace(/\s*$/, '');
  const tail = lines.slice(at).join('\n').replace(/\s*$/, '');
  return `${head}\n\n${block}\n\n${tail}\n`;
}

/** `--force`：把已有那一段重建回空骨架（段内已填的结论会被覆盖，调用方要先警告）。 */
export function replaceDigestSection(body, section, short) {
  const t = String(body || '');
  const lines = t.split('\n');
  const i = lines.findIndex((l) => l.trim() === digestSectionOf(short));
  if (i === -1) return insertDigestSection(t, section);
  let j = i + 1;
  while (j < lines.length && !/^#{1,2}\s/.test(lines[j].trim())) j++;
  return [...lines.slice(0, i), ...section.replace(/\s*$/, '').split('\n'), '', ...lines.slice(j)]
    .join('\n');
}

/** 会话段的 markdown。值留空位 —— 内容由 agent 读会话后填。
 *  段标题层级从 `##` 降为 `###`：外面套了一层 `## 会话 <id8>`，一天多场不会撞标题。 */
export function renderDigestSection({ shape, digest, ids, who }) {
  const sh = SHAPES[shape];
  const files = [...digest.filesEdited.keys()];
  const head = headlineOf(digest);
  const body = [
    digestSectionOf(ids.short),
    '',
    `> ${ids.day} · ${sh.label} · 用户发言 ${digest.users.length} 句 · 工具调用 ${digest.toolCalls} 次`,
    `> 会话：${head || ids.day}`,
    `> 挂钩: session=${ids.id} · session-file=${ids.name} · project=${digest.cwd || ''}`,
    `> 沉淀者: ${who}`,
    '',
  ];
  for (const [title, hint] of sh.sections) {
    body.push(`### ${title}`, `<!-- ${hint} -->`, '');
  }
  if (files.length) {
    body.push('### 改过的文件');
    for (const f of files.slice(0, 40)) {
      body.push(`- \`${f}\` ×${digest.filesEdited.get(f)}`);
    }
    if (files.length > 40) body.push(`- …另有 ${files.length - 40} 个`);
    body.push('');
  }
  body.push(
    '### 用户原话',
    '<!-- 从会话文件提取的原始诉求，按发生顺序。写上面几段时以这里为依据 -->',
  );
  for (const u of digest.users.slice(0, 20)) {
    body.push(`- ${u.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
  }
  if (digest.users.length > 20) body.push(`- …另有 ${digest.users.length - 20} 句`);
  body.push(
    '',
    '### 关联连接',
    `- ${atTag(who)} — 本场沉淀者`,
    '（把本场会话改到的知识页挂在这里，双向可回溯）',
    '',
  );
  return body.join('\n');
}

/** 把会话摘要落成会话页。返回可读的结果文本。 */
export async function cmdIngest({ dir, file, force = false, mark = false, last = false, auto = false, session = '' }) {
  if (!file && !last && !session) {
    return [
      '用法: abs ingest <会话文件名或路径> [--force] [--mark]',
      '      abs ingest --last [--auto]      # 最近一场会话（手工用）',
      '      abs ingest --session <id> [--auto]  # 指定会话（hook 用，避免多会话时选错）',
      '  例: abs ingest 2026-11-05T03-35-14-951Z_01a1a9c6-...jsonl',
      '  说明: 把一场 pi 会话整理成 .brain/sessions/ 的会话页，并把会话 id 写进 frontmatter（双向可回溯）。',
      '       只看 --dir 指定的项目（或当前目录）的会话目录；不跨项目落盘。',
    ].join('\n');
  }

  let root;
  try {
    root = await requireBrain(dir || process.cwd());
  } catch {
    return '未找到 .brain/ 图谱。先在项目根运行: abs init';
  }

  // 会话文件定位：允许给绝对路径、文件名、或只给 id 前 8 位
  const sessDir = join(sessionsRoot(), projectDirName(root));
  let names;
  try { names = (await fs.readdir(sessDir)).filter((f) => f.endsWith('.jsonl')); } catch {
    return `✗ 找不到会话目录: ${sessDir}\n  说明: 本项目的会话可能记在别的路径（用 ABS_PI_SESSIONS 覆盖）。`;
  }
  let hit;
  if (session) {
    // ★ 优先用宿主给的会话 id（2026-11-05 实测修正）：
    //   `--last` 按 mtime 选文件，同时开着两个会话时会选错 —— 实测关会话 A 却落了 B 的页，
    //   因为 B 的 jsonl 更新。hook 那侧本来就能拿到本会话 id（sessionIdFor），
    //   传下来就能精确定位，不用猜。
    const want = String(session).trim();
    hit = names.find((n) => n === want)
      || names.find((n) => want.length >= 8 && n.includes(want));
    if (!hit) return `✗ 会话目录里找不到 session=${want} 对应的文件`;
  } else if (last) {
    // --last：最近**写过**的那个会话文件（hook 在 session_shutdown 时用，
    // 那时刚关的就是这一个）。按 mtime 取最大，不靠文件名排序 ——
    // 文件名里的时间戳是会话**开始**时刻，跨天续聊时它不再是最新的。
    let best = null, bestMs = -1;
    for (const n of names) {
      const st = await fs.stat(join(sessDir, n)).catch(() => null);
      if (st && st.mtimeMs > bestMs) { bestMs = st.mtimeMs; best = n; }
    }
    hit = best;
  } else {
    const want = basename(String(file).trim());
    hit = names.find((n) => n === want)
      || names.find((n) => want.length >= 8 && n.includes(want))
      || names.find((n) => n.includes(want));
    if (!hit) {
      return `✗ 会话目录里找不到 "${want}"。\n  可用: abs summon（列出待总结的会话）`;
    }
  }
  if (!hit) return `• 会话目录是空的，没有可落页的会话`;

  const digest = await digestSession(join(sessDir, hit));
  if (!digest) return `✗ 读不了会话文件: ${hit}`;
  if (!digest.users.length) return `• ${hit} 没有真实用户输入，不生成会话页（空会话）`;

  const ids = idsOf(hit);
  if (!ids.id) ids.id = digest.id || '';

  const shape = shapeOf(digest.filesEdited);

  // ── --auto：hook 在会话关闭时机械调用，判据只有一条 —— 真的动过文件 ──
  //
  // 为何只认文件改动（2026-11-05）：纯聊天/纯查询的会话落成页是噪音，
  //   而且从这类会话里本来也提炼不出「干了什么」。判据与 cmdTeardownCheck
  //   的条件①同源（本会话真改过文件才打扰），两边必须一致，否则
  //   一个说「这会话值得记」另一个说「不值得」，用户看到的是自相矛盾。
  //
  // 只落骨架不填内容：内容要读会话后写，机器不猜。这条边界与本仓
  //   「判断力在 agent、工具只做落点」一致（见 skill 的主动提炼一节）。
  if (auto && shape === 'talk') {
    return `• 跳过：这场会话没有改动任何文件（纯聊天/查询），不值当落页`;
  }

  const who = await requireUser();
  const sessOut = brainPath(root, 'sessions');
  await fs.mkdir(sessOut, { recursive: true });

  // 落页位置 = 当天的 `log-<日期>.md`（2026-11-08 用户定「一天一文件」）。
  // 会话 → 段的凭据是段标题 `## 会话 <id8>`：拿会话文件能在当天页里搜到它。
  const short = ids.short || 'unknown';
  const slug = `log-${ids.day || today()}`;
  const dst = join(sessOut, `${slug}.md`);

  // 幂等判据从「文件存在吗」改成「这一天页里已有这场会话的段吗」——
  // 一天一文件后，同一天多场会话挂在同一个文件里，文件粒度不区分场次。
  // 读-改-写必须走 editFile 锁：abs todo archive 也在写同一个文件，
  // 裸 readFile+rename 会让两边互相覆盖（archive.js 的同一坑，已修）。
  let existed = false;
  await editFile(dst, (cur) => {
    const has = String(cur || '').split('\n').some((l) => l.trim() === digestSectionOf(short));
    if (has && !force) { existed = true; return SKIP; }
    const section = renderDigestSection({ shape, digest, ids, who });
    let text;
    if (cur == null) text = renderDayPage({ ids, who, section });
    else if (has) text = replaceDigestSection(cur, section, short);   // --force：只重建这一段
    else text = insertDigestSection(ensureDigestFrontmatter(cur), section);
    return { text };
  });
  if (existed) {
    // 提示写得直白（2026-11-05 实测的收益要保住）：开发时自己就误用 --force
    // 覆盖掉填好的段。会丢的是「三段结论 + 关联连接」—— 重建回来的只是空骨架 + 素材。
    return [
      `• 这一天页已有本场会话段，不覆盖 → .brain/sessions/${slug}.md（## 会话 ${short}）`,
      '  --force 会把这一段重建回空骨架：三段结论与关联连接全部丢失，只剩素材。',
      '  只想要素材、保留结论 → 直接读那一段；确定要重填再用 --force。',
    ].join('\n');
  }

  // 骨架段里的 <!-- 提示 --> 占位**故意保留**：它告诉填页的人每段该写什么。
  // 它不会干扰「填没填」的判定 —— load 的 digestFilled 与 lint 的 hasTail
  // 都把占位注释当空内容（2026-11-05 审查：原注释声称「去掉注释」但代码没做，
  // 注释与实现不符已改正）。写盘由 editFile 锁内完成，并发读不会读到半写文件。
  await registerInIndex(root, 'Sessions', slug, `会话：${headlineOf(digest) || ids.day}`);

  // 不写 log.md（2026-11-05，沿用 abs concept 的既有判据）：
  // 「并入了一场会话摘要」是**命令的副作用**，不是工作成果 —— 零信息量，
  // 而「这一天页存在」已由 registerInIndex 落在 index 的 Sessions 区。
  // 更要紧的是：--auto 在每次关会话时跑，一天开 10 次就刷 10 行流水，
  // 靠事后清理治不了（abs concept 当初正是因为「建 10 页 = 10 行噪声」才删掉这次调用的）。

  // 记账：这场会话已提取，下次 summon 不再列。
  //
  // ★ 落页即记账，不再等 --mark（2026-11-05 实测修正）：
  //   原来只有 --mark 才写账本，于是一个已落页的会话**永远停在「未总结」名单里**
  //   —— summon 反复催同一场，而人已经能看到那张页了。催一个已存在的东西
  //   是最快让人忽略提醒的方式，比不提醒更糟。
  //   判据变了：账本记的不是「人读过没读」，是「这场会话有没有对应的页」。
  //   读没读由 load 的「未填会话页」提醒负责，那是两件事。
  //   --mark 保留（旧脚本仍在用），效果相同。
  let markNote = '';
  {
    void mark; // --mark 已并入默认行为，保留参数只为旧脚本兼容

    const st = await fs.stat(join(sessDir, hit)).catch(() => null);
    // md5 必须算真值（2026-11-05 审查发现）：原来写空串，而 scanProject 用
    // `rec.md5 === md5` 判重 —— 空串永不等于真 md5。后果是 size/mtime 一变、
    // 且当天没有快照时，内容一字未改的会话会被报成「有更新（需补充）」。
    // 实测复现：删掉快照后 summon 输出 `有更新 1 ↳ md5 与账本不符`。
    const md5 = await md5Of(join(sessDir, hit));
    // 用 updateLedger 而不是「读 → 改 → 写」三连（2026-11-05 实测）：
    //   两个会话同时关闭时，两个进程各自读到同一份旧账本、各自加一条，
    //   后写的盖掉先写的 —— 先写那条静默消失，下轮 summon 又把它当「未落页」催。
    //   updateLedger 按文件加锁，把读改写串行化。
    await updateLedger((book) => {
      markSummarized(book, [{
        name: hit, md5: md5 || '', day: ids.day,
        size: st?.size, mtime: st?.mtimeMs,
      }]);
    }, ledgerPath());
    markNote = '\n  已记账（abs summon 不再列这场）';
  }

  const sh = SHAPES[shape];
  return [
    `✓ 会话摘要 → .brain/sessions/${slug}.md（${digestSectionOf(short)}）`,
    `  ${ids.day} · ${sh.label}（判据: ${sh.when}）`,
    `  用户 ${digest.users.length} 句 · 工具 ${digest.toolCalls} 次 · 改过 ${digest.filesEdited.size} 个文件`,
    `  挂钩: session=${ids.id} file=${hit}`,
    '  骨架已给好，三段内容要读会话后填；填完段内写实、别再留 <!-- 提示 -->。',
  ].join('\n') + markNote;
}

export { idsOf };
