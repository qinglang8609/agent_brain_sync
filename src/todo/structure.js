// src/todo/structure.js — 结构重排与格式归一（rebuildStructure / enforceBrainFormat）。

import { H1_TO_FILE, RETIRED_SECTIONS } from './spec.js';
import { sortTodoLines } from './done.js';
import { parseTaskLine, renderTaskLine, shortTitle, taskTimeOf } from './line.js';
import { checkFileShape, violationSignatures, assertNoStrayBlank, assertTodoContent, orphanChildIssues } from './validate.js';
import { trimBlank, sigOfLine, isPlaceholder, migrateLegacyChild, markOf, stateOfMark, STATE_MARK, TASK_STATES } from './common.js';

export function todoTemplate() {
  // 2026-11-16 用户定：todo.md 只剩一个 H1 + 一条列表 ——
  // 不再有 `## Todo` / `## Done` 分区，状态写在复选框里（[ ] [-] [+] [~] [x]）。
  return '# 📋 Todo Board\n';
}

// 分区是怎么没的：2026-09-13 先砍掉 Backlog/Today/Blocked（实测跨 4 个项目常年 0 条），
// 2026-11-16 再砍掉 Todo/Done 两区：已完成与未完成本来就是一条时间线上的事，
// 拆两个区之后「上周做过什么」还得往下翻，而 Done 又被反复压缩归档 —— 索性全平铺。
// 状态由复选框记号表达（[ ] [−] [+] [~] [x]），不靠分区区分。

export function rebuildStructure(text, spec) {
  const s = String(text ?? '');
  const lines = s.split('\n');
  const h1At = lines.findIndex((l) => l.trim().startsWith('# '));
  const bodyStart = h1At === -1 ? 0 : h1At + 1;
  const bucket = new Map();   // 标准分区名 -> 内容行
  const extras = [];          // [{ title, lines }] 非标准分区，原样保留到末尾
  const preamble = [];        // H1 与第一个 ## 之间的自由正文
  let curStd = null;          // 当前在的标准分区名（null = 前言）
  let curExtra = null;        // 当前在的额外分区对象
  for (let i = bodyStart; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{2,3}\s/.test(l)) {
      const t = l.trim();
      const renamed = (spec.renames?.find(([o]) => o === t) || [, t])[1];
      if (spec.order.includes(renamed)) {
        curStd = renamed;
        curExtra = null;
        if (!bucket.has(curStd)) bucket.set(curStd, []);
      } else {
        curExtra = { title: renamed, lines: [] };
        extras.push(curExtra);
        curStd = null;
      }
      continue;
    }
    if (curExtra) curExtra.lines.push(l);
    else if (curStd) bucket.get(curStd).push(l);
    else preamble.push(l);
  }
  const out = [spec.h1];
  const pre = trimBlank(preamble);
  if (pre.length) out.push('', ...pre);
  // 每个分区标题前恒有一个空行（含空分区）。
  // 坑（2026-10-06 定位）：旧写法对空分区走 `else out.push(name)` —— 不补空行，
  // 于是「有内容分区 → 空分区」的接缝被挤成 `- [[页]] …` 紧贴 `## Sources`。
  // 表现成「index 里那个空行反复丢」：人工补回 → 下次任意写操作(过 enforceBrainFormat)
  // 又归一掉，来回拉锯（本机 corp_agent 实测，17961e5 补、f3f7e84 又丢）。
  // 原注释担心「每次首跑都写盘一次」——实测不会：归一后自身就是稳定形态，
  // 第二次跑 fixed 为空、零字节改动（幂等，见 test/todo 的自检）。
  // H1 后必须恒有空行：`# H1` 与首个分区相贴是门面事故，不容忍。
  for (const name of spec.order) {
    const body = trimBlank(bucket.get(name) || []);
    out.push('', name, ...body);
  }
  for (const e of extras) {
    const body = trimBlank(e.lines);
    out.push('', e.title);
    if (body.length) out.push(...body);
  }
  const next = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
  return { text: next, changed: next === s ? [] : ['结构按标准重排'] };
}

/** 去掉首尾空行，不动中间（保留用户的分段）。 */

const isLeafEntry = (l) => /^- |^#{1,3}\s+\[/.test(l);

