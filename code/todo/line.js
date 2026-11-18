// code/todo/line.js — todo 行格式的唯一真源（2026-11-16 用户定的第三版）。
//
//   - [记号] [YYYY-MM-DD HH:MM] [id 标题] [[作者]] [标签…]
//
// 字段说明：
//   · 记号 `[ ]` 进行中 / `[-]` 滞留中 / `[+]` 讨论中 / `[~]` 搁置 / `[x]` 已完成
//   · `[id 标题]`：id 是一个词（命令用它定位：`abs todo done <id>`），后面是标题正文
//   · `[YYYY-MM-DD HH:MM]`：登记那一刻的本地时间（排序键，最新在上）
//   · `[[作者]]`：可选（旧行可能仍是裸 `@作者`，原样保留）
//   · `[会话id]`：可选
//
// 子项只有「缩进 + 记号 + 标题」，不带 id/时间/作者/会话：
//     - [ ] 子项一
//
// 旧格式（`- [ ] [状态] id [[作者]] — 描述 (认领 日期 sid)`、`【落地】 (完成 日期)`）
// 由 normalizeTodo 一次性迁移到这里 —— 迁移后结语、`【】`、完成时间都不再存在。

const MARK = '[ x\\-+~]';

/** 任务行（含缩进的子项行）。 */
export const TASK_RE = new RegExp(`^(\\s*)-\\s*\\[(${MARK})\\]\\s*(.*)$`);


/** 短标题：**一句短语**（默认 ≤20 字），优先在中文标点处收口。
 *  用户 2026-11-16：「标题是短标题，别把详情塞进去」——详情放行内纯文本部分。
 *  例：`查 abs 单字只做 load 汇报、不触发收尾的原因` → `查 abs 单字只做 load 汇报`
 */
export function shortTitle(text, max = 24) {
  // 标题里的 `[` `]` 会把行结构切坏（解析按方括号分段），统一换成中文括号
  const t = String(text ?? '').replace(/\s+/g, ' ').replace(/\[/g, '〔').replace(/\]/g, '〕').trim();
  if (t.length <= max) return t;
  // 破折号是「描述 — 结语」的天然分界：优先用它
  const dash = t.indexOf(' — ');
  if (dash >= 8 && dash <= max + 6) return t.slice(0, dash).trim();
  const head = t.slice(0, max + 8);
  for (const p of ['。', '；', ';', '！', '!', '？', '?', '、', '，', ',', '：', ':', '—']) {
    const i = head.indexOf(p);
    if (i >= 8 && i <= max) return head.slice(0, i).trim();
  }
  // 没有标点：优先在空格处断，别把英文/路径词切成半截
  // 切点不能落在成对括号/引号里面（否则会切出 `改为「只留 H1 +` 这种半截引用）
  const pairs = [['（', '）'], ['(', ')'], ['「', '」'], ['《', '》'], ['【', '】']];
  let cut = t.slice(0, max).length;
  for (const [open, close] of pairs) {
    const o = t.lastIndexOf(open, max);
    const c = t.indexOf(close, o + 1);
    if (o !== -1 && o < max && c > max) cut = o;   // 切点在括号内 → 退到括号前
  }
  if (cut < max) return t.slice(0, cut).trim();
  const sp = t.lastIndexOf(' ', max + 8);
  if (sp >= Math.floor(max / 2)) return t.slice(0, sp).trim();
  return t.slice(0, max).trim() + '…';
}

export const isTime = (s) => /^\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?$/.test(String(s || '').trim());

/** 解析一行任务/子项。
 *  格式（2026-11-16 定稿）：
 *    `- [记号] [YYYY-MM-DD HH:MM] [短标题] [[作者]] 详情纯文本 [会话id]`
 *  子项：`  - [记号] 短标题`
 *  返回 null = 不是任务行。标题是短标题；详情允许任何文字（可含方括号/链接）。
 *  时间、作者、详情、会话 id 都可缺省。 */
export function parseTaskLine(line) {
  const m = String(line ?? '').match(TASK_RE);
  if (!m) return null;
  const indent = m[1].length;
  const mark = m[2];
  let rest = m[3].trim();
  // 子项与任务同格式，只是带缩进 —— 不在这里 early-return，走同一套字段解析

  const tm = rest.match(/^\[(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\]\s*/);
  const time = tm ? tm[1] : '';
  if (tm) rest = rest.slice(tm[0].length);

  // 标题：第一个方括号段
  const thRaw = rest.match(/^\[([^\]]+)\]\s*/);
  // `[进行中]` 这类旧状态前缀不能被当成标题 → 交给旧格式兜底
  const th = thRaw && !['进行中', '讨论中', '滞留中', '搁置'].includes(thRaw[1].trim()) ? thRaw : null;
  const title = th ? th[1].trim() : '';
  if (th) rest = rest.slice(th[0].length);

  // 作者：`[[姓名]]` 或 `@姓名`
  const au = rest.match(/^(?:\[\[([^[\]]+)\]\]|@([\w\u4e00-\u9fff.-]+))\s*/);
  const author = au ? (au[1] || au[2]) : '';
  const authorAt = !!(au && au[2] && !au[1]);   // 历史行的裸 `@name` 形态，原样保留
  if (au) rest = rest.slice(au[0].length);

  // 末尾：会话 id 是行尾最后一个方括号（详情里可以有别的方括号，所以从右取）
  let sid = '';
  const tail = rest.match(/\[([^[\]]*)\]\s*$/);
  // 详情为空时会话 id 就在 rest 的第 0 位，所以不能要求 index > 0
  if (tail) { sid = tail[1].trim(); rest = rest.slice(0, tail.index).trimEnd(); }

  if (!th) {
    // 不是新格式 → 旧格式兜底（迁移期仍要能列出/定位）
    return parseLegacyTask(mark, indent, m[3], line);
  }
  return { indent, mark, title, time, author, authorAt, detail: rest.trim(), sid, tags: [], newFormat: true };
}

