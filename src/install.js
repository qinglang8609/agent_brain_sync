// src/install.js — 安装 / 卸载到各智能体（MCP + hook + skill）。
// 机制（抄 ai-memory，已确认）:
//   - Claude Code: ~/.claude/settings.json 的 hooks 对象(CamelCase 事件→command)。
//     MCP: settings.json 顶层 mcpServers 或项目 .mcp.json。hook 要求 stdout 以 { 开头。
//   - Codex:      ~/.codex/hooks.json。
//   - OpenCode / Pi: 官方只吃 TS plugin/extension(无 shell-hook 配置) → 初版给出手工指引。
// 纪律: 幂等(重复安装=更新)、原子写(tmp+rename)、卸载只删自己装的、写入前备份。
import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTS, hostByKey } from './hosts.js';

const ABS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_TEMPLATE = join(ABS_DIR, 'hooks', 'event.sh');
const SKILL_SOURCE = join(ABS_DIR, 'skill', 'SKILL.md');

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
function stableBinPath(entryFile) {
  // 本包名（package.json），用于反查全局安装位置
  let pkgName = '@fanchao8609/agent_brain_sync';
  try {
    pkgName = JSON.parse(fsSync.readFileSync(join(ABS_DIR, 'package.json'), 'utf8')).name || pkgName;
  } catch { /* 保持默认 */ }
  const candidates = [
    // npm 全局根（最常见）
    join(dirname(process.execPath), '..', 'lib', 'node_modules', pkgName, 'bin', entryFile),
  ];
  // npm_config_prefix 未设置时会产生相对路径候选（依赖 cwd），只在其存在时才加入
  if (process.env.npm_config_prefix) {
    candidates.push(join(process.env.npm_config_prefix, 'lib', 'node_modules', pkgName, 'bin', entryFile));
  }
  for (const c of candidates) {
    try { if (fsSync.existsSync(c)) return c; } catch { /* 试下一个 */ }
  }
  // 回退：仓库/本地安装形态
  return join(ABS_DIR, 'bin', entryFile);
}

/** 写进宿主 MCP 配置的 mcp.js 路径。 */
function mcpEntryPath() {
  return stableBinPath('mcp.js');
}

