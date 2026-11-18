// code/todo/task-cmd.js — `abs todo` 的命令入口（登记/推进/完成）+ `abs show`。
// 从 store.js 拆出（2026-11-01）：task 就是 todo 的事，归回 todo/ 目录。
// 行级操作在 tasks.js，本文件只做流程编排与落盘。
import { promises as fs } from 'node:fs';
import { brainPath, requireBrain } from '../index.js';
import { editFile, SKIP } from '../lock.js';
import { requireUser } from '../userconfig.js';
import { localStamp, sortTodoLines, shortTitle, upsertTask, findTaskLine, setBreakpoint, setBreakpointDone, setMemo, readMemo, setStateMark, setChildStateMark, TASK_STATES, parseTaskLine, renderTaskLine, taskSidOf, STATE_MARK, parseChild } from './index.js';
import { ensurePersonPage, cmdLog } from '../note.js';
import { readTodo } from './tasks.js';

// 纪律: task 过程动作(start/note/blocked/state/remove)只改 todo.md, 不写 log.md。
// ★ 唯一例外: **done 要写**（2026-11-12 用户定）。
//   旧纪律是「task 动作全不写 log」，结果整件事只剩模型自觉：11-06 SKILL 精简删掉
//   「收尾循环」后，跨项目日志日产量从 16 条掉到 3 条（实测），而 pi 侧的收尾提醒
//   2026-09-18 就已停用 —— 系统里没有任何一处还在要求写日志。
//   done 的参数（任务 id + 结语 + 落地/否决/仅方案）本来就是一条 log 的全部内容，
//   由代码写而不是由模型记得写：Done 区的行归档后就没了，log.md 是唯一留下来的记录。
/** 任务 id 的合法形状：一个词，不含空白 / 路径分隔符 / 方括号。
 *  为什么这么严（2026-11-10 审查实测）：
 *  ① 空白会被 extractId 截断（静默丢信息）；换行还会往 todo.md 里注一行。
 *  ② `/` `\` 会被 setMemo 拼进文件名写出 .brain/ 外（路径穿越，`../..` 实测逃逸）。
 *  ③ `[` `]` 撞行首状态标记 `[进行中]` 的语法。
 *  旧注释写了「不能含方括号」，代码只查了空格 tab —— 这次收口。 */
function isValidId(s) {
  return !/[\s\\/\0[\]]/.test(s);
}

/** 找不到任务时，列出标题里含这个关键词的候选（按标题定位后最容易踩的坑）。 */
async function candidatesHint(root, key) {
  const cur = await readTodo(root).catch(() => '');
  const k = String(key || '').trim();
  if (!k) return '';
  const hits = cur.split('\n')
    .map((l) => parseTaskLine(l))
    .filter((t) => t && t.indent === 0 && t.mark !== 'x' && t.title && t.title.includes(k))
    .map((t) => `    · ${t.title}`)
    .slice(0, 5);
  if (!hits.length) {
    const all = cur.split('\n').map((l) => parseTaskLine(l)).filter((t) => t && t.indent === 0 && t.mark !== 'x' && t.title);
    if (!all.length) return '\n  （看板上没有未完成任务）';
    return `\n  当前未完成任务（前 5 条）:\n${all.slice(0, 5).map((t) => `    · ${t.title}`).join('\n')}`;
  }
  return `\n  标题里含 "${k}" 的有:\n${hits.join('\n')}\n  用完整标题（或更长的前缀）再试一次。`;
}