/** 旧行的日期：`(认领 日期 [sid])` 优先，否则 `(完成 日期 [sid])`。纯正则，不走 parseTaskLine。 */
function legacyTimeOf(line) {
  const pick = (re) => {
    const m = String(line).match(re);
    if (!m) return '';
    const t = m[2] && /^\d{2}:\d{2}$/.test(m[2]) ? ` ${m[2]}` : '';
    return `${m[1]}${t}`;
  };
  return pick(/\(认领\s*(\d{4}-\d{2}-\d{2})(?:\s+(\S+))?/) || pick(/\(完成\s*(\d{4}-\d{2}-\d{2})(?:\s+(\S+))?/);
}

/** 旧格式兜底：`[状态] id [[作者]] — 描述 — 结语 【落地】 (认领 日期 sid)`。 */
function parseLegacyTask(mark, indent, raw, fullLine) {
  // 旧写法的文本状态前缀就是状态本身：`[滞留中] A — …` → 记号 `[-]`
  const sm = String(raw || '').match(/^\[(进行中|讨论中|滞留中|搁置)\]/);
  const stateMark = sm ? ({ 进行中: ' ', 讨论中: '+', 滞留中: '-', 搁置: '~' }[sm[1]]) : null;
  const rest = String(raw || '')
    .replace(/^\[(进行中|讨论中|滞留中|搁置)\]\s*/, '')
    .replace(/【(落地|否决|仅方案)】/g, '')
    .replace(/\s*\((?:认领|完成)[^)]*\)/g, '')
    .trim();
  const t = rest.match(/^(\S+)\s*(?:\[\[([^\]]+)\]\]|@([\w\u4e00-\u9fff.-]+))?\s*(.*)$/);
  const first = t ? t[1] : '';
  const hasAuthor = !!(t && (t[2] || t[3]));
  const id = t && (/^[\w.-]{1,24}$/.test(first) || hasAuthor) ? first : '';
  const desc = (t && id ? t[4] : rest).trim().replace(/^[—:：-]\s*/, '').trim();
  return { indent, mark: stateMark ?? mark, id, title: '', time: legacyTimeOf(fullLine || raw), author: t ? (t[2] || t[3] || '') : '', authorAt: !!(t && t[3] && !t[2]), detail: desc, sid: taskSidOf(raw), tags: [], legacy: true };
}

/** 生成任务行：`- [记号] [时间] [短标题] [[作者]] 详情 [会话id]`。 */
export function renderTaskLine({ indent = '', mark = ' ', title = '', time = '', author = '', detail = '', sid = '', authorAt = false } = {}) {
  // 详情结尾若是方括号段，会被解析成会话 id → 写盘前换成中文括号（保内容、不破坏结构）
  const det = String(detail || '').replace(/\[([^\[\]]*)\]\s*$/, '〔$1〕').trim();
  const pad = typeof indent === 'number' ? ' '.repeat(indent) : String(indent || '');
  const parts = [`${pad}- [${mark}]`];
  if (time) parts.push(`[${time}]`);
  parts.push(`[${String(title).trim()}]`);
  if (author) parts.push(authorAt ? `@${author}` : `[[${author}]]`);
  if (det) parts.push(det);
  if (sid) parts.push(`[${sid}]`);
  return parts.join(' ');
}

/** 子项行（只带记号与文字）。 */
export const renderChildLine = (title, { mark = ' ', indent = '  ', time = '', author = '', detail = '', sid = '' } = {}) =>
  renderTaskLine({ indent, mark, time, title, author, detail, sid });

/** 任务的定位键：新格式用 `[id …]` 的首词，旧格式用行首 id。没有 id 返回 ''。 */
export function taskIdOf(line) {
  const t = parseTaskLine(line);
  return t ? (t.id || '') : '';
}

/** 行的时间（新格式 `[time]`；旧格式取认领/完成日期）。用于排序。 */
export function taskTimeOf(line) {
  const t = parseTaskLine(line);
  if (t && t.time) return t.time;
  if (legacyTimeOf(line)) return legacyTimeOf(line);
  // 旧格式的日期段：`(认领 2026-11-16 01a1e1c1-8258-77)` —— 后面那个是**会话 id 不是时分**，
  // 时间部分只认 `\d{2}:\d{2}`（否则会把 sid 的 "01" 当小时）。
  const pick = (re) => {
    const m = String(line).match(re);
    if (!m) return '';
    const t = m[2] && /^\d{2}:\d{2}$/.test(m[2]) ? ` ${m[2]}` : '';
    return `${m[1]}${t}`;
  };
  return pick(/\(认领\s*(\d{4}-\d{2}-\d{2})(?:\s+(\S+))?/) || pick(/\(完成\s*(\d{4}-\d{2}-\d{2})(?:\s+(\S+))?/);
}

/** 行的会话 id（新格式取尾方括号；旧格式取 `(认领 日期 sid)` 末尾 token）。 */
export function taskSidOf(line) {
  const t = parseTaskLine(line);
  if (t && t.sid) return t.sid;
  // 注意别在这里 early-return：解析不了的片段（如只给了行体）也要能靠正则取到 sid
  const m = String(line).match(/\((?:认领|完成)\s*\d{4}-\d{2}-\d{2}\s+([\w-]+)\)/);
  return m ? m[1] : '';
}
