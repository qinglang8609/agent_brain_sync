#!/usr/bin/env node
// bin/abs.js — abs CLI 入口。
// abs <cmd> [args]
// 命令: init / board / status / load / task / install / uninstall / help
import { cmdInit, cmdBoard, cmdStatus, cmdLoad, cmdTask, cmdLog, cmdQuery, cmdLint, cmdNote, cmdShow, cmdRepair, cmdWrapup, cmdTeardownCheck, cmdTodoArchive } from '../src/store.js';
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
    else if (a === '--keep-days') { o.keepDays = args[++i]; }
    else if (a === '--dry-run') { o.dryRun = true; }
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

读:
  abs load                   开机读状态 (index/todo/log)
  abs todo                   任务看板 Today / In Progress / Blocked / Done
  abs index                  图谱索引 index.md
  abs log                    流水 log.md
  abs status                 当前项目 + 图谱概要

写:
  abs todo add     <id> [--note ..] [--section ..]  登记任务 (start 同义)
  abs todo note    <id> --note "断点/进度"   实时落 ↳ 断点 行
  abs todo blocked <id> --note "卡点原因"    移入 Blocked 区
  abs todo done    <id>                      完成并归位 Done
  abs log "完成 X：…"         记一行工作成果 (无参=查看)
  abs note "经验一句话" [--tags 坑,docker]    经验实时暂存 → sources/

维护:
  abs query <词1> [词2 …]    检索 .brain/ 知识页 (多词 OR)
  abs todo archive [--keep-days N] [--dry-run]
                            归档 Done 区旧日期组 → sessions/<日期>-todo归档.md
                            (默认保留近 3 天; 任一天有未完成则整天不归档)
  abs lint                   图谱体检 (死链/孤岛/超尺寸/堆积)
  abs init [--repair]        建 .brain/ 图谱; 结构不完整时报明细, --repair 只补缺不覆盖
  abs install [--agent <宿主>]   安装 MCP+hook+skill (宿主: claude-code/codex/opencode/pi)
  abs uninstall [--agent <...>]  卸载
  abs update                 升级到最新版并刷新四宿主 hook/skill
  abs --version              显示当前版本
  abs help                   本帮助

注: abs wrapup / abs teardown-check 是 hook 内部命令, 不需手动调用。
`;

/**
 * 拒绝多余的未知位置参数。
 * 坑: 以前只读命令(如 abs todo)会静默忽略多余词 —— `abs todo add x` 照样打印看板、
 * exit 0、不报错, 用户以为登记成功实际什么都没写。现在一律报错并给正确用法。
 * @param {string[]} extra 收到的位置参数
 * @param {string} fix 正确用法的提示行
 */
function rejectExtra(extra, fix) {
  if (!extra.length) return;
  const q = extra.map((s) => `"${s}"`).join('、');
  throw new Error(`✗ 不认识多余参数 ${q}\n  正确用法: ${fix}`);
}

// 已改名/已废弃命令 → 新写法（报错而非静默，避免用户白跑一趟）
const RENAMED = {
  task: () => '命令已改名: abs task → abs todo\n  例: abs todo add <id> --note "…"  /  abs todo done <id>',
  board: () => '命令已改名: abs board → abs todo',
};

// task/todo 共用的子命令 → 归一化后的 action
const TODO_ACTIONS = {
  add: 'start',
  start: 'start', // add 的别名(老习惯保留)
  note: 'note',
  blocked: 'blocked',
  done: 'done',
};

async function main() {
  const opts = parseArgv(rest);
  try {
    if (RENAMED[cmd]) throw new Error(RENAMED[cmd]());
    switch (cmd) {
      case 'init': {
        rejectExtra(opts._, 'abs init [--repair]');
        const msg = opts.repair
          ? await cmdRepair({ dir: opts.dir })
          : await cmdInit({ dir: opts.dir });
        console.log(msg);
        break;
      }
      case 'load':
        rejectExtra(opts._, 'abs load');
        console.log(await cmdLoad({ dir: opts.dir }));
        break;
      case 'index':
        rejectExtra(opts._, 'abs index');
        console.log(await cmdShow({ dir: opts.dir, view: 'index' }));
        break;
      case 'log': {
        // 无参=查看 log.md；带参=追加一行 (用户/AI 主动记; hook 生命周期事件走技术日志 hooks.log, 不经这里)
        if (opts._.length) {
          console.log(await cmdLog({ dir: opts.dir, title: opts._.join(' ') }));
        } else {
          console.log(await cmdShow({ dir: opts.dir, view: 'log' }));
        }
        break;
      }
      case 'status':
        rejectExtra(opts._, 'abs status');
        console.log(await cmdStatus({ dir: opts.dir }));
        break;
      // abs todo —— 无子命令=看板；带子命令=任务写操作
      case 'todo': {
        const [sub, id, ...rest2] = opts._;
        if (!sub) {
          rejectExtra([id, ...rest2].filter(Boolean), 'abs todo');
          console.log(await cmdShow({ dir: opts.dir, view: 'todo' }));
          break;
        }
        const action = TODO_ACTIONS[sub];
        // 归档：Done 区迁出旧日期组（非任务子命令，单独处理）
        if (sub === 'archive') {
          rejectExtra(rest2, 'abs todo archive [--keep-days N] [--dry-run]');
          const a = { dir: opts.dir, keepDays: opts.keepDays, dryRun: opts.dryRun };
          console.log(await cmdTodoArchive(a));
          break;
        }
        if (!action) {
          throw new Error(
            `✗ 未知子命令 "${sub}"\n` +
            `  可用: add / start / note / blocked / done / archive\n` +
            `  看板: abs todo（不带参数）\n` +
            `  登记任务: abs todo add <id> --note "做什么"`,
          );
        }
        rejectExtra(rest2, `abs todo ${sub} <id>${action === 'done' ? '' : ' --note "…"'}`);
        if (!id) throw new Error(`✗ 缺 <id>\n  用法: abs todo ${sub} <id>${action === 'done' ? '' : ' --note "…"'}`);
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
        rejectExtra(opts._, 'abs lint');
        console.log(await cmdLint({ dir: opts.dir }));
        break;
      }
      // 内部命令（hook 专用，不出现在 help）：Stop 时机械快照未完成任务
      case 'wrapup': {
        rejectExtra(opts._, 'abs wrapup（内部命令, 供 hook 调用）');
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
