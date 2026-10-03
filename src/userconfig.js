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

/** 占位名黑名单：这些名字没有任何正当理由当作者名，写进全局配置会污染之后所有项目。
 * 教训（2026-09-18）：一次手动 `abs config set user tester` 让新项目每条 todo 都标 [[tester]]。
 * 注意只拦 setUser（持久配置），**不拦 ABS_USER 环境变量** —— env 是一次性显式覆盖，
 * 且测试套件全程用 ABS_USER=tester（7 个测试文件），拦它会全线爆掉。 */
const PLACEHOLDER_NAMES = new Set([
  'tester', 'test', 'testing', 'foo', 'bar', 'baz', 'foobar',
  'admin', 'user', 'username', 'me', 'you', 'someone', 'nobody',
  'example', 'demo', 'sample', 'tmp', 'temp', 'default', 'null', 'none',
]);

/** 校验是否是像样的人名；不合格抛带指引的错误。setUser 专用（ABS_USER 不过此关）。 */
function assertRealName(name) {
  const lower = name.toLowerCase();
  if (PLACEHOLDER_NAMES.has(lower)) {
    throw new Error(
      `✗ "${name}" 是占位名，不是真人姓名 —— 它会成为所有项目的作者标记。\n` +
      '  请填你本人的名字（如 abs config set user 张三 / alice）'
    );
  }
  // 无意义重复串：aaa/xxx/111 之类
  if (/^(.)\1+$/.test(lower)) {
    throw new Error(`✗ "${name}" 看起来不是名字（重复字符）—— 请填你本人的名字`);
  }
  return name;
}

/** 写配置的 user 字段（保留其它键）。 */
export async function setUser(name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('✗ 姓名不能为空');
  // 合法性：允许字母数字中文下划线连字符点，禁空白（空白会破坏 @name 标记的解析）
  if (!/^[\w\u4e00-\u9fff.-]+$/.test(clean)) {
    throw new Error(`✗ 姓名 "${clean}" 含不支持的字符（只允许字母/数字/中文/._-，且不含空格）`);
  }
  assertRealName(clean);
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
  const e = new Error(
    '✗ 尚未设置使用者姓名 —— 图谱需要标记每条记录的作者。'
  );
  // 错误码：hook/脚本靠它区分「需先配置」与真故障（借 Anneal templateRefusal）。
  e.code = 'NO_USER';
  e.fallback =
    '任选其一:\n' +
    '    abs config set user <你的名字>     (写入 ~/.abs/config.json, 一次即可)\n' +
    '    ABS_USER=<你的名字> abs ...        (仅本次生效)';
  throw e;
}

/** 只读体检：当前生效的作者名是否是占位名（脏配置检测）。
 * 给 load 用 —— 不抛错，返回占位名或 null。历史遗留的 tester 配置靠这条被看见。 */
export async function placeholderWarn() {
  const u = await getUser();
  if (!u) return null;
  const lower = u.toLowerCase();
  if (PLACEHOLDER_NAMES.has(lower) || /^(.)\1+$/.test(lower)) return u;
  return null;
}

/** 标记串：`[[name]]`（wikilink 到人页 entities/<name>.md）。
 * 用 wiki 链接而非裸 `@name`：人是图谱实体，点得进去看技术栈/特点。
 * 旧数据里的裸 `@name` 仍可解析（见 todo.js extractAuthor），但不回填。 */
export function atTag(name) {
  return `[[${name}]]`;
}
