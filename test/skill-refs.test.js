// test/skill-refs.test.js — SKILL 与图谱的引用门禁（2026-11-13 事故后加）。
//
// 事故：11-06 精简把 SKILL 长尾「移到两个图谱页」，但指针表 4/5 条写的是
// `abs resolve abs-skill-details` —— 这个页从未建过，「按需查」整条退路断了，
// 而且断得无声（abs resolve 未找到时退出码曾是 0，lint 又不读 SKILL.md）。
// 这组用例钉住三件事：引用必须命中、死链必须被抓、收尾循环的五步必须还在。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { checkSkillRefs, extraResolveRefs } from '../scripts/check-skill-refs.mjs';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('SKILL 的 abs resolve 引用', () => {
  test('本仓库 SKILL 的每一条引用都能在图谱里找到', async () => {
    const { refs, missing } = await checkSkillRefs(ROOT);
    assert.ok(refs.length > 0, 'SKILL 里应有 abs resolve 引用');
    assert.deepEqual(
      missing, [],
      `死链: ${missing.map((m) => `${m.skill} → ${m.ref}`).join(', ')}`,
    );
  });

  test('不存在的页会被抓出来（防门禁空转）', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'skillref-'));
    try {
      await fs.mkdir(join(root, 'skill', 'demo'), { recursive: true });
      await fs.mkdir(join(root, '.brain', 'concepts'), { recursive: true });
      await fs.writeFile(join(root, '.brain', 'concepts', 'real-page.md'), '# x\n');
      await fs.writeFile(join(root, 'skill', 'demo', 'SKILL.md'),
        '| a | `abs resolve real-page` |\n| b | `abs resolve ghost-page` |\n');
      const { refs, missing } = await checkSkillRefs(root);
      assert.equal(refs.length, 2);
      assert.deepEqual(missing.map((m) => m.ref), ['ghost-page']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('只认反引号里的 abs resolve 写法，不误伤散文', () => {
    assert.deepEqual(
      extraResolveRefs('查 `abs resolve a-b` 和 `abs resolve a-b` 与 `abs resolve c`\n散文提到 abs resolve d'),
      ['a-b', 'c'],
    );
  });

  test('SKILL 不得再指向从未存在的 abs-skill-details', async () => {
    const text = await fs.readFile(join(ROOT, 'skill', 'abs-agent-brain-sync', 'SKILL.md'), 'utf8');
    assert.ok(!text.includes('abs resolve abs-skill-details'), 'abs-skill-details 这个页不存在（11-06 死链事故）');
  });
});

describe('abs resolve 的退出码', () => {
  // 未找到时退出 0 会让所有脚本化检查当成命中 —— 这正是死链能活 7 天的原因。
  test('找不到页时退出码非 0', async () => {
    await assert.rejects(
      execFileAsync(process.execPath, [join(ROOT, 'bin', 'abs.js'), 'resolve', 'no-such-page-xyz'], { cwd: ROOT }),
      (e) => e.code === 1,
    );
  });

  test('找得到页时退出码 0', async () => {
    const { stdout } = await execFileAsync(
      process.execPath, [join(ROOT, 'bin', 'abs.js'), 'resolve', 'abs-skill-flow'], { cwd: ROOT },
    );
    assert.match(stdout, /✓ abs-skill-flow/);
  });
});

describe('收尾循环的内容留在图谱里', () => {
  // 11-06 的提交说明写「长尾移到两个图谱页」，实际这节没搬过去，全库只剩名字。
  // 这条用例保证五步 + 完成标准不会再一次悄无声息地消失。
  test('abs-skill-flow 里有五步对账与完成标准', async () => {
    const md = await fs.readFile(join(ROOT, '.brain', 'concepts', 'abs-skill-flow.md'), 'utf8');
    assert.match(md, /## 收尾循环/);
    for (const step of ['读 todo', '对账', '沉淀经验', 'Rules', '更新 index']) {
      assert.ok(md.includes(step), `收尾循环缺「${step}」`);
    }
    assert.match(md, /完成标准/);
  });

  test('SKILL 的判定表指向那页收尾循环', async () => {
    const text = await fs.readFile(join(ROOT, 'skill', 'abs-agent-brain-sync', 'SKILL.md'), 'utf8');
    assert.match(text, /abs resolve abs-skill-flow/, 'SKILL 要指到 abs-skill-flow');
    assert.match(text, /judge the session first|先判意图|Wrap up first/i);
  });
});
