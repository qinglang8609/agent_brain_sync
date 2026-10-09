// src/todo/spec.js — 三份根文件的「规格数据」：分区名、标签白名单、条目形状、行数上限。
// 这里是纯数据 + 只读谓词。抽出来专为断开 structure ⇄ validate 的环：
// structure 要靠它重排、validate 要靠它校验，两边都只依赖它。

import { SEC } from './common.js';

export const LEGACY_SECTION_RENAMES = [
  // H1（文件标题）
  ['# 🗂 图谱索引', '# 🗂 Graph Index'],
  ['# 🗒 操作日志', '# 🗒 Activity Log'],
  ['# 📋 Todo 看板', '# 📋 Todo Board'],
  // ## 分区
  // 四区 → 两区（2026-09-13 用户定：Backlog/Today 常年为空，进行时分区与实际工作流错配）。
  // 未完成的一律归 Todo，状态改由**行首标记**表达（见 TASK_STATES）。
  ['## Backlog', '## Todo'],
  ['## Today / In Progress', '## Todo'],
  ['## Blocked', '## Todo'],
  ['## Done（只留近期，旧的迁 log.md/快照）', '## Done'],
  // ### 区内分组标题
  ['### 归档', '### Archived'],
  ['### （未标日期）', '### Undated'],
];

export const TODO_SECTIONS = ['Todo', 'Done'];
// todo 的 `###` 级标签（实测真实形态：`## Done` 下按日期分组 `### 2026-09-29`，
// 归位的进 `### Archived`）。白名单只限这两类：日期组 + Archived。
// 为什么必须列：`### ` 是 AI 最爱的「自建小节」位置（### 备忘 / ### 计划），
// 只查 `## ` 会把它放过去。

export const TODO_SUBSECTIONS = ['Archived'];
/** `###` 标签是否放行：归档区 / 未标日期组 / 日期组 `YYYY-MM-DD`。
 *  `Undated` 是 LEGACY_MARKS 里的正式标准名（旧 `### （未标日期）` → `### Undated`），
 *  漏了它会把存量文件卡死（实测）。 */

export function isAllowedTodoSub(name) {
  return TODO_SUBSECTIONS.includes(name) || name === 'Undated' || /^\d{4}-\d{2}-\d{2}$/.test(name);
}

// ---------- 三份根文件的标签白名单与条目形状（2026-10-05 用户定）----------
// 用户原话：「index Rules Concepts Entities Sources Syntheses Sessions 包含这些标签
// 不允许增加新的标签，每个标签写内容的规则都是 - [[xx]]123 不允许乱写，同理 log todo 也是」
//
// 为什么需要：闸门只管骨架（分区顺序/H1/空行），**标签白名单与条目形状都没人管**。
// rebuildStructure 的规矩 3 更是「非标准分区原样保留在末尾」（为了防丢人自加的内容）
// → AI 新加一个 `## 备忘` 或 `## 计划` 永远合法，且会一直留在文件里。
//
// 注意 Rules 区是例外：它放的是**规矩短句**（「写代码前先读 docs/STRUCTURE.md」），
// 不是页链接 —— 实测 13 条规则全是这个形态。不能拿 [[页名]] 去卡它。

export const INDEX_SECTIONS = ['Rules', 'Concepts', 'Entities', 'Sources', 'Syntheses', 'Sessions'];
/** 需要 `- [[页名]] …` 形状的区（Rules 除外）。 */

export const INDEX_LINK_SECTIONS = ['Concepts', 'Entities', 'Sources', 'Syntheses', 'Sessions'];
/** log 行的 kind 枚举（与 cmdLog 写入端同源；实测 238 条只有这 4 种）。 */

export const LOG_KINDS = ['note', 'dev', 'concept', 'ingest'];

/** 条目形状规则表：文件 → 每行的预期形状。
 *  校验器只报告「不像这个形状」的行，不自动改写内容（机器不猜语义）。 */
/** 条目形状规则表：文件 → 每行的预期形状。
 *  校验器只报告「不像这个形状」的行，不自动改写内容（机器不猜语义）。 */

export const H1_TO_FILE = {
  '# 🗂 Graph Index': 'index.md',
  '# 🗒 Activity Log': 'log.md',
  '# 📋 Todo Board': 'todo.md',
};

