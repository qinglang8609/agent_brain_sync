#!/usr/bin/env node
// bin/abs.js — abs CLI 入口。
// abs <cmd> [args]
// 命令: init / board / status / load / task / install / uninstall / help
import { cmdInit, cmdStatus, cmdLoad, cmdTask, cmdLog, cmdQuery, cmdLint, cmdNote, cmdShow, cmdRepair, cmdWrapup, cmdRule, cmdTeardownCheck, cmdTodoArchive } from '../src/store.js';
import { setUser, getUser, userConfigPath } from '../src/userconfig.js';
import { runInstall, runUninstall } from '../src/install.js';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

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

// 所有 flag 集中声明。parseArgs 只负责「把 argv 切成键值」，形状转换（keep-days → keepDays，
// no-mcp → mcp:false）在下面一处收口。曾手写了 117 行 if-else 逐 flag 分支。
const FLAG_SPEC = {
  'dir': { type: 'string' },
  'agent': { type: 'string' },
  'id': { type: 'string' },
  'section': { type: 'string' },
  'note': { type: 'string' },
  'as': { type: 'string' },
  'payload': { type: 'string' },
  'tags': { type: 'string' },
  'keep-days': { type: 'string' },
  'help': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'full': { type: 'boolean' },
  'yes': { type: 'boolean' },
  'repair': { type: 'boolean' },
  'no-mcp': { type: 'boolean' },
  'no-skill': { type: 'boolean' },
};

/** 已被"规范键"接管的 raw flag：不再原样漏出（见 parseArgv 返回处的白名单注释）。 */
const KNOWN_RAW = new Set(['keep-days', 'dry-run', 'no-mcp', 'no-skill']);

