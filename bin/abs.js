#!/usr/bin/env node
// bin/abs.js — abs CLI 入口。
// abs <cmd> [args]
// 命令: init / board / status / load / task / install / uninstall / help
import { cmdInit, cmdStatus, cmdLoad, cmdTask, cmdLog, cmdQuery, cmdLint, cmdNote, cmdConcept, cmdShow, cmdRepair, cmdWrapup, cmdRule, cmdTeardownCheck, cmdTodoArchive, cmdResolve, cmdSupersede } from '../src/store.js';
import { cmdAbInit, cmdAbGrade, cmdAbCheck, cmdAbPrompt } from '../src/ab.js';
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
  console.log(`\n完成。重启宿主（pi / opencode / claude-code / codex）后新 hook 生效。`);
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
  'port': { type: 'string' },
  // note 的触发条件（何时该读这条经验）—— 供 load 的相关页推荐匹配。
  'when': { type: 'string' },
  // concept 骨架用: 不在 FLAG_SPEC 里的 `--title` 会被静默当布尔 true（见 parseArgv 注释），
  // 于是 `--title "一句话"` 的正文会进位置参数 → 必须在这声明。
  'title': { type: 'string' },
  'desc': { type: 'string' },
  'state': { type: 'string' },
  'by': { type: 'string' },
  'all': { type: 'boolean' },
  'keep-days': { type: 'string' },
  // ab 用（对照实验台）。必须声明 —— 不在 FLAG_SPEC 的 `--cmd "x"` 会被静默当布尔 true，
  // 正文进位置参数（同 --title 那个坑）。
  'task': { type: 'string' },
  'name': { type: 'string' },
  'cmd': { type: 'string' },
  // ab init: 覆盖已存在的同名实验（默认拒绝，防抹掉正在跑的 agent 工作目录）
  'force': { type: 'boolean' },
  'help': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'full': { type: 'boolean' },
  'yes': { type: 'boolean' },
  'repair': { type: 'boolean' },
  'no-mcp': { type: 'boolean' },
  'no-skill': { type: 'boolean' },
  // serve 用: --no-open 不自动开浏览器（open 命令仅 macOS）。坑: 曾漏声明 → serve 判
  // opts.open !== false 恒真, --no-open 接不上。
  'no-open': { type: 'boolean' },
};

/** 已被"规范键"接管的 raw flag：不再原样漏出（见 parseArgv 返回处的白名单注释）。 */
const KNOWN_RAW = new Set(['keep-days', 'dry-run', 'no-mcp', 'no-skill', 'no-open']);

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
    state: values.state,
    by: values.by,
    all: !!values.all,
    payload: values.payload,
    tags: values.tags,
    title: values.title,
    desc: values.desc,
    help: !!values.help,
    yes: !!values.yes,
    repair: !!values.repair,
    full: !!values.full,
    keepDays: values['keep-days'],
    dryRun: !!values['dry-run'],
    mcp: !values['no-mcp'],
    skill: !values['no-skill'],
    open: !values['no-open'],
  };
  // 未声明的 `--unknown` 静默收下（旧行为：不进位置参数，也不报错）。
  // 这条保留是因为 rejectExtra 只看位置参数 —— 把未知 flag 放进去会改成报错，
  // 那是另一个行为变更，不在本次范围内。
  for (const [k, v] of Object.entries(values)) {
    if (!(k in o) && !KNOWN_RAW.has(k)) o[k] = v;
  }
  return o;
}
const usage = `abs — 跨会话记忆工具（.brain/ 图谱）

常用:
  abs load                          开工先跑: 读状态、接上次的活
  abs todo add X --note "做什么"      登记任务 (done/state/note 管后续)
  abs note "经验一句话"               随手记经验; abs log "完成 X" 记成果
  abs query <词…>                   检索 .brain/; abs todo 看任务板

全部命令 (细节: abs <命令> --help):
  init [--repair]            建图谱 (当前目录)
  load                       开机读状态
  todo                       任务看板 (add/note/state/done/archive)
  index | log | status       索引 / 流水 / 概要
  note <经验> [--tags a,b]   经验暂存 → sources/
  concept <slug> --title …   建概念页骨架
  query <词…> [--all]       检索知识页 (多词 OR)
  resolve <页名…>            反查页面路径
  supersede <页名> [--by 页] 标经验已失效
  lint                       图谱体检 (死链/超限)
  rule [add "一句话"]        硬规则读写
  serve [--port N] [--no-open]  浏览 .brain/ (仅本机; 端口默认自动选)
  install|uninstall [--agent <宿主>] [--no-mcp] [--no-skill]
  update                     升级并刷新 hook/skill
  config [set user <名字>]   使用者姓名 (写操作需先设置)
  --version | help           版本 / 本帮助

注: wrapup / teardown-check 是 hook 内部命令。
`;