export const ENTRY_SHAPES = {
  'index.md': [
    {
      name: 'INDEX-ENTRY',
      // 条目行：`- [[页名]] — 一句话`（是 6 个链接区里的一行）
      test: (l) => {
        if (!/^-\s/.test(l)) return null; // 非条目行（规则短句/说明）由分区规则另判
        if (!/^-\s*\[\[[^\]]+\]\]/.test(l)) return '应以 `- [[页名]] …` 开头';
        if (!/^-\s*\[\[[^\]]+\]\]\s*[—-]\s*\S/.test(l)) return '`[[页名]]` 后要跟 `— 一句话` 描述';
        return null;
      },
    },
  ],
  'log.md': [
    {
      name: 'LOG-ENTRY',
      test: (l) => {
        if (!/^##\s/.test(l)) return null; // 非 `## ` 行（H1/注释）不管
        // ★ log 没有分区概念：`## ` 开头的只能是条目。
        //   否则 `## 2026-10-05 随便写点`（缺方括号/作者/竖线）会被当成「分区标题」滑过去 ——
        //   而 log.md 的标签白名单是 null（不校验），这就是一个漏网口（实测）。
        // 形状：## [YYYY-MM-DD HH:MM] [[作者]] kind | 正文
        // ★ 放行历史旧模板的占位行 `## [YYYY-MM-DD] ingest | 沉淀 <slug>`：
        //   它是早版 logTemplate 造出来的，不是人写的乱，而是模板自身的遗留。
        //   新模板已改成 HTML 注释（见 store.js logTemplate）。存量这行由 lint 报。
        if (/^##\s*\[YYYY-MM-DD\]/.test(l)) return null;
        const m = l.match(/^##\s*\[(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\]\s*\[\[([^\]]+)\]\]\s*([A-Za-z]+)\s*\|\s*(\S.*)$/);
        if (!m) return '应为 `## [YYYY-MM-DD HH:MM] [[作者]] kind | 正文`（log 只能有这种行）';
        if (!LOG_KINDS.includes(m[3])) return `kind 只能是 ${LOG_KINDS.join('/')}（收到 \`${m[3]}\`）`;
        // 「正文只有个任务 id」不在这里拒（见下 lintOnly 规则）：它是**内容质量**
        // 问题不是**结构格式**问题，当写入闸门会把存量脏库锁死（实测：真库仅一条
        // 就让所有 abs log 失败）。留在此处只会误伤正常短标题（如 `log-0`）。
        return null;
      },
      // 仅在 lint 阶段生效的额外规则（不阻写入，只报存量）。
      lintOnly: (l) => {
        const m = l.match(/^##\s*\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*\[\[[^\]]+\]\]\s*[A-Za-z]+\s*\|\s*(\S.*)$/);
        if (!m) return null;
        if (/^[A-Z][A-Z0-9-]{2,}$/.test(m[1].trim())) return '正文只写了个任务 id（等于没记内容），补一句发生了什么';
        return null;
      },
    },
  ],
  'todo.md': [
    {
      name: 'TODO-ENTRY',
      // 任务行形状（实测）：
      //   新写入（cmdTask）：`- [ ] [状态] id [[作者]] — 描述 (认领 日期)`
      //   旧存量（四区制迁移）：`- [ ] 中文描述 (认领 日期)` ← 没有 id / 作者
      //   已完成：`- [x] id …`（markDone 会 stripStateMark 去掉状态）
      //
      // ★ 为什么不强制要求 id：旧存量的 id 缺失是**历史事实**，机器不能凭空编造
      //   （编了就是静默改写语义）。闸门只确保「结构可解析」：
      //     未完成必须有 `[状态]`（归一后的标志）；已完成必须有内容。
      //   而「新写入必须带 id」由 cmdTask 拼装保证 —— 那是入口的职责，
      //   不是事后逐行猜（猜不出哪行是新的、哪行是旧的）。
      test: (l) => {
        if (/^#{1,3}\s/.test(l)) return null; // 标题行（## Done / ### 日期）不是条目
        if (!/^-\s/.test(l)) return null; // 非条目行（如缩进的 ↳ 断点）由下面单独判
        // Done 区的归档行：`- [[log-日期]] 完成任务 N 条`。
        // ★ 历史命名不统一：还有 `[[2026-09-12-todo归档]]` 这种旧写法（实测），
        //   只认 `log-` 前缀会把它误报为「缺状态标记」。状归档行与任务行的
        //   区别不是命名而是**形态**：没有 `[ ]`/`[x]` 复选框的 [[链接]] 行。
        if (/^-\s*\[\[[^\]]+\]\]\s+完成任务/.test(l)) return null;
        if (/^-\s*\[\[log-\d{4}-\d{2}-\d{2}\]\]/.test(l)) return null;
        const m = l.match(/^-\s*\[([ x])\]\s*(.*)$/);
        if (!m) return '应以 `- [ ] ` 或 `- [x] ` 开头';
        const rest = m[2].trim();
        if (!rest) return '任务行不能只有复选框，要写做什么（已拒）';
        // 未完成：必须有状态标记（新写法）——无标记的旧行由 enforceBrainFormat 自动补上，
        // 走到这里还没标记 = 补不了（不是 `- [ ] ` 形状），报错。
        if (m[1] === ' ' && !/^\[[^\]]+\]\s*\S/.test(rest)) {
          return '未完成任务应为 `- [ ] [状态] …`（状态：进行中/讨论中/滞留中）';
        }
        // 断点附属行不能挤在同一行（应另起 `  ↳ 断点: `）
        if (/↳\s*断点:/.test(rest)) return '断点要另起一行写 `  ↳ 断点: …`';
        return null;
      },
    },
  ], // 任务行/断点行另由 assertTodoContent 卡长度与报告体
};

/** 校验单个文件的分区标签白名单 + 条目形状。返回问题列表（不抛错，供 lint 与写入闸门共用）。
 *  reason 文案直接把出路写清楚 —— 报错不给出路等于让人挖坑。 */

export function indexLinkSectionNeeds(section) {
  return section !== null && INDEX_LINK_SECTIONS.includes(section);
}

/** 任务状态标记（行首，方括号）。替代原 Backlog/Today/Blocked 三区的区分作用。
 * 放在 id **之前**，与 Done 结语的 `【落地】` 形态区分开（那是行尾、结语用）。
 *
 * 「搁置」与「滞留中」的区别（2026-10-05 用户定，别合并）：
 *   滞留中 = 还要做，只是卡住了（等外部/等信息） → 下会话该捡起来
 *   搁置   = 不做了 / 用户改方向了           → 下会话不该捡，除非用户又提
 * 混在一起会让下会话分不清「该不该接着干」。 */

export const TASK_STATES = ['进行中', '讨论中', '滞留中', '搁置'];

/** 结构重建（B 档）：以标准分区表为准重排整个文件。
 *
 * 规则（保证内容不丢、不挪错）：
 *   1. 按 spec.order 顺序输出标准分区，每个分区下放**归属于它**的内容行；
 *   2. 归属判定：按行所处的原分区归入对应标准分区；旧名先按 spec.renames 归一；
 *   3. **非标准分区**（人自加的，如 `## 备忘`）→ 内容连同它自己的标题一起**原样保留在末尾**，
 *      绝不合入已有标准分区（机器不知道它的语义，猜错就是挪错内容）；
 *   4. 自由正文（不属于任何分区的行，如 H1 后的说明句）保留在 H1 之后；
 *   5. 幂等：已是标准结构 → 输出逐字节相同。
 *
 * 返回 { text, changed }；changed 为空的描述列表（空=无需改盘）。 */

export const RETIRED_SECTIONS = ['## Roadmap'];

/** 删除废弃分区的整段（标题到下一个同级/更高级标题前）。
 * 返回 { text, removed:[区名] }；只按整行精确匹配标题，不碰正文。 */

export const BREAKPOINT_MAX = 200;

export const TASK_LINE_MAX = 400;

/** 一行的「违规签名」：去空白、截前 120 字。
 *  用途：比对「这条违规是不是写入前就有的」——新增的拒，存量的放。
 *  不按行号比对：插入一行会让后面所有行号位移，按行号会误判。 */

export const DONE_KINDS = ['落地', '否决', '仅方案'];

/** 从 Done 任务行提取结语标记；无标记返回 ''。 */

export const ARCHIVE_HEADING = `### ${SEC.archived}`;

/** 把 Done 主体行切成 { groupLines, archiveLines }：把 `### 归档` 区当"不透明块"原样保留。
 * 注意不能简单"从标题切到文件尾" —— 否则一旦有日期组落在归档区之后（手改/旧数据），
 * 它会被当不透明内容除在分组之外，永远不参与归档。故只取到下一个 ###/## 标题为止。 */

export const ARCHIVE_SECTION = '## 📦 任务归档';

/** 把「任务归档」段合并进已有正文。**纯函数**（不碰磁盘）。
 *
 * 为何不再「每天一个文件」（2026-09-15 用户定）：
 *   归档页与 `log-<日期>.md` 会话快照是**同一天的记录**，分两处查着要开两个文件。
 *   改为：归档写进当天快照的 `ARCHIVE_SECTION` 段。
 *
 * 两个边界（都有测试钉住）：
 *   ① 文件不存在 → 建一个**只有归档段**的页（那天可能没写快照，仍只落这一个文件）。
 *   ② 文件已存在（含 AI 手写的快照）→ **只替换归档段**，段外内容逐字保留。
 *      同日重复归档（罕见）则把新日期组接在段内已有内容之后，不重复建段。
 *
 * @param body   现有全文（null = 文件不存在）
 * @param group  { date, lines, count }
 */
