// src/brain/maintain.js — 维护类命令：滞留快照、Done 归档、收尾体检。
// 从 store.js 拆出（2026-11-01）：都属"活干完了怎么收"，与看板读写分开。
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { brainPath, requireBrain, absLogDir } from '../index.js';
import { editFile, SKIP } from '../lock.js';
import { appendWrapup } from '../wrapup.js';
import { readIfExists } from '../text.js';
import { getUser } from '../userconfig.js';
import { today, localStamp, archiveDoneInText, upsertArchiveSection, TODO_MAX_LINES } from '../todo.js';
export async function cmdWrapup({ dir }) {
  const root = await requireBrain(dir || process.cwd());
  const snap = await appendWrapup(root);
  // 顺手做 Done 归档。**不引入 cron/定时器**：Stop hook 已经会在会话结束时调
  // `abs wrapup`，直接复用这个触发点（零新基础设施、零新失败面）。
  // 只对「超过保留天数 且 整天都已完成」的日期组动手，平时无动作。
  // 本函数 stdout 会被 hook 追写到 ~/.abs/log/hooks.log → 归档动作自动留痕。
  let arch = '';
  try {
    const a = await cmdTodoArchive({ dir: root, keepDays: 3 });
    if (a.startsWith('✓')) arch = '\n' + a;
  } catch { /* 归档失败不影响快照本身 */ }
  return snap + arch;
}

/**
 * `abs todo archive` —— 把 Done 区里「超过保留天数 且 整天都已完成」的日期组迁到归档页。
 * 规则见 `archiveDoneInText`（① 只留近 N 天 ② 任一天有未完成则整天不归档 ③ 归档成一个文件
 * 并在 Done 区尾部 `### 归档` 记 `- [[slug]] 完成任务 N 条`）。
 * 幂等：同日重跑 = 追写到同一归档页 + 就地更新标记行。
 */
