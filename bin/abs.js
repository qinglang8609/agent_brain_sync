#!/usr/bin/env node
// bin/abs.js — abs CLI 入口。
// abs <cmd> [args]
// 命令: init / board / status / load / task / install / uninstall / help
import { cmdInit, cmdStatus, cmdLoad, cmdRecall, cmdTask, cmdLog, cmdQuery, cmdLint, cmdNote, cmdConcept, cmdShow, cmdRepair, cmdWrapup, cmdRule, cmdTeardownCheck, cmdTodoArchive, cmdResolve, cmdSupersede, cmdReview } from '../src/store.js';
import { cmdDbRebuild, cmdDbSearch, cmdDbStatus, cmdDbEvolve, addProject } from '../src/brain/db-cmd.js';
import { cmdCapture } from '../src/brain/capture.js';
import { cmdSummon } from '../src/brain/summon-cmd.js';
import { cmdIngest } from '../src/brain/ingest.js';
import { setUser, getUser, userConfigPath } from '../src/userconfig.js';
import { runInstall, runUninstall } from '../src/install.js';
import { existsSync, readFileSync } from 'node:fs';
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

/** 比较两个 x.y.z 版本号：a>b 返回 1，a<b 返回 -1，相等返回 0。
 * 缺位按 0 补（1.2 == 1.2.0）。不引 semver —— 本包版本号只有 x.y.z 一种形态。 */
function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  // 非 x.y.z（如 'unknown'）→ 不判定。注意必须先查 NaN 再补 0：
  // NaN 是 falsy，写成 `pa[i] || 0` 会把 'unknown' 静默当成 0.0.0。
  if ([...pa, ...pb].some(Number.isNaN)) return 0;
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
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
  const cmp = cmpVersion(cur, latest);
  console.log(`当前: ${cur}`);
  console.log(`最新: ${latest}`);
  if (cmp === 0) {
    console.log('已是最新，无需升级。');
    return;
  }
  // 本地比 registry 新 —— 典型场景：开发中从源码装过全局，或在改一个未发布的版本。
  // 此时不能走 npm i -g @latest：那会把本地版**降级**覆盖掉（2026-10-06 实际发生：
  // 源码 1.16.2 被拉回 registry 的 1.16.1）。只比较 `===` 而没有方向判断，就是这个坑。
  if (cmp > 0) {
    console.log('\n本地版本比 registry 上的更新（未发布的开发版？），跳过升级以免被降级。');
    console.log('  想用本地源码覆盖全局：npm i -g ' + ABS_DIR);
    console.log('  想把它正式发布：      npm publish（在源码目录，发布后 update 即恢复正常）');
    return;
  }
  console.log(`\n升级 ${cur} → ${latest} …`);
  const r = await runCmd('npm', ['i', '-g', '@fanchao8609/agent_brain_sync@latest']);
  if (r === null) {
    console.error('升级失败（网络/代理/权限）。手动：npm i -g @fanchao8609/agent_brain_sync@latest');
    process.exit(1);
  }
  console.log(r);
  // ★ 重装宿主必须交给**刚装好的那份新代码**去做，不能用本进程（2026-11-07 实报）。
  //
  // 病根：本进程是旧版 bin/abs.js，通过 import 加载的也是**旧版 src/install.js**。
  //   旧 install.js 里的 stableBinPath() 用 process.execPath 推导全局包路径，
  //   于是 hook 模板里的 @@ABS_BIN@@ 被烧成**旧副本**的路径，模板快照也是旧的。
  //   结果：npm 已升到新版（npm ls -g 显示 1.28.0），但 ~/.pi/ 里写的还是旧模板，
  //   界面一点没变，而且 hook 从此指向旧副本 —— 下一版继续错。
  //   实测（fxh-mb）：/usr/bin/abs -> /usr/lib/...（1.26.0，PATH 优先）
  //   与 /opt/node.../bin/abs -> /opt/...（1.28.0，npm 的 prefix，不在 PATH）。
  //
  // 修法：升级后用 `npm prefix -g` 算出新包的真实路径，把「刷新宿主」转交给
  //   那个新包的 bin/abs.js 执行（子进程）。它算 stableBinPath 时会指向自己。
  //   找不到新包才退回本进程的 runInstall（至少不比原来差）。
  const freshEntry = await freshInstallEntry();
  console.log('\n刷新四宿主 hook/skill（hook 脚本烧的是绝对路径 + 模板快照，升级后必须重装）…');
  if (freshEntry) {
    if (freshEntry !== resolveBinPath()) console.log(`  用新装的副本执行: ${freshEntry}`);
    // --all：update 的语义是「把升好的版本铺到所有已装宿主」，不能二次弹窗重选。
    //   旧代码调 runInstall({agent: undefined}) 在 TTY 下会弹菜单，回车只装 pi ——
    //   另装过 omp / Claude Code 的机器升级后那几个宿主永远不刷新（2026-11-07 实报）。
    const args = ['install', '--all'];
    if (yes) args.push('--yes');
    const code = await runInherit(process.execPath, [freshEntry, ...args]);
    if (code !== 0) {
      console.error(`\n✗ 刷新宿主失败（退出码 ${code}）。手动重跑：node ${freshEntry} install --all`);
      process.exit(1);
    }
  } else {
    console.log('  ⚠ 未定位到新安装的副本，用当前进程刷新（可能仍是旧模板）');
    await runInstall({ agent: undefined, mcp: true, skill: true, yes: yes !== false });
  }
  console.log('\n完成。重启宿主（pi / omp / opencode / claude-code / codex）后新 hook 生效。');
}

