// src/install.js — 安装 / 卸载到各智能体（MCP + hook + skill）。
// 机制（抄 ai-memory，已确认）:
//   - Claude Code: ~/.claude/settings.json 的 hooks 对象(CamelCase 事件→command)。
//     MCP: settings.json 顶层 mcpServers 或项目 .mcp.json。hook 要求 stdout 以 { 开头。
//   - Codex:      ~/.codex/hooks.json。
//   - OpenCode / Pi: 官方只吃 TS plugin/extension(无 shell-hook 配置) → 初版给出手工指引。
// 纪律: 幂等(重复安装=更新)、原子写(tmp+rename)、卸载只删自己装的、写入前备份。
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTS, hostByKey } from './hosts.js';

const ABS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_TEMPLATE = join(ABS_DIR, 'hooks', 'event.sh');
const SKILL_SOURCE = join(ABS_DIR, 'skill', 'SKILL.md');

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
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, p);
}

async function backup(p) {
  try {
    const bak = `${p}.abs-bak-${new Date().toISOString().slice(0, 10)}`;
    await fs.copyFile(p, bak);
    return bak;
  } catch { return null; } // 文件不存在则无备份
}

async function readJson(p) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return {}; }
}

const ABS_HOOK_MARK = '/.abs/hooks/';
/** 判断一个 hook 数组元素是不是 abs 装的(command 指向 ~/.abs/hooks/)。卸载/幂等去重用。 */
function entryHasAbs(entry) {
  const hs = entry && entry.hooks ? (Array.isArray(entry.hooks) ? entry.hooks : [entry.hooks]) : [];
  return hs.some((h) => typeof h?.command === 'string' && h.command.includes(ABS_HOOK_MARK));
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
      .replaceAll('__ABS_BIN__', join(ABS_DIR, 'bin', 'abs.js'))
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
      args: [join(ABS_DIR, 'bin', 'mcp.js')],
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
  const settings = await readJson(settingsP);
  let touched = false;
  if (settings.hooks) {
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
  if (settings.mcpServers && settings.mcpServers.abs) {
    delete settings.mcpServers.abs; touched = true;
  }
  if (touched) await atomicWrite(settingsP, JSON.stringify(settings, null, 2));
  steps.push(`✓ hooks/MCP 已从 ${settingsP} 移除`);
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
  cfg.hooks = cfg.hooks || [];
  // 去掉旧的 abs 条目再写(幂等)
  cfg.hooks = cfg.hooks.filter((h) => !String(h.command || '').includes('/.abs/hooks/'));
  for (const [ev, script] of Object.entries(scriptMap)) {
    cfg.hooks.push({ event: ev, command: script });
  }
  await atomicWrite(p, JSON.stringify(cfg, null, 2));
  steps.push(`✓ hooks  → ${p} (${Object.keys(scriptMap).length} 事件)`);

  if (withMcp) {
    const mcpP = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
    let text = '';
    try { text = await fs.readFile(mcpP, 'utf8'); } catch {}
    if (!text.includes('[mcp_servers.abs]')) {
      const block = `\n[mcp_servers.abs]\ncommand = "${process.execPath}"\nargs = ["${join(ABS_DIR, 'bin', 'mcp.js')}"]\n`;
      await backup(mcpP);
      await atomicWrite(mcpP, text.replace(/\s*$/, '') + '\n' + block);
      steps.push(`✓ MCP    → ${mcpP} [mcp_servers.abs]`);
    } else {
      steps.push(`• MCP    → ${mcpP} 已存在, 跳过`);
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
  const cfg = await readJson(p);
  if (Array.isArray(cfg.hooks)) {
    const before = cfg.hooks.length;
    cfg.hooks = cfg.hooks.filter((h) => !String(h.command || '').includes('/.abs/hooks/'));
    if (cfg.hooks.length !== before) {
      await atomicWrite(p, JSON.stringify(cfg, null, 2));
      steps.push(`✓ hooks 已从 ${p} 移除`);
    }
  }
  const mcpP = join(home, 'config.toml');
  try {
    const text = await fs.readFile(mcpP, 'utf8');
    if (text.includes('[mcp_servers.abs]')) {
      const re = /\n?\[mcp_servers\.abs\][^\[]*/s;
      await atomicWrite(mcpP, text.replace(re, '\n'));
      steps.push(`✓ MCP 已从 ${mcpP} 移除`);
    }
  } catch {}
  await fs.rm(hostSkillDir('codex'), { recursive: true, force: true });
  steps.push(`✓ skill 已删除`);
  return steps;
}

// ============================ OpenCode / Pi (TS 插件) ============================
function opencodePluginSource() {
  // OpenCode 官方插件 API: export const MyPlugin: Plugin = async ({ project }) => ({ event: async ({ name }) => {...} })
  return `/**
 * abs (agent-brain-sync) — OpenCode plugin。
 * 纯触发: 生命周期事件 → 机械落盘一行 log (经 abs CLI)。fire-and-forget。
 */
import { spawn } from "child_process"

const ABS_BIN = "${join(ABS_DIR, 'bin', 'abs.js')}"

export const AbsPlugin = async ({ project }) => ({
  event: async ({ name }) => {
    try {
      if (!["session.start", "session.end"].includes(name)) return
      const child = spawn(process.execPath, [ABS_BIN, "log", \`[opencode:\${name}]\`], {
        stdio: "ignore", detached: true,
      })
      child.unref()
    } catch {} // fire-and-forget: 永不阻塞宿主
  },
})
${MARK}
`;
}

// ============================ Pi (TS extension) ============================
// Pi 与 OpenCode 插件语法不同构：Pi 需要 default 工厂函数接收 ExtensionAPI、用 pi.on(event) 注册。
// 不能复用 opencodePluginSource 的 OpenCode 写法（那是 export const ... = ({ project }) => ...）。
function piPluginSource() {
  return `/**
 * abs (agent-brain-sync) — Pi extension。
 * 纯触发: 会话生命周期事件 → 机械落盘一行 log (经 abs CLI)。fire-and-forget。
 * Pi 事件: session_start / session_shutdown (对应 host hook 的 SessionStart/SessionEnd)。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { spawn } from "node:child_process"

const ABS_BIN = "${join(ABS_DIR, 'bin', 'abs.js')}"

function logHook(evt: string) {
  try {
    const child = spawn(process.execPath, [ABS_BIN, "log", \`[pi:\${evt}]\`], {
      stdio: "ignore", detached: true,
    })
    child.unref()
  } catch {} // fire-and-forget: 永不阻塞宿主
}

export default function absPiHook(pi: ExtensionAPI): void {
  pi.on("session_start", () => logHook("session_start"))
  pi.on("session_shutdown", () => logHook("session_shutdown"))
}
${MARK}
`;
}

async function installOpenCode({ withMcp, withSkill, log }) {
  const steps = [];
  const dir = join(hostConfigRoot('opencode'), 'plugins');
  const p = join(dir, 'abs.ts');
  await atomicWrite(p, opencodePluginSource());
  steps.push(`✓ hook(ts plugin) → ${p}`);
  if (withMcp) {
    const mcpP = join(hostConfigRoot('opencode'), 'opencode.json');
    const cfg = await readJson(mcpP);
    cfg.mcp = cfg.mcp || {};
    cfg.mcp['abs'] = {
      type: 'local',
      command: [process.execPath, join(ABS_DIR, 'bin', 'mcp.js')],
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
  const plugin = join(hostConfigRoot('opencode'), 'plugins', 'abs.ts');
  await fs.rm(plugin, { force: true });
  steps.push(`✓ plugin 已删除`);
  const mcpP = join(hostConfigRoot('opencode'), 'opencode.json');
  const cfg = await readJson(mcpP);
  if (cfg.mcp && cfg.mcp.abs) {
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
  if (withMcp) {
    steps.push(`• MCP → Pi 走 extension 内桥接(见 ${p}), 未单独注册`);
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
  const targets = agent ? [agent] : await pickAgents();
  for (const key of targets) {
    const inst = INSTALLERS[key];
    if (!inst) throw new Error(`未知 agent: ${key} (可用: ${Object.keys(INSTALLERS).join(', ')})`);
    console.log(`\n▸ 安装到 ${key} …`);
    for (const line of await inst.on({ withMcp: mcp, withSkill: skill })) {
      console.log('  ' + line);
    }
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
async function pickAgents() {
  if (!process.stdin.isTTY) return Object.keys(INSTALLERS);
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('选择要安装的智能体 (逗号分隔, 回车=全部):');
  console.log(installSummary());
  const ans = (await rl.question('> ')).trim();
  rl.close();
  if (!ans) return Object.keys(INSTALLERS);
  return ans.split(',').map((s) => s.trim()).filter(Boolean);
}
