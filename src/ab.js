/**
 * abs ab —— 对照实验台（搭台 + 判定，不起 agent）。
 *
 * 为何需要它（2026-09-17 实测）：
 *   本仓曾手工做四轮「有 .brain/ vs 无 .brain/」对照实验，每轮搭台 + 判定
 *   都要手工敲几十条命令，且**三次题面泄题**都没被及时发现。没有装置，
 *   每次改动都是盲改 —— 改完不知道好坏。
 *
 * 它做什么（只做能机械化的那部分）：
 *   1. ab init   —— 从当前仓库快照建两组：A 轮（无 .brain/）、B 轮（+ .brain/）
 *   2. ab grade  —— 对两组跑同一个"判定物"，输出对照表
 *   3. ab check  —— 检查题面有没有泄题（本仓踩过三次的真实教训）
 *
 * 它不做什么（诚实边界）：
 *   - **不起 agent**。abs 零 spawn 代码，且要适配 CC/opencode/pi 四种宿主、
 *     处理超时与卡死 —— 那是另一个量级的工程。agent 由人或宿主工具起。
 *   - **不判语义**。"这次改动好不好"仍需人判；它只跑判定物（能红能绿的命令）。
 *
 * 判据必须"跑前定死"：现成的教训是本仓三次泄题、一次事后改判据。
 * 故 init 会生成 判据.md，写死判定命令与通过条件，grade 只按它执行。
 */
import { promises as fs } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { spawn } from 'node:child_process';

/** 实验根目录。放 /tmp 下：不污染仓库，且天然不进 .brain/ 的 recentFiles 扫描。 */
/**
 * 实验根：**每组一个独立顶层目录**（见 armDir 的隔离说明）。
 * 用系统临时根而非某个共享子目录 —— 共享子目录会让 `ls ..` 并列看到两组。
 * 前缀 `absab-` 便于人和其他工具识别这是实验产物、可安全删。
 */
export const AB_ROOT = '/tmp';

/** 分组名。用 A/B 而非"甲/乙"：prompt 里要出现，英文更少歧义。 */
export const ARMS = {
  A: 'A轮',   // 对照组：无 .brain/
  B: 'B轮',   // 实验组：+ .brain/
};

/**
 * 每组一个**随机后缀**的独立目录。
 *
 * 诚实说明：这**不是**安全隔离 —— 同一个文件系统上，任何进程 `ls /tmp` 都能看到两组
 *   （2026-09-17 实测：改成独立目录后，A 组里 `ls ..` 依然并列看到 `absab-x-B`）。
 *   真正起作用的闸门是 prompt 里的边界约束（见 buildArmPrompt）。
 *   随机后缀只负责降低"手滑撞见"的概率，别把它当隔离保证。
 */
export function armDir(expName, arm) {
  // 后缀在进程内稳定（同一实验两次调用返回同一路径）。
  //
  // 2026-09-17 修：原实现 `randSuffix(expName + arm)` 在多数实验名上**两组后缀相同**
  //   （实测 `demo2`/`real1` 都得 `1cy1ch`，仅 `x` 得不同值）。
  //   根因：多项式哈希 `h*31` 下，种子只差末尾一个字符（...A vs ...B）时 h 相差 1，
  //   再 `.slice(0,6)` 截断 → 前 6 位 base36 完全一致。于是"随机后缀降低误撞"
  //   这层在多数实验名上根本没起作用（与注释声称的不符）。
  //   故两份修正：① 扩到 10 位降低截断折损；② 把 arm 混入**末尾**并单独再哈希一轮，
  //   使 A/B 的差异落在高位而非低位。后者是关键的 —— 光扩位治不了低位差异。
  const tag = `absab-${expName}-${arm}-${randSuffix(expName)}${randSuffix(arm + expName)}`;
  return join(AB_ROOT, tag.replace(/[^\w.-]+/g, '_'));
}

/**
 * 由任意种子派生的短后缀：同种子稳定，不同种子不同。
 *
 * 混合手法：先累积，再把 h 的最后一步用位异或反喂一遍（aval­anche），
 * 保证"种子只差一个字符"也能散布到高位 —— 这是 armDir 那个碰撞的根因。
 */
