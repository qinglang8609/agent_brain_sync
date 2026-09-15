#!/usr/bin/env node
// bin/mcp.js — abs MCP server (stdio)。
// 职责只有两个（PLAN.md v2 定稿）:
//   ① resolve_project: 用代码写死逻辑定位当前项目目录（只认 cwd 本身的 .brain/）
//   ② 转接调用 CLI 读写（todo/board/query 的具体实现复用 src/）
// 无状态：每次调用从入参 cwd 重新解析，多项目各归各位。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { appendFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrainRoot, absLogDir } from '../src/index.js';
import { cmdBoard, cmdLoad, cmdStatus, cmdTask, cmdQuery, cmdLint, cmdNote, cmdConcept, cmdWrapup, cmdRule, cmdResolve, cmdSupersede } from '../src/store.js';

// ---------- 技术日志: MCP 请求跟踪（调试用, 与图谱 log.md 完全分开） ----------
// 落 ~/.abs/log/mcp.log: 每次工具调用一行 [时间] tool cwd 参数摘要 → 耗时/结果摘要。
// 关闭: ABS_LOG=0。stderr 不用（stdio transport 会污染协议）。
const MCP_LOG = process.env.ABS_LOG !== '0';
const LOG_DIR = absLogDir();
async function tlog(line) {
  if (!MCP_LOG) return;
  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(join(LOG_DIR, 'mcp.log'), `[${new Date().toISOString()}] ${line}\n`);
  } catch { /* 日志失败不影响服务 */ }
}

// 包一层: 记录每个工具调用的入参摘要与耗时
function withTrace(name, handler) {
  return async (args) => {
    const t0 = Date.now();
    const argBrief = JSON.stringify(args || {}).slice(0, 200);
    try {
      const r = await handler(args);
      const text = r?.content?.[0]?.text || '';
      const brief = text.replace(/\n/g, '⏎').slice(0, 120);
      await tlog(`tool=${name} cwd=${args?.cwd || '-'} args=${argBrief} → ${r?.isError ? 'ERR' : 'OK'} ${Date.now() - t0}ms | ${brief}`);
      return r;
    } catch (e) {
      await tlog(`tool=${name} cwd=${args?.cwd || '-'} args=${argBrief} → THROW ${Date.now() - t0}ms | ${String(e?.message || e).slice(0, 200)}`);
      throw e;
    }
  };
}

// 版本号从本包 package.json 读（曾硬编码 '0.1.0'，与包版本脱节，宿主里看着困惑）
function pkgVersion() {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || 'unknown';
  } catch { return 'unknown'; }
}

const server = new McpServer({
  name: 'abs',
  version: pkgVersion(),
});

// 统一注册入口（总是经 withTrace）。
// 坑: 以前 9 处工具各自直接调 server.tool(...) 而不包 withTrace, 导致 withTrace 定义了
// 但从未被调用 → mcp.log 永远不生成。可观测性静默缺失(无任何症状), 藏了很久。
// 现在工具只经本函数注册, 包 trace 这件事无法再被遗漏。
function tool(name, description, schema, handler) {
  server.tool(name, description, schema, withTrace(name, handler));
}

// 工具面（narrow on purpose — 只暴露读/查/记状态，不做深提炼）。
// 分级标注（借 OpenContext 的 P0/P1/P2 惯例）：P0=每次开机必调；P1=干活中按需；P2=诊断/收尾。
// 后来人（和 AI）照这个顺序调，别一上来就 lint。
//   P0  abs_resolve_project / abs_load
//   P1  abs_board / abs_task / abs_query / abs_note / abs_resolve
//   P2  abs_status / abs_rule / abs_lint / abs_wrapup
tool(
  'abs_resolve_project',
  '定位当前项目的 .brain 图谱根（只认给定目录本身的 .brain/，不向上搜索）。多项目隔离的唯一入口。',
  { cwd: z.string().describe('项目根目录（.brain/ 所在处）') },
  async ({ cwd }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) {
      return err(`目录 ${cwd} 下没有 .brain/ 图谱（不向上搜索）。`, {
        code: 'NO_BRAIN',
        fallback: '先在该目录运行: abs init',
      });
    }
    return { content: [{ type: 'text', text: root }] };
  }
);

tool(
  'abs_board',
  '读取当前项目 todo 看板（含断点/Next-Step）。先 resolve 得到项目，再传其根目录。',
  { cwd: z.string().describe('项目根目录（.brain/ 所在处）') },
  async ({ cwd }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return errNoBrain(cwd || process.cwd());
    return { content: [{ type: 'text', text: await cmdBoard({ dir: root }) }] };
  }
);

