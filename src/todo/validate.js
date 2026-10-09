// src/todo/validate.js — 条目级闸门：形状校验、长度限制、空行检查。

import { TODO_SECTIONS, isAllowedTodoSub, INDEX_SECTIONS, ENTRY_SHAPES, indexLinkSectionNeeds, BREAKPOINT_MAX, TASK_LINE_MAX } from './spec.js';
import { sigOfLine, REPORT_MARKERS, sentenceCount, isTaskLine } from './common.js';

export function checkFileShape(file, text, { lintMode = false } = {}) {
  const issues = [];
  const lines = String(text ?? '').split('\n');
  const allowed = file === 'index.md' ? INDEX_SECTIONS : file === 'todo.md' ? TODO_SECTIONS : null;

  if (allowed) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      // `## [` 开头是 log 的条目行，不是分区标签（否则会把 238 条流水全判非法）
      if (/^##\s+\[/.test(l)) continue;
      const m = l.match(/^##\s+(\S.*)$/);
      const sub = l.match(/^###\s+(\S.*)$/);
      if (!m && !sub) continue;
      const name = (m ? m[1] : sub[1]).trim();
      // todo 的 `###` 标签单独判（只许日期组 + Archived）
      if (sub && file === 'todo.md') {
        if (!isAllowedTodoSub(name)) {
          issues.push({
            code: 'SECTIONS-NOT-ALLOWED',
            line: i + 1,
            msg: `todo.md:${i + 1} 不允许的小节 \`### ${name}\`；` +
              `todo.md 的 ### 只允许 \`### YYYY-MM-DD\`（Done 区日期组）、\`### Undated\` 与 \`### Archived\``,
          });
        }
        continue;
      }
      if (!allowed.includes(name)) {
        issues.push({
          code: 'SECTIONS-NOT-ALLOWED',
          line: i + 1,
          msg: `${file}:${i + 1} 不允许的标签 \`${m ? '##' : '###'} ${name}\`；` +
            `${file} 只允许 ${allowed.map((s) => `\`## ${s}\``).join(' / ')}${
              file === 'todo.md' ? '（`###` 只许日期组与 `### Archived`）' : ''}。` +
            `内容按语义归入现有标签，确实需要例外请先改白名单（见 src/todo.js 的 SECTIONS 常量）`,
        });
      }
    }
  }

  // 条目形状
  const shapes = ENTRY_SHAPES[file] || [];
  if (shapes.length) {
    // 先算每个行所属分区（形状只对被要求的区生效）
    let section = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      // ★ 分区标题的识别不能吃掉 log 的条目行：log 的条目就是 `## [时间] …`，
      //   若把它当分区标题就会 continue 掉本行，形状校验形同虚设（实测：
      //   kind=node / 缺竖线 全部漏放）。判据：`## [` 开头 = 条目，不是分区。
      // ★ 分区标题的识别不能吃掉 log 的条目行：log 的条目就是 `## [时间] …`，
      //   若把它当分区标题就会 continue 掉本行，形状校验形同虚设（实测：
      //   kind=node / 缺竖线 全部漏放）。
      //   ★ log.md 特殊：它**没有分区**，`## ` 开头的只能是条目（含写错的），
      //   所以 log 里绝不能把 `## ` 行当分区标题 —— 全交给形状规则判。
      const sm = file === 'log.md' ? null : (/^##\s+\[/.test(l) ? null : l.match(/^##\s+(\S.*)$/));
      if (sm) { section = sm[1].trim(); continue; }
      if (!l.trim()) continue;
      const needShape = file === 'log.md'
        ? true
        : file === 'todo.md'
          ? true // todo 的任务行形状与分区无关（Todo/Done 都要 `- [ ] …`）
          : indexLinkSectionNeeds(section);
      if (!needShape) continue;
      for (const rule of shapes) {
        const bad = rule.test(l);
        if (bad) issues.push({ code: rule.name, line: i + 1, msg: `${file}:${i + 1} ${bad}` });
        // lintOnly 规则只在体检时跑（不阻写入）—— 用于「内容质量」类问题，
        // 那些问题当闸门会把存量脏库锁死。
        if (!lintMode) continue;
        const bad2 = rule.lintOnly ? rule.lintOnly(l) : null;
        if (bad2) issues.push({ code: `${rule.name}-QUALITY`, line: i + 1, msg: `${file}:${i + 1} ${bad2}` });
      }
    }
  }
  // 条目之间的空行（与写入闸门 assertNoStrayBlank 同判据）。
  // lint 只能「报」，不能抛 —— 体检不能因格式坏而挂。
  const isEntryLine = (l) => /^-\s/.test(l) || /^#{1,3}\s+\[/.test(l);
  const isHeadingLine = (l) => /^#{1,3}\s/.test(l);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) continue;
    if (i > 0 && !lines[i - 1].trim()) continue; // 连续空行只报一次
    let p = i - 1;
    while (p >= 0 && !lines[p].trim()) p--;
    let n = i + 1;
    while (n < lines.length && !lines[n].trim()) n++;
    const prev = p >= 0 ? lines[p] : null;
    const next = n < lines.length ? lines[n] : null;
    if (!prev || !next) continue;
    if (isHeadingLine(prev)) continue; // 标签与首条目之间的空行是排版，不算乱
    if (isEntryLine(prev) && isEntryLine(next)) {
      issues.push({ code: 'STRAY-BLANK-LINE', line: i + 1, msg: `${file}:${i + 1} 条目之间不允许空行（条目必须紧贴）` });
    }
  }
  return issues;
}

/** index 的某个区是否要求 `- [[页名]]` 形状（Rules 与未知区不要求）。 */

export function violationSignatures(text) {
  const set = new Set();
  const lines = String(text ?? '').split('\n');
  for (const l of lines) set.add(sigOfLine(l));
  const isEntry = (l) => /^-\s/.test(l) || /^#{1,3}\s+\[/.test(l);
  for (let i = 1; i < lines.length - 1; i++) {
    if (lines[i].trim()) continue;
    if (isEntry(lines[i - 1]) && isEntry(lines[i + 1])) {
      set.add('HAS-STRAY-BLANK');
      break;
    }
  }
  return set;
}
/** 断点里出现这些 = 明显是在塞报告（列表/代码块/表格）。 */

export function assertNoStrayBlank(text, file, prevSig = null) {
  const lines = String(text ?? '').split('\n');
  const isEntry = (l) => /^-\s/.test(l) || /^#{1,3}\s+\[/.test(l);
  const isHeading = (l) => /^#{1,3}\s/.test(l);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) continue;
    // 找上一个/下一个非空行
    let p = i - 1;
    while (p >= 0 && !lines[p].trim()) p--;
    let n = i + 1;
    while (n < lines.length && !lines[n].trim()) n++;
    const prev = p >= 0 ? lines[p] : null;
    const next = n < lines.length ? lines[n] : null;
    if (prev === null || next === null) continue; // 文件头尾空行不算
    // 连续多个空行：报一次就够
    if (i > 0 && !lines[i - 1].trim()) continue;
    if (!isEntry(prev) && !isEntry(next)) continue; // 正文段落之间允许
    // ★ 标题与首个条目之间必留一个空行（排版必需）—— H1/标签后紧跟条目反而难看。
    //   实测踩坑：log 模板就是 `# H1` + 空行 + `## [日期] …`，不放行会把模板本身卡死。
    if (isHeading(prev)) continue;
    // 两个条目之间（含「条目 → 空行 → 条目」）不允许
    if (isEntry(prev) && isEntry(next)) {
      // 存量空行（写入前就有）→ 放行，交给 lint 报
      if (prevSig !== null && prevSig.has('HAS-STRAY-BLANK')) continue;
      throw new Error(
        `✗ ${file} 不允许条目之间的空行（第 ${i + 1} 行）：\n` +
        `  上一行: ${prev.slice(0, 50)}\n` +
        `  下一行: ${next.slice(0, 50)}\n` +
        `  条目必须紧贴；标签与首条目之间才留一个空行。已拒绝写入 —— 请删掉这个空行再写。`,
      );
    }
  }
  return true;
}

/** 校验 todo 全文的条目内容。抛错 = 拒绝写入（不是修正）。 */

export function assertTodoContent(text, prevSig = null) {
  const lines = String(text ?? '').split('\n');
  /** 存量行（写入前就存在）→ 放行，交给 lint 报。 */
  const isLegacy = (l) => prevSig !== null && prevSig.has(sigOfLine(l));
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const lineNo = i + 1;
    if (l.startsWith('## ')) continue;
    // 任务行
    if (isTaskLine(l)) {
      if (l.length > TASK_LINE_MAX && !isLegacy(l)) {
        throw new Error(
          `✗ 任务行太长（第 ${lineNo} 行 ${l.length} 字 > ${TASK_LINE_MAX}）—— todo 只放「要做什么」，一句话。\n` +
          `  这么长的内容要么拆成多条任务，要么走 abs note（经验）/ abs log（流水）。\n` +
          `  原文开头: ${l.slice(0, 60)}...`,
        );
      }
      continue;
    }
    // 断点附属行
    if (l.trimStart().startsWith('↳ 断点:')) {
      if (isLegacy(l)) continue; // 存量超长断点：不阻写入（lint 报）
      const body = l.trimStart().slice('↳ 断点:'.length).trim();
      if (body.length > BREAKPOINT_MAX) {
        throw new Error(
          `✗ 断点太长（第 ${lineNo} 行 ${body.length} 字 > ${BREAKPOINT_MAX}）—— 断点只写「改到哪个文件哪一步」。\n` +
          `  写不下的内容请分流：实施报告/验证数据 → abs log；经验与坑 → abs note；长设计 → .brain/sources/ 页。\n` +
          `  原文开头: ${body.slice(0, 60)}...`,
        );
      }
      if (REPORT_MARKERS.some((re) => re.test(body)) || sentenceCount(body) > 2) {
        throw new Error(
          `✗ 断点里像是塞了报告/清单（第 ${lineNo} 行）—— 断点是一句话（最多两句），不是文档。\n` +
          `  todo 只能加 todo：要做的拆成任务，做完的写 abs log，经验写 abs note。\n` +
          `  原文开头: ${body.slice(0, 60)}...`,
        );
      }
      continue;
    }
  }
  return true;
}

/** 删掉「条目之间的空行」（条目前后紧贴才是标准形态）。
 *  在 enforceBrainFormat 里跑两次：assertShape 前（清存量，否则存量空行会把写入全卡死）、
 *  重建后（重排会新建邻接关系）。幂等 —— 第二次通常零改动。
 *  为什么删而不是拒：空行不携带信息，删了不丢东西；而断点/条目形状带着内容，
 *  没有安全的自动修法，只能拒并让人处理。 */
