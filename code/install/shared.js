// code/install/shared.js — 安装器共用层：宿主无关的落点计算、原子写、skill 安装、安装后自检告警。
// 拆出来是为了让「装到哪、怎么安全写」只有一份实现 —— 将来多一个宿主就多一份复用。
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostByKey } from '../hosts.js';

// code/install/shared.js 在包内的第 3 层 → 上溯两级才是包根。
const ABS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---- skill 包规则（单一规则，无特例）----
// agents/shared/skills/ 下**每个含 SKILL.md 的子目录**就是一个 skill，随包发布；
// 它跨宿主共用，故放在 shared 而不是某个宿主的目录下。
// 目录名 = 宿主 skills/ 下的安装目录名 = frontmatter 的 name（三者必须一致：
// pi 在目录名与 name 不一致时会告警）。
//
// 为什么全带 abs- 前缀:
//   1. 归属可辨 —— 带前缀才敢判「这是 abs 装的、可随 install 更新/卸载」；
//      不带前缀的副本可能是用户自己放的，卸载时不敢动。
//   2. 避开同名冲突 —— pi 同时扫 ~/.pi/agent/skills 与 ~/.agents/skills
//      （pi 文档 Locations 一节），后者常有同名副本。两份同名实文件 → pi 报
//      skill 冲突（实测: 曾装成 bug-hunter，与 ~/.agents/skills/bug-hunter 相撞）。
//
// 新增 skill: 建 agents/shared/skills/<名称>/SKILL.md 即可，无需改代码（原先写死一条，见旧注释 ponytail）。
const SKILL_ROOT = join(ABS_DIR, 'agents', 'shared', 'skills');

const ALL_SKILLS = (() => {
  const out = [];
  let entries = [];
  try { entries = fsSync.readdirSync(SKILL_ROOT, { withFileTypes: true }); } catch { /* 无 skill/ 目录: 无 skill 可装 */ }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const src = join(SKILL_ROOT, e.name, 'SKILL.md');
    if (!fsSync.existsSync(src)) continue; // 只认含 SKILL.md 的子目录
    out.push({ name: e.name, src });
  }
  if (!out.length) {
    // 包内一个 skill 都没找到 = 安装树与代码版本不一致（半升级 / 旧布局 / 打包漏文件）。
    // 不静默装 0 个: 曾实测新版代码遇扁平旧布局 → out=[] → 一句不说就什么都不装,
    // 而旧版代码遇新布局只报一个当前版本根本不存在的路径(E​NOENT skill/SKILL.md), 把人引去查源码。
    const v = (() => { try { return JSON.parse(fsSync.readFileSync(join(ABS_DIR, 'package.json'), 'utf8')).version; } catch { return 'unknown'; } })();
    const flat = fsSync.existsSync(join(SKILL_ROOT, 'SKILL.md'));
    throw new Error(
      `本包内没有可安装的 skill（${SKILL_ROOT}），安装树与代码版本不一致（当前 ${v}）。\n` +
      (flat
        ? '  检测到旧版扁平布局 skills/SKILL.md，本版要求 skills/<名称>/SKILL.md。\n'
        : '  agents/shared/skills/ 目录缺失或不含任何 <名称>/SKILL.md。\n') +
      '  修复: npm i -g @fanchao8609/agent_brain_sync@latest && abs install（幂等，可安全重跑）',
    );
  }
  return out;
})();

// 主 skill（会话开场加载的那个）。它也只是 ALL_SKILLS 的一员，此处仅用于告警比对。
const SKILL_SOURCE = join(SKILL_ROOT, 'abs-agent-brain-sync', 'SKILL.md');

/** 安装全部 skill 到该宿主。收口在此：四处安装点共用 —— 新增 skill 只改
 *  skill/ 目录，本函数与调用方都不动（避免「改一份不算改」）。返回步骤行。 */
export async function installSkills(agentKey) {
  const steps = [];
  const root = join(hostSkillDir(agentKey), '..');
  for (const s of ALL_SKILLS) {
    const t = join(root, s.name, 'SKILL.md');
    await atomicWrite(t, await fs.readFile(s.src, 'utf8'));
    steps.push(`✓ skill  → ${t}`);
  }
  return steps;
}

/** 卸载该宿主的全部 skill（主 + 附带）。与 installSkills 同源同规则。
 *  曾经的坑: 只有 claude-code 删了附带 skill，其余三宿主留下 abs-bug-hunter/ 残留。
 */
export async function uninstallSkills(agentKey) {
  const steps = [];
  const root = join(hostSkillDir(agentKey), '..');
  for (const s of ALL_SKILLS) {
    const d = join(root, s.name);
    await fs.rm(d, { recursive: true, force: true });
    steps.push(`✓ skill 已删除 → ${d}`);
  }
  return steps;
}