tool(
  'abs_load',
  '开机读状态：index 的 Rules + 图谱计数 + todo 看板 + 最近 log。跨会话续接的入口。',
  { cwd: z.string().describe('项目根目录（.brain/ 所在处）') },
  async ({ cwd }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return errNoBrain(cwd || process.cwd());
    return { content: [{ type: 'text', text: await cmdLoad({ dir: root }) }] };
  }
);

tool(
  'abs_task',
  '任务实时落盘（幂等键 = id）。start 登记进 Todo / note 补断点(改到哪文件哪行) / state 改状态 / done 完成归位 Done。',
  {
    action: z.enum(['add', 'start', 'done', 'note', 'state']),
    id: z.string().describe('任务幂等键，如 TASK-xxx 或子任务名'),
    cwd: z.string().describe('项目根目录（.brain/ 所在处）'),
    note: z.string().optional().describe('add/start=做什么; note=断点(文件/到哪步); state=进行中|讨论中|滞留中'),
  },
  async ({ action, id, cwd, note }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return errNoBrain(cwd || process.cwd());
    // add 是 start 的别名（与 CLI `abs todo add` 对齐）
    const act = action === 'add' ? 'start' : action;
    return { content: [{ type: 'text', text: await cmdTask({ dir: root, action: act, id, note }) }] };
  }
);

tool(
  'abs_resolve',
  '按页面 id（或页面名 slug）反查文件路径。页改名后 id 不变，引用请用返回的路径/id。',
  {
    cwd: z.string().describe('项目根目录（.brain/ 所在处）'),
    refs: z.array(z.string()).min(1).describe('页面 id 或页面名，如 "file-write-locking"'),
  },
  async ({ cwd, refs }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return errNoBrain(cwd || process.cwd());
    const text = await cmdResolve({ dir: root, refs });
    // 全部未命中才算错 —— 部分命中时整体标 isError 会让 Agent 以为调用失败，
    // 把已经拿到的正确路径丢掉（实测：1 中 1 不中 → 整个结果被当错）。
    if (/✗/.test(text) && !/✓/.test(text)) {
      return err(text, { code: 'NOT_FOUND', fallback: 'abs query <词> 全文搜，或直接读 index.md' });
    }
    return { content: [{ type: 'text', text }] };
  }
);

tool(
  'abs_supersede',
  '标记一条经验/知识页已失效（被推翻），不删文件、保留历史。之后 abs_query 默认不再返回它。核实后发现仍有效可手动把 status 改回 active。',
  {
    cwd: z.string().describe('项目根目录（.brain/ 所在处）'),
    refs: z.array(z.string()).min(1).describe('页名或 id，如 "old-approach"'),
    by: z.string().optional().describe('取代它的页名（可选；给了则必须已存在）'),
  },
  async ({ cwd, refs, by }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return errNoBrain(cwd || process.cwd());
    const text = await cmdSupersede({ dir: root, refs, by });
    if (/✗/.test(text) && !/✓/.test(text)) {
      return err(text, { code: 'NOT_FOUND', fallback: '用 abs_query <词> 找到正确的页名后重试' });
    }
    return { content: [{ type: 'text', text }] };
  }
);

tool(
  'abs_status',
  '当前项目 + 图谱概要（各类页数）。',
  { cwd: z.string().describe('项目根目录（.brain/ 所在处）') },
  async ({ cwd }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return errNoBrain(cwd || process.cwd());
    return { content: [{ type: 'text', text: await cmdStatus({ dir: root }) }] };
  }
);

tool(
  'abs_query',
  '检索当前项目 .brain/ 知识页（多词 OR）：以前踩过什么坑、哪页记了 X。',
  { cwd: z.string().describe('项目根目录（.brain/ 所在处）'), terms: z.array(z.string()).min(1).describe('检索词'), include_superseded: z.boolean().optional().describe('true=连已标记失效的经验一起返回（默认隐藏）') },
  async ({ cwd, terms, include_superseded }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return errNoBrain(cwd || process.cwd());
    const text = await cmdQuery({ dir: root, terms, includeSuperseded: include_superseded });
    // 无命中时给逃生口：query 是全文匹配，猜的词不对就换词/看全貌，别以为图谱是空的。
    // 收口在这里（不散在 store.js）—— CLI 侧是一行提示，MCP 侧需要可自救的结构。
    if (/无命中/.test(text)) {
      return err(text, {
        code: 'NO_MATCH',
        fallback: '换更具体的词重试（支持多个词 OR）；或读 .brain/index.md 看完整清单',
      });
    }
    return { content: [{ type: 'text', text }] };
  }
);

