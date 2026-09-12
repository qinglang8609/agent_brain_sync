// src/index.js — 图谱定位：多项目隔离的核心。
// 只看给定目录本身有没有 `.brain/`，不向上搜索。
// 这是唯一"项目定位"逻辑，被 CLI / MCP / hook 共用，代码确定、不靠猜。
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

export const BRAIN_DIR = '.brain';

/**
 * 定位图谱根：仅当 `dir` 本身含 `.brain/` 才命中，否则返回 null。
 * 故意不向上搜索：向上会从任意目录爬到 ~ 命中家目录图谱（如 ~/.brain），
 * 把无关项目静默挂到别的图谱上。宁可报错，不猜。
 */
export async function findBrainRoot(startDir) {
  const dir = resolve(startDir || process.cwd());
  try {
    const st = await fs.stat(join(dir, BRAIN_DIR));
    if (st.isDirectory()) return dir;
  } catch { /* 本目录没有图谱 */ }
  return null;
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
      `abs: 目录 ${resolve(startDir)} 下没有 .brain/ 图谱（不向上搜索）。\n` +
      `  请在该目录运行: abs init`
    );
  }
  return root;
}

/** 全局技术日志目录 (~/.abs/log)。ABS_LOG_DIR 可覆盖（测试/自定义隔离）。
 * JS 侧的单一收口：mcp.log / wrapup.log / teardown mark 共用同一语义。
 * 注: hooks/*.sh、*.ts 是单独安装的产物，无法 import 本函数，各自读 ABS_LOG_DIR —— 改此处不影响它们。 */
export function absLogDir() {
  return process.env.ABS_LOG_DIR || join(homedir(), '.abs', 'log');
}