/**
 * 本包的稳定入口路径解析（mcp.js / abs.js 通用）。
 *
 * 坑: 直接用 ABS_DIR 是不稳定的 —— ABS_DIR = "install.js 自己住哪", 从仓库跑
 * `abs install` 就把仓库路径烧进宿主配置/hook 脚本。之后若卸载/移动仓库或全局包,
 * 该路径直接失效; 而某些分支"已存在即跳过", 一旦写错永不修正。
 *
 * 故统一优先解析本包的稳定安装位置（全局 node_modules），解析不到才回退 ABS_DIR。
 * 单一收口: MCP 注册与 hook 脚本都走这里 —— 曾经 MCP 修了、hook 没修,
 * 同一份安装里 hook 指向仓库而 MCP 指向全局，是两个不同的包。
 *
 * @param entryFile 包内相对 bin/ 的文件名，如 'mcp.js' / 'abs.js'
 */
export function stableBinPath(entryFile) {
  // 本包名（package.json），用于反查全局安装位置
  let pkgName = '@fanchao8609/agent_brain_sync';
  try {
    pkgName = JSON.parse(fsSync.readFileSync(join(ABS_DIR, 'package.json'), 'utf8')).name || pkgName;
  } catch { /* 保持默认 */ }

  // 各平台 npm 全局根下的本包位置。
  // Unix (nvm/homebrew/apt): <node根>/lib/node_modules/<pkg>
  // Windows:                 %APPDATA%\npm\node_modules\<pkg>
  // 注: 曾经只有 Unix 候选 —— Windows 上两个都不中，会回退到 ABS_DIR（仓库路径），
  //     即 H3 在 Windows 上仍会复现。此条为代码层推断，未在 Windows 实测。
  const nodeRoot = dirname(dirname(process.execPath)); // <node>/bin/node → <node>
  const candidates = [
    join(nodeRoot, 'lib', 'node_modules', pkgName, 'bin', entryFile),   // Unix
  ];
  // npm 自己报告的全局根（npm_config_prefix 由 npm 子进程设置；交互 shell 里通常为空）
  if (process.env.npm_config_prefix) {
    candidates.push(join(process.env.npm_config_prefix, 'lib', 'node_modules', pkgName, 'bin', entryFile));
    candidates.push(join(process.env.npm_config_prefix, 'node_modules', pkgName, 'bin', entryFile));
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, 'npm', 'node_modules', pkgName, 'bin', entryFile));
  }

  for (const c of candidates) {
    try {
      // 归一化为绝对路径，避免任何依赖 cwd 的相对候选被误用
      const abs = resolve(c);
      if (fsSync.existsSync(abs)) return abs;
    } catch { /* 试下一个 */ }
  }
  // 回退：仓库/本地安装形态
  return join(ABS_DIR, 'bin', entryFile);
}

/** 写进宿主 MCP 配置的 mcp.js 路径。 */
export function mcpEntryPath() {
  return stableBinPath('mcp.js');
}

export const MARK = '// abs-managed (agent-brain-sync)'; // TS plugin 标记

// ============================ 宿主 config 根 / skill 落点（统一走 env 或 homedir，测试可注入） ============================
/** 某宿主的配置根目录（settings.json 所在目录；env 覆盖优先，默认 ~/.<host> 或 ~/.config/<host>）。 */
export function hostConfigRoot(key) {
  return hostByKey(key).configRoot();
}

/** 该宿主 skill 落点：<configRoot>/<skillSub>/abs-agent-brain-sync/。skillSub 与 hooks/MCP 同根，避免 env 隔离时分裂。
 * 多数宿主 = <configRoot>/skills；pi 的用户级 skill 在 ~/.pi/agent/skills (configRoot=~/.pi)。 */
export function hostSkillDir(key) {
  return join(hostConfigRoot(key), hostByKey(key).skillSub, 'abs-agent-brain-sync');
}

