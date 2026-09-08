#!/usr/bin/env node
// bin/mcp.js — abs MCP server (stdio)。
// 职责只有两个（PLAN.md v2 定稿）:
//   ① resolve_project: 用代码写死逻辑定位当前项目目录（从 cwd 向上找最近 .brain/）
//   ② 转接调用 CLI 读写（todo/board/query 的具体实现复用 src/）
// 无状态：每次调用从入参 cwd 重新解析，多项目各归各位。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findBrainRoot } from '../src/index.js';
import { cmdBoard, cmdLoad, cmdStatus, cmdTask, cmdQuery, cmdLint, cmdNote } from '../src/store.js';

// ---------- 技术日志: MCP 请求跟踪（调试用, 与图谱 log.md 完全分开） ----------
// 落 ~/.abs/log/mcp.log: 每次工具调用一行 [时间] tool cwd 参数摘要 → 耗时/结果摘要。
// 关闭: ABS_LOG=0。stderr 不用（stdio transport 会污染协议）。
const MCP_LOG = process.env.ABS_LOG !== '0';
const LOG_DIR = process.env.ABS_LOG_DIR || join(homedir(), '.abs', 'log');
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

const server = new McpServer({
  name: 'abs',
  version: '0.1.0',
});

// 工具面（narrow on purpose — 只暴露读/查/记状态，不做深提炼）
server.tool(
  'abs_resolve_project',
  '定位当前项目的 .brain 图谱根（从给定目录向上找最近 .brain/）。多项目隔离的唯一入口。',
  { cwd: z.string().describe('当前工作目录，默认进程 cwd') },
  async ({ cwd }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) {
      return { content: [{ type: 'text', text: `未找到 .brain/（从 ${cwd} 向上无果）。先在该项目运行: abs init` }] };
    }
    return { content: [{ type: 'text', text: root }] };
  }
);

server.tool(
  'abs_board',
  '读取当前项目 todo 看板（含断点/Next-Step）。先 resolve 得到项目，再传其根目录。',
  { cwd: z.string().describe('项目内任意目录') },
  async ({ cwd }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return err('未找到 .brain/，先 abs init');
    return { content: [{ type: 'text', text: await cmdBoard({ dir: root }) }] };
  }
);

server.tool(
  'abs_load',
  '开机读状态：index 路线 + todo 看板 + 最近 log。跨会话续接的入口。',
  { cwd: z.string().describe('项目内任意目录') },
  async ({ cwd }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return err('未找到 .brain/，先 abs init');
    return { content: [{ type: 'text', text: await cmdLoad({ dir: root }) }] };
  }
);

server.tool(
  'abs_task',
  '任务实时落盘（幂等键 = id）。start 登记 / note 补断点(改到哪个文件哪行) / blocked 碰壁 / done 完成归位。',
  {
    action: z.enum(['start', 'done', 'note', 'blocked']),
    id: z.string().describe('任务幂等键，如 TASK-xxx 或子任务名'),
    cwd: z.string().describe('项目内任意目录'),
    note: z.string().optional().describe('start=做什么; note=断点(文件/到哪步); blocked=卡点原因'),
  },
  async ({ action, id, cwd, note }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return err('未找到 .brain/，先 abs init');
    return { content: [{ type: 'text', text: await cmdTask({ dir: root, action, id, note }) }] };
  }
);

server.tool(
  'abs_status',
  '当前项目 + 图谱概要（各类页数）。',
  { cwd: z.string().describe('项目内任意目录') },
  async ({ cwd }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return err('未找到 .brain/，先 abs init');
    return { content: [{ type: 'text', text: await cmdStatus({ dir: root }) }] };
  }
);

server.tool(
  'abs_query',
  '检索当前项目 .brain/ 知识页（多词 OR）：以前踩过什么坑、哪页记了 X。',
  { cwd: z.string().describe('项目内任意目录'), terms: z.array(z.string()).min(1).describe('检索词') },
  async ({ cwd, terms }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return err('未找到 .brain/，先 abs init');
    return { content: [{ type: 'text', text: await cmdQuery({ dir: root, terms }) }] };
  }
);

server.tool(
  'abs_lint',
  '图谱体检：死链/孤岛/缺 frontmatter/超尺寸/sources 堆积/index 漏列。',
  { cwd: z.string().describe('项目内任意目录') },
  async ({ cwd }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return err('未找到 .brain/，先 abs init');
    return { content: [{ type: 'text', text: await cmdLint({ dir: root }) }] };
  }
);

server.tool(
  'abs_note',
  '经验实时暂存：把刚踩的坑/技巧/结论一句话落进 sources/（防 context 断了流失）。Teardown 时再提炼进 concepts/。',
  {
    cwd: z.string().describe('项目内任意目录'),
    text: z.string().min(1).describe('经验/坑/技巧一句话'),
    tags: z.string().optional().describe('逗号分隔标签，如 "docker,坑"'),
  },
  async ({ cwd, text, tags }) => {
    const root = await findBrainRoot(cwd || process.cwd());
    if (!root) return err('未找到 .brain/，先 abs init');
    return { content: [{ type: 'text', text: await cmdNote({ dir: root, text, tags }) }] };
  }
);

function err(msg) {
  return { content: [{ type: 'text', text: msg }], isError: true };
}

await server.connect(new StdioServerTransport());