tool(
  'abs_rule',
  '读/写 index.md 的 ## Rules 硬规则区。action=list 列出；action=add 追加一条（只放一句话，≤42 字符、不带链接；展开写概念页）。',
  {
    cwd: z.string().describe('项目根目录（.brain/ 所在处）'),
    action: z.enum(['list', 'add']).optional().describe('list=列出(默认)；add=追加一条'),
    text: z.string().optional().describe('action=add 时的一句话硬规则'),
  },
  async ({ cwd, action, text }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return errNoBrain(cwd || process.cwd());
    return { content: [{ type: 'text', text: await cmdRule({ dir: root, action: action || 'list', text }) }] };
  }
);

tool(
  'abs_lint',
  '图谱体检：死链/孤岛/缺 frontmatter/超尺寸/sources 堆积/index 漏列。',
  { cwd: z.string().describe('项目根目录（.brain/ 所在处）') },
  async ({ cwd }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return errNoBrain(cwd || process.cwd());
    const text = await cmdLint({ dir: root });
    // lint 报的是「哪不对」，得补一句「下一步怎么办」，否则 Agent 只能把问题复述给用户。
    const fallback = /无问题|0 个问题|健康/.test(text)
      ? null
      : '按条目里的文件名/H1 直接改；死链可删或改指向；index 漏列用 abs_rule 同区手工补一行';
    if (!fallback) return { content: [{ type: 'text', text }] };
    return err(text, { code: 'LINT_ISSUES', fallback });
  }
);

tool(
  'abs_note',
  '经验实时暂存：把刚踩的坑/技巧/结论一句话落进 sources/（防 context 断了流失）。Teardown 时再提炼进 concepts/。',
  {
    cwd: z.string().describe('项目根目录（.brain/ 所在处）'),
    text: z.string().min(1).describe('经验/坑/技巧一句话'),
    tags: z.string().optional().describe('逗号分隔标签，如 "docker,坑"'),
  },
  async ({ cwd, text, tags }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return errNoBrain(cwd || process.cwd());
    return { content: [{ type: 'text', text: await cmdNote({ dir: root, text, tags }) }] };
  }
);

tool(
  'abs_concept',
  '建概念页骨架（给写入定结构：触发场景/表现/解法/验证）。只给结构不给内容 —— 值不值得留、归哪页仍靠人判断。',
  {
    cwd: z.string().describe('项目根目录（.brain/ 所在处）'),
    slug: z.string().min(1).describe('文件名/slug，如 "docker-prisma-429"（命名即链接）'),
    title: z.string().optional().describe('页面标题（省略则用 slug）'),
    tags: z.string().optional().describe('逗号分隔标签，如 "docker,坑"'),
    desc: z.string().optional().describe('index.md 里那一行的一句话描述'),
  },
  async ({ cwd, slug, title, tags, desc }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return errNoBrain(cwd || process.cwd());
    return { content: [{ type: 'text', text: await cmdConcept({ dir: root, slug, title, tags, desc }) }] };
  }
);

tool(
  'abs_wrapup',
  '收尾保险：把当前 todo 未完成任务快照到 ~/.abs/log/wrapup.log（下会话 load 时展示滞留对账）。',
  { cwd: z.string().describe('项目根目录（.brain/ 所在处）') },
  async ({ cwd }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return errNoBrain(cwd || process.cwd());
    return { content: [{ type: 'text', text: await cmdWrapup({ dir: root }) }] };
  }
);

// 错误带逃生口：Agent 收到错要能自救，而不是回来问人。
// 借 OpenContext 的做法——错误里直接给「退一步怎么做」，且带结构化 code 供程序判分支。
// 判据：凡 isError 的返回，调用方读完应知道下一步跑什么命令。
function err(msg, { code, fallback } = {}) {
  const body = [
    code ? `[${code}] ${msg}` : msg,
    fallback ? `→ ${fallback}` : null,
  ].filter(Boolean).join('\n');
  const res = { content: [{ type: 'text', text: body }], isError: true };
  // 结构化字段：MCP 客户端可读 structuredContent 判分支（code=NO_BRAIN 等）
  if (code) res.structuredContent = { error: code, message: msg, fallback: fallback || null };
  return res;
}

/** 无图谱专用：所有工具共用同一条自救路径，收口在这里（改一处即全改）。 */
function errNoBrain(cwd) {
  return err(`目录 ${cwd} 下没有 .brain/ 图谱（不向上搜索）。`, {
    code: 'NO_BRAIN',
    fallback: `先在该目录运行: abs init  （或在含图谱的目录重调本工具）`,
  });
}

await server.connect(new StdioServerTransport());
