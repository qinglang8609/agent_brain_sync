// src/brain/rules.js — index.md 的 `## Rules` 区：读写与呈现。
// 从 store.js 拆出（2026-11-01）：Rules 有自己的一条独立规则链（长度门槛、禁链接），
// 与建骨架/看板/任务无关。
import { brainPath, requireBrain } from '../index.js';
import { editFile, SKIP } from '../lock.js';
import { readIfExists } from '../text.js';

/** index.md 的 `## Rules` 区名与上限。 */
export const RULES_HEADING = '## Rules';
export const RULES_MAX = 30; // 超过就 lint 报：它属于“被读到才有价值”的区，不能无界增长
/** 单条上限（中文按字算）。2026-10-05 从 cmdRule 内联数字抽出：lint 也要查同一个值 ——
 * 曾经只在「abs rule add」写入时校验，手工编辑 index.md 完全绕过，而 lint 只查条数不查长度
 * → 89 字的条目静默通过，同一内容用 add 写反而被拒（两个口子标准不一致）。 */
export const RULE_BODY_MAX = 42;


/** 提取 index.md 里的 Rules 区条目（不含标题）。返回 { items:[行], body, found }。 */
export function readRules(indexText) {
  const lines = String(indexText || '').split('\n');
  const i = lines.findIndex((l) => l.trim() === RULES_HEADING);
  if (i === -1) return { items: [], body: '', found: false };
  const rest = lines.slice(i + 1);
  const j = rest.findIndex((l) => /^##\s/.test(l));
  const body = rest.slice(0, j === -1 ? rest.length : j);
  return { items: body.filter((l) => l.trim().startsWith('- ')), body: body.join('\n').trim(), found: true };
}

/** load 里 Rules 的呈现：带独立段头，条目原样（不折、不截）。无条目则不占字节。 */
export function rulesSection(indexText) {
  const { items, body, found } = readRules(indexText);
  if (!found || !body) return '';
  // 有引言句（> 开头）时一并带上，它解释了这个区是干什么的。
  const intro = body.split('\n').filter((l) => l.trim().startsWith('>')).join('\n');
  return [
    `--- Rules (硬规则，先读, index.md) — ${items.length} 条 ---`,
    intro,
    ...items,
  ].filter((x) => x !== '').join('\n');
}

/**
 * `abs rule` —— 读写 index.md 的 Rules 区。
 * 无参 = 列出（只给规则，不被 load 的其它内容占上下文）。
 * add <一句话> = 追加一条（走锁写、幂等去重）。
 * 门槛：只该放“违反会丢数据/静默失效/白干活”级规律；长句会被拒并指向概念页。
 */
export async function cmdRule({ dir, action, text }) {
  let root;
  try { root = await requireBrain(dir || process.cwd()); } catch {
    return '未找到 .brain/ 图谱。先在项目根运行: abs init';
  }
  const p = brainPath(root, 'index.md');
  if (!action || action === 'list' || action === 'show') {
    const { items, found } = readRules(await readIfExists(p));
    if (!found) return `index.md 无 \`${RULES_HEADING}\` 区（跑 abs load 会自动补位）`;
    if (!items.length) return `${RULES_HEADING} 区为空（add "一句话" 追加）`;
    return [`${RULES_HEADING} — ${items.length} 条:`, ...items].join('\n');
  }
  if (action !== 'add') {
    return `用法: abs rule            列出硬规则\n      abs rule add "一句话" [--note "补充"]`;
  }
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '用法: abs rule add "一句话硬规则"';
  // 门槛：**纪律不是记事本**。Rules 是最前面的项目铁律，每条必须一眼扫完。
  // 2026-09-13 用户定：不带链接、不带解释、不写细节 —— 细节进概念页，Rules 只留结论。
  // 宽严：中文一字信息量大，按 40 字算（≈ 英文 80 字符的量）。实测现有 12 条最长 56 字符。
  if (clean.length > RULE_BODY_MAX) {
    return `✗ 太长（${clean.length} > ${RULE_BODY_MAX}）—— Rules 是纪律不是记事本：\n`
      + `  每条要一眼扫完。细节/出处/例子 → 写进 concepts/ 概念页，这里只留一句话结论。`;
  }
  if (/\[\[|\]\]|https?:\/\//.test(clean)) {
    return '✗ 不带链接 —— Rules 区会被反复全量打印，链接占位且让纪律读起来像索引。\n'
      + '  要挂概念页，去概念页自己的「## 关联连接」里挂。';
  }
  let added = null;
  await editFile(p, (cur) => {
    if (cur === null) return SKIP;
    const lines = cur.split('\n');
    const i = lines.findIndex((l) => l.trim() === RULES_HEADING);
    if (i === -1) return SKIP; // 无该区不擅自建（load 会补位）
    if (lines.some((l) => l.trim() === `- ${clean}`)) return SKIP; // 幂等：同句不重复
    // 插在该区最后一条条目之后（保序、不搅动其它条目）
    let at = i + 1;
    for (let k = i + 1; k < lines.length; k++) {
      if (/^##\s/.test(lines[k])) break;
      if (lines[k].trim().startsWith('- ')) at = k + 1;
    }
    lines.splice(at, 0, `- ${clean}`);
    added = clean;
    return { text: lines.join('\n') };
  });
  if (added === null) return `• 已有同句或 index.md 无 ${RULES_HEADING} 区（跳过）`;
  const { items } = readRules(await readIfExists(p));
  const warn = items.length > RULES_MAX
    ? `\n⚠ Rules 已 ${items.length} 条 > ${RULES_MAX}：考虑把其中几条提炼成概念页（跑 abs lint 会报）`
    : '';
  return `✓ 已加硬规则（共 ${items.length} 条）\n  - ${clean}${warn}`;
}
