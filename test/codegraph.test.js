// test/codegraph.test.js — 影响面查询的优雅降级。
//
// 为何测：impactOf 依赖外部 codegraph 二进制。它的契约是**装不到就返回 null**
// （调用方 note.js 据此决定要不要写影响面），绝不能抛 —— 否则 note 这条
// 常用写入路径在没有 codegraph 的机器上全挂。原先 0% 覆盖。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { impactOf } from '../src/codegraph.js';

let sandbox;
let savedPath;

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-cg-'));
  savedPath = process.env.PATH;
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
  if (savedPath === undefined) delete process.env.PATH;
  else process.env.PATH = savedPath;
});

describe('impactOf — 降级契约（不抛，返回 null）', () => {
  test('空符号 → null（不做无意义的查询）', async () => {
    assert.equal(await impactOf('', sandbox), null);
    assert.equal(await impactOf('   ', sandbox), null);
    assert.equal(await impactOf(null, sandbox), null);
    assert.equal(await impactOf(undefined, sandbox), null);
  });

  test('codegraph 不可用时 → null 而非抛（无 codegraph 的机器上 note 不能挂）', async () => {
    // 把 PATH 清空 → 任何二进制都找不到
    process.env.PATH = '';
    const r = await impactOf('someSymbol', sandbox);
    assert.equal(r, null, '不可用时应安静返回 null');
  });

  test('root 不存在也不抛（查询失败一律降级）', async () => {
    process.env.PATH = '';
    await assert.doesNotReject(() => impactOf('sym', '/tmp/definitely-not-here-' + Date.now()));
  });

  test('返回类型契约：字符串或 null（调用方据此写与不写）', async () => {
    process.env.PATH = '';
    const r = await impactOf('abs', sandbox);
    assert.ok(r === null || typeof r === 'string', `应是 string|null，实际 ${typeof r}`);
  });
});
