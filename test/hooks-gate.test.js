// test/hooks-gate.test.js — 直接跑 .githooks/ 里的门禁脚本，断言它真会拦。
//
// 为何需要：2026-10-07 审查发现 pre-push 的门禁是**假**的 ——
//   if ! npm test 2>&1 | tail -20; then
// 管道退出码取 tail 的（永远 0），测试挂了也放行，还照样打「✓ pre-push 通过」。
// 它能烂掉没人发现，是因为**没有任何测试跑过它**。门禁自己没人守 = 会烂。
//
// 判据只认一件事：脚本的退出码。不看输出文字（文字会被措辞改动带偏，
// "✓ 通过"这种假信号恰恰是原 bug 的表现）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** 造一个只含假 npm 的临时 PATH 目录（假 npm 按 exitCode 退出）。 */
function fakeNpmPath(exitCode, output = '') {
  const dir = mkdtempSync(join(tmpdir(), 'abs-fakenpm-'));
  const npm = join(dir, 'npm');
  writeFileSync(npm, `#!/bin/sh\necho "${output}"\nexit ${exitCode}\n`);
  chmodSync(npm, 0o755);
  return { dir, restore: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 跑一个 hook 脚本，返回 { status, stdout }。 */
function runHook(script, { pathPrefix } = {}) {
  const env = { ...process.env };
  if (pathPrefix) env.PATH = `${pathPrefix}:${env.PATH}`;
  const r = spawnSync('sh', [join(ROOT, '.githooks', script)], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
  return { status: r.status, stdout: (r.stdout || '') + (r.stderr || '') };
}

test('pre-push：测试失败必须拦截（拦不住 = 门禁是假的）', () => {
  const fake = fakeNpmPath(1, 'ℹ fail 3');
  try {
    const { status, stdout } = runHook('pre-push', { pathPrefix: fake.dir });
    assert.equal(status, 1, `测试失败时 pre-push 应退出 1，实际 ${status}。输出：\n${stdout}`);
    assert.match(stdout, /f ail 3|fail 3/, '失败摘要应打出来（否则用户不知道为什么被拦）');
    assert.doesNotMatch(stdout, /✓ pre-push 通过/, '失败时不该出现「通过」字样');
  } finally {
    fake.restore();
  }
});

test('pre-push：测试通过必须放行（别矫枉过正恒拦）', () => {
  const fake = fakeNpmPath(0, 'ℹ pass 545\nℹ fail 0');
  try {
    const { status, stdout } = runHook('pre-push', { pathPrefix: fake.dir });
    assert.equal(status, 0, `测试通过时应放行，实际 ${status}。输出：\n${stdout}`);
    assert.match(stdout, /✓ pre-push 通过/);
  } finally {
    fake.restore();
  }
});

test('pre-push：截断输出也不能吞掉退出码（原 bug 的形态）', () => {
  // 造超过 20 行的失败输出：若实现退回「管道 + tail」取码，这里就会漏拦。
  const fake = fakeNpmPath(1, Array.from({ length: 40 }, (_, i) => `line-${i}`).join('\n'));
  try {
    const { status } = runHook('pre-push', { pathPrefix: fake.dir });
    assert.equal(status, 1, '长输出 + 失败时必须仍拦截');
  } finally {
    fake.restore();
  }
});

test('pre-push：临时文件用完要清掉（别在 /tmp 攒垃圾）', () => {
  const fake = fakeNpmPath(0, 'ok');
  try {
    const before = tmpCount();
    runHook('pre-push', { pathPrefix: fake.dir });
    assert.equal(tmpCount(), before, 'pre-push 跑完后不该留下 abs-prepush.* 临时文件');
  } finally {
    fake.restore();
  }
});

function tmpCount() {
  try {
    const out = execFileSync('sh', ['-c', 'ls -1 "${TMPDIR:-/tmp}" 2>/dev/null | grep -c "^abs-prepush" || true'], {
      encoding: 'utf8',
    });
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
}