/** 本进程正在跑的那个 bin/abs.js 的绝对路径（用于判断是否需要转交）。 */
function resolveBinPath() {
  try { return resolve(fileURLToPath(import.meta.url)); } catch { return ''; }
}

/**
 * 找出**刚升级好的**那份 bin/abs.js。找不到返回 null。
 *
 * 为何不用 ABS_DIR：那正是本进程所在目录 —— 在「PATH 里的 abs 与 npm prefix 不是同一份」
 * 的机器上它就是旧副本（fxh-mb 实测：PATH 里是 /usr/bin/abs 指向 1.26.0，
 * npm 把 1.28.0 装在 /opt/node.../lib/node_modules）。
 */
async function freshInstallEntry() {
  let pkgName = '';
  try { pkgName = JSON.parse(readFileSync(join(ABS_DIR, 'package.json'), 'utf8')).name || ''; } catch { return null; }
  if (!pkgName) return null;
  // ① npm 自己报告的全局 prefix 最可信 —— 它正是刚 `npm i -g` 写入的位置。
  const prefix = await runCmd('npm', ['prefix', '-g']);
  const cands = [];
  if (prefix) {
    cands.push(join(prefix, 'lib', 'node_modules', pkgName, 'bin', 'abs.js'));
    cands.push(join(prefix, 'node_modules', pkgName, 'bin', 'abs.js'));
  }
  // ② 本进程 node 所在根（nvm 形态与 prefix 一致；跨副本情况靠 ① 兜）
  try { cands.push(join(dirname(dirname(process.execPath)), 'lib', 'node_modules', pkgName, 'bin', 'abs.js')); } catch {}
  for (const c of cands) {
    try { if (existsSync(c)) return c; } catch {}
  }
  return null;
}

