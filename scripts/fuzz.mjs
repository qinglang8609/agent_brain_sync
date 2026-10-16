#!/usr/bin/env node
// 模糊测试：随机乱调 abs 命令，找「不报错但行为错」与「裸栈崩溃」两类问题。
// 用法: node scripts/fuzz.mjs [轮数]
// 判据：① 任何裸栈崩溃（含 "Error:" + at ...）都算 bug
//       ② 不变量被打破算 bug（幂等/无空行/格式合法/id 唯一）
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ABS = join(import.meta.dirname, '..', 'bin', 'abs.js');
const ROUNDS = Number(process.argv[2] || 200);

// 随机素材：中英文/emoji/特殊字符/超长/空
const IDS = ['t1', 'TASK-2', '中文id', '升级SDK', 'a-b-c', 'x_y', '🐛bug', '带 空格', '', '   ', '..', '../../etc', 'x'.repeat(80), '大写ABC', 'task/with/slash'];
const NOTES = ['普通描述', '带 — 破折号', '多句。第二句。第三句。', 'x'.repeat(300), '', '   ', 'emoji 🚀 测试', '含\n换行', '含"引号"', "含'单引号'", '$(whoami)', '`id`', '|管道|', '--flag', '-x'];
const STATES = ['进行中', '讨论中', '滞留中', '搁置', '乱写的状态', ''];
const ACTIONS = ['start', 'add', 'note', 'memo', 'state', 'bp-done', 'bp-undone', 'done', 'archive'];
// 非 todo 命令也要混进去 —— bug 常在「两个命令的产物互相不匹配」时出现
// （例：unwrapup 读 todo、lint 读两者、note 写 index）。
const OTHER_CMDS = [
  ['lint'],
  ['status'],
  ['load'],
  ['index'],
  ['config'],
  ['rule'],
  ['rule', 'add', '一句话规则'],
  ['query', '任务'],
  ['query', '不存在的词'],
  ['note', '一条经验'],
  ['note', '超长经验'.repeat(50)],
  ['note'],
  ['log', '干了什么'],
  ['concept', 'some-slug'],
  ['concept'],
  ['concept', '中文slug'],
  ['resolve', 'fanchao'],
  ['supersede', 'some-slug'],
  ['review'],
  ['todo'],
  ['todo', '--full'],
  ['wrapup'],
];

let sandbox;
const env = () => ({ ...process.env, HOME: sandbox, ABS_CONFIG_DIR: join(sandbox, '.abs'), ABS_NO_TODO: '1' });

