// src/brain/maintain.js — 维护类命令：滞留快照、收尾体检。
// 从 store.js 拆出（2026-11-01）：都属"活干完了怎么收"，与看板读写分开。
// 2026-11-16：`abs todo archive` 随 Done 区不再压缩一并删除（见 src/todo/done.js 开头）。
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { brainPath, requireBrain, absLogDir } from '../index.js';
import { appendWrapup } from '../wrapup.js';
import { readIfExists } from '../text.js';
import { getUser } from '../userconfig.js';
import { localStamp, taskSidOf, parseTaskLine } from '../todo.js';
/** 这段 transcript 里有没有「写文件」的工具调用。
 *
 * 不写死工具名清单：宿主一改名字判据就静默失效（本仓踩过 model_changed → model_select）。
 * 这里只认「工具名里出现写/编辑/补丁类词根」，覆盖 Write/Edit/MultiEdit/NotebookEdit/
 * apply_patch/str_replace 等常见命名；另有兜底：工具入参里出现 file_path/path/content 也算。
 * 需要额外名字时用 `ABS_WRITE_TOOLS="Foo,Bar"` 追加，不用改代码。 */
function looksLikeWrite(txt) {
  const extra = String(process.env.ABS_WRITE_TOOLS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (extra.some((n) => txt.includes(`"${n}"`))) return true;
  if (/"(?:[\w.]*_)?(?:write|edit|patch|notebook)|(?:write|edit|patch|replace)_?file/i.test(txt)) return true;
  // 不再按「入参里有 path」兜底：Read/Grep/Glob 也带 path，会把只读会话误判成写
  // （2026-11-16 实测）。宁可漏报（少提醒一次），不要误报（每次都打扰）。
  return false;
}

export async function cmdWrapup({ dir }) {
  const root = await requireBrain(dir || process.cwd());
  return appendWrapup(root);
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
    let wroteFiles = false;   // 只有**确认**写过文件才提醒登记（取不到 transcript 就沉默）
    if (transcript) {
      const txt = await readIfExists(transcript);
      wroteFiles = looksLikeWrite(txt);
      if (!wroteFiles) return '{}'; // 纯只读会话不打扰
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
    // 2026-11-16 起 log 行是 `## [标题] [YYYY-MM-DD HH:MM] [[作者]] [会话id]`，没有 kind ——
    // 判据从「今天有没有 dev 条目」变成「今天有没有任何条目」。
    // log 行格式（2026-11-16 定稿）：`## [YYYY-MM-DD HH:MM] [短标题] [[作者]] …`
    // 时间是**第一段** —— 判据认这个，别再按「[标题] [时间]」的老顺序写。
    if (new RegExp('^## \\[' + day + ' \\d{2}:\\d{2}\\]', 'm').test(logTxt)) return '{}';

    // 条件③'（2026-11-16 用户定）：**提醒登记** —— 本会话改过文件、看板上却没有本会话认领的任务。
    // 用户原话：「hook 触发就提醒，但不要强制」。所以：
    //   · 只注入一句话，不拦截任何操作（宿主侧本来就是 decision:block 回灌提示，不是闸门）；
    //   · 独立节流标记（teardown-reg-*.mark），不与「今日无 log」那条共用；
    //   · 判据只看「有没有本会话 sid 的任务」，改错别字这类不登记也不会有后果。
    if (wroteFiles && ev.stop_hook_active !== true) {
      const sidReg = String(ev.session_id || ev.sessionId || '').replace(/[^\w-]/g, '');
      if (sidReg) {
        const todoTxt = await readIfExists(brainPath(root, 'todo.md'));
        const mine = todoTxt.split('\n').some((l) => {
          const t = parseTaskLine(l);
          return t && t.indent === 0 && taskSidOf(l) === sidReg;
        });
        if (!mine) {
          const regMark = join(absLogDir(), `teardown-reg-${sidReg}.mark`);
          let pushedBefore = false;
          try { await fs.access(regMark); pushedBefore = true; } catch { /* 没推过 */ }
          if (!pushedBefore) {
            await fs.mkdir(dirname(regMark), { recursive: true });
            await fs.writeFile(regMark, stamp, 'utf8').catch(() => {});
            const who = await getUser().catch(() => null);
            const why = [
              ...(who ? [] : ['0) 本机尚未设置使用者姓名 —— 先跑 abs config set user <你的名字>，否则 todo/log/note 都会被拦下；']),
              '[abs] 本会话改过文件，但看板上没有本会话认领的任务。',
              '这条只是提醒，不是命令：值得留档就登记，无关紧要就忽略。',
              '登记：abs todo add "<短标题>" --note "详情" --session ' + sidReg,
            ].join('\n');
            return 'push:' + JSON.stringify({ decision: 'block', reason: why });
          }
        }
      }
    }

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