// ============================ 工具函数 ============================
export async function atomicWrite(p, text) {
  await fs.mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.abs-tmp-${Date.now()}`;
  try {
    await fs.writeFile(tmp, text, 'utf8');
  } catch (e) {
    // 写 tmp 就失败（如目标是目录）: 清掉半成品再抛，否则沙盒里留 .abs-tmp-* 残骸
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  try {
    await fs.rename(tmp, p);
  } catch (e) {
    // rename 失败（如目标路径被目录占位）: 同样清理，不留 tmp
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

export async function backup(p) {
  try {
    // 文件名含日期+时分秒: 曾经只有日期，同日多次安装/卸载会互相覆盖，
    // 只剩最后一份 —— 用户装坏了想回滚时，最早的可用副本已经不在了。
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const bak = `${p}.abs-bak-${ts}`;
    await fs.copyFile(p, bak);
    await pruneBackups(p);
    return bak;
  } catch { return null; } // 文件不存在则无备份
}

/** 只保留最近 KEEP 份备份（按文件名时间戳倒序），避免备份目录无限增长。 */
const BACKUP_KEEP = 5;

export async function pruneBackups(p) {
  try {
    const dir = dirname(p);
    const base = `${basename(p)}.abs-bak-`;
    const olds = (await fs.readdir(dir))
      .filter((f) => f.startsWith(base))
      .sort()          // 时间戳格式 YYYY-MM-DD-HH-mm-ss 字典序 == 时间序
      .reverse();
    for (const f of olds.slice(BACKUP_KEEP)) {
      await fs.rm(join(dir, f), { force: true });
    }
  } catch { /* 清理失败不影响主流程 */ }
}

export async function readJson(p, { strict = true } = {}) {
  let text;
  try {
    text = await fs.readFile(p, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return {}; // 文件不存在 = 空配置（正常首装）
    throw e;                             // 权限/IO 错不能静默吞
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    if (!strict) return null; // 宽松模式: 调用方据此跳过写文件，但仍继续其它清理
    // 关键: 「文件不存在」与「存在但解析失败」必须分开处理。
    // 曾经两者都返回 {}，于是只要用户的配置里有 JSONC 注释/尾逗号/多一个字符，
    // 就会被当作空对象重建 → 用户的 hooks/permissions/model/mcpServers 静默全消失。
    // 而 JSONC（带 // 注释）正是 CLaude Code 官方文档鼓励的写法，命中率不低。
    // 测例: 带注释的 settings.json 安装后 myKey/permissions 全丢，且无任何报错。
    // 处置: 宁可整个安装失败，也不写坏用户文件（与 requireBrain 同原则）。
    //   宽松模式(strict:false)供"卸载"使用: 跳过配置文件、但仍清理 abs 自己的脚本/skill，
    //   避免因一个坏配置就留下残余。
    throw new Error(
      `配置文件无法解析为 JSON，已中止以免覆盖你的配置:\n` +
      `  ${p}\n` +
      `  ${e.message}\n` +
      `  若文件含 // 注释或尾逗号（JSONC），请先转成标准 JSON；` +
      `或备份后移走该文件重跑。`,
    );
  }
}

/**
 * 检测 ~/.agents/skills/ 下是否已有一份**非本工具所装**的 abs skill。
 *
 * 坑: 这个目录是 `skills` CLI（npx skills，~/.agents/.skill-lock.json 的所有者）
 * 的规范存储位置，各宿主的 skills/ 只是它 fan-out 的目标。abs 从不往那里写 ——
 * 一旦写了就绕过该 CLI 的 lockfile，会被它下次 sync 判成异常或直接覆盖。
 *
 * 但现实里它常被**手工 cp** 进去一份（实测: 与 abs install 同一秒的 mtime、
 * 内容逐字节相同、而 lockfile 的 skills 是空的 —— 没人认领）。那份副本不会随
 * abs install 更新，时间一长就与真正的 SKILL.md 脱节，而 agents 偏偏会读它。
 *
 * 故这里只做**只读检测 + 告警**，绝不代它删除或改写（那是别人的目录）。
 * @returns {string|null} 一行告警文案；无需告警时 null
 */
/** 安装后自检：hook 指向的入口是否真的跟得上当前代码。
 *
 * 为何要它（2026-11-05 实测踩到）：hook 烧进去的是**绝对路径**，指向全局包。
 *   那天先装了 hook（12:23），全局包四分钟后才重装（12:27）——
 *   中间真实关闭会话时，hook 调的是一个当时还不存在的命令，静默失败。
 *   fire-and-forget 的错误全被吞掉，所以「装好了」和「能用」看起来一模一样。
 *
 * 判据：看那个文件里有没有本次安装所依赖的命令，**而不是看文件存在**。
 *   文件存在只证明路径对，不证明内容新。
 *
 * @returns {string|null} 有问题时返回要打印的提示，正常返回 null。
 */
export function staleBinWarning(binOverride) {
  let bin, src;
  try {
    bin = binOverride || stableBinPath('abs.js');
    src = fsSync.readFileSync(bin, 'utf8');
  } catch { return null; }   // 自检失败不该影响安装结果
  // ingest 是 2026-11 新增的；缺它说明指向的是旧包，hook 触发时会「未知命令」
  if (/'ingest'/.test(src)) return null;
  return [
    '⚠ hook 指向的 abs 缺少 ingest 命令，会话关闭时不会自动落会话页。',
    `  实际指向: ${bin}`,
    '  修法: npm install -g .   然后重跑本安装',
  ].join('\n');
}

