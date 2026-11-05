// src/brain/capture.js — 按七层判定落点的统一总结入口。
//
// 为何需要它（2026-11-01 实测）：七层建好了，但总结这个动作还是老的一根管道 ——
//   `abs note` 一律进 sources/（L7），`abs concept` 一律进 concepts/（L4），
//   `abs rule` 一律进 ## Rules（L1）。落点由**命令**写死，不由**内容**决定。
//   结果是 52 页 concepts 里 23 页（44%）其实是工具经验，全按 L4 的 0.6 衰减算 ——
//   分层在检索权重上的作用被抹平了。
//
// 本命令让判层发生在「总结时」，判完直接落到位，不留二次分拣。
// 沿用 note.js 的两条既有约定：整条相等才算重复（不是子串）、tmp+rename 原子落盘。

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { requireBrain, brainPath } from '../index.js';
import { requireUser, atTag } from '../userconfig.js';
import { today } from '../todo.js';
import { registerInIndex } from '../note.js';
import { cmdLog } from '../note.js';
import { clip, slugOf } from '../text.js';
import { LAYERS, layerOf, DEFAULT_LAYER } from './layers.js';
import { autoIndex } from './db-cmd.js';
import { summonTail } from './summon.js';

/** 层 → 落点目录。L1/L6 不立页，由下面的分支单独处理。 */
// 落点目录。L1/L6 不立页、L5/L7 不在 capture 职责内，都由下面的分支单独处理。
// （2026-11-05 审查删掉 `7: 'sources'`：L7 改成直接拒后它已是死代码，
//   留着会让下个读者以为走 capture 就能落混沌层。）
const LAYER_DIR = {
  2: 'concepts',
  3: 'concepts',
  4: 'concepts',
};

/** 判据表：输入时就看得到，不用记。 */
export function layerGuide() {
  const rows = [
    ['1', '铁律', '违反就必须停下的事', 'abs capture --layer 1 "…"'],
    ['2', '规则', '这个项目要遵守的做法', 'abs capture --layer 2 "…"'],
    ['3', '工具', '某工具怎么用、有什么坑', 'abs capture --layer 3 "…"'],
    ['4', '认知', '踩坑的根因与解法（默认）', 'abs capture "…"'],
    ['5', '会话', '这次会话做了什么', 'abs log / abs ingest'],
    ['6', '断点', '双链词，机器自动抽，不用手写', '（无）'],
    ['7', '混沌', '还没想清的碎片', '用 abs note（同一个落点）'],
  ];
  return [
    '按七层判定这一句该落在哪：',
    '',
    '层  名称   判据                        命令',
    ...rows.map(([id, name, when, cmd]) => `L${id}  ${name}   ${when.padEnd(26)} ${cmd}`),
    '',
    '不传 --layer 时默认 L4（认知）。',
    'L1 走铁律门槛（≤42 字、禁链接）；L6 是机器自动抽的双链词，不接手动。',
  ].join('\n');
}

