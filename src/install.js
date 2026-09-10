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
  let changed = false;
  if (Array.isArray(cfg.hooks)) { // 历史扁平数组形态
    const before = cfg.hooks.length;
    cfg.hooks = cfg.hooks.filter((h) => !String(h.command || '').includes('/.abs/hooks/'));
    changed = cfg.hooks.length !== before;
  } else if (cfg.hooks && typeof cfg.hooks === 'object') { // 对象形态 {EventName: [...]}
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

// ============================ Opencode / Pi (TS 插件) ============================
function opencodePluginSource() {
  // Op​encode 官方插件 API (据 @op​encode-ai/plugin 类型定义实核):
  //   export const Plugin: Plugin = async ({ client, directory }) => ({ event: async ({ event }) => {...} })
  // 坑: event 回调入参是 { event }, 事件名在 event.type —— 曾错写成 ({ name }) 导致 name 恒 undefined,
  //     插件从未触发过(0 条日志), 静默失效。
  // 收尾注入: session.idle (= 每轮结束) 经 client.session.promptAsync 注入收尾指令,
  //     与 pi 的 agent_end 同策略(真改过文件 + .brain 存在 + log.md 今日无记录, 每会话一次)。
  return `/**
 * abs (agent-brain-sync) — Op​encode plugin。
 * 纯触发: 生命周期事件 → 技术日志一行 (~/.abs/log/hooks.log, ABS_LOG_DIR 可覆盖)。fire-and-forget。
 * 纪律: hook 事件只进技术日志, 不进图谱 log.md (log.md 只收工作成果沉淀, 与 event.sh 同纪律)。
 * Op​encode 事件: session.created / session.idle / session.deleted (idle = 每轮结束, 对应 pi 的 agent_end)。
 * 收尾注入: session.idle 且本会话真改过文件 + .brain 今日无记录 → promptAsync 推 agent 走收尾循环。
 */
import { appendFile, mkdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join, dirname } from "node:path"

const server = async ({ client, directory }) => {
  // 本会话是否真改过文件 (由 tool.execute.after 观测)
  let wroteFiles = false
  let nudged = false
  let idleSeen = false

  async function logHook(evt) {
    try {
      const dir = process.env.ABS_LOG_DIR || join(homedir(), ".abs", "log")
      const d = new Date()
      const pad = (n) => String(n).padStart(2, "0")
      const stamp = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())
      await mkdir(dir, { recursive: true })
      await appendFile(join(dir, "hooks.log"), "[" + stamp + "] opencode:" + evt + "\\n")
    } catch {} // fire-and-forget: 永不阻塞宿主
  }

  // 从 cwd 向上找最近含 .brain/ 的祖先目录
  async function findBrain(cwd) {
    let d = cwd || process.cwd()
    for (;;) {
      try { const st = await stat(join(d, ".brain")); if (st.isDirectory()) return join(d, ".brain") } catch {}
      const up = dirname(d)
      if (up === d) return null
      d = up
    }
  }

  // 判定"今天是否收尾过": 必须匹配 log.md 的条目头 '## [YYYY-MM-DD HH:MM]'。
  // 坑: 曾用裸日期 substring(includes('2026-09-10')), 结果正文/任务行里任何一处
  //     提到今天就能把 nudge 永久压掉(误判为已收尾), 守卫形同虚设。
  async function loggedToday(brain) {
    try {
      const txt = await readFile(join(brain, "log.md"), "utf8")
      const d = new Date()
      const pad = (n) => String(n).padStart(2, "0")
      const today = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
      return new RegExp("^## \\\\[" + today + " \\\\d{2}:\\\\d{2}\\\\]", "m").test(txt)
    } catch { return false }
  }

  const TEARDOWN_MSG =
    "[abs 收尾提醒] 本会话改过文件但 .brain/ 今天还没有记录。请立即走收尾循环：\\n" +
    "1) 跑 abs load 看 Today 还有哪些未完成；\\n" +
    "2) 实际做完漏登记的 abs task done <id>，做到一半的 abs task note <id> --note \\"断点\\"；\\n" +
    "3) 值得留的经验 abs note \\"...\\"（宁少勿滥，能从代码 grep 到的不记）；\\n" +
    "4) abs log \\"完成 X：...\\" 记一行工作成果，新页同步进 index。\\n" +
    "简洁执行，不要复述本条提醒。若本次确实没有可沉淀产出，直接回一句\\"无可沉淀\\"即可。"

  // bash 里只跑查询类命令不算改文件 (与 pi 侧 READONLY_CMD 同义, 但生成代码里要写进模板串)
  const READONLY_CMD = /^\\s*(ls|cat|grep|rg|find|head|tail|wc|git\\s+(status|log|diff|show|branch)|pwd|which|echo|node\\s+-v|npm\\s+(ls|view)|curl)\\b/

  return {
    // 观测真实写操作: write/edit/patch 类工具成功即标记。
    // 坑: 曾漏掉 bash —— op​encode 里很多修改是经 bash(heredoc/sed) 完成的, 纯 bash 会话
    //     永远不置位 wroteFiles, 于是收尾提醒静默不发。与 pi 侧 WRITE_TOOLS 保持一致。
    "tool.execute.after": async ({ tool, args }) => {
      const t = String(tool || "").toLowerCase()
      if (["write", "edit", "patch", "multiedit", "apply_patch"].includes(t)) {
        wroteFiles = true
        return
      }
      // bash 里只有非只读命令算改文件(ls/cat/git status 之类不算)
      if (t === "bash") {
        const cmd = String((args && (args.command || args.cmd)) || "")
        if (cmd && !READONLY_CMD.test(cmd)) wroteFiles = true
      }
    },

    event: async ({ event }) => {
      const type = event && event.type
      if (!type) return
      if (type === "session.created" || type === "session.deleted") {
        await logHook(type)
        return
      }
      if (type !== "session.idle") return // idle = 每轮结束, 不记日志(太吵), 只做收尾判定
      const cwd = directory || process.cwd()
      const brain = await findBrain(cwd)
      // 可观测性: 首次 idle 无条件留一行痕(否则无法区分“事件没触发”与“被守卫拦下”)
      if (!idleSeen) {
        idleSeen = true
        await logHook(\`session.idle:seen cwd=\${cwd} brain=\${brain || 'none'}\`)
      }
      if (nudged || !wroteFiles) return
      const sessionID = event.properties && event.properties.sessionID
      if (!sessionID) return
      if (!brain) return // 无图谱=不在这项目沉淀, 不打扰
      if (await loggedToday(brain)) return // 今天已收尾过
      nudged = true
      await logHook("session.idle:teardown-nudge")
      try {
        await client.session.promptAsync({
          path: { id: sessionID },
          query: { directory: cwd },
          body: { parts: [{ type: "text", text: TEARDOWN_MSG }] },
        })
      } catch {} // 注入失败不阻塞宿主
    },
  }
}

export default {
  id: "abs",
  server,
}
${MARK}
`;
}

// ============================ Pi (TS extension) ============================
// Pi 与 Opencode 插件语法不同构：Pi 需要 default 工厂函数接收 ExtensionAPI、用 pi.on(event) 注册。
// 不能复用 opencodePluginSource 的写法（那是 export const ... = ({ project }) => ...）。
// 两者同纪律: 生命周期事件只进技术日志 hooks.log, 不进图谱 log.md。
function piPluginSource() {
  return `/**
 * abs (agent-brain-sync) — Pi extension。
 * 纯触发: 会话生命周期事件 → 技术日志一行 (~/.abs/log/hooks.log, ABS_LOG_DIR 可覆盖)。fire-and-forget。
 * 纪律: hook 事件只进技术日志, 不进图谱 log.md (log.md 只收工作成果沉淀, 与 event.sh 同纪律)。
 * Pi 事件: session_start / session_shutdown (对应 host hook 的 SessionStart/SessionEnd)。
 * session_shutdown 额外触发 abs wrapup: 把当前项目未完成任务快照到 wrapup.log (跨会话收尾保险)。
 * agent_end 收尾注入: 本会话真改过文件 + .brain 今日无记录 → 注入一条收尾指令, 逼 agent 走收尾循环
 *   (被动记日志不够 —— 没人提醒就不会有人收尾)。每会话最多一次, 且已收尾后不再打扰。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { appendFile, mkdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { spawn } from "node:child_process"

const ABS_BIN = "${join(ABS_DIR, 'bin', 'abs.js')}"

async function logHook(evt: string): Promise<void> {
  const dir = process.env.ABS_LOG_DIR || join(homedir(), ".abs", "log")
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const stamp = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())
  const line = "[" + stamp + "] pi:" + evt + "\\n"
  await mkdir(dir, { recursive: true })
  await appendFile(join(dir, "hooks.log"), line)
}

// 会话结束时快照当前项目滞留任务到 wrapup.log（detached fire-and-forget，wrapup 自身幂等去重不刷屏）。
// cwd 用事件 ctx.cwd（当前项目），让 abs 从该目录向上定位 .brain/。
function snapshotWrapup(cwd: string): void {
  try {
    const child = spawn(process.execPath, [ABS_BIN, "wrapup"], {
      cwd: cwd || process.cwd(), stdio: "ignore", detached: true,
    })
    child.unref()
  } catch {} // fire-and-forget
}

// ---- 收尾注入判定 ----
// 真改过文件的工具（read/grep/ls 不算, 那些不产生可沉淀的产出）
const WRITE_TOOLS = new Set(["write", "edit", "multi_edit", "apply_patch", "bash"])
// bash 里只跑查询类命令不算改文件
const READONLY_CMD = /^\\s*(ls|cat|grep|rg|find|head|tail|wc|git\\s+(status|log|diff|show|branch)|pwd|which|echo|node\\s+-v|npm\\s+(ls|view)|curl)\\b/

function hasWriteWork(toolResults: any[]): boolean {
  for (const r of toolResults || []) {
    const name = String(r?.toolName || "")
    if (!WRITE_TOOLS.has(name)) continue
    if (r?.isError) continue
    if (name === "bash") {
      const cmd = String(r?.input?.command ?? r?.args?.command ?? "")
      if (READONLY_CMD.test(cmd)) continue
    }
    return true
  }
  return false
}

/** 从 cwd 向上找最近含 .brain/ 的祖先目录。 */
async function findBrain(cwd: string): Promise<string | null> {
  let d = cwd || process.cwd()
  for (;;) {
    try {
      const st = await stat(join(d, ".brain"))
      if (st.isDirectory()) return join(d, ".brain")
    } catch {}
    const up = dirname(d)
    if (up === d) return null
    d = up
  }
}

/**
 * .brain/log.md 今天有记录吗? 有=已收尾, 不再打扰。
 * 必须匹配条目头 '## [YYYY-MM-DD HH:MM]' —— 裸日期 substring 会被正文里任意一处
 * 今天的日期误命中, 导致"已收尾"误判、nudge 永不触发。
 */
async function loggedToday(brain: string): Promise<boolean> {
  try {
    const txt = await readFile(join(brain, "log.md"), "utf8")
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, "0")
    const today = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
    // 注意: 这里是真实 TS, 不是生成代码的模板字符串。用拼接形式避免反斜杠逃逸歧义。
    return new RegExp("^## \\\\[" + today + " \\\\d{2}:\\\\d{2}\\\\]", "m").test(txt)
  } catch { return false }
}

export default function absPiHook(pi: ExtensionAPI): void {
  pi.on("session_start", () => logHook("session_start").catch(() => {}))

  // 收尾注入: 每个会话最多一次, 避免反复打扰。
  let teardownNudged = false
  let agentEndSeen = false
  pi.on("agent_end", async (event: any, ctx: any) => {
    if (teardownNudged) return
    const cwd = (ctx && ctx.cwd) || process.cwd()
    const brain = await findBrain(cwd)
    // 可观测性: 本会话首次 agent_end 无条件留一行痕。
    // 没有它就无法区分三种状态: ①事件没触发 ②触发了但被守卫拦下 ③真注入了。
    if (!agentEndSeen) {
      agentEndSeen = true
      // 带上 cwd 与命中的 brain —— 否则事后无法解释“为何这条 nudge 会出现”
      await logHook(\`agent_end:seen cwd=\${cwd} brain=\${brain || 'none'}\`).catch(() => {})
    }
    if (!brain) return // 无图谱=不在这项目沉淀, 不打扰
    if (!hasWriteWork(event?.messages ? collectToolResults(event.messages) : [])) return
    if (await loggedToday(brain)) return // 今天已收尾过
    teardownNudged = true
    await logHook("agent_end:teardown-nudge").catch(() => {})
    try {
      pi.sendUserMessage(
        "[abs 收尾提醒] 本会话改过文件但 .brain/ 今天还没有记录。请立即走收尾循环：\\n" +
        "1) 跑 abs load 看 Today 还有哪些未完成；\\n" +
        "2) 实际做完漏登记的 abs task done <id>，做到一半的 abs task note <id> --note \\"断点\\"；\\n" +
        "3) 值得留的经验 abs note \\"...\\"（宁少勿滥，能从代码 grep 到的不记）；\\n" +
        "4) abs log \\"完成 X：...\\" 记一行工作成果，新页同步进 index。\\n" +
        "简洁执行，不要复述本条提醒。若本次确实没有可沉淀产出，直接回一句\\"无可沉淀\\"即可。",
        { deliverAs: "followUp" },
      )
    } catch {}
  })

  pi.on("session_shutdown", (_e: any, ctx: any) => {
    snapshotWrapup((ctx && ctx.cwd) || process.cwd())
    logHook("session_shutdown").catch(() => {})
  })
}

/** agent_end 的 event.messages 里翻出 toolResult 消息。 */
function collectToolResults(messages: any[]): any[] {
  const out: any[] = []
  for (const m of messages || []) {
    if (m && m.role === "toolResult") out.push(m)
  }
  return out
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