function randSuffix(seed) {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0; // 每步扩散，避免差异全留在低位
  }
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 0x5bd1e995) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  // 10 位 base36 —— 够宽，截断不会把不同种子折到同一串
  return h.toString(36).padStart(8, '0').slice(0, 10);
}

/**
 * 跑一条 shell 命令，拿 stdout/stderr/exit。
 * 不引 execa 之类的依赖 —— 判据就一条命令，node 内置够用。
 */
function run(cmd, cwd) {
  return new Promise((res) => {
    const p = spawn('/bin/sh', ['-c', cmd], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => res({ code, out, err }));
    p.on('error', (e) => res({ code: -1, out: '', err: String(e.message) }));
  });
}

/**
 * 把仓库 HEAD 快照导出到目标目录。
 *
 * 为何用 `git archive HEAD` 而不是 `cp -r`：
 *   工作区可能有未提交的改动（正是"要测的那个改动"），也可能有 node_modules。
 *   要的是**干净的、可复现的基线**。若工作区脏，改动本身会进快照 —— 那会被
 *   两组同时带上，不是我们要控制的变量。故明确取 HEAD，并在 init 时告知脏文件。
 */
async function exportSnapshot(root, dest) {
  await fs.mkdir(dest, { recursive: true });
  const tar = await run('git archive HEAD | tar -x -C ' + JSON.stringify(dest), root);
  if (tar.code !== 0) {
    return { ok: false, err: tar.err || tar.out || `git archive 失败 (exit ${tar.code})` };
  }
  return { ok: true };
}

