// code/todo/spec.js — 三份根文件的「规格数据」：分区名、标签白名单、条目形状、行数上限。
// 这里是纯数据 + 只读谓词。抽出来专为断开 structure ⇄ validate 的环：
// structure 要靠它重排、validate 要靠它校验，两边都只依赖它。

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

// todo.md 没有分区（2026-11-16 用户定）：只剩 H1 + 一条列表。
// 任何 `## ` / `### ` 都是违规 —— `### ` 是 AI 最爱的「自建小节」位置（### 备忘 / ### 计划）：
// 旧分区与日期组由 normalizeTodo 迁移时丢掉，不会卡住存量库。
export const TODO_SECTIONS = [];

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

export const INDEX_SECTIONS = ['Rules', 'Concepts', 'Entities', 'Sources', 'Syntheses'];
/** 需要 `- [[页名]] …` 形状的区（Rules 除外）。
 *
 * `Sessions` 已废（2026-11-16 用户定）：会话页与归档页的清单不再登记进 index ——
 * 链接行只是把目录当第二张表，多一处要维护的重复。存量段由 RETIRED_SECTIONS 整段删除。 */

export const INDEX_LINK_SECTIONS = ['Concepts', 'Entities', 'Sources', 'Syntheses'];
/** log 行的 kind 枚举（与 cmdLog 写入端同源；实测 238 条只有这 4 种）。 */

