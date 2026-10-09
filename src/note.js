// src/note.js — 经验实时暂存与知识页脚手架：note（一念一落）/ concept（骨架）/ person（人页）
//              + registerInIndex（把新页登记进 index.md 清单区，三块都用到）。
//
// 从 store.js 拆出（2026-10-05）：原来 18 个职责挤在一个 1500+ 行文件里。
// 依赖方向：note.js ← store.js（store 先 import 再 re-export，保持既有调用面）。
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { requireBrain, brainPath } from './index.js';
import { requireUser, atTag } from './userconfig.js';
import { today, localStamp, LOG_KINDS } from './todo.js';
import { editFile, SKIP } from './lock.js';
import { impactOf } from './codegraph.js';
import { clip, slugOf } from './text.js';

// ---------- note: 经验实时暂存（source 页，一念一落，防流失） ----------

export async function cmdNote({ dir, text, tags, when, impact, type }) {
  const clean = String(text || '').trim();
  if (!clean) return '用法: abs note "经验/坑/技巧一句话" [--when "何时该读它"]（落 sources/ 暂存页，实时不流失）';
  let root;
  try {
    root = await requireBrain(dir || process.cwd());
  } catch {
    return `未找到 .brain/ 图谱。先在项目根运行: abs init`;
  }
  const who = await requireUser(); // 写操作守卫
  await ensurePersonPage(root, who); // 首次写操作即建人页（已存在不动）
  const srcDir = brainPath(root, 'sources');
  await fs.mkdir(srcDir, { recursive: true });
  // 幂等: 同文本已落过就不再落一份（判据是内容包含，不看时间）
  const existing = (await fs.readdir(srcDir).catch(() => [])).filter((f) => f.endsWith('.md'));
  for (const f of existing) {
    const body = await fs.readFile(join(srcDir, f), 'utf8').catch(() => '');
    if (body.includes(clean)) {
      return `• 已落过同文本 → ${f} (跳过重复)`;
    }
  }
  // 影响面（可选）：显式传 --impact <符号> 时，借本机 CodeGraph 拿「改它波及谁」。
  // 失败/未装 codegraph 静默降级为无，绝不阻断 note 落盘。
  const impactText = impact ? await impactOf(impact, root) : null;
  // 类型（可选）：借鉴 TencentDB 的 L1 四分类，把自由文本经验分成可分类的资产。
  // 默认不强制（自由文本仍是主体）；显式 --type 时才写进 frontmatter，供检索/load 区分。
  // 合法值对齐 L1 四类：fact 事实 / pref 偏好 / constraint 约束 / event 事件。
  const NOTE_TYPES = ['fact', 'pref', 'constraint', 'event'];
  const noteType = NOTE_TYPES.includes(String(type || '').trim().toLowerCase())
    ? String(type).trim().toLowerCase() : '';
  const tagList = String(tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  const fmTags = ['source', ...tagList].join(', ');
  const slugSrc = slugOf(clean);
  const file = `${today()}-${slugSrc || 'note'}.md`;
  const heading = clip(clean, 80); // 页面标题: 完整优先, 超长才收口
  // 触发条件（2026-09-16）：经验"写入多读得少"的根因之一是存的是结论、不是"何时该看"。
  // 带上 --when 后，load 的相关页推荐能按当前在做的事匹配，而不是按主题词。
  const whenText = String(when || '').trim();
  const body = [
    '---',
    `tags: [${fmTags}]`,
    `id: ${file.replace(/\.md$/, '')}`,
    `author: ${who}`,
    `updated: ${today()}`,
    'status: draft',
    ...(noteType ? [`type: ${noteType}`] : []),
    '---',
    '',
    `# 来源：${heading}`,
    '',
    `TITLE: ${clean}`,
    ...(whenText ? ['', `WHEN: ${whenText}`] : []),
    ...(impactText ? ['', '## 影响面（本机 CodeGraph 自动带出）', '```', impactText, '```'] : []),
    '',
    `## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）`,
    `- ${clean}`,
    ...(whenText ? [`- 何时读：${whenText}`] : []),
    '',
    '## 关联连接',
    `- ${atTag(who)} — 本页沉淀者`,
    '（提炼成 concepts 规律页后，在此挂双链到该页）',
    '',
  ].join('\n');
  // 源文件是新写唯一文件：tmp+rename 原子落盘（避免并发读读到半写文件）
  const srcFile = join(srcDir, file);
  const tmp = join(srcDir, `.${file}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, srcFile);
  // index Sources 区登记（锁内幂等：别页已登记则跳过，防并发重复） + log 一行
  const slug = file.replace(/\.md$/, '');
  await registerInIndex(root, 'Sources', slug, heading);
  await cmdLog({ dir: root, title: clean, kind: 'note' });
  return `✓ 经验暂存 → sources/${file}\n  ${clean} ${atTag(who)}`;
}

// ---------- concept: 概念页脚手架（给「写入」定结构，不替人做判断） ----------
/** 建一张带骨架的概念页。
 *
 * 为何需要它（实测 2026-09-15）: concepts/ 页原来**没有任何代码写入路径** ——
 * 全靠人/AI 手写 markdown，结果 26 页里 2 页完全没有「做完怎么确认」。
 * 而骨架只写在 skill 的**文字里**（"触发场景/表现/解法/验证命令"），没有执行点 → 看运气。
 * 对照: `abs note` 落的 source 页结构整齐，因为模板在**代码里**。
 *
 * 边界（关键）: 它只给**结构**，不给**内容**。
 * 「这条值不值得留 / 归哪一页」仍靠人判断 —— 那是 skill 明写的分工（深提炼不自动化）。
 * 所以本命令不猜语义、不自动提炼，只在你要新建页时把该有的位置摆好。
 *
 * 尾巴用「占位符」而非真实值: 这样 lint 的 NO-TAIL 判据在占位未填时仍会报
 * （骨架≠完成）。填完删掉占位行即可。 */
export async function cmdConcept({ dir, slug, title, tags, desc }) {
  let root;
  try {
    root = await requireBrain(dir || process.cwd());
  } catch {
    return `未找到 .brain/ 图谱。先在项目根运行: abs init`;
  }
  const raw = String(slug || '').trim();
  if (!raw) {
    return [
      '用法: abs concept <slug> --title "一句话标题" [--tags a,b] [--desc "index 里的一句话"]',
      '  例: abs concept docker-prisma-429 --title "Docker 内存超限导致 Prisma 429"',
      '  说明: 只给骨架（头/中/尾位置），内容仍由你写 —— 判断不自动化。',
    ].join('\n');
  }
  // slug 即文件名（命名即链接）。收口掉路径分隔符与空白，防逃出 concepts/。
  const name = raw.replace(/[\s/\\]+/g, '-').replace(/[^\w\u4e00-\u9fff.-]/g, '').replace(/^-+|-+$/g, '');
  if (!name) return `✗ slug 无效（清洗后为空）: ${raw}`;
  const who = await requireUser();
  await ensurePersonPage(root, who);
  const dirP = brainPath(root, 'concepts');
  await fs.mkdir(dirP, { recursive: true });
  const file = join(dirP, `${name}.md`);
  const head = String(title || '').trim() || name;
  const tagList = ['concept', ...String(tags || '').split(',').map((t) => t.trim()).filter(Boolean)];
  const body = [
    '---',
    `tags: [${tagList.join(', ')}]`,
    `id: ${name}`,
    `author: ${who}`,
    `updated: ${today()}`,
    'status: draft',
    '---',
    '',
    `# 概念：${head}`,
    '',
    '## 触发场景',
    '<!-- 什么情况下该想起这条？（写可检索的词，别只写“遇到问题”） -->',
    '',
    '## ❌ 表现',
    '<!-- 具体症状 / 贴报错 / 复现条件 -->',
    '',
    '## 🛠 解法',
    '<!-- 根因 + 修复 -->',
    '',
    '## 验证',
    '<!-- 做完怎么确认？跑什么命令 / 看什么信号 / 用什么判据。必须填 —— 没尾巴的经验只能被“相信”，不能被“验证” -->',
    '',
    '## 关联连接',
    `- ${atTag(who)} — 本页沉淀者`,
    '（在这挂相关页双链，别留孤岛）',
    '',
  ].join('\n');
  // 独占写（wx）：已存在则 EEXIST —— 与 ensurePersonPage 同路数。
  // 不用「先查后写」：那有 TOCTOU 竞态，且已有人工内容一律不覆盖是本仓硬规则。
  // 也不走 tmp+rename：rename 会默默覆盖已存在文件，而这里必须「存在就拒绝」。
  try {
    await fs.writeFile(file, body, { encoding: 'utf8', flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') {
      return `• 已存在，不覆盖 → .brain/concepts/${name}.md\n  要改请直接编辑（或先删页）；新建请换个 slug。`;
    }
    throw e;
  }
  const oneLine = String(desc || '').trim() || clip(head, 60);
  await registerInIndex(root, 'Concepts', name, oneLine);
  // 不写 log.md（2026-10-05 用户定）：`新建概念页 x` 是**命令的副作用**不是成果 ——
  // 38 字符、零信息量，且「该页存在」已由 registerInIndex 落在 index.md 的 Concepts 区
  // （那是 index 的职责）。同件事落两处，且建 10 个页 = 10 行流水噪声自动重现，
  // 靠事后清理治不了。故删掉这次调用，不加开关（没人需要读「某页被创建了」）。
  return `✓ 概念页骨架 → .brain/concepts/${name}.md ${atTag(who)}\n` +
    '  已给好四段位置；填完内容后：删掉 <!-- --> 占位、按需改 status: active、挂双链。\n' +
    '  尾部「## 验证」必须填（留空会被 abs lint 报 NO-TAIL）。';
}

// ---------- person: 使用者实体页（首次需要时创建，已存在则不动） ----------
/** 确保 entities/<name>.md 存在。已存在一律不动（里面的技术栈/特点是人工沉淀的）。
 * 用 `wx` 独占写：并发下后到者拿到 EEXIST 就静默跳过，不覆盖。
 * 失败不抛：建页是附带动作，不能因为它让 todo/log 写不进去。
 * 返回 'created' | 'exists' | 'skip'。 */
export async function ensurePersonPage(root, name) {
  const nm = String(name || '').trim();
  if (!nm || !/^[\w\u4e00-\u9fff.-]+$/.test(nm)) return 'skip';
  const dir = brainPath(root, 'entities');
  const file = join(dir, `${nm}.md`);
  const body = [
    '---',
    'tags: [entity, person]',
    `id: ${nm}`,
    `author: ${nm}`,
    `updated: ${today()}`,
    'status: draft',
    '---',
    '',
    `# ${nm}`,
    '',
    '## 技术栈',
    '<!-- 沉淀时填: 主力语言/框架/工具链。例: TypeScript + Node, 熟悉 MCP 协议与 CLI 工具链 -->',
    '',
    '## 特点 / 工作习惯',
    '<!-- 沉淀时填: 决策偏好、沟通习惯、反复出现的判断倾向。例: 先要方案后动手; 质疑"这需求是否需要存在" -->',
    '',
    '## 名下踩过的坑',
    '（本页被 [[todo]] / [[log]] 里的作者标记引用；沉淀经验时在此挂双链）',
    '',
  ].join('\n');
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, body, { encoding: 'utf8', flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') return 'exists';
    return 'skip';
  }
  // 只有真建成才登记 index（否则 index 指向不存在的页 → INDEX-DEAD-LINK）。
  // 放这里而非各调用点：todo/log/note 三条写路径都要登记，抄三遍必漂。
  await registerInIndex(root, 'Entities', nm, `${nm} — 使用者；技术栈 / 特点 / 名下踩过的坑`);
  return 'created';
}

/** 把新页登记进 index.md 的指定分区（幂等）。供人页/其它程序建页用。 */
export async function registerInIndex(root, section, slug, desc) {
  const iP = brainPath(root, 'index.md');
  await editFile(iP, (index) => {
    if (!index || index.includes(`[[${slug}]]`)) return SKIP;
    const sIdx = index.indexOf(`## ${section}`);
    if (sIdx === -1) return SKIP;
    const after = index.indexOf('\n## ', sIdx + 1);
    const line = `- [[${slug}]] — ${desc}`;
    const next = after === -1
      ? `${index.replace(/\s*$/, '')}\n${line}\n`
      : index.slice(0, after) + `\n${line}` + index.slice(after);
    // 归一空行：历史手工编辑会留 3+ 空行（load 时 collapseIndex 会压掉，但文件本身没清）。
    // 追加新条目的同时顺手压一次，既清旧债又不改内容（与 collapseIndex 同一判据）。
    return { text: next.replace(/\n{3,}/g, '\n\n') };
  });
}
// ---------- log: 追加工作成果沉淀摘要（用户/AI 主动 abs log "..." 记, 不收工具动作流水） ----------
export async function cmdLog({ dir, title, kind = 'dev' }) {
  const root = await requireBrain(dir || process.cwd());
  const who = await requireUser(); // 写操作守卫
  // ★ kind 必须是枚举值（2026-10-05 加）：此前无校验，传什么写什么 ——
  //   实测有测试传 kind:'test' 写进去，而形状闸门上线后才暴露。
  //   枚举内校在**入口**（这里）比事后 lint 更早，且报错能直接告诉可用值。
  if (!LOG_KINDS.includes(String(kind))) {
    throw new Error(
      `✗ log 的 kind 只能是 ${LOG_KINDS.join(' / ')}（收到 "${kind}"）\n` +
      `  note=经验/踩坑 / dev=完成的工作 / concept=新建概念页 / ingest=沉淀资料`,
    );
  }
  await ensurePersonPage(root, who); // 首次写操作即建人页（已存在不动）
  const p = brainPath(root, 'log.md');
  const stamp = localStamp();
  // 不硬切: log.md 是人类读的成果摘要, 也是 abs load 的开机入口。600 码点够一条完整小结,
  // 超出才在语义边界收口（曾 slice(0,100) → 34/85 条断在词中间）
  const clean = clip(String(title || '').replace(/\n/g, ' '), 600);
  // 作者前置于 kind：`## [时间] @name dev | 内容`。
  // 一眼先看到谁做的（与 todo 行 `ID @name — 说明` 排版对齐）。
  const line = `## [${stamp}] ${atTag(who)} ${kind} | ${clean}`;
  await editFile(p, (cur) => {
    const text = cur ?? '# 🗒 Activity Log\n';
    // 倒序：新行插在标题后（若已是模板占位行则替换它）
    const lines = text.split('\n');
    const headerIdx = lines.findIndex((l) => l.startsWith('#'));
    lines.splice(headerIdx + 1, 0, line);
    return { text: lines.join('\n') };
  });
  return `✓ log → ${p}\n  ${line}`;
}