function run(args, { cwd = sandbox } = {}) {
  const r = spawnSync('node', [ABS, ...args], { encoding: 'utf8', env: env(), cwd, timeout: 20000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const failures = [];
function bug(kind, detail, ctx) {
  failures.push({ kind, detail, ctx });
}

// 裸栈崩溃判据：stderr 里出现 「at 」堆栈行 或 ERR_ 前缀
function looksLikeCrash(s) {
  return /\n\s+at .+:\d+:\d+/.test(s) || /\bERR_[A-Z_]+/.test(s) || /ReferenceError|TypeError|SyntaxError/.test(s);
}

async function main() {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-fuzz-'));
  await fs.mkdir(join(sandbox, '.abs'), { recursive: true });
  await fs.writeFile(join(sandbox, '.abs', 'config.json'), JSON.stringify({ user: 'fuzzer' }));
  run(['init']);

  const created = [];
  for (let i = 0; i < ROUNDS; i++) {
    const action = pick(ACTIONS);
    const id = Math.random() < 0.35 && created.length ? pick(created) : pick(IDS);
    const note = pick(NOTES);
    // 20% 概率跑个非 todo 命令（看它们与 todo 的产物会不会打架）
    if (Math.random() < 0.2) {
      const other = pick(OTHER_CMDS);
      const ro = run(other);
      if (looksLikeCrash(ro.err)) bug('裸栈崩溃', ro.err.split('\n').slice(0, 3).join(' | '), `abs ${other.join(' ')}`);
    }
    const args = ['todo', action];
    if (id !== '') args.push(id);
    if (action === 'state') args.push('--note', pick(STATES));
    else if (note !== '') args.push('--note', note);
    if (action === 'bp-done' || action === 'bp-undone') {
      if (Math.random() < 0.5) args.push('--n', pick(['1', '2', '99', '0', '-1', 'abc']));
    }
    if (action === 'done' && Math.random() < 0.5) args.push('--as', pick(['落地', '否决', '仅方案', '乱写']));
    if (action === 'archive') { args.length = 0; args.push('todo', 'archive', '--keep-days', pick(['0', '1', '3', 'abc', '-5'])); }

    const r = run(args);
    const ctx = `abs ${args.join(' ')}`;
    if (looksLikeCrash(r.err)) bug('裸栈崩溃', r.err.split('\n').slice(0, 3).join(' | '), ctx);
    if (action === 'start' || action === 'add') created.push(id);

    // 不变量检查（每 10 轮）
    if (i % 10 === 0) {
      const todo = await fs.readFile(join(sandbox, '.brain', 'todo.md'), 'utf8').catch(() => '');
      // ① 条目之间不得有空行
      const sec = todo.split('## Todo')[1]?.split('## Done')[0] || '';
      const lines = sec.split('\n');
      // 只看**顶层任务行**（行首无缩进）：子项也以 `- ` 开头，
      // 拿它当 id 来源会把 `- [ ] -x` 子项误判成一条叫 `-x` 的任务（实测假阳性）。
      const isTop = (l) => /^- \[[ x]\]/.test(l);
      // 空行检查则用**任意条目**（任务或子项）定边界 —— 子项夹在任务之间也不该有空行。
      const isAny = (l) => /^\s*- \[[ x]\]/.test(l);
      const first = lines.findIndex(isAny);
      let last = -1;
      for (let k = lines.length - 1; k >= 0; k--) if (isAny(lines[k])) { last = k; break; }
      if (first >= 0 && last > first) {
        const blanks = lines.slice(first, last + 1).filter((l) => l.trim() === '').length;
        if (blanks) bug('条目之间有空行', `${blanks} 个`, ctx);
      }
      // ② 同一 id 不得出现两行未完成任务。
      //    取 id 要**先剥状态标记**（`- [ ] [进行中] <id>`），否则会把 "[进行中]" 当 id。
      const ids = lines.filter(isTop)
        .map((l) => {
          const m = l.match(/^-\s*\[[ x]\]\s*(?:\[[^\]]+\]\s+)?(\S+)/);
          return m ? m[1].replace(/\u200b/g, '') : null;
        })
        .filter(Boolean);
      const dup = ids.filter((x, k) => ids.indexOf(x) !== k);
      if (dup.length) bug('同一 id 多行（幂等失效）', [...new Set(dup)].join(','), ctx);

      // ③ 格式合法性：lint 不得报**写入弄脏文件**类问题。
      //    排除容量类（ROOT-OVER-SIZE / SOURCES-PILED-UP）—— 模糊测试会乱塞几百条，
      //    超限是预期结果、不是 bug。也排除内容质量类（SOURCE-UNDISTILLED 等）。
      const lint = run(['lint']);
      const IGNORE = /OVER-SIZE|PILED-UP|UNDISTILLED|NO-INBOUND|ORPHAN|TEMPLATE-LINK|DEAD-LINK|BREAKPOINT-BLOAT|BREAKPOINT-PROSE/;
      const structural = (lint.out.match(/^\s*(TODO-[A-Z-]+|[A-Z-]*(?:MISPLACED|STRAY|SHAPE)[A-Z-]*|INDEX-MISSING)/gm) || [])
        .filter((x) => !IGNORE.test(x));
      if (structural.length) bug('lint 报结构问题', structural.slice(0, 3).join(','), ctx);

      // ④ 子项不得脱离父任务：每个缩进条目上方必须能追溯到一条顶层任务。
      let sawTask = false;
      const orphan = [];
      for (const l of lines) {
        if (isTop(l)) { sawTask = true; continue; }
        if (/^\s+- \[[ x]\]/.test(l) && !sawTask) orphan.push(l);
      }
      if (orphan.length) bug('子项脱离父任务', orphan[0].slice(0, 40), ctx);

      // ⑤ 任务行不得出现裸文本（非任务非子项的非空行）
      const stray = lines.filter((l) => l.trim() && !isAny(l) && !/^##/.test(l));
      if (stray.length) bug('Todo 区裸文本', stray[0].slice(0, 40), ctx);
    }
  }

  console.log(`跑了 ${ROUNDS} 轮随机命令`);
  if (!failures.length) { console.log('✓ 没发现崩溃或不变量破坏'); return; }
  // 按 kind 归类，每类列出代表
  const byKind = new Map();
  for (const f of failures) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push(f);
  }
  console.log(`✗ 发现 ${failures.length} 处问题，${byKind.size} 类：\n`);
  for (const [kind, list] of byKind) {
    console.log(`【${kind}】${list.length} 次`);
    const seen = new Set();
    for (const f of list) {
      const key = f.detail.slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  · ${f.ctx}`);
      console.log(`    ${f.detail}`);
      if (seen.size >= 3) break;
    }
    console.log();
  }
  process.exitCode = 1;
}
main();