export const LOG_KINDS = ['note', 'dev', 'concept', 'ingest', 'review', 'plan', 'fix', 'docs', 'devops', 'audit', 'migrate'];
// 枚举来自 2026-11-16 的跨项目实测（9 个图谱 1000+ 条 log）：
//   note/dev/concept/ingest 是主线四种；review/plan/fix/docs/devops/audit/migrate
//   在 zj_shop 真库里各出现过 1–3 次。原枚举是从「238 条只有这 4 种」推的，样本不够——
//   把实际用过的补进枚举，比批量改写历史行诚实（工具只报不改是同一原则的反面教材）。

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
      // 条目行：`- [[页名]] — 一句话`（是 5 个链接区里的一行）
      //
      // ★ 2026-10-18 补的白名单另一半：原规则只检查 `- ` 开头的行，**不以 `- ` 开头的
      //   散文全部原样放行**。于是 Sources 区被塞进 `场景：…` 段落、裸编号列表项、
      //   `## 标题` 前缀也都存下来了（实测真库被污染 5 条，index 从 69 行膨到 88 行）。
      //   链接区里只应有两种行：`- [[…]]` 条目、空行。其余一律拒。
      test: (l) => {
        if (!l.trim()) return null; // 空行由 STRAY-BLANK 规则另判
        if (!/^-\s/.test(l)) return '链接区只能放 `- [[页名]] — 一句话`（正文段落/编号列表/代码块都不行）';
        if (!/^-\s*\[\[[^\]]+\]\]/.test(l)) return '应以 `- [[页名]] …` 开头';
        if (!/^-\s*\[\[[^\]]+\]\]\s*[—-]\s*\S/.test(l)) return '`[[页名]]` 后要跟 `— 一句话` 描述';
        // 格式闸（2026-11-08 用户定）：机器模板行（只有日期+归档字样）不算描述，打回。
        // 归档登记时必须带任务首段（见 maintain.js / archiveBrief）。
        const dTpl = l.replace(/^\s*-\s*\[\[[^\]]+\]\]\s*[—-]\s*/, '').trim();
        if (/^\d{4}-\d{2}-\d{2}（(?:会话快照 \+ )?任务归档）?$/.test(dTpl)) {
          return '描述不能只是日期模板 —— 要写那天干了什么（任务首段，≥4 字）';
        }
        // 摘要里不许带 Markdown 结构符（实测污染就是摘要取了页面正文开头）
        if (/^\s*-\s*\[\[[^\]]+\]\]\s*[—-]\s*#+\s/.test(l)) return '摘要不能带 `## ` 标题前缀（取页面首行标题了）';
        // ★ 2026-10-18 补：摘要正文本身必须是**纯文本一句话**。
        //   原规则只拦了 `## ` 前缀，实测下列全放行：摘要写成 `- 列表项`（看着就像
        //   另一条条目）、```js（开代码围栏把后面全吞）、`| a | b |`（表格）。
        //   index 是表，摘要是一列纯文本。
        //
        //   但别拦过头：摘要位置在 `- [[页名]] — ` 之后，是**一行中间**，
        //   `+ ` / `* ` / `> ` / `1. ` 在这里不会真渲染成块级结构，都是人话开头
        //   （实测放过一次「+ 一点补充」被误拒）。只拦真正会破坏解析的几种。
        const desc = l.replace(/^\s*-\s*\[\[[^\]]+\]\]\s*[—-]\s*/, '');
        if (/^(?:-\s|```|~~~|\|)/.test(desc) || /^#{1,6}\s/.test(desc)) {
          return '摘要必须以文字开头（不能是列表项/代码围栏/表格/标题）';
        }
        if (desc.includes('```')) return '摘要不能含代码围栏 ```（会吞掉后续所有条目）';
        return null;
      },
    },
  ],
  'log.md': [
    {
      name: 'LOG-ENTRY',
      // 2026-11-16 用户定：log 行与 todo 行同构，kind 取消 ——
      //   `## [标题] [YYYY-MM-DD HH:MM] [[作者]] [会话id]`
      // log 只应有三类行：H1、条目行、HTML 注释（空行另由 STRAY-BLANK 判）。
      test: (l) => {
        if (!l.trim()) return null;
        if (/^#\s/.test(l)) return null;                        // H1
        if (/^<!--/.test(l.trim())) return null;                 // 模板提示注释
        if (!/^##\s/.test(l)) return 'log 里只能有 `## [标题] [时间] [[作者]] [会话id]` 条目行（散文/报告请开一条条目）';
        // 历史占位行（早版模板 `## [YYYY-MM-DD] ingest | 沉淀 <slug>`）放行，存量由 lint 报。
        if (/^##\s*\[YYYY-MM-DD\]/.test(l)) return null;
        // 标题贪婪匹配：正文里可能有 `[[页名]]` 这类方括号。
        // 2026-11-16 定稿：`## [时间] [短标题] [[作者]] 正文纯文本 [会话id]`
        const m = l.match(/^##\s*\[(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\]\s*\[([^\]]+)\]\s*(?:\[\[([^\]]+)\]\]|@([\w\u4e00-\u9fff.-]+))?\s*([\s\S]*?)\s*(?:\[([^\[\]]*)\])?\s*$/);
        if (!m) return '应为 `## [标题] [YYYY-MM-DD HH:MM] [[作者]] [会话id]`（log 只能有这种行）';
        if (!m[2].trim()) return '条目标题不能为空';
        if (!(m[3] || m[4])) return '缺作者标记（`[[作者]]` 或历史的 `@作者`）';
        if (m[2].includes('```') || (m[5] || '').includes('```')) return '条目不能含 ``` —— 一行摘要，代码请贴文件路径或拆成 source 页';
        return null;
      },
      // 仅在 lint 阶段生效的额外规则（不阻写入，只报存量）。
      lintOnly: (l) => {
        const m = l.match(/^##\s*\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*\[([^\]]+)\]/);
        if (!m) return null;
        if (/^[A-Z][A-Z0-9-]{2,}$/.test(m[1].trim())) return '标题只写了个任务 id（等于没记内容），补一句发生了什么';
        return null;
      },
    },
  ],
  'todo.md': [
    {
      name: 'TODO-ENTRY',
      // 行格式（2026-11-16 定稿）：
      //   `- [记号] [YYYY-MM-DD HH:MM] [短标题] [[作者]] 详情纯文本 [会话id]`
      //   子项同格式（带缩进）。时间可缺省；详情允许任意文字（可含方括号/双链）。
      test: (l) => {
        if (/^#{1,3}\s/.test(l)) return null;
        if (!/^-\s/.test(l)) return null;
        const m = l.match(/^\s*-\s*\[([ x\-+~])\]\s*(?:\[(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\]\s*)?\[([^\]]+)\]/);
        if (!m) return '任务行应为 `- [记号] [时间] [短标题] [[作者]] 详情 [会话id]`';
        if (!m[3].trim()) return '`[短标题]` 不能为空';
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

// 四个状态词已挪到 common.js（2026-11-09：子项也能标状态，parseChild/renderChild 要用它）——
// 这里只做转发，别处的 import 路径不变。
export { TASK_STATES } from './common.js';

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

export const RETIRED_SECTIONS = ['## Roadmap', '## Sessions'];

/** 删除废弃分区的整段（标题到下一个同级/更高级标题前）。
 * 返回 { text, removed:[区名] }；只按整行精确匹配标题，不碰正文。 */

export const BREAKPOINT_MAX = 200;

export const TASK_LINE_MAX = 400;

/** 一行的「违规签名」：去空白、截前 120 字。
 *  用途：比对「这条违规是不是写入前就有的」——新增的拒，存量的放。
 *  不按行号比对：插入一行会让后面所有行号位移，按行号会误判。 */