export async function cmdCapture({ dir, text, layer, tags, title, kind }) {
  const clean = String(text || '').trim();
  const layerArg = String(layer || '').trim();

  if (!clean) {
    return [
      '用法: abs capture [--layer 1-6] [--kind gotcha|decision|tradeoff|howto] "一句话" [--tags a,b] [--title "页标题"]',
      '  注: L7（混沌/碎片）用 abs note，两者落点相同，不再留两个入口。',
      '',
      layerGuide(),
    ].join('\n');
  }

  // 层号校验：非法直接拒，不静默当默认层（否则记错层没人知道）
  let L = DEFAULT_LAYER;
  if (layerArg) {
    const n = Number(layerArg);
    if (!Number.isInteger(n) || !layerOf(n)) {
      return `✗ --layer 非法（读到 "${layerArg}"）。只能是 1-7 的整数。\n\n${layerGuide()}`;
    }
    L = n;
  }

  // L6 是机器自动抽的双链词，不接受手动写入 —— 手写会让断点词表失真
  if (L === 6) {
    return '✗ L6 断点层是机器从双链里自动抽的词，不接手写。\n  想加索引词：在页面正文写 [[词]]，abs db rebuild 时会自动收录。';
  }

  // L7 混沌层：`abs note` 与 `abs capture --layer 7` 是**同一个落点**
  //   （都进 sources/，同样的文件名与正文结构）。实测 2026-11-05 确认。
  //   两个入口做同一件事 = 每次都得先选一个，而选不选对没有任何后果 ——
  //   纯认知负担。按本仓判据「与已有功能重叠 → 复用/删，别新增」
  //   （concept feature-delete-not-patch），保留被真实用过 228 次的 note，
  //   这里直接拒，并给出等价命令 —— 不静默转发（静默转发会把两个入口都留着）。
  if (L === 7) {
    return [
      '✗ L7 混沌层用 abs note，不用 capture。',
      `  abs note "${clip(clean, 40)}"`,
      '  两者落点完全相同（都进 sources/）；note 是这条主路径，别再二选一。',
    ].join('\n');
  }

  // L5 会话层同样不接 capture（2026-11-05 审查发现）：它落 sessions/，
  //   而 sessions/ 有两条硬规则（lint 的 SESSIONS-NAMING / SESSIONS-MISPLACED）——
  //   当天只允许 `log-<日期>.md`、tags 必须是 session-log 类。capture 生成的
  //   `<日期>-<内容>.md` + `tags: [concept]` 必然被这两条同时报错。
  //   实测：`abs capture --layer 5 "x"` → lint 报 2 个问题。命令自己产出坏数据。
  //   真实用法各有正主：当天工作 → abs log；一场会话的结构化记录 → abs ingest。
  if (L === 5) {
    return [
      '✗ L5 会话层不接 capture（它落 sessions/，会违反那里的命名与 tags 规则）。',
      '  当天工作成果 → abs log "完成 X：…"',
      '  一场会话的结构化记录 → abs ingest --last（或给会话 id）',
    ].join('\n');
  }

  // L1 铁律：复用 cmdRule 的门槛（≤42 字、禁链接），不另起一套
  if (L === 1) {
    const { cmdRule } = await import('./rules.js');
    const r = await cmdRule({ dir, action: 'add', text: clean });
    return r;
  }

  // 作用分档（2026-11-02 借 clo​ude-mem）：gotcha 坑 / decision 决策 / tradeoff 权衡 / howto 做法。
  // 与 layer 正交：layer 说「这是什么性质的知识」，kind 说「它起什么作用」。
  const KIND = {
    gotcha: '坑', decision: '决策', tradeoff: '权衡', howto: '做法',
  };
  const kindArg = String(kind || '').trim().toLowerCase();
  if (kindArg && !KIND[kindArg]) {
    return `✗ --kind 只认 ${Object.keys(KIND).join(' / ')}（收到 "${kind}"）`;
  }

  let root;
  try {
    root = await requireBrain(dir || process.cwd());
  } catch {
    return '未找到 .brain/ 图谱。先在项目根运行: abs init';
  }
  const who = await requireUser();
  const { ensurePersonPage } = await import('../note.js');
  await ensurePersonPage(root, who);

  const dirName = LAYER_DIR[L];
  if (!dirName) return `✗ L${L} 没有对应目录（这层不立页）。`;

  const targetDir = brainPath(root, dirName);
  await fs.mkdir(targetDir, { recursive: true });

  // 幂等：整条相等才算重复（子串判据会把「新经验恰好是旧经验的子串」丢掉）
  const titleLine = `TITLE: ${clean}`;
  for (const f of (await fs.readdir(targetDir).catch(() => [])).filter((x) => x.endsWith('.md'))) {
    const body = await fs.readFile(join(targetDir, f), 'utf8').catch(() => '');
    if (body.split('\n').some((l) => l.trim() === titleLine)) {
      return `• 已落过同文本 → ${dirName}/${f} (跳过重复)`;
    }
  }

  const head = String(title || '').trim() || clip(clean, 80);
  const tagList = String(tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  const meta = layerOf(L);
  const slugSrc = slugOf(clean);
  const file = `${today()}-${slugSrc || 'capture'}.md`;

  const body = [
    '---',
    `tags: [${['concept', ...tagList].join(', ')}]`,
    `layer: ${L}`,
    ...(kindArg ? [`kind: ${kindArg}`] : []),
    `author: ${who}`,
    `updated: ${today()}`,
    'status: draft',
    '---',
    '',
    `# ${meta.name}：${head}`,
    '',
    `TITLE: ${clean}`,
    '',
    '## 记录',
    `- ${clean}`,
    '',
    // 「验证」是本仓硬要求（lint 的 NO-TAIL）：没尾巴的经验只能被相信、不能被验证。
    // 占位注释不算内容（hasTail 明确跳过 <!-- -->），所以这里给的是**可填的实际位置**，
    // 而不是一句注释就交差 —— 那会让新页天生就带 NO-TAIL。
    '## 验证',
    '- 做完怎么确认：跑什么命令 / 看什么信号 / 按什么判据',
    '',
    '## 关联连接',
    `- ${atTag(who)} — 本页沉淀者`,
    '（挂相关页双链，别留孤岛；本页无人链入时 lint 会报 NO-INBOUND）',
    '',
  ].join('\n');

  // tmp + rename 原子落盘（并发读不会读到半写文件）
  const dst = join(targetDir, file);
  const tmp = join(targetDir, `.${file}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, dst);

  const slug = file.replace(/\.md$/, '');
  const section = dirName === 'concepts' ? 'Concepts' : dirName === 'sessions' ? 'Sessions' : 'Sources';
  await registerInIndex(root, section, slug, head);
  await cmdLog({ dir: root, title: clean, kind: 'note', summon: false });

  // 落盘即入库 —— 否则用户以为记下了，检索却空手而归（静默失效）。
  // autoIndex 永不抛错也不阻塞：库坏了只是检索旧一点，不能让记笔记失败。
  const idx = await autoIndex();

  // 每次总结都顺手查一遍会话历史，避免漏下没总结的会话（2026-11-02 用户要求）。
  // 只给线索不写盘 —— 落哪一条仍是人的判断。
  const tail = await summonTail(root);

  return [
    `✓ 已落入 L${L} ${meta.name}层 → ${dirName}/${file}`,
    `  ${clip(clean, 60)} ${atTag(who)}`,
    `  该层衰减 ${meta.decay}（${meta.note}）`,
    idx.ok ? '  已同步入库，abs db search 可查到' : `  （未入库：${idx.reason}）`,
  ].join('\n') + tail;
}

export { LAYERS };