/** 已废弃的标准分区（2026-10-05 用户定，白名单只一条）。
 * `## Roadmap` 是 2026-09-13 用户亲手删的分区（`store.js` 注释写明原因：
 * “AI 自己写的方向总结，会被 load 反复读到并带偏后续会话”）。
 * 但 `rebuildStructure` 的规矩 3 是「非标准分区原样保留在末尾」——那条护栏是为了
 * 防丢失人自加的区（如 `## 备忘`），机器不猜语义。结果是 Roadmap 被当成“人自加的区”
 * 留了下来，而且 AI 每次重写 index 都能把它加回来：删一个分区的决策根本没生效。
 * 所以这里单列一张白名单，只放**被正式删过的标准分区**——它们进闸门就被整段丢弃；
 * 从没见过的（`## 备忘` 类）仍按护栏原样保留。不做通用机制，出现第二个再添。 */

export function dropRetiredSections(text) {
  const lines = String(text ?? '').split('\n');
  const removed = [];
  const out = [];
  let dropping = false;
  let dropLevel = 0;
  for (const l of lines) {
    const m = l.match(/^(#{2,3})\s+(.*)$/);
    if (m) {
      const title = `${m[1]} ${m[2].trim()}`;
      if (RETIRED_SECTIONS.includes(title)) {
        removed.push(title);
        dropping = true;
        dropLevel = m[1].length;
        continue;
      }
      // 遇到同级或更高级的标题 = 废弃区结束
      if (dropping && m[1].length <= dropLevel) dropping = false;
    }
    if (!dropping) out.push(l);
  }
  return { text: out.join('\n'), removed };
}

/** 写入侧格式闸门：三个文件在**每次写盘前**都过这里，不是只在 load 时修。
 *
 * 规则（用户 2026-10-05 定）：
 *   1. 固定样式 — 标题/分区名必须逐字对标准，不符按 LEGACY_MARKS 归一；
 *   2. 不允许空行 — 条目之间不留空行（正文段落内的空行保留）；
 *   3. 结构固定 — 无 H1 的「无头文件」补回标准 H1，分区按标准顺序重排（rebuildStructure）。
 *
 * 入参 spec 与 checkBrainShape 的 BRAIN_SHAPE 同源（见 store.js）。
 * log.md 无分区（order 为空）→ 只做 H1/归一/去空行，不重排条目顺序（时间倒序自带语义）。
 * 返回 { text, fixed:[描述] }；fixed 为空 = 无需改盘。 */
// ---------- 条目级闸门（2026-10-05 加）----------
// 为什么加：闸门此前只管**骨架形状**（分区/H1/空行），不管条目**内容**。
// 于是 AI 把 todo 当笔记本 —— 实施报告、测试数据、需求清单、架构分析全塞进
// 断点行，文件涨到 232 行/上万字，而闸门与 lint 双双报「0 问题」。
// 这里补上内容约束：todo 只能放 todo。长内容走 abs note（经验）/ abs log（流水）/ sources 页。
//
// 注意：**超长一律抛错，不静默截断**。截断会丢数据且无声 —— 正是要防的那种失效。

function stripStrayBlanks(body, fixed) {
  const lines = String(body).split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) {
      const prev = kept[kept.length - 1];
      // 前瞻要跳过连续空行，否则「两个空行」里只有第一个被删（两个空行是常见形态，
      // 首版留下一个 → 规则形同虚设）。
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const next = lines[j];
      if (prev !== undefined && next !== undefined && isLeafEntry(prev) && isLeafEntry(next)) {
        fixed.push('删除条目之间的空行');
        continue;
      }
    }
    kept.push(l);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

export function enforceBrainFormat(text, spec, prev) {
  let src = String(text ?? '');
  if (!src.trim()) return { text: src, fixed: [] };
  const fixed = [];
  // ★ 旧 `↳` 子项写法最先迁移（2026-10-20），必须跑在**一切校验之前**：
  //   否则旧行会被 assertTodoContent 判成「裸文本」而拒写 —— 整个库变只读。
  //   （实测：真库形态的 `  ↳ 断点: …` 在 load 时就撞上了这条。）
  if (spec?.h1 === '# 📋 Todo Board') {
    const ls0 = src.split('\n');
    let n0 = 0;
    for (let i = 0; i < ls0.length; i++) {
      const conv = migrateLegacyChild(ls0[i]);
      if (conv !== null && conv !== ls0[i]) { ls0[i] = conv; n0++; }
    }
    if (n0) {
      src = ls0.join('\n');
      fixed.push(`旧 ↳ 子项写法 → 标准 md 缩进子项（${n0} 行）`);
    }
  }
  // 内容闸门：形状归一之前先拒掉乱塞（超长断点/报告体），否则下面的 rebuild
  // 会把它当「人自加的正文」好好保留下来 —— 越规整越难发现。
  // ★ 存量宽容（2026-10-05 本机实测踩到）：只拒「本次写入新引入」的违规；
  //   写入前就存在的违规放行（由 lint 报出）。
  //   为什么：不做这个区分，库里只要有一条历史脏行，**所有写入全部失败** ——
  //   实测真库（corp_agent）就因一条超长断点 + 8 条 `[]()` 条目，
  //   连 `abs rule add` 都做不到，整个图谱变成只读。
  //
  // ★ prev 也要过同一道 ↳ 迁移（2026-11-05 实测踩到）：
  //   上面把 src 里的 `  ↳ 内容: …` 迁成 `  - [ ] …`，行的签名随之变形；
  //   而 prevSig 若直接取 prev 的原始签名，就对不上迁移后的行 ——
  //   存量坏子项（超长/报告体）会被判成「本次新引入」，写入失败。
  //   实测症状：zj_shop 的 load 直接崩 —— readTodo 的惰性迁移一走写盘就抛错，
  //   于是 abs load / abs todo 全部失效，且该状态不会自愈。
  //   修法：让 prev 走**同一次迁移**再取签名，两边签名体系才一致。
  let prevForSig = prev;
  if (prev != null && spec?.h1 === '# 📋 Todo Board') {
    const lp = String(prev).split('\n');
    for (let i = 0; i < lp.length; i++) {
      const conv = migrateLegacyChild(lp[i]);
      if (conv !== null && conv !== lp[i]) lp[i] = conv;
    }
    prevForSig = lp.join('\n');
  }
  // prevSig 里同时收**归一后的** prev 签名：load 的核对是「先归一、再交给写入闸门」，
  // 第二次闸门看到的 prev 是原始文件、text 是已归一的新格式 —— 只看原始签名会把
  // 内容没变、只是格式升级的行判成「本次新引入」，于是长行永远修不动（2026-11-16 实测）。
  const prevSigSet = prevForSig == null ? null : violationSignatures(String(prevForSig));
  if (prevSigSet) {
    try {
      for (const l of normalizeTodo(String(prevForSig)).split('\n')) prevSigSet.add(sigOfLine(l));
    } catch { /* 归一失败就只用原始签名 */ }
  }
  const prevSig = prevSigSet;
  if (spec?.h1 === '# 📋 Todo Board') assertTodoContent(src, prevSig);
  // ★ 标签白名单闸门放在**旧标记归一之后**（见下面 legacy 段之后）——
  // 旧标签（`## Backlog` / `## Today / In Progress`）是**待迁移**的，不是非法新标签。
  // 首版把校验放在归一之前，把存量老文件全卡死（7 个测试红，2026-10-05 实测）。
  const fname = H1_TO_FILE[spec?.h1];
  let checked = false;
  const assertShape = (t) => {
    if (!fname || checked) return;
    checked = true;
    // ★ 空行：直接拒绝（用户 2026-10-05：「绝对不允许乱空行」）。
    //   存量库里本来就有空行的，在**写入前**先被归一清除（见 enforceBrainFormat 尾部），
    //   所以走到这里仍有空行 = 本次写入引入的 → 拒。
    assertNoStrayBlank(t, fname);
    // ★ 标签/条目形状：存量脏行放行（不因历史数据锁死库），新增的拒。
    //   为什么这类要宽容而空行不要：超长断点/`[]()` 条目**没有安全的自动修法**
    //   （截断会丢数据、改格式会改语义），只能报给人看；而空行删了不丢任何信息。
    const tLines = t.split('\n');
    const bad = checkFileShape(fname, t).filter(
      (it) => it.code !== 'STRAY-BLANK-LINE' &&
              // ★ 孤儿缩进行**不吃存量豁免**（2026-10-18 用户要求）。
              //   超长断点/奇怪条目放行存量是因为「没有安全的自动修法」；
              //   而孤儿行是**确定性的坏数据**（子项没有父项，语义已丢），放行 = 让损坏持续。
              //   宁可写不进去让人看见，也不要静默接受。
              (it.code === 'TODO-ORPHAN-CHILD' ||
               !(prevSig !== null && prevSig.has(sigOfLine(tLines[it.line - 1] || '')))),
    );
    if (bad.length) {
      const onlyOrphan = bad.every((it) => it.code === 'TODO-ORPHAN-CHILD');
      throw new Error(
        `✗ ${fname} 格式不合规（写入被拒）：\n` +
        bad.map((it) => `  · ${it.msg}`).join('\n') +
        (onlyOrphan
          ? `\n  出路：子任务必须挂在主任务下。给删掉的父任务行恢复一行任务行，或把那几条子项一起删掉。`
          : `\n  出路：内容归入现有标签，或走对应入口（页 → concepts/ 等子目录 + index 登记；流水 → abs log；经验 → abs note）。`),
      );
    }
  };
  // 旧标记 → 标准标记（H1 与分区/分组标题）。与 store.js 的 LEGACY_MARKS 同源，
  // 由调用方通过 spec.renames 注入（todo.js 不反向依赖 store.js）。

  // (0) 废弃分区：被正式删过的标准分区（如 Roadmap）整段丢弃，不等 rebuildStructure
  // 把它当“人自加的区”留到末尾 —— 否则删分区的决策每次都被 AI 重写覆盖回去。
  const retired = dropRetiredSections(src);
  if (retired.removed.length) {
    fixed.push(`删除已废弃分区: ${retired.removed.join(', ')}`);
  }
  // (1) 样式：旧标题名先归一到标准（LOG 无分区、不走 rebuildStructure，这条是它的唯一归一者）。
  let body = retired.text;
  const renames = spec.renames || [];
  if (renames.length) {
    const ls = body.split('\n');
    for (let i = 0; i < ls.length; i++) {
      const t = ls[i].trim();
      const hit = renames.find(([o]) => o === t);
      if (hit && ls[i] !== hit[1]) { ls[i] = hit[1]; fixed.push(`${hit[0]} → ${hit[1]}`); }
    }
    body = ls.join('\n');
  }

  // ★ 旧格式自动升级（2026-10-05）：闸门不能只会拒，还得会**修**。
  //   用户要求「旧版本旧样式要能自动更新为新样式」。
  //   这里把已知的旧形态归一为新形态，**归一之后再校验白名单** ——
  //   否则存量老文件（无状态标记的裸任务行）会被当成违规而卡死（实测：
  //   底层 addTask/upsertTask 传的就是裸文本，它们是内部 API，不是 AI 入口）。
  if (fname === 'todo.md') {
    const ls = body.split('\n');
    let migrated = 0;
    for (let i = 0; i < ls.length; i++) {
      // ★ 旧 `↳ 断点:` / `↳ [ ]` 写法 → 标准 md 缩进子项（2026-10-20）。
      //   为何在闸门里做而不只靠 load：所有写入都过这里，迁移一次就永久生效。
      //   保留这个转换器是「存量不能锁死」的代价 —— 它是全仓唯一还认得 ↳ 的地方。
      const conv = migrateLegacyChild(ls[i]);
      if (conv !== null) {
        if (conv !== ls[i]) { ls[i] = conv; migrated++; }
      }
    }
    if (migrated) fixed.push(`旧 ↳ 子项写法 → 标准 md 缩进子项（${migrated} 行）`);
    body = ls.join('\n');
    // ★ 孤儿子任务在归一**之前**判：归一含按时间重排，重排会把无主子项挪到别的任务下面，
    //   从此看不出它是孤儿（2026-11-16 实测把「写入前就存在的孤儿」放过去了）。
    const orphans = orphanChildIssues(ls);
    if (orphans.length) {
      throw new Error(
        `✗ todo.md 格式不合规（写入被拒）：\n` +
        orphans.map((o) => `  · ${o.msg}`).join('\n') +
        `\n  出路：子任务必须挂在主任务下。给删掉的父任务行恢复一行任务行，或把那几条子项一起删掉。`,
      );
    }
    // ★ 白名单闸门之前先归一（2026-11-16）：旧分区标题（## Todo / ## Done / ### 日期）
    //   是**待迁移**的东西，不是非法新标签。不先归一，闸门就会把存量老文件一顿报红
    //   并拒绝写入 —— 那正是 2026-10-05 踩过的坑（改了白名单顺序把 7 个测试干红）。
    const normalized = normalizeTodo(body);
    if (normalized !== body) { body = normalized; fixed.push('旧分区/日期分组 → 单列表'); }
  }

  // ★ 存量空行先清掉（2026-10-05）：必须跑在 assertShape **之前** ——
  //   否则 assertShape 会看到存量空行而拒绝写入（实测把整个脏库锁成只读）。
  //   删空行不丢任何信息，所以这里直接修，而不是报错。
  body = stripStrayBlanks(body, fixed);

  // ★ 白名单闸门在这里跑：旧格式已升级、旧标记已归一、存量空行已清，
  //   剩下的违规才是真的本次引入。
  assertShape(body);

  // (3) 结构：先补 H1，再按标准重排分区。
  const hasH1 = body.split('\n').some((l) => l.trim().startsWith('# '));
  if (!hasH1) {
    body = [spec.h1, '', body.replace(/^\n+/, '')].join('\n');
    fixed.push(`补回缺失的 H1: ${spec.h1}`);
  }
  if (spec.order?.length) {
    const r = rebuildStructure(normalizeTodoIf(body, spec), spec);
    if (r.changed.length) fixed.push(...r.changed);
    body = r.text;
  }

  // (2) 去条目间空行：同 stripStrayBlanks，但重建后再跑一次（重排会新建邻接关系）。
  const out = stripStrayBlanks(body, fixed);
  return { text: out, fixed };
}

/** todo.md 在重排前必须先走 normalizeTodo（知道旧的 Blocked → 滞留中 语义），
 * 其余文件原样进（rebuildStructure 自带旧分区名归一）。 */

function normalizeTodoIf(body, spec) {
  // 判据只看 H1（2026-11-16 起 todo 没有分区，不能再拿 order[0] 当暗号）。
  return spec.h1 === '# 📋 Todo Board' ? normalizeTodo(body) : body;
}

/** 旧分区/分组标题 —— 迁到单列表时整行丢（内容行会留下并参与排序）。
 *  `📦 任务归档` 是过去日志页里的段名；旧 todo 不会出现，但一起认了不亏。 */
const LEGACY_HEADING_RE = /^#{2,3}\s+(Todo|Done|Backlog|Today \/ In Progress|In Progress|Blocked|Archived|归档|Undated|（未标日期）|📦 任务归档|任务归档|\d{4}-\d{2}-\d{2})\s*$/;

/** 旧归档链接行：`- [[log-2026-11-10]] 完成任务 4 条`。用户 2026-11-16 要求去掉。
 *  实测还有带尾巴的变体：`… 完成任务 3 条 〔来源 service〕`（faxuehui 5 行）——
 *  尾部括注不改变它「只是入口指针」的性质，一起认。 */
const LEGACY_ARCHIVE_LINK_RE = /^-\s*\[\[[^\]]+\]\]\s+完成任务\s+\d+\s*条\s*(?:〔[^〕]*〕|\([^)]*\))?$/;

