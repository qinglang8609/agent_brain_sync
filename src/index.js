// src/index.js — 图谱定位：多项目隔离的核心。
// 从给定 cwd 向上找最近含 `.brain/` 的祖先目录即命中。
// 这是唯一"项目定位"逻辑，被 CLI / MCP / hook 共用，代码确定、不靠猜。
import { promises as fs } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';

export const BRAIN_DIR = '.brain';

/** 向上找最近含 .brain/ 的祖先目录。找不到返回 null。 */
export async function findBrainRoot(startDir) {
  let dir = resolve(startDir || process.cwd());
  for (;;) {
    try {
      const st = await fs.stat(join(dir, BRAIN_DIR));
      if (st.isDirectory()) return dir;
    } catch { /* not here, keep walking up */ }
    const parent = dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

/** 解析图谱内文件的绝对路径。brainRoot 须已定位。 */
export function brainPath(brainRoot, ...rel) {
  return join(brainRoot, BRAIN_DIR, ...rel);
}

/** 断言 .brain/ 存在，否则抛错（宁可失败不落错项目）。 */
export async function requireBrain(startDir) {
  const root = await findBrainRoot(startDir);
  if (!root) {
    throw new Error(
      `abs: 找不到 .brain/ 图谱（从 ${resolve(startDir)} 向上搜索无果）。\n` +
      `  请在项目根先运行: abs init`
    );
  }
  return root;
}

export { basename };
