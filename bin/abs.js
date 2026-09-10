#!/usr/bin/env node
// bin/abs.js — abs CLI 入口。
// abs <cmd> [args]
// 命令: init / board / status / load / task / install / uninstall / help
import { cmdInit, cmdBoard, cmdStatus, cmdLoad, cmdTask, cmdLog, cmdQuery, cmdLint, cmdNote, cmdShow, cmdRepair, cmdWrapup, cmdTeardownCheck } from '../src/store.js';
import { runInstall, runUninstall, installSummary } from '../src/install.js';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ABS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 读本包 package.json 的 version。 */
function pkgVersion() {
  try {
    return JSON.parse(readFileSync(join(ABS_DIR, 'package.json'), 'utf8')).version || 'unknown';
  } catch { return 'unknown'; }
}

/** 跑一个命令并把 stdout 当字符串返回(失败返回 null)。 */
function runCmd(cmd, args) {
  return new Promise((resolvePromise) => {
    let out = '';
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    c.stdout.on('data', (d) => (out += d));
    c.on('error', () => resolvePromise(null));
    c.on('close', (code) => resolvePromise(code === 0 ? out.trim() : null));
  });
}

/**
 * abs update — 升级全局安装并刷新四宿主 hook/skill。
 * 升级走 npm(唯一真源)；刷新是因为 hook 脚本烧的是绝对路径与模板快照。
 */
async function cmdUpdate({ yes }) {
  const cur = pkgVersion();
  const latest = await runCmd('npm', ['view', '@fanchao8609/agent_brain_sync', 'version']);
  if (!latest) {
    console.error('无法查询 npm registry（网络/代理问题）。手动升级：npm i -g @fanchao8609/agent_brain_sync@latest');
    process.exit(1);
  }
  console.log(`当前: ${cur}`);
  console.log(`最新: ${latest}`);
  if (latest === cur) {
    console.log('已是最新，无需升级。');
    return;
  }
  console.log(`\n升级 ${cur} → ${latest} …`);
  const r = await runCmd('npm', ['i', '-g', '@fanchao8609/agent_brain_sync@latest']);
  if (r === null) {
    console.error('升级失败（网络/代理/权限）。手动：npm i -g @fanchao8609/agent_brain_sync@latest');
    process.exit(1);
  }
  console.log(r);
  console.log('\n刷新四宿主 hook/skill（hook 脚本烧的是绝对路径 + 模板快照，升级后必须重装）…');
  await runInstall({ agent: undefined, mcp: true, skill: true, yes: yes !== false });
  console.log(`\n完成。重启宿主（pi / op​encode / cl​aude-code / co​dex）后新 hook 生效。`);
}

const [,, cmd, ...rest] = process.argv;

function parseArgv(args) {
  const o = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dir') { o.dir = args[++i]; }
    else if (a === '--agent') { o.agent = args[++i]; }
    else if (a === '--id') { o.id = args[++i]; }
    else if (a === '--section') { o.section = args[++i]; }
    else if (a === '--note') { o.note = args[++i]; }
    else if (a === '--payload') { o.payload = args[++i]; }
    else if (a === '--yes') { o.yes = true; }
    else if (a === '--repair') { o.repair = true; }
    else if (a === '--no-mcp') { o.mcp = false; }
    else if (a === '--no-skill') { o.skill = false; }
    else if (a.startsWith('--')) { o[a.slice(2)] = true; }
    else o._.push(a);
  }
  return o;
}