/** 跑子进程并把输出直接接到本进程。返回退出码。 */
function runInherit(cmd, args) {
  return new Promise((resolvePromise) => {
    const c = spawn(cmd, args, { stdio: 'inherit' });
    c.on('error', () => resolvePromise(1));
    c.on('close', (code) => resolvePromise(code === null ? 1 : code));
  });
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
  // todo start 用：本会话 id（LLM 自己给，hook 会把当前 sid 摆进 system prompt）。
  // ★ 必须在这声明 —— 未声明的选项会被静默丢掉（本文件自己的注释写过这个坑）。
  'session': { type: 'string' },
  'payload': { type: 'string' },
  'tags': { type: 'string' },
  // db search 用：最多返回几页（亮度排序后的截断）。未声明会被静默吞成 true。
  'limit': { type: 'string' },
  // capture 用：1-7 的层号。未声明会被静默吞成 true。
  'layer': { type: 'string' },
  // summon 用：布尔开关。未声明会被静默吞成 true（--mark 会变成真值即生效，但 --status 同理）。
  'mark': { type: 'boolean' },
  'status': { type: 'boolean' },
  'port': { type: 'string' },
  // note 的触发条件（何时该读这条经验）—— 供 load 的相关页推荐匹配。
  'when': { type: 'string' },
  // note 可选：借本机 CodeGraph 带出「改某符号会影响哪些代码」。
  'impact': { type: 'string' },
  // note 可选：经验类型（fact/pref/constraint/event，对齐 TencentDB L1 四分类）。
  'type': { type: 'string' },
  // review 用：--accept / --reject 各跟一个页名列表（逗号分隔或位置参数）。
  'accept': { type: 'string' },
  'reject': { type: 'string' },
  // concept 骨架用: 不在 FLAG_SPEC 里的 `--title` 会被静默当布尔 true（见 parseArgv 注释），
  // 于是 `--title "一句话"` 的正文会进位置参数 → 必须在这声明。
  'title': { type: 'string' },
  'desc': { type: 'string' },
  'state': { type: 'string' },
  // 勾子项用：第几条（1-based，缺省=最后一条）
  'n': { type: 'string' },
  // log 流水类型：note|dev|concept|ingest（cmdLog 会校枚举，非枚举直接报错）。
  // ★ 漏声明就是真 bug（2026-10-05 本机实测）：不在 FLAG_SPEC 的选项会被静默丢掉，
  //   于是 `abs log "x" --kind note` 全写成默认的 dev，而 cmdLog 的枚举校验看不见它。
  'kind': { type: 'string' },
  'by': { type: 'string' },
  'all': { type: 'boolean' },
  'keep-days': { type: 'string' },
  // db evolve 用：多少天没动且无人链算 stale。未声明会被静默吞成 true（同 keep-days 坑）。
  'stale-days': { type: 'string' },
  'help': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'full': { type: 'boolean' },
  'yes': { type: 'boolean' },
  'repair': { type: 'boolean' },
  'no-mcp': { type: 'boolean' },
  'no-skill': { type: 'boolean' },
  // ingest 用：强制重建已有会话页。
  // ★ 不声明就会被 parseArgs 当布尔 true（见上面 kind 的注释）。
  // （--mark 已在 summon 那里声明过，两家共用，不能重复写 —— no-dupe-keys 会报）
  'force': { type: 'boolean' },
  // ingest 用：--last 取最近一场会话（hook 在 session_shutdown 调，不用给 id）；
  //           --auto 只落真改过文件的会话（纯聊天不落页）。
  // ingest 用：--list 只看「哪些会话没落页」不写入（原 abs summon 的职责）
  'list': { type: 'boolean' },
  'last': { type: 'boolean' },
  'auto': { type: 'boolean' },
  // db search 用：不输出 L1 铁律（查主题时它们是噪音；开工看铁律是 load 的职责）。
  // ★ 不声明会被 parseArgs 当布尔 true —— 见上面 kind 的注释。
  'no-rules': { type: 'boolean' },
};

/** 已被"规范键"接管的 raw flag：不再原样漏出（见 parseArgv 返回处的白名单注释）。 */
const KNOWN_RAW = new Set(['keep-days', 'stale-days', 'dry-run', 'no-mcp', 'no-skill']);

