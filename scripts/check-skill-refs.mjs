#!/usr/bin/env node
// scripts/check-skill-refs.mjs — SKILL 里 `abs resolve <页>` 引用的页必须存在。
//
// 为什么要有这道门禁（2026-11-13 实测）：
//   11-06 的精简（4e00560）把 SKILL 从 303 行砍到 107 行，长尾「移到两个图谱页」。
//   但末尾指针表 5 条里有 4 条写的是 `abs resolve abs-skill-details` —— 这个页
//   从来没建过（实际建的是 abs-skill-flow / abs-skill-structure）。于是「细节按需查」
//   整条退路断了，而且断得毫无声音：`abs resolve` 找不到页时退出码仍是 0，
//   `abs lint` 又完全不读 SKILL.md。7 天没人发现。
//
// 放在这里而不是 abs lint：SKILL 是全库共用的一份包文件，不是某个项目的图谱；
// 每个项目跑 lint 都报同一个包问题就是噪声。这里是提交/发布门禁。
//
// 用法：node scripts/check-skill-refs.mjs [项目根]
//   exit 0 = 全部命中；exit 1 = 有死链（逐条打印）。

import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE_DIRS = ['concepts', 'entities', 'syntheses', 'sources', 'sessions'];

/** 列出 root/.brain 下所有页的 slug（不含 .md）。 */
async function pageSlugs(root) {
  const slugs = new Set();
  for (const dir of PAGE_DIRS) {
    let names = [];
    try {
      names = await fs.readdir(join(root, '.brain', dir));
    } catch {
      continue; // 该分区不存在 = 没有页，不算错
    }
    for (const n of names) if (n.endsWith('.md')) slugs.add(n.slice(0, -3));
  }
  return slugs;
}

/** 找出 SKILL.md 里所有 `abs resolve <slug>` 引用。
 *  只认反引号包起来的那种（`abs resolve x`）—— 散文里顺口提到的页名不在此列，
 *  它由 .brain 内的双链 lint 负责。 */
export function extraResolveRefs(text) {
  const seen = new Set();
  const re = /`abs resolve ([A-Za-z0-9._-]+)`/g;
  let m;
  while ((m = re.exec(text))) seen.add(m[1]);
  return [...seen];
}

/** 检查一个项目根：返回 { refs: [{skill, ref}], missing, skillFiles }。 */
export async function checkSkillRefs(root) {
  const refs = [];
  const skillFiles = [];
  let dirs = [];
  try {
    dirs = await fs.readdir(join(root, 'skill'));
  } catch {
    return { refs, missing: [], skillFiles }; // 没有 skill/ = 不是本仓库，跳过
  }
  for (const d of dirs) {
    const rel = `skill/${d}/SKILL.md`;
    let text = '';
    try {
      text = await fs.readFile(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    skillFiles.push(rel);
    for (const ref of extraResolveRefs(text)) refs.push({ skill: rel, ref });
  }
  const slugs = await pageSlugs(root);
  return { refs, missing: refs.filter((x) => !slugs.has(x.ref)), skillFiles };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..');
  const { refs, missing } = await checkSkillRefs(root);
  if (!refs.length) {
    console.log('✓ SKILL 里没有 abs resolve 引用（跳过）');
    process.exit(0);
  }
  if (missing.length) {
    for (const m of missing) {
      console.log(`✗ 死链: ${m.skill} 引用 \`abs resolve ${m.ref}\`，但 .brain 里没有这页`);
    }
    console.log(`\n${missing.length} 条死链 / 共 ${refs.length} 条引用 —— 「按需查」这条路是断的。`);
    process.exit(1);
  }
  console.log(`✓ SKILL 的 ${refs.length} 条 abs resolve 引用全部命中`);
}