/** todo.md 归一（读路径与写闸门共用，幂等）。
 *
 * 2026-11-16 用户定：只剩 H1 + 一条列表。迁移动作全在这里：
 *   ① 旧 `↳` 子项 → 标准缩进子项；
 *   ② 旧行首状态前缀 `[滞留中]` → 复选框记号；
 *   ③ 丢掉旧分区标题（`## Todo` / `## Done` / `### 日期` / `### Archived` …）；
 *   ④ 丢掉旧归档链接行（`- [[log-…]] 完成任务 N 条`）；
 *   ⑤ 空行、占位任务行清掉；
 *   ⑥ 按时间倒序重排（未完成用认领日期、已完成用完成日期）。
 * 非任务行（人自加的小节/正文）原样保留 —— 机器不猜语义，报给 lint 处理。 */
export function normalizeTodo(text) {
  const raw = String(text ?? '').split('\n').map((l) => migrateLegacyChild(l) ?? l);
  const kept = [];
  // 旧分区名有语义：`## Blocked` 下的任务本来是「卡住了」，迁到单列表时要落成 `[-]` 滞留中，
  // 不然一条卡住的任务被抹成「进行中」，看板读起来就是假的。
  let legacyBlocked = false;
  for (const l of raw) {
    const t = l.trim();
    if (/^#\s/.test(t)) continue;                       // 旧 H1 统一重写
    if (/^<!--/.test(t)) continue;                       // 模板提示注释
    if (LEGACY_HEADING_RE.test(t)) {                     // 旧分区/日期组/归档标题
      legacyBlocked = /^##\s+Blocked\s*$/.test(t);
      continue;
    }
    if (LEGACY_ARCHIVE_LINK_RE.test(t)) continue;        // 旧归档链接行
    if (!t) continue;                                    // 空行（闸门本来也不许）
    if (isPlaceholder(l)) continue;                      // 占位任务行
    // 老格式行 → 新格式（2026-11-16 用户定：「让他自动改格式」）：
    //   `[状态] id [[作者]] — 描述 — 结语 【落地】 (认领 日期 sid)`
    //     → `[时间] [短标题] [[作者]] 详情 [会话id]`
    // 短标题取第一句（≤24 字），**剩下的全部进详情**；时间取认领/完成日期；
    // 已在新格式的行（parseTaskLine 不返回 legacy）原样不动 —— 幂等。
    const p0 = parseTaskLine(l);
    if (!p0) { kept.push(l); continue; }
    const mark0 = legacyBlocked && p0.mark === ' ' ? '-' : p0.mark;
    if (!p0.legacy) {
      kept.push(legacyBlocked && mark0 !== p0.mark ? l.replace(/^(\s*-\s*)\[ \]/, `$1[${mark0}]`) : l);
      continue;
    }
    // 旧格式的「描述 — 结语」先按破折号切开：第一段当标题来源，其余全是详情
    const descParts = String(p0.detail || '').split(' — ');
    const head0 = descParts[0].trim();
    const st0 = shortTitle(head0);
    const rest0 = [
      head0.length > st0.length ? head0.slice(st0.length).replace(/^[，,、。；;：:—\-\s]+/, '').trim() : '',
      ...descParts.slice(1).map((x) => x.trim()),
    ].filter(Boolean).join(' — ');
    if (p0.indent > 0) {
      kept.push(renderTaskLine({ indent: ' '.repeat(p0.indent), mark: mark0, title: st0 || head0, detail: rest0 }));
      continue;
    }
    kept.push(renderTaskLine({
      mark: mark0,
      time: p0.time || taskTimeOf(l),
      title: [p0.id, st0 || head0].filter(Boolean).join(' '),
      author: p0.author,
      authorAt: p0.authorAt,
      detail: rest0,
      sid: p0.sid,
    }));
  }
  const body = sortTodoLines(kept);
  return ['# 📋 Todo Board', '', ...body].join('\n').replace(/\n+$/, '') + '\n';
}

/** 把任务行的复选框记好改为 state 对应的记号（幂等）。
 *  2026-11-16 起状态就写在复选框里：`[ ]` 进行中 / `[-]` 滞留中 / `[+]` 讨论中 / `[~]` 搁置。
 *  已是该记号 → 原样返回（不为了"补"而改写行）。 */
export function ensureStateMark(line, state) {
  const m = String(line).match(/^(\s*-\s*)\[([ x\-+~])\](.*)$/);
  if (!m) return line;
  const want = STATE_MARK[state] ?? ' ';
  if (m[2] === want) return line;
  // 只剥**旧状态前缀**（`[滞留中]` 这类）；新格式的 `[id 标题]` 不能动 ——
  // 用裸 `/^\s*\[[^\]]+\]/` 会把标题整段吃掉（2026-11-16 实测）。
  const body = m[3].replace(new RegExp(`^\\s*\\[(?:${TASK_STATES.join('|')})\\]\\s*`), '');
  return `${m[1]}[${want}]${body}`;
}

/** 读任务行的状态；已完成（`[x]`）与不是任务行都返回 null。 */
export function stateOfTaskLine(line) {
  const mark = markOf(line);
  return mark === null ? null : stateOfMark(mark);
}

/** 剥掉旧写法的文本状态前缀（`- [ ] [进行中] id …` → `- [ ] id …`），保留缩进与复选框。
 *  新写法状态在复选框里，没有前缀可剥 —— 这个函数只为存量迁移与 upsert 原位重建服务。 */

export function stripStateMark(line) {
  return String(line).replace(/^(\s*-\s*\[[ x\-+~]\]\s*)\[[^\]]+\]\s*/, '$1');
}

/** 把复选框翻成已完成 `[x]`（保留原前缀与缩进）。 */
export function checkTaskBox(line) {
  return String(line).replace(/^(\s*-\s*)\[[ x\-+~]\]/, '$1[x]');
}

/** 从已完成任务行提取 `(完成 YYYY-MM-DD)` 日期；无则返回 ''。兼容中英文括号。 */
