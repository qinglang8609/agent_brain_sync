// src/wrapup.js — 收尾保险：把「某会话结束时 Today 仍滞留的任务」快照到 ~/.abs/log/wrapup.log。
// 目标: 解决「任务做完了但没标 done 进 Done」的间歇性。根因是 done 判定只靠 agent 自觉,
// Stop 若来不及/没意识到就滞留。这里不做判定(不替 agent 判断完成与否), 只做两件事:
//   A) 机械快照(agent_end/Stop 触发 abs wrapup): 会话暂停时把当前未完成任务落盘一份结构清单;
//   B) 开场对账(abs load 读取): 下会话 load 时把「上会话滞留、且当前仍未 done」的任务顶出来,
//      让收尾成为开场的默认动作而非自愿的日志行。
// wrapup.log 是全局技术日志(~/.abs/log/), 跨项目共用, 故每块带 proj=<root> 归属。
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { absLogDir } from './index.js';
import { readTodo, localStamp, parseChild } from './todo.js';

export function wrapupLogPath() {
  return join(absLogDir(), 'wrapup.log');
}

// 同项目两次快照的最小间隔(秒)。agent_end 会逐 turn 触发, 无变化时不刷屏。
export const WRAPUP_MIN_INTERVAL_MS = 5 * 60 * 1000;

// wrapup.log 轮转阈值。只留 .1 一层: 排查/Rebuild 只靠每个 proj 的最近一块,
// 旧块是死重量(parseWrapup 用 byProj.set 覆盖, 前面的块永远不会被读到)。
export const WRAPUP_MAX_BYTES = 1024 * 1024; // 1 MiB

/** 超阈值则轮转为 .1。放在 appendWrapup 里 → CLI/MCP/hook 三条路径都覆盖。 */
async function rotateIfNeeded(p) {
  const max = Number(process.env.ABS_WRAPUP_MAX_BYTES || WRAPUP_MAX_BYTES);
  let st;
  try { st = await fs.stat(p); } catch { return; }
  if (!Number.isFinite(max) || st.size <= max) return;
  // 先把当前内容落成 .1(覆盖旧 .1), 再截断；失败则不动, 不让轮转本身丢数据
  try {
    await fs.rename(p, p + '.1');
  } catch {
    return;
  }
  await fs.writeFile(p, `[${localStamp()}] wrapup 轮转: 原文件 ${st.size} bytes > ${max}, 已移入 wrapup.log.1\n`, 'utf8').catch(() => {});
}

/** 从 todo 文本/快照块提取未完成任务（记号不是 `x` 的顶层行）。
 *  body = `[id 标题]` 里的整段（去掉记号与时间/作者/会话字段），状态无关 ——
 *  跨会话滞留靠 body 精确比对，状态一改不能让它消失。
 *  bp = 子项文字（去掉记号）。返回 [{ body, bp }]。 */
export function extractOpenTasks(todoText) {
  const lines = String(todoText || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    // 新格式：`- [记号] [时间] [id 标题] …` —— 第一个方括号是**时间**，body 要取第二个
    const m = lines[i].match(/^\s*-\s*\[([ \-+~])\]\s*(?:\[\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?\]\s*)?\[([^\]]+)\]/);
    if (!m) continue;
    const body = m[2].trim();
    if (!body || isPlaceholderBody(body)) continue;
    const bp = [];
    while (i + 1 < lines.length) {
      const nx = lines[i + 1];
      const kid = nx.match(/^\s+-\s*\[([ x\-+~])\]\s*(.*)$/);
      if (kid) { i++; bp.push(`${kid[1] === 'x' ? '[x]' : '[ ]'} ${kid[2].trim()}`); continue; }
      if (/^\s*↳/.test(nx)) { i++; bp.push(nx.trim().replace(/^↳\s*(断点|卡点|内容)?[:：]?\s*/, '')); continue; }
      break;   // 空行/别的行 = 子项块结束（曾写成 continue 不推进 i → 死循环）
    }
    out.push({ body, bp });
  }
  return out;
}

/** 模板占位任务行（“待办任务”/无）不算真任务，快照/对账都排除。 */
function isPlaceholderBody(body) {
  return /^(待办任务|无|（无）|None|null)$/.test(body) || /^待办任务/.test(body);
}

/** 序列化一个快照块：首行时间戳+归属，后随未完成任务（主体+子项）。
 * 子项 bp 元素已自带勾选前缀（`[ ] 内容` / `[x] 内容`，见 extractOpenTasks）。
 * 新写入一律用标准 md 缩进子项（旧 `↳ 断点:` 形态已废弃）。 */
