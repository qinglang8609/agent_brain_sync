// src/userconfig.js — 用户身份（作者名）配置。
// 用途：todo/log/生成的文档标 @name，让跨会话图谱能看出"谁登记的"。
//
// 配置源（后者优先）：
//   1. ~/.abs/config.json 的 { "user": "fanchao" }  —— abs config set user <name> 写入
//   2. 环境变量 ABS_USER                          —— 临时/CI 覆盖，不改落盘配置
//
// 纪律：**只在写操作检查**。hook 会在会话结束时非交互调 abs wrapup / abs teardown-check，
// 只读命令若也拦人，hook 路径会卡住或报错。故 requireUser 只被写命令调用。
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** 配置文件路径（ABS_CONFIG_DIR 可覆盖，测试隔离用）。 */
export function userConfigPath() {
  const dir = process.env.ABS_CONFIG_DIR || join(homedir(), '.abs');
  return join(dir, 'config.json');
}

/** 读配置的 user 字段（不存在/坏 JSON 一律返回 null，不抛）。 */
export async function getUser() {
  const env = String(process.env.ABS_USER || '').trim();
  if (env) return env; // 环境变量优先：临时覆盖不必改落盘配置
  try {
    const raw = await fs.readFile(userConfigPath(), 'utf8');
    const u = JSON.parse(raw).user;
    return typeof u === 'string' && u.trim() ? u.trim() : null;
  } catch {
    return null;
  }
}

/** 写配置的 user 字段（保留其它键）。 */
export async function setUser(name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('✗ 姓名不能为空');
  // 合法性：允许字母数字中文下划线连字符点，禁空白（空白会破坏 @name 标记的解析）
  if (!/^[\w\u4e00-\u9fff.-]+$/.test(clean)) {
    throw new Error(`✗ 姓名 "${clean}" 含不支持的字符（只允许字母/数字/中文/._-，且不含空格）`);
  }
  const p = userConfigPath();
  await fs.mkdir(join(p, '..'), { recursive: true });
  let cfg = {};
  try { cfg = JSON.parse(await fs.readFile(p, 'utf8')); } catch { /* 首次或坏 JSON → 重建 */ }
  cfg.user = clean;
  await fs.writeFile(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  return clean;
}

/**
 * 写操作入口守卫：拿到作者名，拿不到就抛带指引的错误。
 * 错误文案给出两条路（持久设置 / 临时覆盖），别让用户猜。
 */
export async function requireUser() {
  const u = await getUser();
  if (u) return u;
  throw new Error(
    '✗ 尚未设置使用者姓名 —— 图谱需要标记每条记录的作者。\n' +
    '  请任选其一设置后重试:\n' +
    '    abs config set user <你的名字>     (写入 ~/.abs/config.json, 一次即可)\n' +
    '    ABS_USER=<你的名字> abs ...        (仅本次生效)'
  );
}

/** 标记串：`@name`。用于 todo 行 / log 行 / 页面 frontmatter。 */
export function atTag(name) {
  return `@${name}`;
}