const MARK = '// abs-managed (agent-brain-sync)'; // TS plugin 标记
const JSON_MARK_KEY = 'abs-managed';             // JSON 内我们的命名空间

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
async function atomicWrite(p, text) {
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

async function backup(p) {
  try {
    const bak = `${p}.abs-bak-${new Date().toISOString().slice(0, 10)}`;
    await fs.copyFile(p, bak);
    return bak;
  } catch { return null; } // 文件不存在则无备份
}

async function readJson(p, { strict = true } = {}) {
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
    // 而 JSONC（带 // 注释）正是 CL​aude Code 官方文档鼓励的写法，命中率不低。
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
 * 判断一个 hook 数组元素是不是 abs 装的（用于卸载只删自己、安装去重）。
 *
 * 修复: 曾经用 command.includes('/.abs/hooks/') —— 子串匹配。任何「命令文本里恰好
 * 出现该片段」的用户 hook 都会被误判为 abs 装的，于是卸载时删掉、安装时静默丢弃。
 * 实测真例（都被误删）:
 *   grep -r try /home/u/.abs/hooks/ > /tmp/report
 *   tar czf /tmp/b.tgz /home/u/.abs/hooks/ && echo done
 * 现在改为精确匹配本工具实际写入的路径前缀: <homedir>/.abs/hooks/<agentKey>/abs-
 * （stageHookScripts 生成的脚本名统一是 abs-<Event>.sh）。
 */
function absHookDir(agentKey) {
  return join(homedir(), '.abs', 'hooks', agentKey);
}
function isAbsStagedCommand(cmd) {
  if (typeof cmd !== 'string') return false;
  // 取命令里的绝对路径 token 逐个比对，避免子串误判
  const tokens = cmd.match(/\S+/g) || [];
  return tokens.some((t) => {
    const base = t.replace(/^['"]|['"]$/g, '');
    return base.includes('/.abs/hooks/') && /(^|\/)\.abs\/hooks\/[^/]+\/abs-[^/]*$/.test(base);
  });
}
function entryHasAbs(entry) {
  const hs = entry && entry.hooks ? (Array.isArray(entry.hooks) ? entry.hooks : [entry.hooks]) : [];
  const cmds = [];
  for (const h of hs) if (h && typeof h.command === 'string') cmds.push(h.command);
  // 兼容扁平形态 { command } （无 hooks 字段）
  if (entry && typeof entry.command === 'string') cmds.push(entry.command);
  return cmds.some(isAbsStagedCommand);
}

// ============================ TOML section 行级工具 ============================
// 为什么不用正则: 曾用 /\n?\[mcp_servers\.abs\][^\[]*/s 删 section，
// 而 `[^\[]*` 会在下一个 `[` 处停下 —— `args = ["/x/mcp.js"]` 的数组左括号就是 `[`。
// 结果卸载后把数组值原地截成活一个假 section 头，留下非法行 `["/…/mcp.js"]`，
// 用户 co​dex 启动时 TOML 解析直接失败（卸载却给用户留个坏配置）。
// 另一坑: 用 includes('[mcp_servers.abs]') 判"已存在"不区分注释 ——
// 用户配置里一句 `# 例: [mcp_servers.abs]` 就让安装器报"已存在且路径正确, 跳过"，
// 实际从未注册（静默失效，且重装永不修复）。
// 故统一用行级扫描: section 头必须锚定行首、非注释；section 体到下一个 section 头为止。
const TOML_ABS_SECTION = '[mcp_servers.abs]';

/** 某行是否为 section 头（含数组表格 [[x]]）。 */
function isTomlSectionHeader(line) {
  return line.trimStart().startsWith('[');
}

/** 找出 [mcp_servers.abs] 真实 section 的 [start, end) 行下标；无则 null。
 * 注释行（# 开头）不算 —— 这是修复 H1（注释导致假装成功）的关键。 */
function findTomlAbsSection(lines) {
  const start = lines.findIndex((l) => {
    const t = l.trimStart();
    return !t.startsWith('#') && t.trim() === TOML_ABS_SECTION;
  });
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !isTomlSectionHeader(lines[end])) end++;
  return { start, end };
}

/** 删除 [mcp_servers.abs] section（含其 body）；无则原样返回。
 * @returns {{ text: string, removed: boolean }} */
function removeTomlAbsSection(text) {
  const lines = String(text || '').split('\n');
  const sec = findTomlAbsSection(lines);
  if (!sec) return { text, removed: false };
  // 一并去掉 section 前的多余空行，避免留下连续空行
  let from = sec.start;
  while (from > 0 && lines[from - 1].trim() === '') from--;
  const out = [...lines.slice(0, from), ...lines.slice(sec.end)];
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n'), removed: true };
}

// ============================ Hook 脚本落盘 ============================
// 每个事件一份脚本（模板替换 EVENT/BIN），统一 stage 到 ~/.abs/hooks/<agent>/。
async function stageHookScripts(agentKey, events) {
  const tpl = await fs.readFile(HOOK_TEMPLATE, 'utf8');
  const dir = join(homedir(), '.abs', 'hooks', agentKey);
  const out = {};
  for (const ev of events) {
    const name = `abs-${ev}.sh`;
    const p = join(dir, name);
    const script = tpl
      .replaceAll('__ABS_BIN__', stableBinPath('abs.js'))
      .replaceAll('__NODE_BIN__', process.execPath)
      .replaceAll('__EVENT__', ev);
    await atomicWrite(p, script);
    await fs.chmod(p, 0o755);
    out[ev] = p;
  }
  return out; // { 'SessionStart': '/home/.abs/hooks/claude-code/abs-SessionStart.sh', ... }
}

// ============================ Claude Code ============================
function claudeSettingsPath() {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json');
}

async function installClaudeCode({ withMcp, withSkill, log }) {
  const steps = [];
  // 1) hooks → settings.json (分区合并: 同事件可挂多个 hook 框架, 追加 abs 而非覆盖, 保留 moshi-hook 等)
  const scriptMap = await stageHookScripts('claude-code', HOSTS[0].events);
  const settingsP = claudeSettingsPath();
  await backup(settingsP);
  const settings = await readJson(settingsP);
  settings.hooks = settings.hooks || {};
  for (const [ev, script] of Object.entries(scriptMap)) {
    const existing = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];
    const kept = existing.filter((e) => !entryHasAbs(e)); // 去掉旧 abs 条目, 幂等; 保留 moshi 等其它 hook
    settings.hooks[ev] = [...kept, { hooks: [{ type: 'command', command: script }] }];
  }
  await atomicWrite(settingsP, JSON.stringify(settings, null, 2));
  steps.push(`✓ hooks  → ${settingsP} (${Object.keys(scriptMap).length} 事件, 与既有 hook 共存)`);

  // 2) MCP → settings.json mcpServers (stdio)
  if (withMcp) {
    settings.mcpServers = settings.mcpServers || {};
    settings.mcpServers['abs'] = {
      command: process.execPath,
      args: [mcpEntryPath()],
    };
    await atomicWrite(settingsP, JSON.stringify(settings, null, 2));
    steps.push(`✓ MCP    → settings.json mcpServers.abs (stdio)`);
  }

  // 3) skill → <configRoot>/skills/abs-agent-brain-sync/SKILL.md (config 根 = CLAUDE_CONFIG_DIR)
  if (withSkill) {
    const target = join(hostSkillDir('claude-code'), 'SKILL.md');
    await atomicWrite(target, await fs.readFile(SKILL_SOURCE, 'utf8'));
    steps.push(`✓ skill  → ${target}`);
  }
  return steps;
}

async function uninstallClaudeCode() {
  const steps = [];
  const settingsP = claudeSettingsPath();
  const settings = await readJson(settingsP, { strict: false });
  if (settings === null) {
    // 配置解析失败: 跳过该文件（绝不覆盖），但仍继续清理 abs 自己的脚本/skill。
    steps.push(`⚠ ${settingsP} 无法解析为 JSON，已跳过（未改动你的配置）`);
  }
  let touched = false;
  if (settings && settings.hooks) {
    const events = HOSTS[0].events;
    for (const ev of events) {
      if (!Array.isArray(settings.hooks[ev])) continue;
      const kept = settings.hooks[ev].filter((e) => !entryHasAbs(e)); // 只删 abs, 保留 moshi 等共存 hook
      if (kept.length !== settings.hooks[ev].length) {
        if (kept.length) settings.hooks[ev] = kept;
        else delete settings.hooks[ev]; // 无共存 hook 时整删该事件
        touched = true;
      }
    }
  }
  if (settings && settings.mcpServers && settings.mcpServers.abs) {
    delete settings.mcpServers.abs; touched = true;
  }
  if (touched) await atomicWrite(settingsP, JSON.stringify(settings, null, 2));
  if (settings) steps.push(`✓ hooks/MCP 已从 ${settingsP} 移除`);
  // staged hook 脚本目录 —— 只删本 agent 的，绝不整删 ~/.abs/（其它 agent 的 hook / mcp.log 共存）
  await fs.rm(join(homedir(), '.abs', 'hooks', 'claude-code'), { recursive: true, force: true });
  steps.push(`✓ ~/.abs/hooks/claude-code/ (本 agent hook 脚本) 已删除`);
  // skill
  const skillDir = hostSkillDir('claude-code');
  await fs.rm(skillDir, { recursive: true, force: true });
  steps.push(`✓ skill 已删除`);
  return steps;
}

// ============================ Codex ============================
async function installCodex({ withMcp, withSkill, log }) {
  const steps = [];
  const scriptMap = await stageHookScripts('codex', HOSTS[1].events);
  const p = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json');
  await backup(p);
  const cfg = await readJson(p);
  // Codex 真实结构是 {hooks: {EventName: [{matcher?, hooks:[{type,command}]}]}} (与 Claude 同形)。
  // 兼容历史 bug 写出的扁平数组 {hooks: [{event, command}]}: 迁移成对象形态, 不丢既有 hook。
  let hooks = cfg.hooks;
  if (Array.isArray(hooks)) {
    const migrated = {};
    for (const h of hooks) {
      if (!h || !h.event) continue;
      (migrated[h.event] = migrated[h.event] || []).push({ hooks: [{ type: 'command', command: h.command }] });
    }
    hooks = migrated;
  }
  if (!hooks || typeof hooks !== 'object') hooks = {};
  for (const [ev, script] of Object.entries(scriptMap)) {
    const existing = Array.isArray(hooks[ev]) ? hooks[ev] : [];
    const kept = existing.filter((e) => !entryHasAbs(e)); // 去掉旧 abs 条目, 幂等; 保留既有 hook
    hooks[ev] = [...kept, { hooks: [{ type: 'command', command: script }] }];
  }
  cfg.hooks = hooks;
  await atomicWrite(p, JSON.stringify(cfg, null, 2));
  steps.push(`✓ hooks  → ${p} (${Object.keys(scriptMap).length} 事件, 与既有 hook 共存)`);

  if (withMcp) {
    const mcpP = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
    let text = '';
    try { text = await fs.readFile(mcpP, 'utf8'); } catch {}
    const found = findTomlAbsSection(text.split('\n'));
    if (!found) {
      // 必须用 findTomlAbsSection 而非 includes —— 注释里的同名文本不算已注册（H1）。
      const block = `\n[mcp_servers.abs]\ncommand = "${process.execPath}"\nargs = ["${mcpEntryPath()}"]\n`;
      await backup(mcpP);
      await atomicWrite(mcpP, text.replace(/\s*$/, '') + '\n' + block);
      steps.push(`✓ MCP    → ${mcpP} [mcp_servers.abs]`);
    } else {
      // 已存在也要校对路径: 旧版可能写入了仓库路径(不稳定) 或全局包已迁移。
      const want = mcpEntryPath();
      const lines = text.split('\n');
      const body = lines.slice(found.start, found.end).join('\n');
      if (body.includes(`"${want}"`)) {
        steps.push(`• MCP    → ${mcpP} 已存在且路径正确, 跳过`);
      } else {
        // 只改 args 行的字面量值，不碰其它行（正则跨行会误伤数组内容）
        let touched = false;
        for (let k = found.start; k < found.end; k++) {
          if (/^\s*args\s*=/.test(lines[k])) { lines[k] = `args = ["${want}"]`; touched = true; break; }
        }
        if (touched) {
          await backup(mcpP);
          await atomicWrite(mcpP, lines.join('\n'));
          steps.push(`✓ MCP    → ${mcpP} 路径已校正 → ${want}`);
        } else {
          steps.push(`• MCP    → ${mcpP} 已注册但无 args 行, 未动（请手动确认）`);
        }
      }
    }
  }
  if (withSkill) {
    const target = join(hostSkillDir('codex'), 'SKILL.md');
    await atomicWrite(target, await fs.readFile(SKILL_SOURCE, 'utf8'));
    steps.push(`✓ skill  → ${target}`);
  }
  return steps;
}

async function uninstallCodex() {
  const steps = [];
  const home = process.env.CODEX_HOME || join(homedir(), '.codex');
  const p = join(home, 'hooks.json');
  const cfg = await readJson(p, { strict: false });
  if (cfg === null) {
    steps.push(`⚠ ${p} 无法解析为 JSON，已跳过（未改动你的配置）`);
  }
  let changed = false;
  if (cfg && Array.isArray(cfg.hooks)) {
    const before = cfg.hooks.length;
    cfg.hooks = cfg.hooks.filter((h) => !isAbsStagedCommand(String(h.command || '')));
    changed = cfg.hooks.length !== before;
  } else if (cfg && cfg.hooks && typeof cfg.hooks === 'object') {
    for (const ev of Object.keys(cfg.hooks)) {
      const arr = cfg.hooks[ev];
      if (!Array.isArray(arr)) continue;
      const kept = arr.filter((e) => !entryHasAbs(e));
      if (kept.length !== arr.length) {
        changed = true;
        if (kept.length) cfg.hooks[ev] = kept;
        else delete cfg.hooks[ev]; // 无共存 hook 时整删该事件
      }
    }
  }
  if (changed) {
    await atomicWrite(p, JSON.stringify(cfg, null, 2));
    steps.push(`✓ hooks 已从 ${p} 移除`);
  }
  const mcpP = join(home, 'config.toml');
  try {
    const text = await fs.readFile(mcpP, 'utf8');
    // 用行级扫描而非正则: 正则会在 args = [...] 的 [ 处截断，
    // 留下非法行 ["/…/mcp.js"] 让用户的 TOML 解析失败。
    const { text: after, removed } = removeTomlAbsSection(text);
    if (removed) {
      await atomicWrite(mcpP, after);
      steps.push(`✓ MCP 已从 ${mcpP} 移除`);
    }
  } catch {}
  await fs.rm(hostSkillDir('codex'), { recursive: true, force: true });
  steps.push(`✓ skill 已删除`);
  return steps;
}

/**
 * opencode 路径歧义提示（返回一行警告文本，无歧义时返回 null）。
 *
 * 背景: opencode 的全局配置默认在 ~/.config/opencode/，但它同样尊重
 *   XDG_CONFIG_HOME（官方支持 XDG 规范）。若用户设了该变量，opencode 会去
 *   $XDG_CONFIG_HOME/opencode/ 读配置，而本工具默认仍写 ~/.config/opencode/ ——
 *   于是插件装了却不生效（静默失效，最难查）。同理 OPENCODE_CONFIG 可覆盖配置文件路径。
 *
 * 为什么只警告不自动跟随: ①跟随会让"装到哪"依赖环境变量，变得不可预测；
 *   ②若 opencode 实际没读该变量，跟着写反而错。故只提示，把决定权留给用户 ——
 *   用户可用 ABS_OPENCODE_HOME 显式指定目标。
 */
function opencodePathWarning() {
  // 本工具实际会写入的位置（ABS_OPENCODE_HOME 覆盖时即该值）
  const ours = hostConfigRoot("opencode");
  const hints = [];

  // opencode 自身可能读取的位置。它支持 XDG 规范，故 XDG_CONFIG_HOME 优先于 ~/.config。
  const xdg = process.env.XDG_CONFIG_HOME;
  const opencodeWillRead = xdg ? join(xdg, "opencode") : null;
  if (opencodeWillRead && resolve(opencodeWillRead) !== resolve(ours)) {
    hints.push(`XDG_CONFIG_HOME=${xdg} → opencode 会读 ${opencodeWillRead}，但本工具写的是 ${ours}`);
  }
  if (process.env.OPENCODE_CONFIG) {
    hints.push(`OPENCODE_CONFIG=${process.env.OPENCODE_CONFIG} 会覆盖全局配置路径（优先级高于上面两者）`);
  }

  if (!hints.length) return null;
  // 修复: 曾经 ABS_OPENCODE_HOME 一被设置就无条件 return null —— 于是即使用户
  // 显式指定的目标与 opencode 实际会读的位置也不一致，警告仍完全静默。
  // 现在改为「只比较路径是否一致」: 一致就静默（无歧义），不一致就提示，
  // 无论目标来自默认值还是显式 env。
  const via = process.env.ABS_OPENCODE_HOME ? "（目标由 ABS_OPENCODE_HOME 显式指定）" : "";
  return [
    "⚠ opencode 配置路径可能不一致（已装的插件可能不生效）:" + via,
    ...hints.map((h) => `    - ${h}`),
    "  如需指定目标: ABS_OPENCODE_HOME=<配置根> abs install --agent opencode",
  ].join("\n");
}

// ============================ Opencode / Pi (TS 插件) ============================
function opencodePluginSource() {
  // 模板已外置到 hooks/abs.opencode.ts（真文件，非字符串）。
  // 为什么外置: ①改一处逻辑不用在模板里再改一遍(曾漏改导致行为不一致)
  //            ②生成产物能被测试直接 import 断言, 不再解析字符串产物(间接测试的税)
  // 转义坑已消除: 以前模板嵌在模板字符串里，\n / \" / \` 双层转义极易写错(代码注释亦踩过)。
  return renderPluginTemplate('abs.opencode.ts', { '@@MARK@@': MARK });
}

// ============================ Pi (TS extension) ============================
// Pi 与 Opencode 插件语法不同构：Pi 需要 default 工厂函数接收 ExtensionAPI、用 pi.on(event) 注册。
// 不能复用 opencodePluginSource 的写法（那是 export const ... = ({ project }) => ...）。
// 两者同纪律: 生命周期事件只进技术日志 hooks.log, 不进图谱 log.md。
function piPluginSource() {
  // 模板已外置到 hooks/abs.pi.ts。理由同 opencodePluginSource。
  return renderPluginTemplate('abs.pi.ts', {
    '@@ABS_BIN@@': stableBinPath('abs.js'),
    '@@MARK@@': MARK,
  });
}

/**
 * 读 hooks/ 下的插件模板（真文件，非字符串）并替换 @@占位符@@。
 * 为什么用占位符而非模板字符串: 模板本身是 TS 代码，含 \n / " / \` 等；
 * 以前嵌在模板字符串里需双层转义，极易写错且只能靠“生成的字符串”间接测。
 * 现在模板是真文件 → 可用真 TS 编辑器/测试直接 import 断言。
 * 找不到模板文件时抛错（宁可失败也不静默生成空插件）。
 */
function renderPluginTemplate(name, vars) {
  let t;
  try {
    t = fsSync.readFileSync(join(ABS_DIR, 'hooks', name), 'utf8');
  } catch (e) {
    throw new Error(`插件模板缺失: hooks/${name}（安装包不完整？）: ${e.message}`);
  }
  for (const [k, v] of Object.entries(vars || {})) t = t.split(k).join(v);
  return t;
}

async function installOpenCode({ withMcp, withSkill, log }) {
  const steps = [];
  const dir = join(hostConfigRoot('opencode'), 'plugins');
  const p = join(dir, 'abs.ts');
  await atomicWrite(p, opencodePluginSource());
  steps.push(`✓ hook(ts plugin) → ${p}`);
  const warn = opencodePathWarning();
  if (warn) steps.push(warn);
  if (withMcp) {
    const mcpP = join(hostConfigRoot('opencode'), 'opencode.json');
    const cfg = await readJson(mcpP);
    cfg.mcp = cfg.mcp || {};
    cfg.mcp['abs'] = {
      type: 'local',
      command: [process.execPath, mcpEntryPath()],
    };
    await backup(mcpP);
    await atomicWrite(mcpP, JSON.stringify(cfg, null, 2));
    steps.push(`✓ MCP → ${mcpP} (mcp.abs local)`);
  }
  if (withSkill) {
    const target = join(hostSkillDir('opencode'), 'SKILL.md');
    await atomicWrite(target, await fs.readFile(SKILL_SOURCE, 'utf8'));
    steps.push(`✓ skill → ${target}`);
  }
  return steps;
}

async function uninstallOpenCode() {
  const steps = [];
  // 路径歧义提示（卸载侧同样有价值：可能提示用户去清另一个位置的旧副本）
  const warn = opencodePathWarning();
  if (warn) steps.push(warn);
  const plugin = join(hostConfigRoot('opencode'), 'plugins', 'abs.ts');
  await fs.rm(plugin, { force: true });
  steps.push(`✓ plugin 已删除`);
  const mcpP = join(hostConfigRoot('opencode'), 'opencode.json');
  const cfg = await readJson(mcpP, { strict: false });
  if (cfg === null) {
    steps.push(`⚠ ${mcpP} 无法解析为 JSON，已跳过（未改动你的配置）`);
  }
  if (cfg && cfg.mcp && cfg.mcp.abs) {
    delete cfg.mcp.abs;
    await atomicWrite(mcpP, JSON.stringify(cfg, null, 2));
    steps.push(`✓ MCP 已从 ${mcpP} 移除`);
  }
  await fs.rm(hostSkillDir('opencode'), { recursive: true, force: true });
  steps.push(`✓ skill 已删除`);
  return steps;
}

async function installPi({ withMcp, withSkill, log }) {
  const steps = [];
  const dir = join(hostConfigRoot('pi'), 'agent', 'extensions');
  const p = join(dir, 'abs.ts');
  await atomicWrite(p, piPluginSource()); // Pi 用专用模板, 语法与 OpenCode 不同构
  steps.push(`✓ hook(ts extension) → ${p}`);
  // MCP → ~/.pi/agent/mcp.json 的 mcpServers (stdio)
  // 曾经只打印「走 extension 内桥接」而没有任何桥接代码 —— 靠 mcp-adapter 的
  // hostConfigDiscovery 间接读到 cl​aude 注册才"看起来能用"; 没有 cl​aude 宿主的机器上直接缺失。
  if (withMcp) {
    const mcpP = join(hostConfigRoot('pi'), 'agent', 'mcp.json');
    await backup(mcpP);
    const cfg = await readJson(mcpP);
    cfg.mcpServers = cfg.mcpServers || {};
    cfg.mcpServers['abs'] = { type: 'stdio', command: process.execPath, args: [mcpEntryPath()] };
    await atomicWrite(mcpP, JSON.stringify(cfg, null, 2));
    steps.push(`✓ MCP    → ${mcpP} (mcpServers.abs, stdio)`);
  }
  if (withSkill) {
    const target = join(hostSkillDir('pi'), 'SKILL.md');
    await atomicWrite(target, await fs.readFile(SKILL_SOURCE, 'utf8'));
    steps.push(`✓ skill → ${target}`);
  }
  return steps;
}

async function uninstallPi() {
  const steps = [];
  await fs.rm(join(hostConfigRoot('pi'), 'agent', 'extensions', 'abs.ts'), { force: true });
  steps.push(`✓ extension 已删除`);
  await fs.rm(hostSkillDir('pi'), { recursive: true, force: true });
  steps.push(`✓ skill 已删除`);
  const mcpP = join(hostConfigRoot('pi'), 'agent', 'mcp.json');
  const cfg = await readJson(mcpP, { strict: false });
  if (cfg === null) {
    steps.push(`⚠ ${mcpP} 无法解析为 JSON，已跳过（未改动你的配置）`);
  }
  if (cfg && cfg.mcpServers && cfg.mcpServers.abs) {
    delete cfg.mcpServers.abs;
    await atomicWrite(mcpP, JSON.stringify(cfg, null, 2));
    steps.push(`✓ MCP 已从 ${mcpP} 移除`);
  }
  return steps;
}

// ============================ 向导入口 ============================
const INSTALLERS = {
  'claude-code': { on: installClaudeCode, off: uninstallClaudeCode },
  codex:         { on: installCodex,      off: uninstallCodex },
  opencode:      { on: installOpenCode,   off: uninstallOpenCode },
  pi:            { on: installPi,         off: uninstallPi },
};

export function installSummary() {
  return HOSTS.map((h) => `  ${h.key.padEnd(12)} ${h.label}`).join('\n');
}

export async function runInstall({ agent, mcp = true, skill = true, yes = false } = {}) {
  const targets = agent ? [agent] : await pickAgents(yes);
  const failed = [];
  for (const key of targets) {
    const inst = INSTALLERS[key];
    if (!inst) throw new Error(`未知 agent: ${key} (可用: ${Object.keys(INSTALLERS).join(', ')})`);
    console.log(`\n▸ 安装到 ${key} …`);
    try {
      for (const line of await inst.on({ withMcp: mcp, withSkill: skill })) {
        console.log('  ' + line);
      }
    } catch (e) {
      // 逐宿主容错: 一个宿主失败不应让其余宿主整体被跳过。
      // 坑: 曾经任一处报错就直接上抛，于是前序宿主已装、后续宿主全未装 —— 半成品状态。
      // 注意: 单宿主安装(agent 指定)时仍上抛，保持 CLI 非零退出语义。
      failed.push({ key, msg: String(e && e.message ? e.message : e) });
      console.error(`  ✗ ${key} 安装失败: ${failed[failed.length - 1].msg}`);
      if (agent) throw e;
    }
  }
  if (failed.length) {
    console.log(`\n⚠ ${failed.length} 个宿主安装失败: ${failed.map((f) => f.key).join(', ')}`);
    console.log('  其余宿主已完成。修复上述问题后重跑 `abs install`（幂等，不会重复写入）。');
    throw new Error(`${failed.length} 个宿主安装失败（见上）`);
  }
  console.log('\n完成。项目内运行 abs init 建图谱; 会话里说 "abs load" 续接。');
}

export async function runUninstall({ agent, yes = false } = {}) {
  const targets = agent ? [agent] : Object.keys(INSTALLERS);
  for (const key of targets) {
    const inst = INSTALLERS[key];
    if (!inst) throw new Error(`未知 agent: ${key}`);
    console.log(`\n▸ 从 ${key} 卸载 …`);
    for (const line of await inst.off()) console.log('  ' + line);
  }
  console.log('\n卸载完成。');
}

// 交互式多选（无 TTY 时回退为全部）
async function pickAgents(yes = false) {
  // --yes / 非 TTY: 直接全选，绝不弹交互。
  // 坑: 曾经只看 isTTY，--yes 被收下却从不使用 —— 在 TTY 里跑
  //     abs install --yes（自动化/脚本）仍会弹提示并挂起等输入。
  if (yes || !process.stdin.isTTY) return Object.keys(INSTALLERS);
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('选择要安装的智能体 (逗号分隔, 回车=全部):');
  console.log(installSummary());
  const ans = (await rl.question('> ')).trim();
  rl.close();
  if (!ans) return Object.keys(INSTALLERS);
  return ans.split(',').map((s) => s.trim()).filter(Boolean);
}
