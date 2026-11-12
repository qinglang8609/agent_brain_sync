// src/todo/task-cmd.js — `abs todo` 的命令入口（登记/推进/完成）+ `abs show`。
// 从 store.js 拆出（2026-11-01）：task 就是 todo 的事，归回 todo/ 目录。
// 行级操作在 tasks.js，本文件只做流程编排与落盘。
import { brainPath, requireBrain } from '../index.js';
import { editFile, SKIP } from '../lock.js';
import { requireUser, atTag } from '../userconfig.js';
import { stripStateMark, checkTaskBox, stateOfTaskLine, upsertTask, today, setBreakpoint, setBreakpointDone, setMemo, readMemo, setStateMark, setChildStateMark, TASK_STATES, insertDoneGrouped, idOfTaskLine, DONE_KINDS, withDoneKind, sessionOf, parseChild, migrateLegacyChild, SEC } from '../todo.js';
import { ensurePersonPage, cmdLog } from '../note.js';

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

export async function cmdTask({ dir, action, id, section, note, as, session, n }) {
  // ★ id 校验：宁可明确拒掉，也不替人猜哪个词算 id、不把怪 id 写出图谱外。
  const idStr = id === undefined || id === null ? '' : String(id);
  if (idStr && !isValidId(idStr)) {
    throw new Error(
      `✗ 任务 id 不能含空格、/、\\、[、]（收到 "${idStr}"）—— id 是一个词，也会被拼进文件名。\n` +
      `  想要带空格的名字：用连字符或下划线；完整名称写进 --note。`,
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
    .replace(/[^\w-]/g, '').slice(0, 16);
  const claim = `(认领 ${today()}${sid ? ' ' + sid : ''})`;
  await ensurePersonPage(root, who); // 首次写操作即建人页（已存在不动）
  if (action === 'start') {
    // 格式闸（2026-11-08 用户定：不符合直接打回）：只有 id 的看板行查不到、接不上。
    // 实测：slim-skill-load-cmd 只登记了 id，面板上一行代号，隔天自己都不认识。
    if (!String(note || '').trim()) {
      throw new Error(
        `✗ 任务必须有描述 —— 只有 id 的行查不到、接不上，打回。\n` +
        `  用法: abs todo start <id> --note "一句话：做什么"\n` +
        `  格式: 动词开头、一句话、≤40 字；进度用 abs todo note 逐条加，别塞进标题。`,
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
      alreadyThere = cur.split('\n').some((l) => idOfTaskLine(l) === String(id).replace(/[\u200b\u200c\u200d\ufeff]/g, ''));
      return SKIP;
    });
    if (st === '进行中' && !alreadyThere) {
      const others = [];
      await editFile(brainPath(root, 'todo.md'), (cur) => {
        if (cur === null) return SKIP;
        for (const l of cur.split('\n')) {
          const tid = idOfTaskLine(l);
          if (tid && tid !== id && stateOfTaskLine(l) === '进行中') others.push(tid);
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
        for (const l of cur.split('\n')) {
          if (idOfTaskLine(l) === String(id).replace(/[\u200b\u200c\u200d\ufeff]/g, '')) {
            prevSid = sessionOf(l);
            break;
          }
        }
        return SKIP;
      });
      if (prevSid && prevSid !== sid) {
        takeover = `\n  ⚠ 接手 —— 该任务原属会话 ${prevSid}（不是本会话 ${sid}）\n`
          + `    已把会话标记改为 ${sid}\n`
          + `    不想接手只想看看 → abs todo state <id> --note 滞留中（释放占用）`;
      }
    }
    const r = await upsertTask(root, {
      section: SEC.todo,
      text: `[${st}] ${id} ${atTag(who)}${note ? ' — ' + note : ''} ${claim}`,
      session: sid,
    });
    return `✓ 任务${r.updated ? '更新(幂等)' : '登记'} → ${brainPath(root, 'todo.md')}\n  [${st}] ${id} ${atTag(who)}${note ? ' — ' + note : ''}${sid ? ' ' + claim : ''}${takeover}${warning}`;
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
      for (let i = 0; i < lines.length; i++) {
        if (idOfTaskLine(lines[i]) !== want) continue;
        lines[i] = lines[i].replace(want, newId);
        done = true;
        break;
      }
      return done ? { text: lines.join('\n') } : SKIP;
    });
    return done ? `✓ 任务改名 ${id} → ${newId}` : `[NO_MATCH] 未找到含 "${id}" 的未完成任务行`;
  }
  if (action === 'state') {
    // 改状态标记（原地，不搬区）：进行中 / 讨论中 / 滞留中 / 搁置。
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
      return n
        ? `[NO_MATCH] "${id}" 下没有第 ${n} 条子项（或任务不存在），或状态未变`
        : `[NO_MATCH] 未找到含 "${id}" 的未完成任务行，或状态未变`;
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
      for (let i = 0; i < lines.length; i++) {
        if (idOfTaskLine(lines[i]) !== wantId) continue;
        // 收集这一行 + 紧跟的所有子项行（缩进列表项 / 旧 ↳ 写法）
        const block = [lines[i]];
        let j = i + 1;
        while (j < lines.length) {
          const nx = lines[j];
          if (!nx.trim()) break;
          const kid = parseChild(nx);
          const legacy = /^\s+↳\s/.test(nx);
          if ((kid && kid.indent > 0) || legacy) { block.push(nx); j++; continue; }
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
    // 找到匹配 id 的行，勾选并归位 Done（简化：若行在某 section 则标记完成）
    // --as 结语：落地(默认) / 否决 / 仅方案 —— 让 [x] 可被信任（见 todo.js DONE_KINDS）
    if (as && !DONE_KINDS.includes(as)) {
      throw new Error(`✗ --as 只接受: ${DONE_KINDS.join(' | ')}（收到 "${as}"）`);
    }
    // 格式闸（2026-11-08 用户定）：done 必须带结语，否则 Done 区只剩一个勾和 id，
    // 下个会话不知道“做成了什么”。打回，让人把结论写完。
    if (!String(note || '').trim() && !as) {
      throw new Error(
        `✗ done 必须带结语 —— 打回。只有勾没有结论的 Done 不可信。\n` +
        `  用法: abs todo done <id> --as 落地|否决|仅方案 "一句话结论"\n` +
        `  例: abs todo done <id> --as 落地 "821 测试全绿，已装到 ~/.pi"`,
      );
    }
    // 结语 = note（MCP 路径）或位置参数（CLI 路径）。坑(2026-09-16 实测):
    // MCP abs_task schema 无 as，AI 按旧 SKILL.md 传 note 会被静默丢弃、行上默认盖【落地】
    // —— 状态失真且无声。现在 note 也当结语；note 里自带【落地/否决/仅方案】时它就是 kind。
    // as 与 note 里的 kind 矛盾 → 报错不猜（猜一侧就是静默篡改另一侧）。
    const conclusion = note ? String(note).replace(/\u200b/g, '') : undefined;
    const inlineKind = conclusion ? (conclusion.match(/【(落地|否决|仅方案)】/) || [])[1] : undefined;
    if (inlineKind && as && inlineKind !== as) {
      throw new Error(`✗ as="${as}" 与 note 里的【${inlineKind}】矛盾 —— 只留一个（改 as，或改 note 里的【】）`);
    }
    const { ok, msg } = await markDone(brainPath(root, 'todo.md'), id, as || inlineKind || '落地', conclusion, sid);
    // 完成即落一条 log（2026-11-12）：只认成功的那次（NO_MATCH 不写）。
    // 正文 = 任务 id + 结语，结语里没带【kind】时补上 —— log 是归档后唯一的记录。
    //
    // ★ ok 是布尔量，不靠嗅探 msg —— 2026-11-13 审查的 P2：原实现用
    //   `String(res).startsWith('✓')` 判成功，等于把「自动写日志」挂在一句用户可见
    //   文案上：谁改一下「✓ 已完成并归位」这句话，自动写日志就静默停摆，
    //   而那正是这次事故的失效类型（要求只存在于一句话里）。
    if (!ok) return msg;
    const finalKind = as || inlineKind || '落地';
    const body = `${id}${conclusion ? '：' + conclusion : ''}` +
      (conclusion && conclusion.includes(`【${finalKind}】`) ? '' : ` 【${finalKind}】`);
    const logged = await cmdLog({ dir: root, title: body, kind: 'dev', summon: false }).catch(
      // 写 log 失败**不能**把已经成功的 done 变成报错：todo.md 已落盘，报错会让用户
      // 以为没完成、再做一遍。但也不能静默吞 —— 静默吞就是这次事故的形态（写了没人知道 / 没写也没人知道）。
      // 所以降级为一行显式警告，把「哪一半成功了」写清楚。
      (e) => `⚠ 已归位 Done，但写 log 失败: ${e?.message || e}\n  （todo.md 已更新，log.md 缺这一条）`,
    );
    return `${msg}\n${logged}`;
  }
  throw new Error(`unknown task action: ${action}`);
}

async function markDone(file, id, kind = '落地', conclusion, bySid = '') {
  const res = await editFile(file, (text) => {
    const lines = text.split('\n');
    let changed = false;
    let moved = null;
    const kept = [];
    const wantId = String(id).replace(/\u200b/g, '');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!moved && idOfTaskLine(l) === wantId) {
        changed = true;
        // 结语（MCP note / CLI 位置参数）拼在日期前 —— 与 CLI `abs todo done <id> [--as ..] <结语>` 同一落点。
        const tail = conclusion ? ` — ${conclusion}` : '';
        // 认领与完成可能是**不同会话**（A 认领、B 收尾）。两个都要留：
        //   只留完成者 → A 的线索断；只留认领者 → (完成 日期) 配着别人，语义拧。
        // 规则（2026-10-09 用户定）：
        //   同一个 sid     → 只写 `(完成 日期 sid)`
        //   不同 sid       → `(认领 日期 A) (完成 日期 B)`
        //   认领无 sid     → 只写 `(完成 日期 B)`
        //   done 未给 sid → 沿用认领的（无新信息，不凭空编）
        const claimSid = sessionOf(l);
        const doneSid = bySid || claimSid;
        const base = checkTaskBox(stripStateMark(l)).replace(/\s*\(认领[^)]*\)/, '');
        const parts = [];
        if (claimSid && doneSid && claimSid !== doneSid) {
          parts.push(`(认领 ${today()} ${claimSid})`);
        }
        parts.push(`(完成 ${today()}${doneSid ? ' ' + doneSid : ''})`);
        const head = withDoneKind(`${base}${tail} ${parts.join(' ')}`, kind);
        const bp = [];
        const leftover = [];
        // 子项搬运：**已勾选**的随任务进 Done；未勾选的不搬（下方直接拒）。
        // 已勾的必须搬：否则任务进 Done 了、子项剩在原区，就是无主孤儿行，
        // 重建分区时会被清掉（历史上就是这么丢过数据）。
        while (i + 1 < lines.length) {
          const nx = lines[i + 1];
          if (!nx.trim()) break;
          const kid = parseChild(nx);
          if (kid && kid.indent > 0) {
            // 无论勾没勾都要 i++（否则原地打转 —— 2026-10-18 实测 OOM）
            const ch = lines[++i];
            if (kid.done) bp.push(ch);
            else leftover.push(kid.text);
            continue;
          }
          // 防御：旧 `↳` 行本应已在 normalizeTodo 里迁掉。万一有路径绕过迁移，
          // 这里必须**消费掉该行**（i++），否则外层 while 原地打转（2026-10-18 OOM 实测）。
          const legacyChild = migrateLegacyChild(nx);
          if (legacyChild !== null) {
            i++;  // 消费掉这一行，防止原地打转
            const parsed2 = parseChild(legacyChild);
            if (parsed2 && !parsed2.done) leftover.push(parsed2.text);
            else bp.push(legacyChild);
            continue;
          }
          break;
        }
        moved = [head, ...bp];
        // 还有未勾子项就**不许 done**（2026-10-18 用户定）。
        //
        // 规则：主任务与子任务都是任务，处理方式一样 —— 子任务也是看板上一行，
        // 也要自己完成。只有主子全部完成，主任务才能经 done。
        //
        // 为何不自己搬：上四版的四种做法全被否定——
        //   ① 随父任务进 Done（原实现）→ Done 区被 collapseDone 折叠成计数，
        //      未勾子项进去即消失（实测 factory-docs-slim）
        //   ② 升为顶层任务（<id>-restN）→ 用户：子任务不能升格
        //   ③ 建占位主任务挂住 → 仍是无中生有，与 ② 同病
        //   ④ 就这么留着不管 → 无主杂行，重建分区时被清掉
        // 正确做法是**不替用户决定**：告诉他还有哪些没完成，让他先勾或先删。
        if (leftover.length) {
          throw new Error(
            `✗ 任务 "${wantId}" 还有 ${leftover.length} 条子任务未完成，不能 done：\n` +
              leftover.map((p) => `    - [ ] ${p}`).join('\n') +
              `\n子任务也是任务，主子全部完成才能 done。先二选一：\n` +
              `  • 做完了 → abs todo child-done ${wantId}   （勾最后一条；指定第 N 条：child-done ${wantId} --n N）\n` +
              `  • 不做了 → 删掉那几行子项，再 abs todo done ${wantId}`,
          );
        }
        continue;
      }
      kept.push(l);
    }
    if (!changed || !moved) return SKIP;
    // 归位 + 按日期分组：insertDoneGrouped 一次重建 Done 区（新日期在前，未标日期归尾）
    return { text: insertDoneGrouped(kept.join('\n'), moved) };
  });
  // 返回 { ok, msg } 而不是纯文本：成功与否由调用方据此判断，不去猜文案。
  // msg 仍是人读的那句话（NO_MATCH 前缀有测试、有脚本在匹配，不要改它）。
  return res === SKIP
    ? { ok: false, msg: `[NO_MATCH] 未找到含 "${id}" 的未完成任务行` }
    : { ok: true, msg: `✓ 已完成并归位 Done: ${id} 【${kind}】` };
}