export async function cmdTask({ dir, action, id, section, note, as, session, n }) {
  // ★ id 校验：宁可明确拒掉，也不替人猜哪个词算 id、不把怪 id 写出图谱外。
  const idStr = id === undefined || id === null ? '' : String(id);
  // 短标题可以含空格（它就是一句话），但会当 memo 文件名用 —— 路径分隔符与 `..` 必须拒
  if (idStr && (/[\n\r\0]/.test(idStr) || /[\\/]/.test(idStr) || idStr.includes('..') || /[\[\]]/.test(idStr))) {
    throw new Error(
      `✗ 短标题不能含换行、斜杠、方括号或 ..（收到 "${idStr}"）—— 方括号会破坏行结构，斜杠会被当路径。`,
    );
  }
  const root = await requireBrain(dir || process.cwd());
  // 写操作守卫：无姓名不落盘（hook 调的 wrapup/teardown-check 不经过这里，不受影响）
  const who = await requireUser();
  // 会话 id（可缺省）：塞进已有的 `(认领 日期)` 字段而非另开新字段 ——
  //   归档是整行搬运，塞在旧字段里就能自动跟着走，且 6 处解析里 5 处用的
  //   是 `\(认领[^)]*\)` 通配，零改动兼容（只剩 hook 那处严格正则要改）。
  // 取不到就不写：纯加法，旧行为不变。
  const sid = String(session || process.env.ABS_SESSION_ID || '')
    .replace(/[^\w-]/g, '').slice(0, 40);
  await ensurePersonPage(root, who); // 首次写操作即建人页（已存在不动）
  if (action === 'start') {
    // 格式闸（2026-11-08 用户定：不符合直接打回）：只有 id 的看板行查不到、接不上。
    // 实测：slim-skill-load-cmd 只登记了 id，面板上一行代号，隔天自己都不认识。
    if (!String(id || '').trim()) {
      throw new Error(
        `✗ 任务必须有短标题 —— 打回。\n` +
        `  用法: abs todo start "<短标题>" [--note "详情，可多句"]\n` +
        `  行格式: - [记号] [时间] [短标题] [[作者]] 详情 [会话id]`,
      );
    }
    // 两区制：未完成一律进 Todo，行首带状态标记（默认 进行中）。
    const st = section && TASK_STATES.includes(section) ? section : '进行中';
    // 唯一进行中约束（2026-10-05 照 rpiv-todo）：看板要能回答"现在在做什么"，
    // 多个 [进行中] 就答不了。**只提示，不擅自降级别人的任务** ——
    // 机器替人改状态是静默篡改（同 [[falsy-or-eats-zero]] 的"别悄悄改写意图"）。
    let warning = '';
    // 只在**新开**进行中时提示（幂等更新同一条不该重复唠叨）。
    let alreadyThere = false;
    await editFile(brainPath(root, 'todo.md'), (cur) => {
      if (cur === null) return SKIP;
      alreadyThere = findTaskLine(cur.split('\n'), String(id)) !== -1;
      return SKIP;
    });
    if (st === '进行中' && !alreadyThere) {
      const others = [];
      await editFile(brainPath(root, 'todo.md'), (cur) => {
        if (cur === null) return SKIP;
        for (const l of cur.split('\n')) {
          const t = parseTaskLine(l);
          if (t && t.indent === 0 && t.title && t.title !== String(id) && t.mark === ' ' && t.mark !== 'x') others.push(t.title);
        }
        return SKIP;
      });
      if (others.length) {
        // 提示要具体到「该转成哪个」：只报「已有 N 个进行中」实测不够 ——
        // 用户改方向时，旧任务是「搁置」（不做了），与「滞留中」（还要做）不同，
        // 选错会让下会话分不清该不该接着干。
        warning = `\n  ⚠ 已有 ${others.length} 个 [进行中]: ${others.join(', ')}\n`
          + '    同时只有一个进行中才说得清"现在在做什么"。\n'
          + `    旧任务怎么处理 ——\n`
          + `      • 用户改方向了/不做了 → abs todo state <id> --note 搁置\n`
          + `      • 还要做，只是卡住了   → abs todo state <id> --note 滞留中\n`
          + `      • 还想商量            → abs todo state <id> --note 讨论中`;
      }
    }
    // 接手提示（2026-10-09 用户要求）：该任务已属于另一个会话时，接手要告知 ——
    //   用户原话：「不属于我的会话的就别乱进行，但是用户强制要进行那也得接手」。
    //   **只提示不拦截**：接手是允许的，但得让它知道这条原来是谁的、自己接手了；
    //   否则静默换了 sid，看板上无声无息地易主。
    let takeover = '';
    if (sid) {
      let prevSid = '';
      await editFile(brainPath(root, 'todo.md'), (cur) => {
        if (cur === null) return SKIP;
        // 按标题定位（新格式没有 id 字段）；取该行的会话标签
        const ls = cur.split('\n');
        const at = findTaskLine(ls, String(id));
        if (at !== -1) prevSid = taskSidOf(ls[at]);
        return SKIP;
      });
      if (prevSid && prevSid !== sid) {
        takeover = `\n  ⚠ 接手 —— 该任务原属会话 ${prevSid}（不是本会话 ${sid}）\n`
          + `    已把会话标记改为 ${sid}\n`
          + `    不想接手只想看看 → abs todo state <id> --note 滞留中（释放占用）`;
      }
    }
    // 位置参数就是短标题；--note 是详情（用户 2026-11-16：标题短，详情完整保留）
    const rawTitle = String(id).trim();
    const shortT = shortTitle(rawTitle);
    // 详情 = --note；没给就把位置参数里超出的那部分当详情（一个字都不丢）
    const restOfTitle = rawTitle.length > shortT.length
      ? rawTitle.slice(shortT.length).replace(/^[，,、。；;：:\-\s]+/, '').trim()
      : '';
    const detailT = [restOfTitle, String(note || '').trim()].filter(Boolean).join(' — ');
    // 格式闸（对齐 SKILL.md 的契约：`todo start/add` 不带 --note 应被拒）：
    // 看板行只有代号时，隔天自己也认不出这是哪件事，lint 还会判 TODO-NO-DESC。
    // 已存在的任务重跑 start（幂等 / 改状态 / 释放占用）不要求 note —— 它本来就有描述。
    // 阈值与 lint 对齐（lint 判 taskBodyOf(l).length < 2）：命令放过的行，lint 也放过，
    // 否则会出现「登记成功，但 abs lint 报 TODO-NO-DESC」这种自相矛盾。
    if (detailT.trim().length < 2) {
      const lines = String(await readTodo(root)).split('\n');
      if (findTaskLine(lines, shortT) < 0) {
        throw new Error(
          `✗ 登记新任务必须带描述（至少 2 个字）：abs todo start "${shortT}" --note "一句话说明要做什么"\n` +
          '  （已登记过的任务可以不带 --note 重跑，那是更新状态）',
        );
      }
    }
    const r = await upsertTask(root, {
      title: shortT,
      detail: detailT,
      // 只有调用方明确给了 --section 才改状态；否则沿用原状态（重跑 start 不该把滞留中翻回进行中）
      state: section && TASK_STATES.includes(section) ? st : null,
      session: sid,
      author: who,
    });
    // 回显按文件里的形态（记号 + 状态名 + 那一行），别再用 `[进行中] id` 这种旧写法 ——
    // 用户拿回显去对文件会发现对不上。
    return `✓ 任务${r.updated ? '更新(幂等)' : '登记'} → ${brainPath(root, 'todo.md')}\n  ${r.line || renderTaskLine({ mark: STATE_MARK[st] ?? ' ', title: shortT, detail: detailT, time: localStamp(), author: who, sid })}${takeover}${warning}`;
  }
  if (action === 'rename') {
    // 改任务 id（2026-10-05）：人工起错名、或旧 id 不可读时用。
    // （`fix-skill-trigger` 这种名字不是从用户字面抽出来的，是读懂在干什么之后起的。）
    // --note 传新 id（沿用既有 CLI 习惯，免得再加一个 flag）。
    if (!note) throw new Error('✗ 用法: abs todo rename <旧id> --note "<新id>"');
    const newId = String(note).replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim();
    if (!newId || !isValidId(newId)) throw new Error(`✗ 新 id 不能为空，且不能含空白、/、\\、[、]: "${newId}"`);
    const f = brainPath(root, 'todo.md');
    let done = false;
    await editFile(f, (cur) => {
      if (cur === null) return SKIP;
      const lines = cur.split('\n');
      const want = String(id).replace(/[\u200b\u200c\u200d\ufeff]/g, '');
      const at = findTaskLine(lines, want);
      if (at !== -1) {
        const p0 = parseTaskLine(lines[at]);
        lines[at] = renderTaskLine({ indent: ' '.repeat(p0.indent), mark: p0.mark, time: p0.time, title: newId, author: p0.author, authorAt: p0.authorAt, detail: p0.detail, sid: p0.sid });
        done = true;
      }
      return done ? { text: lines.join('\n') } : SKIP;
    });
    return done ? `✓ 任务改名 ${id} → ${newId}` : `[NO_MATCH] 未找到含 "${id}" 的未完成任务行`;
  }
  if (action === 'state') {
    // 改状态标记（原地，不搬区）：滞留中 / 讨论中 / 搁置 / 进行中。
    // 带 n = 改某任务的第 n 条子项（2026-11-09 用户要求给子项加状态）；不带给 n = 改任务本身。
    if (!note) throw new Error(`✗ 用法: abs todo state <id> --note "${TASK_STATES.join('|')}" [--n N]`);
    if (!TASK_STATES.includes(note)) {
      throw new Error(`✗ 状态只接受: ${TASK_STATES.join(' | ')}（收到 "${note}"）`);
    }
    const f = brainPath(root, 'todo.md');
    let cc = [];
    await editFile(f, (cur) => {
      if (cur === null) return SKIP;
      const r = n ? setChildStateMark(cur, id, n, note) : setStateMark(cur, id, note);
      cc = r.changed;
      return r.changed.length ? { text: r.text } : SKIP;
    });
    if (!cc.length) {
      // 区分「任务不存在」和「状态本来就是它」—— 后者不是错误，报 NO_MATCH 会误导。
      // 带 n（改子项）时不走这条：子项越界/不存在仍要报 NO_MATCH。
      const cur = await fs.readFile(f, 'utf8').catch(() => '');
      const hit = !n && findTaskLine(cur.split('\n'), id) !== -1;
      if (hit) return `= ${id} 状态本来就是 [${note}]（无变化）`;
      return n
        ? `[NO_MATCH] "${id}" 下没有第 ${n} 条子项（或任务不存在）`
        : `[NO_MATCH] 未找到标题含 "${id}" 的未完成任务行`;
    }
    return `✓ ${id} ${n ? `第 ${n} 条子项` : ''}状态 → [${note}]`;
  }
  // 删除任务（2026-11-05 用户要求「每次删除任务可烦人了」）。
  // 与 state=搁置 的区别（别混）：
  //   搁置 = 先不做，任务**留在看板上**，下个会话还会看见它并问你要不要接着干
  //   删除 = 从看板移除，当作从未登记过（记错了/重复了/与事实不符）
  // 为何必须连子项一起删：只删任务行会留下无主的缩进子项，
  //   normalizeTodo 重建分区时它们会被当孤儿清掉 —— 那种「清掉」是静默的，
  //   而这里要让整块消失是**显式**的，且报告删了几条。
  if (action === 'remove') {
    const f = brainPath(root, 'todo.md');
    let removed = null;
    await editFile(f, (cur) => {
      if (cur === null) return SKIP;
      const lines = cur.split('\n');
      const wantId = String(id).replace(/[\u200b\u200c\u200d\ufeff]/g, '');
      // 按标题定位（新格式没有 id 字段）；已完成的行不许删（历史不许篡改）
      const at = findTaskLine(lines, wantId);
      if (at !== -1) {
        const i = at;
        const block = [lines[i]];
        let j = i + 1;
        while (j < lines.length) {
          const nx = lines[j];
          if (!nx.trim()) break;
          const kid = parseChild(nx);
          if (kid && kid.indent > 0) { block.push(nx); j++; continue; }
          break;
        }
        removed = { body: lines[i], kids: block.length - 1 };
        lines.splice(i, block.length);
        return { text: lines.join('\n') };
      }
      return SKIP;
    });
    if (!removed) return `[NO_MATCH] 未找到含 "${id}" 的未完成任务行`;
    // 只删未完成区：Done 区的条目是历史，删了等于篡改记录。
    // idOfTaskLine 只认 `- [ ]`，所以到这里的一定是未完成的。
    const kidNote = removed.kids ? `（连同 ${removed.kids} 条子项）` : '';
    return `✓ 已删除任务 ${id}${kidNote}\n  原行: ${removed.body.trim().slice(0, 90)}\n  说明: 删除是不可恢复的移除；只是「先不做」请用 abs todo state ${id} --note 搁置`;
  }
  if (action === 'note') {
    if (!note) return '用法: abs todo note <id> --note "进度"\n  建议前缀（load 会把它们单独抽出来，让人一眼看到）:\n    验证: <跑过的命令/结果>\n    边界: <这方案治不了什么>\n    阻塞: <在等什么，卡在哪>';
    const r = await setBreakpoint(root, { id, text: note });
    return r.msg;
  }
  // 勾/取消勾子项：子项也是待办，做完要勾。
  // 单独两个子命令而不是 `--done true/false` —— 勾与取消是两件事，各自一个动词更顺手。
  // 2026-10-20：命令名从 bp-done/bp-undone 改为 child-done/child-undone
  //（「断点」这个叫法已废弃，子项就是标准 md 嵌套列表项）。
  if (action === 'child-done' || action === 'child-undone') {
    const r = await setBreakpointDone(root, { id, n, done: action === 'child-done' });
    return r.msg;
  }
  if (action === 'memo') {
    // 任务随手记：多句/不定长/可追加，不占看板。无 note 时 = 查看已有笔记。
    if (!id) return '用法: abs todo memo <id> "随手记（可多句）"  |  abs todo memo <id>（查看）';
    if (!note) {
      const body = await readMemo(root, id);
      return body || `（${id} 没有随手记）`;
    }
    const r = await setMemo(root, { id, text: note });
    return r.msg;
  }
  if (action === 'done') {
    // 2026-11-16 用户定：新格式不再有结语（【落地/否决/仅方案】）与完成时间。
    // 传了也照收，但只回一句提示 —— 不静默吞掉用户的字数，也不假装记下来了。
    const legacyNote = String(note || '').trim() || String(as || '').trim()
      ? '\n  （新格式不再记录结语与完成时间，本次的结语未落盘；结论请写 abs log）'
      : '';
    // 写 log 用「id 短标题」——只写 id 的条目等于没信息（lint 也会报 LOG-ENTRY-QUALITY）。
    let logTitle = String(id);
    {
      const cur = await readTodo(root).catch(() => '');
      const t = cur.split('\n').map((l) => parseTaskLine(l)).find((x) => x && x.id === String(id));
      if (t) logTitle = [t.id, t.title].filter(Boolean).join(' ');
    }
    const { ok, msg } = await markDone(brainPath(root, 'todo.md'), id);
    if (!ok) return msg + await candidatesHint(root, id);
    // 完成即落一条 log（2026-11-12 起的规矩）：log 是任务行之外唯一的长期记录。
    const logged = await cmdLog({ dir: root, title: logTitle, kind: 'dev', summon: false }).catch(
      // 写 log 失败不能把已经成功的 done 变成报错（todo.md 已落盘），
      // 但也不能静默吞 —— 降级成一行显式警告，把「哪一半成功了」写清楚。
      (e) => `⚠ 已完成，但写 log 失败: ${e?.message || e}\n  （todo.md 已更新，log.md 缺这一条）`,
    );
    return `${msg}${legacyNote}\n${logged}`;
  }
  throw new Error(`unknown task action: ${action}`);
}