/** 复制 .brain/ 进 B 轮。A 轮故意不给 —— 这就是全部变量。 */
async function copyBrain(root, dest) {
  const src = join(root, '.brain');
  const dst = join(dest, '.brain');
  try {
    await fs.cp(src, dst, { recursive: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, err: `复制 .brain/ 失败: ${e.message}` };
  }
}

/**
 * 从 A 轮删掉 .brain/。
 *
 * 为何必须显式删（2026-09-17 实测踩到）：
 *   本仓把 `.brain/` **提交进了 git**（42 个文件被跟踪），所以 `git archive HEAD`
 *   会把它一起导出 —— A 轮于是也带着完整图谱，两组变量相同，实验直接失效。
 *   而它不会报错：两组"看起来"都建好了，只有对比目录内容才发现。
 *   这正是本仓「静默失效」那类坑：**机制没生效，但没有任何信号**。
 */
async function stripBrain(dest) {
  const p = join(dest, '.brain');
  await fs.rm(p, { recursive: true, force: true });
  try {
    await fs.access(p);
    return { ok: false, err: `A 轮的 .brain/ 删不掉（仍存在）: ${p}` };
  } catch { /* 期望：不存在 */ }
  return { ok: true };
}

/**
 * 题面泄题检查 —— 本仓三次踩坑的真实教训，把它做成机械检查。
 *
 * 三种泄题形态（都有实测案例）：
 *   ① 明写目标环境    —— "alpine 只有 busybox sh / CI 是 dash"
 *   ② 提示有陷阱      —— "宿主会吞掉 stderr / 不得非零退出"（等于说"这里有静默故障"）
 *   ③ 提示验证入口    —— "现在 main.js 跑不起来"（等于说"去跑 main.js 就知道了"）
 *
 * 它们共性是：**题面替 agent 完成了"想到那个坑"这一步** —— 那测的就不是记忆，是注意力。
 */
export function checkTaskForLeaks(taskText) {
  const t = String(taskText || '');
  const hits = [];
  const rules = [
    { kind: '① 明写目标环境', re: /\b(alpine|busybox|dash|musl|ubuntu|centos|debian)\b/i,
      why: '直接点名运行环境 = 把"要兼容什么"直接告诉它' },
    { kind: '① 明写目标环境', re: /POSIX\s+sh|只[用能]用\s*sh|不要依赖\s*bash/i,
      why: '点名 POSIX/bash 差异 = 直接给出答案' },
    { kind: '② 提示有陷阱', re: /静默(失败|失效)|吞掉\s*(stdout|stderr)|不得非零退出|不许报错/i,
      why: '"会被吞掉/要静默" 会让 agent 去找"什么情况下会错"' },
    { kind: '③ 提示验证入口', re: /跑不起来|报错|崩(溃|了)|无法(运行|启动)|不生效/i,
      why: '说出"跑不起来" = 告诉它去跑一次就能发现，绕过了"要不要验证"的判断' },
    { kind: '② 提示有陷阱', re: /注意|小心|务必|别忘了|切记/i,
      why: '提醒式措辞会把注意力引到某处' },
  ];
  for (const r of rules) {
    const m = t.match(r.re);
    if (m) hits.push({ kind: r.kind, hit: m[0], why: r.why });
  }
  return hits;
}

/**
 * `abs ab init` —— 搭台。
 *
 * @param {{name?:string, root?:string, taskPath:string}} o
 */
export async function cmdAbInit({ name, root, taskPath, force }) {
  const r = resolve(root || process.cwd());
  const expName = name || `exp-${new Date().toISOString().slice(0, 10)}`;
  const out = [];

  // 前置校验：r 必须是【含 .brain/ 的 git 仓库】。
  // 不校验的话，从别处（如实验组目录）跑会静默把 cwd 当仓库根，
  // 然后在"复制 .brain/ 失败"上报一句误导性错误 —— 真因是 cwd 不对（2026-09-17 实测）。
  // 本仓硬规则「证据到手前不给结论」的同构：先确认自己在哪，再动手。
  const isRepo = await run('git rev-parse --is-inside-work-tree', r);
  if (isRepo.code !== 0 || !isRepo.out.trim().startsWith('true')) {
    return [
      `✗ ${r}`,
      '  不是一个 git 仓库 —— ab 需要仓库根（含 .brain/ 的那个目录）。',
      `  当前目录不像：请 cd 到仓库根，或用 --dir <仓库根> 指定。`,
    ].join('\n');
  }
  const hasBrainRepo = await (async () => {
    try { await fs.access(join(r, '.brain')); return true; } catch { return false; }
  })();
  if (!hasBrainRepo) {
    return [
      `✗ ${r} 里没有 .brain/ —— 没有图谱就无从"给 B 组图谱、不给 A 组"。`,
      `  若该仓库的图谱在子目录，请用 --dir 指向它。`,
    ].join('\n');
  }

  // 题面是实验的灵魂：读它、查泄题
  let taskText;
  try {
    taskText = await fs.readFile(resolve(taskPath), 'utf8');
  } catch (e) {
    return `✗ 读不到题面 ${taskPath}: ${e.message}`;
  }

  // 脏工作区警告：快照取 HEAD，未提交改动不会进去
  const st = await run('git status --porcelain', r);
  if (st.code === 0 && st.out.trim()) {
    const n = st.out.trim().split('\n').length;
    out.push(`⚠ 工作区有 ${n} 个未提交改动 —— 快照取的是 HEAD，这些改动**不会**进实验。`);
    out.push('  （若你要测的就是这个改动，先 commit；否则两组都拿到同一份旧代码，测不出东西）');
    out.push('');
  }

  // 覆盖守卫：同名实验已存在时，除非显式 --force，否则拒绝重建。
  //
  // 为何需要（2026-09-17 实测事故）：agent 还在台子里干活时我重跑了 init，
  // 旧目录被 `rm -rf` 抹掉 —— 那个 agent 没报错，而是**自己找了个附近目录继续改**
  // （顺带看到了我后建的另一组，污染了它自己）。实验数据因此报废，而且没有任何信号。
  // 「静默失效」类：毁掉别人的工作目录不报错，只是让结果变得不可信。
  if (!force) {
    const existing = [];
    for (const arm of ['A', 'B']) {
      try { await fs.access(armDir(expName, arm)); existing.push(armDir(expName, arm)); }
      catch { /* 不存在 */ }
    }
    if (existing.length) {
      return [
        `✗ 实验 ${expName} 已存在，拒绝覆盖（防抹掉正在跑的实验）:`,
        ...existing.map((p) => `    ${p}`),
        '',
        '  · 确认两组 agent 都已停、也不要这份数据了 → 加 --force 重建',
        '  · 想保留旧的 → 换个 --name',
      ].join('\n');
    }
  }

  for (const arm of ['A', 'B']) {
    const dest = armDir(expName, arm);
    await fs.rm(dest, { recursive: true, force: true });
    const snap = await exportSnapshot(r, dest);
    if (!snap.ok) return `✗ 导出快照失败: ${snap.err}`;
    // 快照可能自带 .brain/（本仓把它提交进了 git）—— 两组变量必须只差这一份
    if (arm === 'A') {
      const st = await stripBrain(dest);
      if (!st.ok) return `✗ ${st.err}`;
    } else {
      const cp = await copyBrain(r, dest);
      if (!cp.ok) return `✗ ${cp.err}`;
    }
    // 题面是唯一两组逐字相同的东西 —— 先落盘，避免后续误改其中一份
    await fs.writeFile(join(dest, 'TASK.md'), taskText, 'utf8');
  }

  out.push(`✓ 实验台已建（两组隔离，互不可见）:`);
  out.push(`  ${armDir(expName, 'A')}  ← 对照：仓库快照，**无** .brain/`);
  out.push(`  ${armDir(expName, 'B')}  ← 实验：同快照 + .brain/`);
  out.push('  隔离原因：并排放会让实验组 diff 到对照组的答案，绕过 .brain/（实测事故）');
  out.push('');

  // 核心假设自检：两组必须**只差** .brain/。不检的话，本仓"把 .brain 提交进 git"
  // 会让 A 轮也带图谱 —— 实验失效但零信号（实测踩过）。
  const chk = await verifyArms(expName);
  if (!chk.ok) {
    out.push(`⛔ 分组自检失败 —— 实验无效，别往下跑:`);
    for (const m of chk.problems) out.push(`  · ${m}`);
    return out.join('\n');
  }
  out.push(`✓ 分组自检通过：两组只差 .brain/（A 无、B 有 ${chk.bPages} 页）`);

  // 起点可比性：两组快照都取 HEAD —— 若 HEAD 里没有本次要测的改动，
  // 则两组拿到同一份旧代码，差值必然 0，而实验会"看着跑完"。
  // 前面那条脏工作区警告是**提示性**的（会随输出滚走）；这里把它做成**自检项**，
  // 与其它自检并列，目的是让人在"看一眼自检块"时就能看到它。
  // 不直接拒跑：测试未提交改动是合法用法（手动 cp 进两组），故只报不断。
  const dirty = await checkWorktreeSnapshot(r);
  if (dirty.uncommitted) {
    out.push(
      `⚠ 起点可比性: 工作区有 ${dirty.n} 处未提交改动，快照取 HEAD —— ` +
      `若本次要测的就是这些改动，两组都拿不到它们，测出来必然无差异。`,
    );
    out.push('  （要测未提交改动：先 commit；或手工把改动拷进两组目录）');
  }

  const leaks = checkTaskForLeaks(taskText);
  if (leaks.length) {
    out.push(`⛔ 题面泄题 ${leaks.length} 处 —— 本仓三次实验都栽在这，改了再跑:`);
    for (const l of leaks) out.push(`  · ${l.kind}: 命中「${l.hit}」 → ${l.why}`);
    out.push('  判据: 题面替 agent 完成了"想到那个坑"这一步 → 测的是注意力，不是记忆。');
  } else {
    out.push('✓ 题面未发现泄题迹象（三类：明写环境 / 提示陷阱 / 提示验证入口）。');
  }
  out.push('');
  out.push('下一步（用 abs ab prompt 取现成的 prompt，别自己手写 —— 手写会漏边界约束）:');
  out.push(`  1. 两个 agent 的 cwd 与 prompt 分别对应:`);
  out.push(`     对照 A: abs ab prompt ${expName} A   →  cwd ${armDir(expName, 'A')}`);
  out.push(`     实验 B: abs ab prompt ${expName} B   →  cwd ${armDir(expName, 'B')}`);
  out.push(`  2. 两组都完成后跑: abs ab grade --name ${expName} --cmd "<判定命令>"`);
  return out.join('\n');
}

/**
 * `abs ab prompt <实验名> <A|B>` —— 生成该组该用的 agent prompt。
 *
 * 为何要有这条命令（2026-09-17 实测事故）：
 *   早先我手工写 prompt 时只说了"在 <目录> 工作"，没给边界约束。
 *   B 组 agent 于是 `ls ..`、发现并排的对照组，`diff` 拿到答案后**拒绝交付**，
 *   并指出"这不是对 .brain/ 的诚实测量"。它没错 —— 是我的 prompt 没设边界。
 *
 * 关键认识：**路径隔离做不到**。任意两组都在同一个文件系统上，
 *   `ls /`、`find /tmp` 总能看到对方。只靠改名/挪位置是安全剧场。
 *   所以隔离改为"约束 + 低可见度"两层：
 *     · prompt 里**显式**写明"只看本目录、不要去探索父目录或同层目录"
 *     · 目录名随机化，让误撞概率接近零
 *   前者是真正的闸门（agent 会遵守明确约束），后者只是降低手滑几率。
 *
 * 2026-09-17 第二次事故（更重）—— 只约束"读"不够，**必须也约束"写"**：
 *   B 组 agent 为了满足题面的"改完让它真正生效"，去写**用户真实的**
 *   `~/.abs/hooks/<宿主>/abs-*.sh`（7 个文件），绕过了工作目录。
 *   它甚至有理有据地解释了为什么这么干（"比 abs install 风险小"）——
 *   它没意识到"写用户 home"本身就超出任务范围。
 *
 *   根因不是 agent 不守规矩，是**任务需求在推着它越界**：
 *   "让它生效"对 hook 而言天然意味着"写宿主落点"。
 *   故边界段必须显式禁止写工作目录之外，并给出替代做法（写明操作、不执行）。
 *
 * 注意：**边界约束不算泄题**。它没透露任何答案，只是划定工作范围 ——
 *   对照组和实验组拿到的是同一句话，对称，不破坏对照。
 */
export function buildArmPrompt(expName, arm, workdir) {
  const lines = [
    `你的工作目录是 ${workdir}/。`,
    '',
    '读该目录下的 TASK.md，按需求完成。所有产物写在该目录内。',
    '',
    '**工作边界（重要，必须遵守）**：',
    '1. 只在上面这个目录里工作。不要去列、读、或 diff 父目录、兄弟目录或 /tmp 下的其他目录。',
    '2. **不要写这个目录之外的任何文件。** 尤其不要改 $HOME 下的任何东西',
    '   （`~/.abs/`、`~/.claude/`、`~/.config/`、`~/.codex/`、`~/.pi/` 等都不许写）。',
    '   这个环境属于别人，你的改动会破坏它。',
    '3. 若任务要求"让它真正生效"而生效需要写本目录之外（例如装到宿主落点），',
    '   **不要真的执行**：把它作为「要执行的操作」写在汇报里即可，由人来做。',
    '4. 你需要的一切都在这个目录里。',
    '',
  ];
  // 两组唯一允许的差异 —— 且必须是**整段对称**的（空行数也要对齐），
  // 否则"差异不只来自 .brain/"这条前提就不成立。曾因空行多一个而破坏对称。
  if (arm === 'B') {
    lines.push('该目录下另有 `.brain/` 目录，是本项目的知识图谱，动手前建议先看看。', '');
  }
  lines.push('完成后简要汇报：改了什么、做了哪些操作、为什么认为改动已经生效。');
  return lines.join('\n');
}

/** 生成该组目录的 prompt（内部用；目录由 armDir 决定）。 */
export function armPromptFor(expName, arm) {
  return buildArmPrompt(expName, arm, armDir(expName, arm));
}

/**
 * `abs ab prompt <实验名> <A|B>` —— 打印该组该用的 prompt。
 * 目的是**别让调用方手写**：手写极容易漏掉边界约束，而漏了就会重演
 * "实验组 ls .. 发现对照组"那次事故。
 */
export async function cmdAbPrompt({ name, arm }) {
  if (!name || !['A', 'B'].includes(arm)) return '用法: abs ab prompt <实验名> <A|B>';
  const dir = armDir(name, arm);
  try { await fs.access(dir); } catch { return `✗ 没有实验 ${name} 的 ${arm} 组（先 abs ab init）`; }
  return armPromptFor(name, arm);
}

/**
 * `abs ab grade` —— 判定 + 出对照表。
 *
 * 判定物来源（按优先级）：
 *   1. 实验目录下的 `判据.sh` —— 若存在，对每个组目录跑一次
 *   2. 否则只看两组目录的差异 + 提示手工判定
 *
 * 刻意不自动"读 agent 汇报打分"：那需要语义判断，机器判会引入新的不可信层。
 * 本仓教训是"证据到手前不给结论" —— 机器给不出语义结论，就不假装给。
 */
export async function cmdAbGrade({ name, cmd }) {
  if (!name) return '用法: abs ab grade --name <实验名> [--cmd "判定命令"]';
  // 两组各有独立根（隔离），故"实验存在"= 至少一组目录在
  const anyArm = await (async () => {
    for (const arm of ['A', 'B']) {
      try { await fs.access(armDir(name, arm)); return true; } catch { /* 下一组 */ }
    }
    return false;
  })();
  if (!anyArm) return `✗ 没有实验 ${name}（先 abs ab init）`;

  const rows = [];
  for (const arm of ['A', 'B']) {    const dir = armDir(name, arm);
    let exists = true;
    try { await fs.access(dir); } catch { exists = false; }
    if (!exists) { rows.push({ arm, dir, state: '缺失' }); continue; }

    if (cmd) {
      const r = await run(cmd, dir);
      rows.push({
        arm, dir,
        state: r.code === 0 ? 'PASS' : 'FAIL',
        code: r.code,
        out: (r.out || r.err || '').trim().split('\n').slice(0, 4).join('\n'),
      });
    } else {
      rows.push({ arm, dir, state: '未判定' });
    }
  }

  const out = [`# 实验对照: ${name}`, ''];
  for (const r of rows) {
    out.push(`## ${ARMS[r.arm]}  ${r.state}${r.code !== undefined ? ` (exit ${r.code})` : ''}`);
    out.push(`   ${r.dir}`);
    if (r.out) out.push(r.out.split('\n').map((l) => `   ${l}`).join('\n'));
    out.push('');
  }

  if (!cmd) {
    out.push('未给 --cmd：本工具只搭台与跑判定物，不替你做语义判断。');
    out.push('  · 若这次实验能写成一条命令: abs ab grade --name ' + name + ' --cmd "<命令>"');
    out.push('  · 否则按 判据.md 手工对照两组汇报（判据必须跑前定死）');
  } else {
    // 只陈述事实，不下"哪组更好"的结论 —— 单次 n=1，说因果是过度推断
    const pass = rows.filter((r) => r.state === 'PASS').length;
    const fail = rows.filter((r) => r.state === 'FAIL').length;
    out.push(`## 事实`);
    out.push(`   A/B 两组: ${pass} pass, ${fail} fail`);
    if (pass === 1 && fail === 1) {
      out.push('   差异存在 —— 但 n=1，不足以成规律。要下结论请重复多轮。');
    } else if (pass === fail && pass > 0) {
      out.push('   两组同结果 = 这次没测出差异。先查题面有没有泄题（abs ab init 会报）。');
      out.push('   再查判据是不是在基线就已绿（两组同 PASS 时最常见的原因）。');
    }
    // 尺子自检：命令是否跑得起来（本仓踩过 exit 127 被当 FAIL 计分）
    const broken = rows.filter((r) => r.code === 127 || r.code === 126);
    if (broken.length) {
      out.push('');
      out.push(`⛔ 有组的判据跑不起来（exit ${broken.map((r) => r.code).join('/')}）:`);
      out.push(`   ${broken.map((r) => ARMS[r.arm]).join(', ')} —— 这不是"作品错了"，是尺子坏了。`);
      out.push('   先修判据命令（路径/可执行位/依赖），别把 exit 127 当 FAIL 计入对照。');
    }
  }
  return out.join('\n');
}

/**
 * 自检：两组是否**只差 .brain/**。
 *
 * 本仓硬规则「判等价必须真跑到，且跑破坏验证」的同构应用 ——
 * 不真去数两边的文件，就不知道 A 轮是不是也带着图谱。
 * 实测踩过：`.brain/` 被提交进 git → A 轮自带 42 个文件 → 两组无差异 → 零信号。
 */
export async function verifyArms(expName) {
  const problems = [];
  const aDir = armDir(expName, 'A');
  const bDir = armDir(expName, 'B');

  const hasBrain = async (d) => {
    try { await fs.access(join(d, '.brain')); return true; } catch { return false; }
  };
  const aHas = await hasBrain(aDir);
  const bHas = await hasBrain(bDir);
  if (aHas) problems.push(`A 轮不该有 .brain/（对照组的定义就是没有它）`);
  if (!bHas) problems.push(`B 轮必须有 .brain/（实验组少了唯一变量）`);

  // 隔离自检：两组的父目录不能是同一个 —— 否则实验组一 ls 就看到对照组（实测事故）。
  // 判据：某一组的路径不能落在另一组的目录树里。
  const inside = (child, parent) =>
    child === parent || child.startsWith(parent.endsWith('/') ? parent : parent + '/');
  if (inside(aDir, bDir) || inside(bDir, aDir)) {
    problems.push(`两组目录互相可见（一组在另一组路径下）—— 实验组能读到对照组的答案`);
  }

  // 数 B 轮图谱页数 —— 0 页的图谱等于没给
  let bPages = 0;
  if (bHas) {
    for (const d of ['concepts', 'entities', 'syntheses']) {
      try {
        const fs2 = await fs.readdir(join(bDir, '.brain', d));
        bPages += fs2.filter((f) => f.endsWith('.md') && !f.startsWith('_')).length;
      } catch { /* 目录不存在 = 0 */ }
    }
    if (bPages === 0) problems.push(`B 轮的 .brain/ 里一页知识都没有（图谱空 = 等于没给）`);
  }

  // 题面必须逐字相同 —— 两份不同的题面就不叫对照实验了
  try {
    const [ta, tb] = await Promise.all([
      fs.readFile(join(aDir, 'TASK.md'), 'utf8'),
      fs.readFile(join(bDir, 'TASK.md'), 'utf8'),
    ]);
    if (ta !== tb) problems.push(`两组 TASK.md 不一致（题面必须逐字相同）`);
  } catch {
    problems.push(`两组 TASK.md 缺一个 —— 题面没落盘`);
  }

  // 判据可比性自检（2026-09-17 补，三次设计错误的共同病根）
  const crit = await checkCriterionComparable(expName);
  problems.push(...crit.problems);

  return { ok: problems.length === 0, problems, bPages, crit };
}

/**
 * 判据可比性自检 —— **两组能不能用同一把尺子量**。
 *
 * 为何单独加这道（2026-09-17 实测）：本仓前面三道自检查的都是
 *   「两组是否干净隔离」（只差 .brain/、目录互不可见、题面逐字相同）。
 *   但实验失败的真实病根不止隔离 —— 还有**判据在两组上不等价**：
 *     · 判据命令在某一组跑不起来（exit 127/126 = 命令不存在/不可执行）
 *     · 判据在**起点就已满足**：两组未改动时都 PASS → 测不出任何改动
 *   这两类都不会报错，只会让结论看着成立。
 *
 * 怎么查：若实验目录有 `判据.sh`，在两组**未改动的基线状态**各跑一次
 *   （即 init 之后、agent 动手之前），报告两组 exit code。
 *   因此本函数在 init 阶段最有价值 —— 那时两组确实都是原始快照。
 *
 * 它不做语义判断：只说"这把尺子在两组上有没有同等可用、起点是否已绿"，
 *   不替人判"这次改动好不好"。
 */
export async function checkCriterionComparable(expName, cmd) {
  const problems = [];
  const detail = [];

  // 判据命令：优先参数，其次实验目录下的 判据.sh
  let useCmd = cmd || '';
  if (!useCmd) {
    for (const arm of ['A', 'B']) {
      try {
        const p = join(armDir(expName, arm), '判据.sh');
        await fs.access(p);
        useCmd = 'sh 判据.sh';
        break;
      } catch { /* 下一组 */ }
    }
  }
  if (!useCmd) {
    detail.push('无判据.sh 也未给判定命令 —— 跳过判据可比性自检（建议补上，否则无从判定）。');
    return { problems, detail, ran: false };
  }

  const results = {};
  for (const arm of ['A', 'B']) {
    const dir = armDir(expName, arm);
    try { await fs.access(dir); } catch { results[arm] = { missing: true }; continue; }
    const r = await run(useCmd, dir);
    results[arm] = { code: r.code, out: (r.out || r.err || '').trim().split('\n')[0] || '' };
  }

  for (const arm of ['A', 'B']) {
    const r = results[arm];
    if (!r || r.missing) continue;
    if (r.code === 127 || r.code === 126) {
      problems.push(
        `${arm} 组的判据跑不起来（exit ${r.code}：命令不存在或不可执行）` +
        ` —— 这一跑不是"作品错了"，是尺子坏了；修判据再跑`,
      );
    }
  }

  // 起点已绿 = 判据测不出改动（两组都 PASS 时最可疑）
  const a = results.A, b = results.B;
  if (a && b && !a.missing && !b.missing && a.code === 0 && b.code === 0) {
    problems.push(
      '判据在两组未改动的基线上**都已通过** —— 这把尺子测不出本次改动，' +
      '两组都会 PASS，差值必然为 0。先确认：判据应该"跑前是红的"。',
    );
  }

  detail.push(`判据命令: ${useCmd}`);
  for (const arm of ['A', 'B']) {
    const r = results[arm];
    if (!r || r.missing) detail.push(`  ${arm}: 目录缺失`);
    else detail.push(`  ${arm}: exit ${r.code}${r.out ? ` — ${r.out}` : ''}`);
  }
  return { problems, detail, ran: true, results };
}

/**
 * 起点可比性：两组快照都取 HEAD，故工作区脏 ≡ 本次改动可能不在快照里。
 *
 * 为何单独抽出来：原来只有一句打印警告（滚过去就没了），且没任何断言。
 * 本仓硬规则「靠提醒才能工作的功能，该删不该补」—— 要么做成自检，要么不要。
 * 故这里做成可断言的返回值，并在 init 自检块里展示。
 */
export async function checkWorktreeSnapshot(repo) {
  const st = await run('git status --porcelain', repo);
  if (st.code !== 0) return { uncommitted: false, n: 0, unknown: true };
  const lines = st.out.trim() ? st.out.trim().split('\n') : [];
  return { uncommitted: lines.length > 0, n: lines.length };
}

/** `abs ab check <题面路径> [--name X]` —— 单独查泄题 + 判据可比性，不建台。 */
export async function cmdAbCheck({ taskPath, name }) {
  let t;
  try { t = await fs.readFile(resolve(taskPath), 'utf8'); }
  catch (e) { return `✗ 读不到 ${taskPath}: ${e.message}`; }
  const leaks = checkTaskForLeaks(t);
  const out = [];
  if (!leaks.length) out.push('✓ 未发现泄题迹象（明写环境 / 提示陷阱 / 提示验证入口 三类都没命中）');
  else {
    out.push(`⛔ 题面泄题 ${leaks.length} 处:`);
    for (const l of leaks) out.push(`  · ${l.kind}: 命中「${l.hit}」 → ${l.why}`);
    out.push('  改了再跑实验 —— 泄题的实验测不出记忆的价值。');
  }

  // 有实验名时顺带查判据可比性（同一把尺子能不能量两组）
  if (name) {
    const crit = await checkCriterionComparable(name);
    out.push('');
    if (crit.problems.length) {
      out.push(`⛔ 判据可比性 ${crit.problems.length} 处:`);
      for (const m of crit.problems) out.push(`  · ${m}`);
    } else if (crit.ran) {
      out.push('✓ 判据可比性通过（两组都能跑、基线未全绿）');
    }
    for (const d of crit.detail) out.push(`  ${d}`);
  }
  return out.join('\n');
}
