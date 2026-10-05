// test/userconfig.test.js — 作者名配置的三重守卫（写入侧 + 读侧警告）。
//
// 为何专测这个文件：它是**全局配置**的唯一写入口，而 {user} 是单一全局值 ——
// 写错一次会污染之后所有项目的每条记录（2026-09-18 实测：一次 `config set
// user tester` 让新项目每条 todo 都标 [[tester]]）。
// 原先只有间接覆盖，setUser 的三重校验（空/非法字符/占位名）没有专属用例。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  userConfigPath, getUser, setUser, requireUser, placeholderWarn, atTag,
} from '../src/userconfig.js';

let sandbox;
let savedUser;

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-user-'));
  process.env.ABS_CONFIG_DIR = sandbox;
  savedUser = process.env.ABS_USER;
  delete process.env.ABS_USER;   // 让落盘配置生效（env 优先级更高，留着会盖住）
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
  if (savedUser === undefined) delete process.env.ABS_USER;
  else process.env.ABS_USER = savedUser;
});

// beforeEach 清掉了 ABS_USER 让落盘生效，但下面有测试要用 env ——
// 测试内部需要 env 时自己设，afterEach 恢复。

describe('setUser — 三重校验（写入守卫）', () => {
  test('正常名字写入并保留其它键', async () => {
    await fs.writeFile(userConfigPath(), JSON.stringify({ other: 'KEEP' }), 'utf8');
    assert.equal(await setUser('fanchao'), 'fanchao');
    const cfg = JSON.parse(await fs.readFile(userConfigPath(), 'utf8'));
    assert.equal(cfg.user, 'fanchao');
    assert.equal(cfg.other, 'KEEP', '不该覆盖别的键');
  });

  test('空/纯空白 → 拒绝', async () => {
    await assert.rejects(() => setUser(''), /不能为空/);
    await assert.rejects(() => setUser('   '), /不能为空/);
    await assert.rejects(() => setUser(null), /不能为空/);
  });

  test('含空格/特殊字符 → 拒绝（会破坏 [[name]] 解析）', async () => {
    for (const bad of ['a b', 'a[[b]]', 'x/y', 'p|q', 'a\nb']) {
      await assert.rejects(() => setUser(bad), /不支持的字符/, `"${bad}" 应被拒`);
    }
  });

  test('占位名 → 拒绝（会污染之后所有项目）', async () => {
    for (const bad of ['tester', 'foo', 'admin', 'TEMP', 'Demo']) {
      await assert.rejects(() => setUser(bad), /占位名/, `"${bad}" 应被拒`);
    }
  });

  test('重复字符 → 拒绝，但两字母缩写与中文叠字要放行', async () => {
    for (const bad of ['aaa', 'xxx', '111']) {
      await assert.rejects(() => setUser(bad), /重复字符/, `"${bad}" 应被拒`);
    }
    // 长度门槛 ≥3：`oo`/`ee` 是合法缩写；`中中` 是常见小名 —— 原规则会误伤
    assert.equal(await setUser('oo'), 'oo');
    assert.equal(await setUser('ee'), 'ee');
    assert.equal(await setUser('中中'), '中中');
  });

  test('中文全名 / 带点带横线 → 放行', async () => {
    assert.equal(await setUser('张三'), '张三');
    assert.equal(await setUser('jean-luc'), 'jean-luc');
    assert.equal(await setUser('a.b'), 'a.b');
  });

  test('坏 JSON 的旧配置 → 重建而非崩（不静默丢弃用户意图）', async () => {
    await fs.writeFile(userConfigPath(), '{ 这不是 JSON', 'utf8');
    assert.equal(await setUser('fanchao'), 'fanchao');
    const cfg = JSON.parse(await fs.readFile(userConfigPath(), 'utf8'));
    assert.equal(cfg.user, 'fanchao');
  });
});

describe('getUser — 读取优先级', () => {
  test('ABS_USER 环境变量优先于落盘配置', async () => {
    await setUser('fromfile');
    process.env.ABS_USER = 'fromenv';
    assert.equal(await getUser(), 'fromenv');
    delete process.env.ABS_USER;
    assert.equal(await getUser(), 'fromfile');
  });

  test('非字符串 / 空串的 user 字段视为未设置', async () => {
    await fs.writeFile(userConfigPath(), JSON.stringify({ user: 123 }), 'utf8');
    assert.equal(await getUser(), null);
    await fs.writeFile(userConfigPath(), JSON.stringify({ user: '   ' }), 'utf8');
    assert.equal(await getUser(), null);
  });

  test('配置不存在 → null（不抛）', async () => {
    assert.equal(await getUser(), null);
  });
});

describe('requireUser — 写操作入口守卫', () => {
  test('未设置 → 抛带 NO_USER 码 + 两条出路的错', async () => {
    await assert.rejects(
      () => requireUser(),
      (e) => {
        assert.equal(e.code, 'NO_USER', 'hook 靠错误码区分「需配置」与真故障');
        assert.match(e.fallback, /config set user/);
        assert.match(e.fallback, /ABS_USER=/);
        return true;
      },
    );
  });

  test('已设置 → 返回名字', async () => {
    await setUser('fanchao');
    assert.equal(await requireUser(), 'fanchao');
  });
});

describe('placeholderWarn — 脏配置只报不改', () => {
  test('正常名字 → null（不打扰）', async () => {
    await setUser('fanchao');
    assert.equal(await placeholderWarn(), null);
  });

  test('历史遗留的占位名 → 报出来（靠这条被看见）', async () => {
    // 绕过 setUser 直接落盘，模拟历史脏配置
    await fs.writeFile(userConfigPath(), JSON.stringify({ user: 'tester' }), 'utf8');
    assert.equal(await placeholderWarn(), 'tester');
  });

  test('重复字符也算占位（与 assertRealName 同一判据）', async () => {
    await fs.writeFile(userConfigPath(), JSON.stringify({ user: 'aaa' }), 'utf8');
    assert.equal(await placeholderWarn(), 'aaa');
  });

  test('未设置 → null（没有可警告的）', async () => {
    assert.equal(await placeholderWarn(), null);
  });
});

describe('atTag — 作者标记', () => {
  test('产出 wikilink 形态（人是图谱实体，点得进去）', () => {
    assert.equal(atTag('fanchao'), '[[fanchao]]');
  });
});