function parseArgv(args) {
  // 坑: parseArgs 会把**任何** `-` 开头的 token 当选项，连正文一起吃：
  // `abs note "-X 是个坑"` → values={X:true,' ':true,是:true,…}，正文全丢（旧手写版只认 `--` 长选项）。
  // 也不能简单地把所有非 `--` token 剔走 —— 那样 `--dir /x` 的值 `/x` 会被误剔。
  // 解法: 先用 tokens 看清每个 token 的 kind，只把「`--` 开头且 name 在 FLAG_SPEC 里」当真选项，
  // 其余（包括 `-x` 与 `--unknown`）一律按原序交回位置参数，复刻旧手写逻辑。
  const { tokens } = parseArgs({
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
    limit: values.limit === undefined ? undefined : Number(values.limit),
    layer: values.layer,
    kind: values.kind,
    mark: !!values.mark,
    status: !!values.status,
    title: values.title,
    desc: values.desc,
    help: !!values.help,
    yes: !!values.yes,
    repair: !!values.repair,
    full: !!values.full,
    keepDays: values['keep-days'],
    staleDays: values['stale-days'],
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
const usage = `abs — 跨会话记忆（.brain/ 图谱）

怎么用：按你要做的事找，不用记命令名。旧名都还能用，会自动提示新名。

【开工】读状态，接上次的活
  abs load                  必跑。Rules + 图谱计数 + 任务板 + 最近流水
  abs recall [词…]          卡住时用：按当前处境推相关页（不给词也行）

【找东西】
  abs search <词>           推荐。亮度排序 + 邻居扩散 + 跨项目
  abs query <词…> [--all]   要字面精确时用：多词 OR，输出更短
  abs resolve <页名…>       有了页名，反查文件路径

【写知识】（三者落点不同，别混）
  abs note "一句话"         随手一句经验 → sources/ 待提炼
  abs concept <slug> --title "…"   要成页 → concepts/（自动带四段骨架）
  abs rule add "一句话"     要约束 → index 的 Rules（≤42 字）

【写任务】
  abs todo                  看板
  abs todo add <id> --note "做什么"
  abs todo note <id> --note "进度"      追加子项
  abs todo done <id> --as 落地|否决|仅方案 [结语]
  abs todo state <id> --note 进行中|讨论中|滞留中|搁置
  abs todo remove <id>      删除（连子项，不可恢复）

【会话】
  abs ingest [--list]       把一场 pi 会话落成结构化页；--list 看还有哪些没落

【维护】
  abs lint                  体检：死链 / 超限 / 待提炼
  abs review                待确认的 draft 页（升 active 或否决）
  abs supersede <页> --by <新页>   标经验已失效（不删文件）
  abs show index|log|status 看完整索引 / 流水 / 概要
  abs db rebuild|status|evolve     重建库 / 库体检 / 进化体检
  abs init [--repair]       建图谱

【其它】
  abs install|uninstall [--agent <宿主>] [--no-mcp] [--no-skill]
  abs update                升级并刷新 hook/skill
  abs config set user <名字>  使用者姓名（写操作需先设置）

旧名（仍可用，会提示新名）：
  index/log/status → show   |  capture → concept  |  db search → search
  summon → ingest --list    |  db add → init

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
    '  --agent <宿主>   只装一个宿主: claude-code | codex | opencode | pi | omp',
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
    '  --agent <宿主>   只卸一个宿主: claude-code | codex | opencode | pi | omp（不传=全部）',
    '  --yes            不交互',
    '',
    '说明:',
    '  • 只删 abs 自己装的东西，保留你其它的 hook / MCP / 配置字段',
    '  • 配置文件无法解析时会跳过该文件（不覆盖）但仍清理 abs 的脚本与 skill',
  ].join('\n'),
  todo: [
    'abs todo — 任务看板（Todo / Done 两区；未完成都带行首状态标记）',
    '',
    '用法:',
    '  abs todo                       看板',
    '  abs todo add <id> [--note "做什么"] [--section 讨论中|滞留中|搁置]',
    '  abs todo rename <旧id> --note "<新id>"   改任务 id（起错名/不可读时）',
    '  abs todo note <id> --note "进度/子项"     追加一条子项（标准 md 缩进列表）',
    '  abs todo child-done <id> [--n N]   勾子项（缺省最后一条）',
    '  abs todo child-undone <id> [--n N] 取消勾',
    '  abs todo memo <id> "随手记（可多句）"  任务笔记 → sessions/，不上看板；无文字=查看',
    '  abs todo state <id> --note 进行中|讨论中|滞留中|搁置',
    '  abs todo remove <id>              删除任务（连子项，不可恢复；只是先不做请用 state 搁置）',
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
    '  abs note "一句话经验" [--tags 坑,docker] [--when "什么时候该读这条"] [--impact 符号名] [--type fact|pref|constraint|event]',
    '',
    '说明:',
    '  • --tags 首个标签建议带类别（坑/技巧/决策…），检索按词 OR 命中',
    '  • --when 供 load 的相关页推荐匹配「何时该读」',
    '  • --impact 借本机 CodeGraph 带出「改该符号会影响哪些代码」（未装则静默跳过）',
    '  • --type 经验分类：fact 事实 / pref 偏好 / constraint 约束 / event 事件（默认不分类）',
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
  recall: [
    'abs recall — 卡住时主动取相关页（不需先想到检索词）',
    '',
    '用法:',
    '  abs recall [词1 词2 …] [--limit N]',
    '',
    '不给词时，从当前处境推：活跃 todo 的关键词 + 最近改过的文件名。',
    '给了词就只用你给的词，不混处境词。',
    '',
    '与 load 的区别: load 只在开工跑一次；recall 随时可跑（卡住/换方向时）。',
    '与 query 的区别: query 枚全图命中；recall 只给按亮度亮的几页。',
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

// 已废弃命令 → 报错（而非静默）。曾用 RENAMED 表做"已改名"提示，
// 2026-10-05 删掉 task/board 两条：未知命令分支本来就报错+退出码 1+打印帮助，
// 别名不提供额外信息，只多一处要维护的文案。

// task/todo 共用的子命令 → 归一化后的 action
const TODO_ACTIONS = {
  add: 'start',
  start: 'start', // add 的别名(老习惯保留)
  note: 'note',
  'child-done': 'child-done', // 勾子项（标准 md 缩进列表项）
  'child-undone': 'child-undone', // 取消勾子项
  memo: 'memo', // 任务随手记：多句/追加/不占看板（无文字时=查看）
  state: 'state', // 改行首状态标记：进行中|讨论中|滞留中|搁置（原地，不搬区）
  rename: 'rename', // 改任务 id：人工起错名、或旧 id 不可读时用
  done: 'done',
  // 删除任务（2026-11-05 用户要求）：连子项一起移除，不可恢复。
  // 与 state=搁置 语义不同 —— 搁置是「先不做，还留在看板上」，删除是「从未登记过」。
  // rm 是别名：用户说「删除」时想敲的通常是 rm/del。
  remove: 'remove',
  rm: 'remove',
  del: 'remove',
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
    // 子命令级 --help: 有用法页的命令在此一处拦截（此前只在 install/uninstall 分支里判,
    // 其余命令的 --help 被忽略 —— 曾出现子命令 --help 直接执行动作、挂住终端）。
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
      // 顶层 search（2026-11-06）：MCP 侧一直叫 abs_search，CLI 却要敲 `db search` —— 名实不符。
      // 现在 CLI 与 MCP 同名，`db search` 保留为别名（转指向这里并提示一次）。
      case 'search': {
        if (opts.help) {
          console.log('abs search — 按亮度检索知识图谱\n\n'
            + '用法: abs search <词> [--limit N] [--full] [--no-rules] [--rules]\n\n'
            + '  亮度排序 + 邻居扩散 + 跨项目（标 [跨项目]）。\n'
            + '  默认省略 L1 铁律（开工时 abs load 会给）；要看加 --rules。\n'
            + '  --full 附正文；--limit 最多几页（默认 8）。\n\n'
            + '与 abs query 的区别：这是详略两档不是重复 ——\n'
            + '  query 给字面 OR 命中的页名+摘要，最省 token；\n'
            + '  search 给亮度与扩散，找「我上次怎么解决 X」更准。');
          break;
        }
        if (!opts._.length) throw new Error('✗ 缺检索词\n  用法: abs search <词> [--limit N] [--full] [--no-rules]');
        // 顶层 search 默认省略铁律（2026-11-06）：它是「查一个主题」的工具，
        // 18 条铁律占输出近一半、每次都是噪音。要看铁律显式 --rules，或跑 abs load。
        // db search 那个别名仍保持旧默认（带铁律），不改变老脚本的行为。
        console.log(await cmdDbSearch({
          query: opts._.join(' '), limit: Number(opts.limit) || 8,
          full: !!opts.full, noRules: !opts.rules, cmdName: 'search',
        }));
        break;
      }
      case 'recall': {
        const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 5;
        console.log(await cmdRecall({ dir: opts.dir, terms: opts._, limit }));
        break;
      }
      // ── 只读视图：统一到 abs show <视图>，旧名保留为别名并提示 ──
      // （2026-11-06 命令面整理：index/log/status 都是「看某个文件的现状」，
      //  三个顶层命令占三个名额却只有一个心智动作 —— 看。合成 show 一个入口。）
      case 'show': {
        const v = opts._[0];
        if (!v) {
          console.log('用法: abs show index|log|status\n  index=完整索引  log=操作流水  status=图谱概要');
          break;
        }
        rejectExtra(opts._.slice(1), 'abs show index|log|status');
        if (v === 'status') console.log(await cmdStatus({ dir: opts.dir }));
        else if (v === 'index' || v === 'log') console.log(await cmdShow({ dir: opts.dir, view: v }));
        else console.log(`✗ 未知视图 "${v}"。可用: index | log | status`);
        break;
      }
      case 'index':
        rejectExtra(opts._, 'abs index');
        console.log('（abs index 已改名 → abs show index）');
        console.log(await cmdShow({ dir: opts.dir, view: 'index' }));
        break;
      case 'log': {
        // 无参=查看 log.md；带参=追加一行 (用户/AI 主动记; hook 生命周期事件走技术日志 hooks.log, 不经这里)
        // ★ log 有双职责，不能并进 show：带参时它是**写**操作。
        //   所以只把「无参查看」这一半指向 show，写的那半保持不变、也不提示改名。
        if (opts._.length) {
          console.log(await cmdLog({ dir: opts.dir, title: opts._.join(' '), kind: opts.kind }));
        } else {
          console.log('（查看流水已改名 → abs show log；abs log "完成 X" 仍是记成果）');
          console.log(await cmdShow({ dir: opts.dir, view: 'log' }));
        }
        break;
      }
      case 'status':
        rejectExtra(opts._, 'abs status');
        console.log('（abs status 已改名 → abs show status）');
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
            `  可用: add / start / note / child-done / child-undone / memo / state / done / archive\n` +
            `  看板: abs todo（不带参数）\n` +
            `  登记任务: abs todo add <id> --note "做什么"`,
          );
        }
        // done 的结语：--note "结语" 或位置参数（`abs todo done X 验证: 全绿`）都收。
        // 坑(2026-09-16 实测): --help 里写了 [结语文字] 但实现只读 --note，
        // 位置参数被 rejectExtra 当多余参数拒掉 —— 文档与实现不一致。
        // memo 同：随手记常是多句带空格，位置参数收全段比 --note 顺手。
        const isDone = action === 'done';
        const isMemo = action === 'memo';
        const usage = `abs todo ${sub} <id>${isDone ? ' [--as 落地|否决|仅方案] [--note "结语"]' : ' --note "…"'}`;
        if (isDone) {
          const note = opts.note || (rest2.length ? rest2.join(' ') : undefined);
          console.log(await cmdTask({ dir: opts.dir, action, id, section: opts.section, note, as: opts.as, session: opts.session }));
          break;
        }
        if (isMemo) {
          // 无文字 = 查看该任务所有随手记
          const note = opts.note || (rest2.length ? rest2.join(' ') : undefined);
          console.log(await cmdTask({ dir: opts.dir, action, id, note, session: opts.session }));
          break;
        }
        // 勾/取消勾子项：只收 <id>（子项位置 = 「某任务的第 N 条」，没有自己的 id）
        if (action === 'child-done' || action === 'child-undone') {
          rejectExtra(rest2, `abs todo ${sub} <id> [--n N]`);
          if (!id) throw new Error(`✗ 缺 <id>\n  用法: abs todo ${sub} <id> [--n N]`);
          const n = opts.n ? Number(opts.n) : undefined;
          if (opts.n && (!Number.isInteger(n) || n < 1)) throw new Error(`✗ --n 要是正整数（收到 "${opts.n}"）`);
          console.log(await cmdTask({ dir: opts.dir, action, id, n }));
          break;
        }
        rejectExtra(rest2, usage);
        if (!id) throw new Error(`✗ 缺 <id>\n  用法: ${usage}`);
        console.log(await cmdTask({ dir: opts.dir, action, id, section: opts.section, note: opts.note, as: opts.as, session: opts.session }));
        break;
      }
      case 'summon': {
        // 别名（2026-11-06）：并进 ingest --list —— 两者是同一件事的两半
        // （summon 说「哪些没落页」，ingest 负责落）。分两个顶层命令只是多记一个词。
        console.log('（abs summon 已改名 → abs ingest --list）');
        console.log(await cmdSummon({ dir: opts.dir, mark: !!opts.mark, full: !!opts.full, status: !!opts.status, limit: Number(opts.limit) || 15 }));
        break;
      }
      case 'ingest': {
        // --list：只看「还有哪些会话没落页」，不写入（原来的 abs summon）
        if (opts.list) {
          console.log(await cmdSummon({ dir: opts.dir, mark: false, full: !!opts.full, status: false, limit: Number(opts.limit) || 15 }));
          break;
        }
        console.log(await cmdIngest({
          dir: opts.dir, file: opts._.join(' '), force: !!opts.force, mark: !!opts.mark,
          last: !!opts.last, auto: !!opts.auto, session: opts.session,
        }));
        break;
      }
      case 'capture': {
        console.log(await cmdCapture({ dir: opts.dir, text: opts._.join(' '), layer: opts.layer, tags: opts.tags, title: opts.title, kind: opts.kind }));
        break;
      }
      case 'note': {
        console.log(await cmdNote({ dir: opts.dir, text: opts._.join(' '), tags: opts.tags, when: opts.when, impact: opts.impact, type: opts.type }));
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
          await runInstall({ agent: opts.agent, all: !!opts.all, mcp: opts.mcp !== false, skill: opts.skill !== false, yes: opts.yes });
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
      case 'db': {
        const sub = opts._[0];
        const rest = opts._.slice(1);
        if (sub === 'rebuild') { console.log(await cmdDbRebuild({ dir: opts.dir })); break; }
        if (sub === 'search') {
          // 别名（2026-11-06）：顶层已改叫 abs search。留着是为了不打断现有习惯与脚本，
          // 但每次提示一次 —— 不提示的话旧名会永远活着，命令面又变宽。
          console.log('（abs db search 已改名 → abs search）');
          console.log(await cmdDbSearch({ query: rest.join(' '), limit: Number(opts.limit) || 8, full: !!opts.full, noRules: !!opts['no-rules'] }));
          break;
        }
        if (sub === 'status') { console.log(await cmdDbStatus()); break; }
        if (sub === 'evolve') { console.log(await cmdDbEvolve({ staleDays: Number(opts.staleDays) || 90 })); break; }
        if (sub === 'add') {
          const r = await addProject(opts.dir || process.cwd());
          console.log(`✓ 已登记项目: ${r}\n  建库: abs db rebuild`);
          break;
        }
        console.log('用法: abs db rebuild | search <词> | status | evolve | add [--dir <项目根>]');
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
      case 'review': {
        // 无 --accept/--reject → 列出全部 draft 页；有则对页名列表执行确认/否决。
        const action = opts.accept ? 'accept' : opts.reject ? 'reject' : '';
        const refs = action === 'accept' ? (opts.accept || '').split(',').map(s => s.trim()).filter(Boolean)
          : action === 'reject' ? (opts.reject || '').split(',').map(s => s.trim()).filter(Boolean)
          : opts._;
        console.log(await cmdReview({ dir: opts.dir, refs, action }));
        break;
      }
      case 'lint': {
        rejectExtra(opts._, 'abs lint');
        console.log(await cmdLint({ dir: opts.dir, all: opts.all }));
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
