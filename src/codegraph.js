// src/codegraph.js — 借用本机 CodeGraph 的「代码影响面」，写回 abs 图谱。
//
// 为何要这个模块（而非直接塞进 cmdNote）：
//   abs 的定位是纯 markdown 图谱、零依赖、可进 git；CodeGraph 是二进制 SQLite、
//   不可进 git、且不是每个机器都装。两者职责不同，唯一值得打通的点是一个维度：
//   abs 的经验页里「这个改动会影响哪些代码」是空白的，而 codegraph impact 正是干这个的。
//
// 融合姿势 = 借结果、不引依赖：
//   只在「用户显式传了 --impact <符号>」时才调 codegraph CLI，
//   把它的纯文本输出写进 .brain/ 的 markdown 页（可进 git）。
//   codegraph 不存在 / 调用失败 / 超时 → 静默降级为「无影响面」，绝不阻断 note 落盘。
//
// 为什么走 child_process 调 CLI、不引 npm 包、不走 MCP：
//   - CLI 是 codegraph 自己装的稳定接口（impact/callers/callees），零依赖；
//   - MCP 走宿主钩子，之前实测在 pi 下报 _elicitationHandler 错（宿主 bug），CLI 稳定。

import { execFile } from 'node:child_process';

const CG_BIN = 'codegraph';
const CG_TIMEOUT_MS = 3000;

/**
 * 探测本机 codegraph 是否可用（不抛错，任何失败都返回 false）。
 * 结果只影响「要不要在 note 里带影响面」，绝不影响 note 本身落盘。
 */
async function codegraphAvailable() {
  return new Promise((resolve) => {
    execFile(CG_BIN, ['--version'], { timeout: 1500 }, (err) => resolve(!err));
  });
}

/**
 * 索引是否新鲜（无 pending 改动）。
 * codegraph 有文件 watcher，但 daemon 可能没在跑 / 停了很久，索引会过期。
 * 过期时 impact 会返回旧数据 —— 把它写进经验页等于污染 abs 图谱。
 * 用 `codegraph status --json` 的 pendingChanges 判定：全 0 才新鲜；
 * 任何失败（命令不在/超时/解析失败）一律当「不新鲜」，宁缺毋滥。
 */
async function codegraphFresh(root) {
  return new Promise((resolve) => {
    execFile(
      CG_BIN,
      ['status', '--json', root],
      { timeout: 2000 },
      (err, stdout) => {
        if (err) return resolve(false);
        try {
          const j = JSON.parse(stdout);
          const pc = j.pendingChanges || {};
          const fresh = (pc.added || 0) + (pc.modified || 0) + (pc.removed || 0) === 0;
          resolve(fresh);
        } catch {
          resolve(false);
        }
      },
    );
  });
}

/**
 * 拿某符号的「影响面」：改它会波及哪些函数/文件。
 * @param {string} symbol 符号名（如 cmdTask、requireBrain）
 * @param {string} root 项目根（codegraph -p 参数）
 * @returns {Promise<string|null>} 纯文本影响面，失败/不可用/索引过期返回 null
 */
export async function impactOf(symbol, root) {
  const s = String(symbol || '').trim();
  if (!s) return null;
  if (!(await codegraphAvailable())) return null;
  // 索引不新鲜 → 不写影响面（避免把过期结构写进经验页）。
  // 代价：用户刚改完代码立刻 note 时拿不到影响面；收益：绝不写错数据。
  // 新鲜度恢复只需 codegraph 的 watcher 约 1s 同步，或手动 codegraph sync。
  if (!(await codegraphFresh(root))) return null;
  return new Promise((resolve) => {
    execFile(
      CG_BIN,
      ['impact', s, '--depth', '2', '-p', root],
      { timeout: CG_TIMEOUT_MS },
      (err, stdout) => {
        if (err) return resolve(null);
        const text = String(stdout || '').trim();
        // codegraph 无命中时输出形如 "No ..." 或空，统一当「无影响面」。
        resolve(text ? text : null);
      },
    );
  });
}
