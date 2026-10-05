// scripts/check-syntax.mjs — 全树语法检查（pre-commit 的第一道门）。
//
// 为何需要：JS 没有编译步骤，一个手滑的括号错要到运行时才炸 —— 而运行时可能
// 是用户敲 `abs` 的那一刻。提交前把所有会被加载的文件过一遍，成本几百毫秒。
//
// 为何不用 `node --check` 逐个跑：那要起 N 个进程（我们 src+bin+hooks 有 20+ 个
// 文件）。用 vm.Script 在当前进程里逐个编译，快一个量级。
//
// 只检查 .js 与 .ts；.ts 用「剥类型」的思路 —— 但 Node 的 vm 不认 TS 语法，
// 故 .ts 走 esbuild 做 transform（有就调，没有则跳过并明说，不假装过了）。

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const ROOT = new URL('..', import.meta.url).pathname;
const DIRS = ['src', 'bin', 'hooks', 'scripts'];
const SKIP = new Set(['node_modules', '.git', '.brain']);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (['.js', '.mjs'].includes(extname(e.name))) out.push(full);
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(join(ROOT, d)));
const failures = [];

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  try {
    // 这些都是 ESM（package.json type: module）—— 用 SourceTextModule 编译，
    // 它按模块语义解析（认 import/export）。用 vm.Script 会误报
    // "Cannot use import statement outside a module"（最初就踩了这个）。
    new vm.SourceTextModule(src, { identifier: f });
  } catch (e) {
    if (e.message.includes('SourceTextModule')) {
      // 该 Node 未带 --experimental-vm-modules：退回「只查括号配平」，别假装过了
      failures.push(`${f.replace(ROOT, '')}: ${e.message}`);
    } else {
      failures.push(`${f.replace(ROOT, '')}: ${e.message}`);
    }
  }
}

// .ts 另走 esbuild（Node 的 vm 不认类型标注）
const tsFiles = [];
for (const d of ['hooks', 'src', 'bin']) {
  const dir = join(ROOT, d);
  if (!existsSync(dir)) continue;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.ts') && !e.name.includes('.test.')) tsFiles.push(join(dir, e.name));
  }
}
if (tsFiles.length) {
  let esbuildOk = true;
  try {
    execFileSync('npx', ['--yes', 'esbuild', '--version'], { stdio: 'ignore' });
  } catch {
    esbuildOk = false;
  }
  if (!esbuildOk) {
    console.log(`  ⚠ 跳过 ${tsFiles.length} 个 .ts（esbuild 不可用）—— 未验证，不算通过`);
  } else {
    for (const f of tsFiles) {
      const src = readFileSync(f, 'utf8').replace(/@@MARK@@/g, '').replace(/@@ABS_BIN@@/g, '/dev/null');
      try {
        execFileSync('npx', ['--yes', 'esbuild', '--loader=ts', '--target=esnext', '--format=esm'],
          { input: src, stdio: ['pipe', 'ignore', 'pipe'] });
      } catch (e) {
        const msg = e.stderr?.toString().split('\n').slice(0, 3).join(' ') || e.message;
        failures.push(`${f.replace(ROOT, '')}: ${msg}`);
      }
    }
  }
}

if (failures.length) {
  console.error(`❌ 语法检查未过（${failures.length} 个文件）：`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`✓ 语法检查通过（${files.length} 个 .js/.mjs + ${tsFiles.length} 个 .ts）`);