/**
 * 双副本检测：本机是否还装着**另一份**本包？
 *
 * ★ 为何需要（2026-11-07 实报）：远程机器有两份全局安装 ——
 *   /usr/bin/abs → /usr/lib/node_modules/...（旧）
 *   npm prefix → /opt/node.../lib/node_modules/...（新）
 *   PATH 里 `/usr/bin` 在前，于是 `abs update` 跑的是旧副本；它用自己那份旧
 *   install.js 刷宿主，把旧模板和旧 bin 路径写进 ~/.pi/，界面一点不变。
 *
 * 这里只做**检测与报告**，不自动改 PATH —— 改用户 shell 配置是越权动作。
 * 正确修法在 bin/abs.js 的 cmdUpdate 里（把刷新动作转交给 npm prefix 下的新副本）；
 * 本函数负责让「装完之后仍然指错」这件事在输出里可见，而不是静默。
 *
 * @returns {string|null} 有另一份时返回提示，否则 null。
 */
export function duplicateInstallWarning() {
  let pkgName = '';
  try {
    pkgName = JSON.parse(fsSync.readFileSync(join(ABS_DIR, 'package.json'), 'utf8')).name || '';
  } catch { return null; }
  if (!pkgName) return null;

  // ★ 只关心「两份都是全局安装」的情形。
  //   从开发仓库直接跑 install（self 不在 node_modules 下）是正常的开发流程，
  //   此时与全局那份版本不同是预期的 —— 那不是双副本故障，报出来只会是噪声
  //   （2026-11-07 自测时先误报了一次）。
  if (!/[\\/]node_modules[\\/]/.test(ABS_DIR)) return null;

  let npmRoot;
  try {
    npmRoot = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf8' }).trim();
  } catch { return null; }
  if (!npmRoot) return null;

  // npm prefix 下的那份（「正确」的那份）与本进程所在那份（可能正是旧副本）
  const correct = [join(npmRoot, 'lib', 'node_modules', pkgName), join(npmRoot, 'node_modules', pkgName)]
    .find((x) => fsSync.existsSync(x));
  if (!correct) return null;
  const self = ABS_DIR;
  try {
    if (fsSync.realpathSync(correct) === fsSync.realpathSync(self)) return null;  // 同一份，正常
  } catch { return null; }

  let correctVer = '?', selfVer = '?';
  try { correctVer = JSON.parse(fsSync.readFileSync(join(correct, 'package.json'), 'utf8')).version || '?'; } catch {}
  try { selfVer = JSON.parse(fsSync.readFileSync(join(self, 'package.json'), 'utf8')).version || '?'; } catch {}

  return [
    '⚠ 本机存在两份 abs 全局安装，本次安装用的是：',
    `     ${self}  (v${selfVer})`,
    '  npm 装的那份在：',
    `     ${correct}  (v${correctVer})`,
    `  修法: 用新那份重跑 —— node ${join(correct, 'bin', 'abs.js')} install --all`,
  ].join('\n');
}

export function agentsSkillWarning() {
  const p = join(homedir(), '.agents', 'skills', 'abs-agent-brain-sync', 'SKILL.md');
  if (!fsSync.existsSync(p)) return null;
  // 内容一致 = 用户已自行同步，不必打扰
  try {
    if (fsSync.readFileSync(p, 'utf8') === fsSync.readFileSync(SKILL_SOURCE, 'utf8')) return null;
  } catch { /* 读不到就照常告警 */ }
  return [
    `⚠ ${p} 存在一份与当前版本不一致的副本`,
    `  ~/.agents/skills/ 归 skills CLI 所有（本工具不写它），该副本不会被 abs install 更新。`,
    `  如不需要: rm -rf ${join(homedir(), '.agents', 'skills', 'abs-agent-brain-sync')}`,
  ].join('\n');
}

/**
 * 读 hooks/ 下的插件模板（真文件，非字符串）并替换 @@占位符@@。
 * 为什么用占位符而非模板字符串: 模板本身是 TS 代码，含 \n / " / \` 等；
 * 以前嵌在模板字符串里需双层转义，极易写错且只能靠“生成的字符串”间接测。
 * 现在模板是真文件 → 可用真 TS 编辑器/测试直接 import 断言。
 * 找不到模板文件时抛错（宁可失败也不静默生成空插件）。
 */
export function renderPluginTemplate(rel, vars) {
  let t;
  try {
    // rel 是相对包根的路径，如 agents/pi/hook/abs.pi.ts —— 模板文件按宿主分居在 agents/<宿主>/ 下。
    t = fsSync.readFileSync(join(ABS_DIR, rel), 'utf8');
  } catch (e) {
    throw new Error(`插件模板缺失: ${rel}（安装包不完整？）: ${e.message}`);
  }
  for (const [k, v] of Object.entries(vars || {})) t = t.split(k).join(v);
  return t;
}
