// src/todo/structure.js — 结构重排与格式归一（rebuildStructure / enforceBrainFormat）。

import { TODO_SECTIONS, H1_TO_FILE, TASK_STATES, RETIRED_SECTIONS } from './spec.js';
import { checkFileShape, violationSignatures, assertNoStrayBlank, assertTodoContent } from './validate.js';
import { trimBlank, sigOfLine, isPlaceholder } from './common.js';

export function todoTemplate() {
  // 由 rebuildStructure 生成，保证“模板”与“重排结果”逐字节一致
  // （否则 load 会把新建的模板又重排一次 = 无意义的写盘）。
  // 注意（2026-09-13 踩坑）：rebuildStructure 的 order 要**带 `## ` 前缀**，
  // 而 TODO_SECTIONS 是裸名（两者用途不同，不能复用 —— 曾误传裸名导致
  // 生成出没有 `##` 的裸标题行，模板直接损坏、Backlog 分区消失）。
  return rebuildStructure(
    ['# 📋 Todo Board', ...TODO_SECTIONS.map((s) => `## ${s}`)].join('\n'),
    { h1: '# 📋 Todo Board', order: TODO_SECTIONS.map((s) => `## ${s}`) },
  ).text;
}

// 只有两区（2026-09-13 用户定：精简）。为什么砍掉 Backlog/Today/Blocked：
// 实测跨 4 个项目，Backlog 与 Today 常年为 **0 条** —— 而 log.md 有 120 条。
// 根因：AI 的工作方式是「一口气做完」，任务从开始到完成都在同一会话内走完，
// 中间那个「挂到进行时分区上」的动作既来不及也不需要发生。
// 而 log 是在**结束时**写的，那个时点真实存在，所以它记满了。
// 结论：进行时分区是符合直觉但不符合实际工作流的抽象 → 删掉，
// 未完成的一律进 Todo，状态用**行首标记**表达（不靠分区区分）。

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
  const src = String(text ?? '');
  if (!src.trim()) return { text: src, fixed: [] };
  // 内容闸门：形状归一之前先拒掉乱塞（超长断点/报告体），否则下面的 rebuild
  // 会把它当「人自加的正文」好好保留下来 —— 越规整越难发现。
  // ★ 存量宽容（2026-10-05 本机实测踩到）：只拒「本次写入新引入」的违规；
  //   写入前就存在的违规放行（由 lint 报出）。
  //   为什么：不做这个区分，库里只要有一条历史脏行，**所有写入全部失败** ——
  //   实测真库（corp_agent）就因一条超长断点 + 8 条 `[]()` 条目，
  //   连 `abs rule add` 都做不到，整个图谱变成只读。
  const prevSig = prev == null ? null : violationSignatures(String(prev));
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
              !(prevSig !== null && prevSig.has(sigOfLine(tLines[it.line - 1] || ''))),
    );
    if (bad.length) {
      throw new Error(
        `✗ ${fname} 格式不合规（写入被拒）：\n` +
        bad.map((it) => `  · ${it.msg}`).join('\n') +
        `\n  出路：内容归入现有标签，或走对应入口（页 → concepts/ 等子目录 + index 登记；流水 → abs log；经验 → abs note）。`,
      );
    }
  };
  const fixed = [];
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
    for (let i = 0; i < ls.length; i++) {
      // 裸任务行（`- [ ] id …` 无状态标记）→ 补默认「进行中」
      if (/^- \[ \] /.test(ls[i]) && !/^- \[ \] \[[^\]]+\]/.test(ls[i])) {
        const fixed2 = ensureStateMark(ls[i], '进行中');
        if (fixed2 !== ls[i]) { ls[i] = fixed2; fixed.push('补回缺失的状态标记'); }
      }
    }
    body = ls.join('\n');
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
  return spec.h1 === '# 📋 Todo Board' && spec.order?.[0] === '## Todo' ? normalizeTodo(body) : body;
}

export function normalizeTodo(text) {
  const lines = text.split('\n');
  const has = (name) => lines.some((l) => l.trim() === `## ${name}`);
  // 已是标准两区制 = 有 Todo 且**没有**任何进行时老分区。
  // 坑（2026-09-13）：曾只判 has('Todo') 就 return —— 而最老格式里也可能有 `## Todo`
  // （与 `## In Progress` 混用），于是旧文件永不迁移。
  const legacy = ['Backlog', 'Today / In Progress', 'In Progress', 'Blocked'].some(has);
  if (has('Todo') && !legacy) return text;
  const out = ['# 📋 Todo Board'];
  const grab = (name) => {
    const items = [];
    let inSec = false;
    for (const l of lines) {
      if (l.startsWith('## ')) { inSec = l.trim() === `## ${name}`; continue; }
      if (inSec && l.trim() && !isPlaceholder(l)) items.push(l);
    }
    return items;
  };
  const done = grab('Done');
  // 未完成的一切（不论原来在 Backlog/In Progress/Todo/Blocked）→ 一律进 Todo。
  // 状态信息由行首标记承接：原 Blocked 区的任务补 [滞留中]（其余默认 [进行中]，写入时补）。
  const open = [];
  for (const name of ['Backlog', 'Today / In Progress', 'In Progress', 'Todo']) {
    open.push(...grab(name).map((l) => ensureStateMark(l, '进行中')));
  }
  open.push(...grab('Blocked').map((l) => ensureStateMark(l, '滞留中')));
  out.push('## Todo', ...open);
  out.push('## Done', ...done);
  return out.join('\n');
}

/** 给任务行补行首状态标记（已有则不覆盖）。`- [ ] id …` → `- [ ] [状态] id …` */

export function ensureStateMark(line, state) {
  const m = String(line).match(/^(- \[[ x]\] )(\[[^\]]+\]\s+)?(.*)$/);
  if (!m) return line;
  if (m[2] && TASK_STATES.includes(m[2].trim().replace(/[\x5B\x5D]/g, ''))) return line;
  return `${m[1]}[${state}] ${m[3]}`;
}

/** 取任务行的状态标记；无标记返回 null。 */

export function stateOfTaskLine(line) {
  const m = String(line).match(/^- \[[ x]\] \[([^\]]+)\]/);
  return m && TASK_STATES.includes(m[1]) ? m[1] : null;
}

/** 改任务行的状态标记（原地）。未找到或非法状态返回原样。 */

export function stripStateMark(line) {
  return String(line).replace(/^(- \[[ x]\] )\[[^\]]+\] /, '$1');
}

/** 从已完成任务行提取 `(完成 YYYY-MM-DD)` 日期；无则返回 ''。兼容中英文括号。 */
