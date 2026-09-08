#!/usr/bin/env node
// bin/abs.js — abs CLI 入口。
// abs <cmd> [args]
// 命令: init / board / status / load / task / install / uninstall / help
import { cmdInit, cmdBoard, cmdStatus, cmdLoad, cmdTask, cmdLog, cmdQuery, cmdLint, cmdNote, cmdShow, cmdRepair } from '../src/store.js';
import { runInstall, runUninstall, installSummary } from '../src/install.js';

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
  abs log                    无参查看流水 log.md；带参追加一行 (hook 用): abs log "标题"
  abs status                 显示当前项目 + 图谱概要
  abs task start   <id> [--note ..] [--section Today / In Progress]  登记任务
  abs task note    <id> --note "断点/进度"   实时落 ↳ 断点 行
  abs task blocked <id> --note "卡点原因"    移入 Blocked 区
  abs task done    <id>                      完成并归位 Done
  abs note "经验一句话" [--tags 坑,docker]    经验实时暂存 → sources/
  abs query <词1> [词2 …]    检索 .brain/ 知识页 (多词 OR)
  abs lint                   图谱体检 (死链/孤岛/超尺寸/堆积)
  abs install [--agent <claude-code|opencode|codex|pi>]  安装 MCP+hook+skill
  abs uninstall [--agent <...>]                            卸载
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
        // 无参=查看 log.md；带参=追加一行流水（hook 落盘点）
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
      case 'log': {
        const title = opts._.join(' ') || '(hook)';
        console.log(await cmdLog({ dir: opts.dir, title }));
        break;
      }
      case 'query': {
        console.log(await cmdQuery({ dir: opts.dir, terms: opts._ }));
        break;
      }
      case 'lint': {
        console.log(await cmdLint({ dir: opts.dir }));
        break;
      }
      case 'help': case undefined: case '--help': console.log(usage); break;
      default: throw new Error(`未知命令: ${cmd}\n\n${usage}`);
    }
  } catch (e) {
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
  }
}

main();