function blockText(root, tasks) {
  const head = `[${localStamp()}] wrapup proj=${root}`;
  if (!tasks.length) return head; // 无滞留，仍记一行「干净结束」
  const rows = tasks.map((t) => {
    const bps = t.bp.map((b) => (b.startsWith('[')
      ? `      - ${b}`
      : `      - [ ] ${b}`));
    return `  - [ ] ${t.body}${bps.length ? '\n' + bps.join('\n') : ''}`;
  });
  return [head, ...rows].join('\n');
}

/** 从已有 wrapup.log 解析：按 proj 分组返回每个项目最近一次快照。逐行解析，鲁棒于多块/异常行。 */
export function parseWrapup(text) {
  const byProj = new Map(); // proj -> { stamp, proj, tasks:[{body,bp}] }
  let cur = null;
  let curProj = null;
  for (const line of String(text || '').split('\n')) {
    const h = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] wrapup proj=(.+?)\s*$/);
    if (h) {
      curProj = h[2].trim();
      cur = { stamp: h[1], proj: curProj, tasks: [] };
      byProj.set(curProj, cur);
      continue;
    }
    if (!cur) continue;
    const tm = line.match(/^\s*- \[ \]\s*(.*)$/);
    if (tm) {
      const body = tm[1].replace(/\s*\(认领[^)]*\)\s*$/, '').trim();
      if (body && !isPlaceholderBody(body)) {
        cur.tasks.push({ body, bp: [] });
      }
      continue;
    }
    // 子项：新快照写缩进 `- [ ]`；旧快照（历史 wrapup.log）写的是 `↳ …`，两者都要读
    const bm = line.match(/^\s+-\s*\[[ x]\]/) || line.match(/^\s*↳/);
    if (bm && cur.tasks.length) {
      // 回读时统一成 `[ ] 内容` / `[x] 内容` 形态（新写的就是这个；旧快照无勾 → 当未勾）
      const parsed = parseChild(line);
      cur.tasks[cur.tasks.length - 1].bp.push(parsed
        ? `${parsed.done ? '[x]' : '[ ]'} ${parsed.text}`
        : line.trim().replace(/^↳\s*(断点|卡点|内容)?[:：]?\s*/, ''));
    }
  }
  return byProj;
}

/** B: 追加一次当前项目的滞留快照（幂等去重：同内容/短间隔内不重复写）。 */
export async function appendWrapup(root) {
  const p = wrapupLogPath();
  await fs.mkdir(join(p, '..'), { recursive: true });
  const todo = await readTodo(root); // readTodo 幂等迁移，拿到权威内容
  const tasks = extractOpenTasks(todo);
  // 轮转在写前做：否则文件无上限增长（只追加不清理，旧块永远读不到=死重量）
  await rotateIfNeeded(p);
  let prev = '';
  try { prev = await fs.readFile(p, 'utf8'); } catch { /* 尚无文件 */ }
  const snap = parseWrapup(prev);
  const last = snap.get(root);
  if (last) {
    const sameBody = JSON.stringify(last.tasks.map((t) => [t.body, ...t.bp]))
      === JSON.stringify(tasks.map((t) => [t.body, ...t.bp]));
    const lastMs = Date.parse(last.stamp.replace(' ', 'T'));
    const fresh = !Number.isNaN(lastMs) && Date.now() - lastMs < WRAPUP_MIN_INTERVAL_MS;
    if (sameBody && fresh) {
      return `(同内容已落，跳过): ${root}`;
    }
  }
  const line = blockText(root, tasks) + '\n';
  await fs.appendFile(p, line, 'utf8');
  return tasks.length
    ? `✓ 滞留快照已落 wrapup.log (${tasks.length} 项未完成): ${root}`
    : `✓ 干净结束已记 wrapup.log (无滞留): ${root}`;
}

/** A: 读 wrapup.log 里本项目的最近快照，返回其中「当前 todo 仍勾着未完成」的任务（已 done 自动消失）。
 * 用于 load 开场展示滞留，跨 todo 交叉核对 → 无 false callout、自清理、不需 reconcile 标记。 */
export async function strandedFor(root) {
  const p = wrapupLogPath();
  let text;
  try { text = await fs.readFile(p, 'utf8'); } catch { return []; }
  const snap = parseWrapup(text).get(root);
  if (!snap || !snap.tasks.length) return [];
  const todo = await readTodo(root).catch(() => '');
  const openBodies = new Set(extractOpenTasks(todo).map((t) => t.body));
  // 快照里那些「现在仍开着」的任务才是滞留；已 done（不在 openBodies）的自动剔除
  return snap.tasks.filter((t) => openBodies.has(t.body));
}