/** 子命令级用法（abs <cmd> --help 时打印）。 */
const subUsage = {
  load: [
    'abs load — 开机读状态（Rules 全量 + 图谱计数 + todo 看板 + 最近 log）',
    '',
    '用法:',
    '  abs load [--dir <项目根>]',
    '',
    '说明:',
    '  • 顶部出现「⏳ 上会话滞留」时先收尾再开工',
    '  • 输出是折叠过的；全量明细用 abs todo --full / abs index',
  ].join('\n'),
  init: [
    'abs init — 在当前目录（或 --dir）建 .brain/ 图谱',
    '',
    '用法:',
    '  abs init [--repair] [--dir <项目根>]',
    '',
    '说明:',
    '  • 结构不完整时报明细；--repair 只补缺不覆盖，已有内容一律不动',
  ].join('\n'),
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
  serve: [
    'abs serve — 把 .brain/ 挂成只读网页（左目录树 + 右正文 + [[双链]]跳转）',
    '',
    '用法:',
    '  abs serve [--port N] [--no-open] [--dir <项目根>]',
    '',
    '参数:',
    '  --port N      端口。默认 0 = 自动选空闲端口（多项目可同时开各的）',
    '  --no-open     不自动打开浏览器（open 仅 macOS）',
    '  --dir <路径>  服务别的项目的 .brain/',
    '',
    '说明:',
    '  • 只读、仅绑定 127.0.0.1，外部访问不了',
    '  • 主题/明暗切换在网页右上角；最后一页会记住',
  ].join('\n'),
  todo: [
    'abs todo — 任务看板（Todo / Done 两区；未完成都带行首状态标记）',
    '',
    '用法:',
    '  abs todo                       看板',
    '  abs todo add <id> [--note "做什么"] [--section 讨论中|滞留中]',
    '  abs todo note <id> --note "断点/进度"',
    '  abs todo state <id> --note 进行中|讨论中|滞留中',
    '  abs todo done <id> [--as 落地|否决|仅方案] [结语文字]',
    '  abs todo archive [--keep-days N] [--dry-run]',
    '',
    'done 的结语:',
    '  落地(默认) = 真做成且有验证; 否决 = 评估后不做(含做了又撤); 仅方案 = 只设计过',
    '  结语失真会让下个会话把"想过"当成"做完了" —— 不确定就写清楚',
  ].join('\n'),
  note: [
    'abs note — 经验实时暂存 → sources/（幂等去重；先记后提炼）',
    '',
    '用法:',
    '  abs note "一句话经验" [--tags 坑,docker] [--when "什么时候该读这条"]',
    '',
    '说明:',
    '  • --tags 首个标签建议带类别（坑/技巧/决策…），检索按词 OR 命中',
    '  • --when 供 load 的相关页推荐匹配「何时该读」',
    '  • sources 是暂存区: 提炼成 concept 后应清理',
  ].join('\n'),
  query: [
    'abs query — 全文检索 .brain/ 知识页',
    '',
    '用法:',
    '  abs query <词1> [词2 …] [--all]     多词 OR；命中页按命中数排序',
    '',
    '参数:',
    '  --all    连 superseded(已失效)页一起返回',
  ].join('\n'),
  config: [
    'abs config — 使用者姓名（写操作的作者标记）',
    '',
    '用法:',
    '  abs config                 查看当前姓名',
    '  abs config set user <名字>  设置（未设置时写操作报错要求先设置）',
    '',
    '临时用法: ABS_USER=<名字> abs …',
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
  state: 'state', // 改行首状态标记：进行中|讨论中|滞留中（原地，不搬区）
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
    // 子命令级 --help: 有用法页的命令在此一处拦截（此前只在 install/uninstall 分支里判,
    // 其余命令的 --help 被忽略 —— serve --help 曾直接把服务起起来挂住终端）。
    if (opts.help && subUsage[cmd] && !(cmd === 'todo' && opts._.length)) {
      console.log(subUsage[cmd]);
    } else {
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
      // abs serve —— 把 .brain/ 挂成只读网页（浏览器无法自己列目录，所以必须有服务端）
      case 'serve': {
        rejectExtra(opts._, 'abs serve');
        const { serve } = await import('../src/serve.js');
        const { requireBrain, brainPath } = await import('../src/index.js');
        // 坑(2026-09-16 实测): requireBrain 返回的是【项目根】, .brain/ 在它下面 ——
        // 直接把项目根当服务根会扫到 node_modules。必须走 brainPath()。
        const root = brainPath(await requireBrain(opts.dir || process.cwd()));
        // 默认 0 = 让系统挑空闲端口：固定 7777 第二个项目就起不来了。
        // --port abc 曾静默变 NaN → server listen 报怪错；在此拦下。
        const port = opts.port ? Number(opts.port) : 0;
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          throw new Error(`✗ --port 需为 0-65535 的整数（收到 "${opts.port}"）。0 = 自动选空闲端口`);
        }
        // --no-open 显式声明在 FLAG_SPEC（type:boolean），parseArgv 归一化为 open:false。
        // 坑(2026-09-16 审计#6): 曾判 opts.open !== false 但 FLAG_SPEC 无 open →
        // 条件恒真且 --no-open 接不上（open 命令也仅 macOS）。
        const { url, server } = await serve({ root, port });
        console.log(`📖 abs serve → ${url}`);
        console.log(`   根: ${root}`);
        console.log('   (只读，仅本机可访；Ctrl+C 停止)');
        if (opts.open) runCmd('open', [url]);
        // 不断开进程：服务要活着才有用
        await new Promise(() => {});
        break;
      }
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
            `  可用: add / start / note / state / done / archive\n` +
            `  看板: abs todo（不带参数）\n` +
            `  登记任务: abs todo add <id> --note "做什么"`,
          );
        }
        // done 的结语：--note "结语" 或位置参数（`abs todo done X 验证: 全绿`）都收。
        // 坑(2026-09-16 实测): --help 里写了 [结语文字] 但实现只读 --note，
        // 位置参数被 rejectExtra 当多余参数拒掉 —— 文档与实现不一致。
        const isDone = action === 'done';
        const usage = `abs todo ${sub} <id>${isDone ? ' [--as 落地|否决|仅方案] [--note "结语"]' : ' --note "…"'}`;
        if (isDone) {
          const note = opts.note || (rest2.length ? rest2.join(' ') : undefined);
          console.log(await cmdTask({ dir: opts.dir, action, id, section: opts.section, note, as: opts.as }));
          break;
        }
        rejectExtra(rest2, usage);
        if (!id) throw new Error(`✗ 缺 <id>\n  用法: ${usage}`);
        console.log(await cmdTask({ dir: opts.dir, action, id, section: opts.section, note: opts.note, as: opts.as }));
        break;
      }
      case 'note': {
        console.log(await cmdNote({ dir: opts.dir, text: opts._.join(' '), tags: opts.tags, when: opts.when }));
        break;
      }
      case 'concept': {
        // 建概念页骨架（只给结构，不给内容 —— 判断不自动化）。
        console.log(await cmdConcept({
          dir: opts.dir,
          slug: opts._.join('-'),
          title: opts.title,
          tags: opts.tags,
          desc: opts.desc,
        }));
        break;
      }
      case 'install':
      case 'uninstall': {
        // --help 已在 switch 前统一拦截（subUsage）。
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
        console.log(await cmdQuery({ dir: opts.dir, terms: opts._, includeSuperseded: opts.all }));
        break;
      }
      case 'supersede': {
        console.log(await cmdSupersede({ dir: opts.dir, refs: opts._, by: opts.by }));
        break;
      }
      case 'resolve': {
        console.log(await cmdResolve({ dir: opts.dir, refs: opts._ }));
        break;
      }
      case 'lint': {
        rejectExtra(opts._, 'abs lint');
        console.log(await cmdLint({ dir: opts.dir }));
        break;
      }
      // 对照实验台：搭台 + 判定（不起 agent —— 见 src/ab.js 顶部边界说明）
      case 'ab': {
        const sub = opts._[0];
        if (sub === 'init') {
          rejectExtra(opts._.slice(1), 'abs ab init --task <题面路径> [--name X]');
          if (!opts.task) throw new Error('用法: abs ab init --task <题面路径> [--name X]');
          console.log(await cmdAbInit({ root: opts.dir, name: opts.name, taskPath: opts.task, force: opts.force }));
        } else if (sub === 'grade') {
          rejectExtra(opts._.slice(1), 'abs ab grade --name X [--cmd "判定命令"]');
          console.log(await cmdAbGrade({ name: opts.name, cmd: opts.cmd }));
        } else if (sub === 'check') {
          const p = opts._[1] || opts.task;
          if (!p) throw new Error('用法: abs ab check <题面路径>');
          console.log(await cmdAbCheck({ taskPath: p }));
        } else if (sub === 'prompt') {
          const name = opts.name || opts._[1];
          const arm = (opts._[2] || '').toUpperCase();
          if (!name || !['A', 'B'].includes(arm)) {
            throw new Error('用法: abs ab prompt <实验名> <A|B>');
          }
          console.log(await cmdAbPrompt({ name, arm }));
        } else {
          console.log(
            'abs ab —— 对照实验台（搭台 + 判定，不起 agent）\n\n' +
            '  abs ab init --task <题面路径> [--name X]   建 A/B 两组 + 查题面泄题\n' +
            '  abs ab grade --name X [--cmd "命令"]       对两组跑同一判定物，出对照表\n' +
            '  abs ab check <题面路径>                    只查泄题\n\n' +
            '边界: 它不起 agent（agent 由你或宿主工具起），也不替你做语义判断。',
          );
        }
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
    }
  } catch (e) {
    // 带码的错（AbsError）：首行印 [CODE]，fallback 另起一行。
    // 为何：hook/脚本需要机器可读的分支依据（借 Anneal 的 templateRefusal 惯例）。
    // 无码的错照旧只印 message —— 不能把内部堆栈当错误码泄给使用人。
    if (e && e.code) {
      console.error(`[${e.code}] ${e.message}`);
      if (e.fallback) console.error(`  → ${e.fallback}`);
    } else {
      console.error(String(e && e.message ? e.message : e));
    }
    process.exit(1);
  }
}

main();