export async function cmdTodoArchive({ dir, keepDays = 3, dryRun = false } = {}) {
  let root;
  try { root = await requireBrain(dir || process.cwd()); } catch { return '未找到 .brain/ 图谱。先在项目根运行: abs init'; }
  // 坑（2026-10-05 实测）：原写法 `Math.max(1, Number(keepDays) || 3)` 有两个问题 ——
  //   ① JS falsy 陷阱：`0 || 3` 得 3，于是 `--keep-days 0` 被当成"没传值"，静默变成
  //      保留 3 天（用户以为归档了全部，实际一条没动，且输出还理直气壮说"保留近 3 天"）。
  //   ② `Math.max(1, ...)` 会静默把 0 抬成 1 —— 即使修好 ①，用户也不知道自己被改了。
  // 改为：显式校验 + 明确报错。宁可让用户改参数，也不静默改写他的意图。
  const rawDays = Number(keepDays);
  if (!Number.isFinite(rawDays) || rawDays < 1 || !Number.isInteger(rawDays)) {
    return `✗ --keep-days 需为 ≥1 的整数（收到 "${keepDays}"）\n`
      + '  下限 1 天是为了不误删今天刚完成的记录；要清空 Done 请先确认后手动编辑 todo.md。';
  }
  const days = rawDays;
  const todoP = brainPath(root, 'todo.md');
  const raw = await fs.readFile(todoP, 'utf8').catch(() => '');
  if (!raw.trim()) return '（todo.md 为空）';

  const plan = archiveDoneInText(raw, { keepDays: days, from: today(), maxLines: TODO_MAX_LINES });
  const why = plan.skipped.length
    ? `\n  跳过: ${plan.skipped.map((s) => `${s.date}（${s.reason}）`).join('；')}`
    : '';
  if (!plan.archived.length) return `（无可归档：保留近 ${days} 天）${why}`;
  const brief = plan.archived.map((g) => `${g.date}(${g.count})`).join(' ');
  if (dryRun) {
    return `[dry-run] 将归档 ${plan.archived.length} 天 / ${plan.count} 条（每天一个文件）\n  ${brief}${why}`;
  }

  // 1) todo.md：锁内重算（拿最新内容，避免与并发 done 互相覆盖），
  //    todo 是权威 —— 会话页/ index 都跟随它，不反向。
  //    先写 todo 再写会话页：todo 写失败（闸门拒绝/SKIP）时会话页不写，
  //    避免「会话页已写、看板没动」的两边不一致（原顺序相反，且会话页裸写绕过锁）。
  let archivedFinal = [];
  await editFile(todoP, (cur) => {
    // 坑（2026-10-05 实测抓到）: 这里漏传 maxLines → 锁内重算的 archived 为空 →
    // 返回 SKIP → 磁盘上的 todo.md 一个字没动（而 sessions/ 归档页已经写了，
    // 两边不一致）。**同参数的每个调用点都要一起改**。
    const p2 = archiveDoneInText(cur ?? '', { keepDays: days, from: today(), maxLines: TODO_MAX_LINES });
    if (!p2.archived.length) return SKIP;
    archivedFinal = p2.archived;   // 锁内算出的权威清单，后续写会话页/index 用它
    return { text: p2.text };
  });
  if (!archivedFinal.length) {
    return `（todo 锁内重算无归档项，已跳过）${why}`;
  }

  // 2) 归档目标 = 当天的会话快照文件（log-<日期>.md），写进其「任务归档」段。
  //    为何合一（2026-09-15 用户定）: 归档与会话快照是**同一天的记录**，分两个文件查着要开两处。
  //    边界: ① 文件不存在→建只有归档段的页（那天可能没写快照）
  //          ② 文件已存在（含 AI 手写快照）→ 只替换归档段，段外逐字保留
  //    （硬规则「已存在的人工内容一律不覆盖」由 upsertArchiveSection 保证）。
  //    走 editFile 锁（2026-11-03 审查修复）：append 语义必须与 setMemo 同一路数，
  //    裸 readFile+tmp+rename 会让并发 archive 互相覆盖，丢一批归档任务行。
  const sessDir = brainPath(root, 'sessions');
  await fs.mkdir(sessDir, { recursive: true });
  for (const g of archivedFinal) {
    const pageP = join(sessDir, `${g.slug}.md`);
    await editFile(pageP, (cur) => ({ text: upsertArchiveSection(cur, g) }));
  }

  // 3) index 登记（每个日期页一行，幂等）
  // 坑（2026-09-15 修）: 原先把归档页登记到 `## Sources` 区 —— 但它们在 sessions/ 里，
  // 旧数据实测就是错位的（09-10/09-12 两条曾键在 Sources 段，人工才发现）。现改登 `## Sessions`。
  const iP = brainPath(root, 'index.md');
  await editFile(iP, (index) => {
    if (!index) return SKIP;
    const missing = archivedFinal.filter((g) => !index.includes(`[[${g.slug}]]`));
    if (!missing.length) return SKIP;
    const sIdx = index.indexOf('## Sessions');
    if (sIdx === -1) return SKIP;
    const after = index.indexOf('\n## ', sIdx + 1);
    const add = missing.map((g) => `- [[${g.slug}]] — ${g.date}（会话快照 + 任务归档）`).join('\n');
    const next = after === -1
      ? `${index.replace(/\s*$/, '')}\n${add}\n`
      : index.slice(0, after) + `\n${add}` + index.slice(after);
    return { text: next };
  });

  const files = archivedFinal.map((g) => `sessions/${g.slug}.md`).join('\n  ');
  const count = archivedFinal.reduce((n, g) => n + g.count, 0);
  const briefFinal = archivedFinal.map((g) => `${g.date}(${g.count})`).join(' ');
  return `✓ 已归档 ${archivedFinal.length} 天 / ${count} 条\n  ${briefFinal}\n  → ${files}${why}`;
}

/**
 * Stop hook 收尾注入判定 —— CC/Co​dex 的"主动推"。
 * 与 pi 插件四条件一致: ①本会话真改过文件 ②有 .brain ③log.md 今日无条目 ④每会话一次。
 * 输出给 shell: `push:<json>` = 注入, 其它 = 放行。JSON 走 stdout 回宿主的 decision:block。
 * 所有异常一律放行(`{}`), 绝不因判定失败而卡住用户会话。
 */