const usage = `abs — agent-brain-sync 记忆工具

用法:
  abs init [--repair]        建 .brain/ 图谱；结构不完整时报明细，--repair 只补缺不覆盖
  abs load                   开机读状态 (index/todo/log)
  abs todo                   查看任务看板 (board 的正名)
  abs index                  查看图谱索引 index.md
  abs log                    无参查看流水 log.md；带参追加一行: abs log "标题" (仅用户/AI 主动记, hook 事件走 ~/.abs/log/hooks.log)
  abs status                 显示当前项目 + 图谱概要
  abs task start   <id> [--note ..] [--section Today / In Progress]  登记任务
  abs task note    <id> --note "断点/进度"   实时落 ↳ 断点 行
  abs task blocked <id> --note "卡点原因"    移入 Blocked 区
  abs task done    <id>                      完成并归位 Done
  abs note "经验一句话" [--tags 坑,docker]    经验实时暂存 → sources/
  abs query <词1> [词2 …]    检索 .brain/ 知识页 (多词 OR)
  abs lint                   图谱体检 (死链/孤岛/超尺寸/堆积)
  abs wrapup                 快照当前未完成任务到 ~/.abs/log/wrapup.log (收尾保险)
  abs install [--agent <claude-code|opencode|codex|pi>]  安装 MCP+hook+skill
  abs uninstall [--agent <...>]                            卸载
  abs update                 升级到最新版并刷新四宿主 hook/skill
  abs --version              显示当前版本
  abs help                   本帮助
`;

async function main() {
  const opts = parseArgv(rest);
  try {
    switch (cmd) {
      case 'init': {
        const msg = opts.repair
          ? await cmdRepair({ dir: opts.dir })
          : await cmdInit({ dir: opts.dir });
        console.log(msg);
        break;
      }
      case 'load':     console.log(await cmdLoad({ dir: opts.dir })); break;
      case 'board':    console.log(await cmdShow({ dir: opts.dir, view: 'todo' })); break;
      case 'todo':     console.log(await cmdShow({ dir: opts.dir, view: 'todo' })); break;
      case 'index':    console.log(await cmdShow({ dir: opts.dir, view: 'index' })); break;
      case 'log': {
        // 无参=查看 log.md；带参=追加一行 (用户/AI 主动记; hook 生命周期事件走技术日志 hooks.log, 不经这里)
        if (opts._.length) {
          console.log(await cmdLog({ dir: opts.dir, title: opts._.join(' ') }));
        } else {
          console.log(await cmdShow({ dir: opts.dir, view: 'log' }));
        }
        break;
      }
      case 'status':   console.log(await cmdStatus({ dir: opts.dir })); break;
      case 'task': {
        const [action, id] = opts._;
        if (!action || !['start', 'done', 'blocked', 'note'].includes(action)) {
          throw new Error('abs task <start|done|blocked|note> <id>');
        }
        console.log(await cmdTask({ dir: opts.dir, action, id, section: opts.section, note: opts.note }));
        break;
      }
      case 'note': {
        console.log(await cmdNote({ dir: opts.dir, text: opts._.join(' '), tags: opts.tags }));
        break;
      }
      case 'install':  await runInstall({ agent: opts.agent, mcp: opts.mcp !== false, skill: opts.skill !== false, yes: opts.yes }); break;
      case 'uninstall': await runUninstall({ agent: opts.agent, yes: opts.yes }); break;
      case 'agents':   console.log(installSummary()); break;
      case 'query': {
        console.log(await cmdQuery({ dir: opts.dir, terms: opts._ }));
        break;
      }
      case 'lint': {
        console.log(await cmdLint({ dir: opts.dir }));
        break;
      }
      case 'wrapup': {
        console.log(await cmdWrapup({ dir: opts.dir }));
        break;
      }
      // Stop hook 用: 判定是否注入收尾指令。stdout 给 shell (`push:<json>` / `{}`), 无额外输出。
      case 'teardown-check': {
        process.stdout.write((await cmdTeardownCheck({ dir: opts.dir, payload: opts.payload })) + '\n');
        break;
      }
      case 'update':  await cmdUpdate({ yes: opts.yes }); break;
      case '--version': case '-v': case 'version': console.log(pkgVersion()); break;
      case 'help': case undefined: case '--help': console.log(usage); break;
      default: throw new Error(`未知命令: ${cmd}\n\n${usage}`);
    }
  } catch (e) {
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
  }
}

main();