async function markDone(file, id) {
  const res = await editFile(file, (text) => {
    const lines = text.split('\n');
    const wantId = String(id).replace(/\u200b/g, '');
    const at = findTaskLine(lines, wantId);
    if (at === -1) return SKIP;
    // 子项必须全部完成才许 done（2026-10-18 用户定，主子都是任务，不替人决定）。
    const leftover = [];
    for (let i = at + 1; i < lines.length; i++) {
      const kid = parseChild(lines[i]);
      if (kid && kid.indent > 0) { if (!kid.done) leftover.push(kid.text); continue; }
      if (!lines[i].trim()) continue;
      break;
    }
    if (leftover.length) {
      throw new Error(
        `✗ 任务 "${wantId}" 还有 ${leftover.length} 条子任务未完成，不能 done：\n` +
          leftover.map((p) => `    - [ ] ${p}`).join('\n') +
          `\n子任务也是任务，主子全部完成才能 done。先二选一：\n` +
          `  • 做完了 → abs todo child-done ${wantId}   （勾最后一条；指定第 N 条：child-done ${wantId} --n N）\n` +
          `  • 不做了 → 删掉那几行子项，再 abs todo done ${wantId}`,
      );
    }
    const p = parseTaskLine(lines[at]);
    // 只翻记号：时间、作者、会话 id 全部原样保留（没有「完成时间」这个字段了）。
    lines[at] = renderTaskLine({ indent: ' '.repeat(p.indent), mark: 'x', title: p.title, time: p.time, author: p.author, authorAt: p.authorAt, detail: p.detail, sid: p.sid });
    return { text: sortTodoLines(lines.filter((l) => l.trim())).join('\n') + '\n' };
  });
  // 返回 { ok, msg } 而不是纯文本：成功与否由调用方据此判断，不去猜文案。
  // msg 仍是人读的那句话（NO_MATCH 前缀有测试、有脚本在匹配，不要改它）。
  return res === SKIP
    ? { ok: false, msg: `[NO_MATCH] 未找到含 "${id}" 的未完成任务行` }
    : { ok: true, msg: `✓ 已完成: ${id}` };
}
