// test/hosts.test.js — 四宿主定义的不变量。
//
// 为何测数据文件：这里的每个字段都直接被 install.js 用来决定"文件落到哪"，
// 抄错一个（比如 pi 的 skillSub 漏掉 agent/）就会把 skill 装到错误位置 ——
// 而且是静默的（装完没报错，宿主读不到）。原先 0% 覆盖。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HOSTS, hostByKey } from '../src/hosts.js';

describe('HOSTS — 定义不变量', () => {
  test('四个宿主齐全（claude-code / codex / opencode / pi）', () => {
    assert.deepEqual(
      HOSTS.map((h) => h.key).sort(),
      ['claude-code', 'codex', 'opencode', 'pi'],
    );
  });

  test('每项都有 render 需要的字段，且 key 不重复', () => {
    const keys = new Set();
    for (const h of HOSTS) {
      assert.ok(h.key, 'key 必填');
      assert.ok(!keys.has(h.key), `key 重复: ${h.key}`);
      keys.add(h.key);
      assert.equal(typeof h.label, 'string', `${h.key}.label 应是字符串`);
      assert.equal(typeof h.configRoot, 'function', `${h.key}.configRoot 应是函数`);
      assert.equal(typeof h.skillSub, 'string', `${h.key}.skillSub 应是字符串`);
      assert.ok(Array.isArray(h.events) && h.events.length, `${h.key}.events 应非空`);
    }
  });

  test('pi 的 skill 落点是 agent/skills（不是 skills）—— 抄错会静默装错位置', () => {
    assert.equal(hostByKey('pi').skillSub, 'agent/skills');
  });

  test('其余三宿主 skill 落点都是 skills', () => {
    for (const k of ['claude-code', 'codex', 'opencode']) {
      assert.equal(hostByKey(k).skillSub, 'skills', `${k} 的 skillSub`);
    }
  });
});

describe('configRoot — env 覆盖（测试/自定义安装靠它隔离）', () => {
  const cases = [
    ['claude-code', 'CLAUDE_CONFIG_DIR'],
    ['codex', 'CODEX_HOME'],
    ['opencode', 'ABS_OPENCODE_HOME'],
    ['pi', 'ABS_PI_HOME'],
  ];

  for (const [key, envName] of cases) {
    test(`${key} 尊重 ${envName}`, () => {
      const saved = process.env[envName];
      process.env[envName] = '/tmp/abs-probe-' + key;
      try {
        assert.equal(hostByKey(key).configRoot(), '/tmp/abs-probe-' + key);
      } finally {
        if (saved === undefined) delete process.env[envName];
        else process.env[envName] = saved;
      }
    });
  }

  test('未设 env 时回落到家目录下的默认位置', () => {
    const saved = process.env.ABS_PI_HOME;
    delete process.env.ABS_PI_HOME;
    try {
      const p = hostByKey('pi').configRoot();
      assert.ok(p.endsWith('/.pi'), `应回落到 ~/.pi，实际 ${p}`);
    } finally {
      if (saved !== undefined) process.env.ABS_PI_HOME = saved;
    }
  });
});

describe('hostConfigRoot / hostSkillDir — 落点计算（决定文件装到哪）', () => {
  // 这两个是 install.js 的入口，抄错 = 静默装到错位置（宿主读不到，装完不报错）。
  // 原先只有间接覆盖（安装测试里的副作用），没有直接钉住。

  test('hostConfigRoot 等价于 hostByKey(k).configRoot()', async () => {
    const { hostConfigRoot } = await import('../src/install.js');
    for (const h of HOSTS) {
      assert.equal(hostConfigRoot(h.key), h.configRoot(), `${h.key} 应一致`);
    }
  });

  test('hostSkillDir = <configRoot>/<skillSub>/abs-agent-brain-sync', async () => {
    const { hostConfigRoot, hostSkillDir } = await import('../src/install.js');
    for (const h of HOSTS) {
      const want = [hostConfigRoot(h.key), h.skillSub, 'abs-agent-brain-sync'].join('/');
      assert.equal(hostSkillDir(h.key), want, `${h.key} 落点`);
    }
  });

  test('pi 的 skill 落点带 agent/ 前缀（不是 <root>/skills）', async () => {
    const { hostSkillDir } = await import('../src/install.js');
    const saved = process.env.ABS_PI_HOME;
    process.env.ABS_PI_HOME = '/tmp/probe-pi';
    try {
      assert.equal(hostSkillDir('pi'), '/tmp/probe-pi/agent/skills/abs-agent-brain-sync');
    } finally {
      if (saved === undefined) delete process.env.ABS_PI_HOME;
      else process.env.ABS_PI_HOME = saved;
    }
  });

  test('installSummary 列出四个宿主（人看得懂的清单）', async () => {
    const { installSummary } = await import('../src/install.js');
    const s = installSummary();
    for (const h of HOSTS) assert.ok(s.includes(h.key), `应含 ${h.key}`);
  });
});

describe('hostByKey — 未知 key', () => {
  test('未知 key 抛错，且提示可用值（别让人猜）', () => {
    assert.throws(
      () => hostByKey('not-a-host'),
      (e) => {
        assert.match(e.message, /未知 agent/);
        assert.match(e.message, /claude-code/, '应列出可用 key');
        return true;
      },
    );
  });
});