export async function cmdTeardownCheck({ dir, payload }) {
  try {
    let ev = {};
    try { ev = JSON.parse(payload || '{}'); } catch { ev = {}; }

    // 条件①: 本会话真改过文件。CC 的 Stop payload 不带工具足迹,
    // 故以 transcript_path 为准; 取不到就退化为"本项目今日是否已有产物"判断。
    const transcript = ev.transcript_path || ev.transcriptPath;
    if (transcript) {
      const txt = await readIfExists(transcript);
      const wrote = /"(Write|Edit|MultiEdit|NotebookEdit)"/.test(txt);
      if (!wrote) return '{}'; // 纯只读会话不打扰
    }

    // 条件②: 本项目有 .brain
    const dir0 = dir || ev.cwd || process.cwd();
    let root;
    try { root = await requireBrain(dir0); } catch { return '{}'; }

    // 条件③: log.md 今日尚无【工作成果】条目(条目头 '## [YYYY-MM-DD HH:MM] [[name]] dev |')。
    // 坑(2026-09-13 实测, pi 侧先修): `abs note` 也写 log.md(kind=note)，
    // 旧判据只看「今天有没有行」会把「沉淀了一条经验」误判成「今天已收尾」→ 整天不再提醒。
    // 三宿主(pi/CC/op​encode)判据必须一致 —— 见 [[hook-throttle-alignment]]。
    const logTxt = await readIfExists(brainPath(root, 'log.md'));
    const stamp = localStamp();            // 'YYYY-MM-DD HH:MM'
    const day = stamp.slice(0, 10);
    if (new RegExp('^## \\[' + day + ' \\d{2}:\\d{2}\\] (?:\\[\\[[^\\]]+\\]\\] )?dev \\|', 'm').test(logTxt)) return '{}';

    // 条件④: 每会话一次。
    // 双保险, 因为官方 stop_hook_active 有已知
    // 不传播 bug(claude-code#54360): 同一 turn 内重复 fire 时它仍是 false。
    // ① 官方契约: stop_hook_active=true = 本次 Stop 已是注入后的产物, 绝不再推(否则死循环)
    if (ev.stop_hook_active === true) return '{}';
    // ② 己方节流: 以 session_id 落 mark。缺 id 时退化为按项目+日期节流,
    //    绝不"无节流"——否则一旦宿主张不到 id, decision:block 就会无限自激。
    const sid = String(ev.session_id || ev.sessionId || '').replace(/[^\w-]/g, '');
    // 兼底 key 只用【项目名】而非 full path。
    // 坑(2026-09-16 实测): 原用 root.replace(/[^\w]/g,'_') 会把 cwd 的 tmp 路径
    //   (/var/folders/..._tmpXXXX) 也编进去 —— 而每个会话的 tmp 目录都不同,
    //   于是"按项目+日期节流"根本没生效, 每次都新 key → ~/.abs/log/ 堆了 361 个 mark。
    const projKey = root.split('/').filter(Boolean).pop() || 'unknown';
    const key = sid || 'nosession-' + day + '-' + projKey;
    const mark = join(absLogDir(), `teardown-${key}.mark`);
    try {
      await fs.access(mark);
      return '{}'; // 本会话(或本项目今日)已推过
    } catch { /* 未推过 */ }
    await fs.mkdir(dirname(mark), { recursive: true });
    await fs.writeFile(mark, stamp).catch(() => {});
    // mark 只增不减会堆成垃圾(实测 361 个)。只清【带旧日期】的 mark ——
    // 节流只在当天有意义(判据是 day), 旧日期 mark 不可能再命中;
    // 无日期的会话 mark(teardown-<sid>.mark)保留, 它靠自身存在与否判重。
    try {
      for (const f of await fs.readdir(absLogDir())) {
        const m = f.match(/^teardown-.*-(\d{4}-\d{2}-\d{2})-.*\.mark$/);
        if (m && m[1] !== day) await fs.unlink(join(absLogDir(), f)).catch(() => {});
      }
    } catch { /* 清理失败不影响主流程 */ }

    // 会话总结托底：算出「还有几场会话没总结」。
    // 只给条数不给内容 —— 守「读取侧输出不得随规模增长」；要看明细人自己跑 abs summon。
    // 计算失败一律吞掉：托底提示不能因为它自己算不出来就不提醒。
    let pendingSessions = 0;
    try {
      const { scanProject } = await import('./summon.js');
      const r = await scanProject(root);
      pendingSessions = (r.fresh?.length || 0) + (r.changed?.length || 0);
    } catch { /* 会话目录不存在 / 别的宿主 → 没有这项提示 */ }

    const msg = [
      // 未设姓名时把设置指令插到第0条 —— 否则后续 todo add/log/note 全会被守卫拦下。
    (await getUser() ? [] : [
      '0) 本机尚未设置使用者姓名 —— 先跑 abs config set user <你的名字>，否则 todo/log/note 都会被拦下；',
    ]),
    '[abs] 本会话改过文件，.brain/ 今日无记录。',
      '这条是信息不是命令：该沉淀就沉淀，没有可沉淀的直接回一句「无可沉淀」，不用凑。',
      '需要时：abs todo / abs todo done <id> / abs capture --layer N "..." / abs log "..."',
      ...(pendingSessions ? [`另有 ${pendingSessions} 场历史会话从未总结（明细: abs summon）`] : []),
    ].join('\n');

    // Cl​aude Code Stop hook 契约: {"decision":"block","reason":"..."} = 阻止结束并把 reason 回灌给 agent
    return 'push:' + JSON.stringify({ decision: 'block', reason: msg });
  } catch {
    return '{}'; // 永不阻塞宿主
  }
}