function parseArgv(args) {
  // 坑: parseArgs 会把**任何** `-` 开头的 token 当选项，连正文一起吃：
  // `abs note "-X 是个坑"` → values={X:true,' ':true,是:true,…}，正文全丢（旧手写版只认 `--` 长选项）。
  // 也不能简单地把所有非 `--` token 剔走 —— 那样 `--dir /x` 的值 `/x` 会被误剔。
  // 解法: 先用 tokens 看清每个 token 的 kind，只把「`--` 开头且 name 在 FLAG_SPEC 里」当真选项，
  // 其余（包括 `-x` 与 `--unknown`）一律按原序交回位置参数，复刻旧手写逻辑。
  const { values: rawValues, tokens } = parseArgs({
    args,
    options: FLAG_SPEC,
    allowPositionals: true,
    strict: false,
    tokens: true,
  });
  const values = {};
  const positionals = [];
  const seenIdx = new Set(); // 同一个 argv 下标可能因 `-X 是个坑` 被拆出多个 token，只收一次
  // tokens 会把 `-X 是个坑` 拆成 5 个短选项（一个字符一个），但原始 argv 里它只是一个 token。
  // 而 token.index 就是原始 argv 的下标 → 直接按下标取回原串，才能拿回未拆的正文。
  for (const t of tokens) {
    const known = t.kind === 'option' && FLAG_SPEC[t.name] !== undefined && t.rawName.startsWith('--');
    if (known) {
      // 同名重复出现时后者胜（旧手写版行为）
      values[t.name] = t.value === undefined ? true : t.value;
    } else if (t.kind === 'positional') {
      positionals.push(t.value);
    } else {
      // `-x` / `--unknown` / 未知长选项: 都不是我们声明的 flag。
      // 旧手写版里 `-x` 落位置参数（→ 被 rejectExtra 拦），`--unknown` 静默收下。
      // 区分: `--` 开头的按旧的「静默收下」当布尔（不进位置参数），其余按 argv 原值整体回位置参数
      // （**不拆**，否则 note 正文会被切成碎片；同一 index 只收一次）。
      if (t.rawName && t.rawName.startsWith('--')) values[t.name] = true;
      else if (!seenIdx.has(t.index)) { seenIdx.add(t.index); positionals.push(args[t.index]); }
    }
  }
  // 坑: parseArgs 对「声明的 string 选项缺值」不报错（值会变 true），
  // 于是 `abs init --dir` 一路传到 resolve(true) 才抛裸栈。在此拦下并给清晰用法。
  const missing = Object.entries(values)
    .filter(([k, v]) => FLAG_SPEC[k]?.type === 'string' && typeof v !== 'string')
    .map(([k]) => `--${k}`);
  if (missing.length) {
    throw new Error(`✗ ${missing.join('、')} 缺少值\n  用法: --<flag> <值>（如 --dir /path/to/project）`);
  }
  // 只输出**读者实际用的**规范形状：camelCase 键 + mcp/skill 正向布尔。
  // 坑(OPTS-DOUBLE-KEYS): 曾 `...values` 之后再叠加 camelCase → opts 同时带两份 key
  // （keep-days 与 keepDays、no-mcp 与 mcp），读者得自己猜哪份算数。raw 键无人读，
  // 属纯噪音（grep 验证：opts['keep-days'] 零引用）。
  // 用显式白名单而非 ...values：新增 flag 必须在此声明一次，否则"声明了却没接线"
  // 会静默变成"读不到"，而不是意外漏出一个无名键。
  const o = {
    _: positionals,
    dir: values.dir,
    agent: values.agent,
    id: values.id,
    section: values.section,
    note: values.note,
    as: values.as,
    payload: values.payload,
    tags: values.tags,
    help: !!values.help,
    yes: !!values.yes,
    repair: !!values.repair,
    full: !!values.full,
    keepDays: values['keep-days'],
    dryRun: !!values['dry-run'],
    mcp: !values['no-mcp'],
    skill: !values['no-skill'],
  };
  // 未声明的 `--unknown` 静默收下（旧行为：不进位置参数，也不报错）。
  // 这条保留是因为 rejectExtra 只看位置参数 —— 把未知 flag 放进去会改成报错，
  // 那是另一个行为变更，不在本次范围内。
  for (const [k, v] of Object.entries(values)) {
    if (!(k in o) && !KNOWN_RAW.has(k)) o[k] = v;
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
  abs todo done    <id> [--as 落地|否决|仅方案]    完成；结语标明到底"做成了没有"
                               默认 落地。否决=评估后不做(含做了又撤)；仅方案=只设计过
                               不加结语或结语失真会让下一个会话把"想过"当成"做完了"。
  abs log "完成 X：…"         记一行工作成果 (无参=查看)
  abs note "经验一句话" [--tags 坑,docker]    经验实时暂存 → sources/

维护:
  abs query <词1> [词2 …]    检索 .brain/ 知识页 (多词 OR)
  abs todo archive [--keep-days N] [--dry-run]
                            归档 Done 区旧日期组 → sessions/<日期>-todo归档.md
                            (默认保留近 3 天; 任一天有未完成则整天不归档)
  abs lint                   图谱体检 (死链/孤岛/超尺寸/堆积)
  abs rule                   列出 index.md 的 ## Rules 硬规则
  abs rule add "一句话"      追加一条硬规则 (只放违反会丢数据/静默失效级的；展开写概念页)
  abs config [show]          查看使用者姓名 (标记作者用)
  abs config set user <名字> 设置使用者姓名 → ~/.abs/config.json
                             未设置时写操作(todo/log/note)会报错要求先设置
                             临时覆盖: ABS_USER=<名字> abs ...
  abs init [--repair]        建 .brain/ 图谱; 结构不完整时报明细, --repair 只补缺不覆盖
  abs install [--agent <宿主>]   安装 MCP+hook+skill (宿主: claude-code/codex/opencode/pi)
  abs uninstall [--agent <...>]  卸载
  abs update                 升级到最新版并刷新四宿主 hook/skill
  abs --version              显示当前版本
  abs help                   本帮助

注: abs wrapup / abs teardown-check 是 hook 内部命令, 不需手动调用。
`;

/** 子命令级用法（abs <cmd> --help 时打印）。 */
const subUsage = {
  install: [
    'abs install — 把 MCP + hook + skill 安装到 AI 编码宿主',
    '',
    '用法:',
    '  abs install [--agent <宿主>] [--yes] [--no-mcp] [--no-skill]',
    '',
    '参数:',
    '  --agent <宿主>   只装一个宿主: claude-code | codex | opencode | pi',
    '                   (不传则在 TTY 下交互多选; 非 TTY / --yes 时为全部)',
    '  --yes            不交互，直接装全部宿主（自动化用）',
    '  --no-mcp         不注册 MCP server',
    '  --no-skill       不装 skill',
    '',
    '说明:',
    '  • 幂等: 重复安装不会叠加，也不会覆盖宿主的其它配置',
    '  • 配置文件解析失败时会中止（不会清空你的配置）',
    '  • 安装前会备份原配置（同日多份保留最近 5 份）',
    '',
    '例:',
    '  abs install                    交互选择',
    '  abs install --yes              全部宿主',
    '  abs install --agent pi --yes   只装 pi',
  ].join('\n'),
  uninstall: [
    'abs uninstall — 从 AI 编码宿主移除 abs 的 MCP / hook / skill',
    '',
    '用法:',
    '  abs uninstall [--agent <宿主>] [--yes]',
    '',
    '参数:',
    '  --agent <宿主>   只卸一个宿主: claude-code | codex | opencode | pi（不传=全部）',
    '  --yes            不交互',
    '',
    '说明:',
    '  • 只删 abs 自己装的东西，保留你其它的 hook / MCP / 配置字段',
    '  • 配置文件无法解析时会跳过该文件（不覆盖）但仍清理 abs 的脚本与 skill',
  ].join('\n'),
};

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

/** abs config —— 读/写用户设置（目前只有 user）。 */
async function cmdConfig({ sub, value }) {
  const p = userConfigPath();
  if (!sub || sub === 'show' || sub === 'get') {
    const u = await getUser();
    return u
      ? `user = ${u}\n  (来源: ${process.env.ABS_USER ? 'ABS_USER 环境变量' : p})`
      : `user 未设置\n  设置: abs config set user <你的名字>\n  (或临时: ABS_USER=<名字> abs ...)`;
  }
  if (sub === 'set') {
    const [key, ...rest] = String(value || '').split(/\s+/).filter(Boolean);
    if (key !== 'user') throw new Error(`✗ abs config set 目前只支持 user\n  用法: abs config set user <你的名字>`);
    // 名字含空格时不该静默只取第一个词（会被 setUser 的字符校验拒）。
    // 拼接后交给 setUser 统一判定，报错文案里能看到完整输入。
    const name = rest.join(' ');
    if (rest.length > 1) throw new Error(`✗ 姓名不能含空格（收到 "${name}"）\n  @标记无法解析带空格的姓名`);
    const u = await setUser(name);
    // 立即建人页（用户说"两者都行"：配置时建一份，首次写操作也会兜底建）。
    // 没 .brain/ 就跳过 —— 全局配置不该强绑某个项目。
    let extra = '';
    try {
      const { requireBrain } = await import('../src/index.js');
      const { ensurePersonPage } = await import('../src/store.js');
      const root = await requireBrain(process.cwd());
      const r = await ensurePersonPage(root, u);
      if (r === 'created') extra = `\n  人页: .brain/entities/${u}.md (已登记 index)`;
    } catch { /* 无图谱 / 建页失败都不影响配置生效 */ }
    return `✓ user = ${u}\n  → ${p}${extra}`;
  }
  throw new Error(`✗ 未知子命令 "${sub}"\n  用法: abs config [show] / abs config set user <名字>`);
}

async function main() {
  try {
    const opts = parseArgv(rest);
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
          rejectExtra([id, ...rest2].filter(Boolean), 'abs todo [--full]');
          console.log(await cmdShow({ dir: opts.dir, view: 'todo', full: opts.full }));
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
        rejectExtra(rest2, `abs todo ${sub} <id>${action === 'done' ? ' [--as 落地|否决|仅方案]' : ' --note "…"'}`);
        if (!id) throw new Error(`✗ 缺 <id>\n  用法: abs todo ${sub} <id>${action === 'done' ? ' [--as 落地|否决|仅方案]' : ' --note "…"'}`);
        console.log(await cmdTask({ dir: opts.dir, action, id, section: opts.section, note: opts.note, as: opts.as }));
        break;
      }
      case 'note': {
        console.log(await cmdNote({ dir: opts.dir, text: opts._.join(' '), tags: opts.tags }));
        break;
      }
      case 'install':
      case 'uninstall': {
        // 子命令级 --help: 打印用法后直接返回。
        // 坑(INSTALL-HELP-FOOTGUN): 以前 --help 只在顶层命令被识别，跟在 install 后面时
        // 落到 parseArgv 的通用分支，而 install 分支根本不读它 → 用户想看帮助，
        // 实际执行了全量安装（幂等不炸，但确实改了四宿主配置，写了 15 个文件）。
        if (opts.help) { console.log(subUsage[cmd]); break; }
        if (cmd === 'install') {
          await runInstall({ agent: opts.agent, mcp: opts.mcp !== false, skill: opts.skill !== false, yes: opts.yes });
        } else {
          await runUninstall({ agent: opts.agent, yes: opts.yes });
        }
        break;
      }
      case 'config': {
        console.log(await cmdConfig({ sub: opts._[0], value: opts._.slice(1).join(' ') }));
        break;
      }
      case 'rule': {
        // abs rule            列出
        // abs rule add "..."  追加一条
        const [sub, ...rest3] = opts._;
        const isAdd = sub === 'add';
        if (!isAdd && sub) throw new Error(`✗ 未知子命令 "${sub}"\n  用法: abs rule / abs rule add "一句话"`);
        console.log(await cmdRule({ dir: opts.dir, action: isAdd ? 'add' : 'list', text: rest3.join(' ') }));
        break;
      }
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
