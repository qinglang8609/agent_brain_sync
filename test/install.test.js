// test/install.test.js — 安装器 (src/install.js) 深度测试。
// 覆盖: 四宿主(claude-code/codex/opencode/pi)配置烧录、幂等重装、卸载只删自己(R3)、
//       skill 落点随 config 根 env 走(R2)、备份、hook 脚本模板替换正确。
// 隔离关键: homedir() 在进程首次调用即缓存 —— 故全部在 child_process 里以沙盒 $HOME + env 跑,
//           绝不写真实 ~/.claude ~/.abs ~/.codex 等。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(REPO, 'bin', 'abs.js');

let sandbox;
let HOME;         // 沙盒 HOME (homedir() 会返回这里)
let CC_CFG;       // CLAUDE_CONFIG_DIR
let CODEX_CFG;    // CODEX_HOME

/** 默认沙盒 env: 覆盖 HOME + 各宿主 config 根到 sandbox 下。 */
function sbEnv(extra = {}) {
  return {
    ...process.env,
    HOME,
    CLAUDE_CONFIG_DIR: CC_CFG,
    CODEX_HOME: CODEX_CFG,
    ABS_OPENCODE_HOME: join(sandbox, 'opencode'),
    ABS_PI_HOME: join(sandbox, 'pi'),
    ...extra,
  };
}

function run(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: sandbox,
      env: sbEnv(opts.env),
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
  });
}

beforeEach(async () => {
  sandbox = await fs.mkdtemp(join(tmpdir(), 'abs-install-'));
  HOME = join(sandbox, 'home');
  CC_CFG = join(sandbox, 'cc');
  CODEX_CFG = join(sandbox, 'codex');
  await fs.mkdir(HOME, { recursive: true });
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

const CC_SETTINGS = () => join(CC_CFG, 'settings.json');

// ---------- claude-code 完整安装 ----------
describe('install claude-code', () => {
  test('hooks + mcp + skill 全落盘到 env 指定的 config 根 (R2: skill 不落真 home)', async () => {
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    // settings.json 在 CLAUDE_CONFIG_DIR
    const settings = JSON.parse(await fs.readFile(CC_SETTINGS(), 'utf8'));
    // hooks 覆盖 4 事件
    for (const ev of ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']) {
      assert.ok(settings.hooks[ev], `缺 hook ${ev}`);
    }
    // mcpServers.abs
    assert.ok(settings.mcpServers?.abs?.command, '缺 mcpServers.abs');
    // staged hook 脚本在 fake $HOME/.abs/hooks/claude-code/ (homedir 跟随 HOME)
    await fs.access(join(HOME, '.abs', 'hooks', 'claude-code', 'abs-Stop.sh'));
    // R2 验证: skill 落在 CLAUDE_CONFIG_DIR/skills, 而非真实 ~/.claude
    await fs.access(join(CC_CFG, 'skills', 'abs-agent-brain-sync', 'SKILL.md'));
    // 不应在 HOME/.claude 建 skill
    await assert.rejects(() => fs.access(join(HOME, '.claude', 'skills', 'abs-agent-brain-sync', 'SKILL.md')));
  });

  test('幂等: 重装不抛错、配置仍单份', async () => {
    await run(['install', '--agent', 'claude-code', '--yes']);
    const r2 = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r2.code, 0, r2.stderr);
    const settings = JSON.parse(await fs.readFile(CC_SETTINGS(), 'utf8'));
    // mcpServers.abs 仍单条 (不因重装成数组/重复)
    assert.equal(settings.mcpServers.abs.command, process.execPath);
  });
});

// ---------- codex ----------
describe('install codex', () => {
  test('hooks.json + config.toml + skill 落 CODEX_HOME', async () => {
    const r = await run(['install', '--agent', 'codex', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const hooks = JSON.parse(await fs.readFile(join(CODEX_CFG, 'hooks.json'), 'utf8'));
    assert.ok(Array.isArray(hooks.hooks) && hooks.hooks.length > 0);
    const toml = await fs.readFile(join(CODEX_CFG, 'config.toml'), 'utf8');
    assert.ok(toml.includes('[mcp_servers.abs]'), toml);
    await fs.access(join(CODEX_CFG, 'skills', 'abs-agent-brain-sync', 'SKILL.md'));
  });
});

// ---------- opencode / pi ----------
describe('install opencode / pi', () => {
  test('opencode ts plugin + mcp json + skill 落 config 根', async () => {
    const r = await run(['install', '--agent', 'opencode', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    await fs.access(join(sandbox, 'opencode', 'plugins', 'abs.ts'));
    const json = JSON.parse(await fs.readFile(join(sandbox, 'opencode', 'opencode.json'), 'utf8'));
    assert.ok(json.mcp?.abs?.command);
    await fs.access(join(sandbox, 'opencode', 'skills', 'abs-agent-brain-sync', 'SKILL.md'));
  });

  test('pi ts extension + skill 落 config 根', async () => {
    const r = await run(['install', '--agent', 'pi', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    await fs.access(join(sandbox, 'pi', 'agent', 'extensions', 'abs.ts'));
    await fs.access(join(sandbox, 'pi', 'agent', 'skills', 'abs-agent-brain-sync', 'SKILL.md'));
  });

  // 回归: 插件生命周期事件只进技术日志 hooks.log, 不得 spawn `abs log` 灌图谱 log.md。
  // (曾有 [pi:session_start]/[opencode:session.start] 垃圾行刷进 .brain/log.md)
  test('pi/opencode 插件不写图谱 log.md — 无 abs log 调用, 有 hooks.log 直写', async () => {
    await run(['install', '--agent', 'pi', '--yes']);
    await run(['install', '--agent', 'opencode', '--yes']);
    const pi = await fs.readFile(join(sandbox, 'pi', 'agent', 'extensions', 'abs.ts'), 'utf8');
    const oc = await fs.readFile(join(sandbox, 'opencode', 'plugins', 'abs.ts'), 'utf8');
    // 精确匹配旧模板的 spawn 形态: [ABS_BIN, "log", ...] (勿匹配 join(..., "log") 合法路径段)
    for (const [name, src] of [['pi', pi], ['opencode', oc]]) {
      assert.ok(!/\[ABS_BIN,\s*"log"/.test(src), `${name} 插件不得 spawn abs log`);
      assert.ok(src.includes('hooks.log'), `${name} 插件应直写技术日志 hooks.log`);
      assert.ok(src.includes('appendFile'), `${name} 插件应用 appendFile 落技术日志`);
    }
  });
});

// ---------- 未知 agent ----------
describe('install 边界', () => {
  test('未知 agent 非零退出', async () => {
    const r = await run(['install', '--agent', 'vim', '--yes']);
    assert.notEqual(r.code, 0);
    assert.ok(r.stderr.includes('未知 agent'), r.stderr);
  });
});

// ---------- 与既有 hook 框架共存 (moshi-hook 场景) ----------
describe('共存: 追加 abs 而非覆盖既有 hook', () => {
  /** 预置一个已被 moshi-hook 占用的 settings.json (模拟真实用户环境) */
  async function seedMoshi() {
    await fs.mkdir(CC_CFG, { recursive: true });
    const moshi = (cmd) => ({ hooks: [{ type: 'command', command: cmd, async: true }] });
    await fs.writeFile(CC_SETTINGS(), JSON.stringify({
      hooks: {
        SessionStart: [moshi("'moshi' claude-hook")],
        Stop: [moshi("'moshi' claude-hook")],
        SessionEnd: [moshi("'moshi' claude-hook")],
        UserPromptSubmit: [moshi("'moshi' claude-hook")],
      },
    }, null, 2), 'utf8');
  }
  const count = (arr, mark) => (arr || []).filter((e) =>
    e.hooks?.some?.((h) => String(h.command || '').includes(mark))).length;

  test('install 后: moshi 保留 + abs 追加, 每事件 2 条', async () => {
    await seedMoshi();
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const s = JSON.parse(await fs.readFile(CC_SETTINGS(), 'utf8'));
    for (const ev of ['SessionStart', 'Stop', 'SessionEnd', 'UserPromptSubmit']) {
      const arr = s.hooks[ev];
      assert.ok(arr, `缺 ${ev}`);
      assert.equal(arr.length, 2, `${ev} 应 moshi+abs 共 2 条, 实际 ${arr.length}`);
      assert.equal(count(arr, "'moshi'"), 1, `${ev} 应保留 1 条 moshi`);
      assert.equal(count(arr, '/.abs/hooks/'), 1, `${ev} 应追加 1 条 abs`);
    }
  });

  test('重装幂等: 仍是 moshi1+abs1, 不叠加', async () => {
    await seedMoshi();
    await run(['install', '--agent', 'claude-code', '--yes']);
    await run(['install', '--agent', 'claude-code', '--yes']); // 重装
    const s = JSON.parse(await fs.readFile(CC_SETTINGS(), 'utf8'));
    for (const ev of ['SessionStart', 'Stop']) {
      assert.equal(s.hooks[ev].length, 2, `${ev} 重装后应仍 2 条`);
      assert.equal(count(s.hooks[ev], '/.abs/hooks/'), 1, `${ev} abs 应只 1 条`);
    }
  });

  test('卸载后: 只删 abs, 保留 moshi', async () => {
    await seedMoshi();
    await run(['install', '--agent', 'claude-code', '--yes']);
    const r = await run(['uninstall', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const s = JSON.parse(await fs.readFile(CC_SETTINGS(), 'utf8'));
    for (const ev of ['SessionStart', 'Stop', 'SessionEnd', 'UserPromptSubmit']) {
      const arr = s.hooks[ev];
      assert.ok(arr, `缺 ${ev}`);
      assert.equal(arr.length, 1, `${ev} 卸载后应只剩 moshi 1 条`);
      assert.equal(count(arr, "'moshi'"), 1, `${ev} moshi 应保留`);
      assert.equal(count(arr, '/.abs/hooks/'), 0, `${ev} abs 应已删`);
    }
    assert.ok(!s.mcpServers?.abs, 'abs mcp 应移除');
  });

  test('卸载后事件无共存 hook 时整删该事件(老场景: 无 moshi 预置)', async () => {
    await run(['install', '--agent', 'claude-code', '--yes']); // 全新无预置
    await run(['uninstall', '--agent', 'claude-code', '--yes']);
    const s = JSON.parse(await fs.readFile(CC_SETTINGS(), 'utf8'));
    assert.ok(!s.hooks?.SessionStart, '无共存时应整删 SessionStart');
  });
});

// ---------- 卸载只删自己 (R3) ----------
describe('uninstall 只删本 agent, 不误删其它', () => {
  test('装 claude-code + codex, 卸 claude-code 后 codex 的 hook 脚本仍在', async () => {
    await run(['install', '--agent', 'claude-code', '--yes']);
    await run(['install', '--agent', 'codex', '--yes']);
    // codex 也 stage 了 hook 到 ~/.abs/hooks/codex/ (stageHookScripts 共用 ~/.abs)
    await fs.access(join(HOME, '.abs', 'hooks', 'codex', 'abs-Stop.sh'));
    const r = await run(['uninstall', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    // R3: ~/.abs 整体不应被删 —— codex 的脚本必须保留
    await fs.access(join(HOME, '.abs', 'hooks', 'codex', 'abs-Stop.sh'));
    // claude-code 自己的脚本应被删
    await assert.rejects(() => fs.access(join(HOME, '.abs', 'hooks', 'claude-code', 'abs-Stop.sh')));
    // settings.json 的 abs hooks/mcp 应清掉
    const settings = JSON.parse(await fs.readFile(CC_SETTINGS(), 'utf8'));
    assert.ok(!settings.hooks?.SessionStart, 'abs hook 应移除');
    assert.ok(!settings.mcpServers?.abs, 'abs mcp 应移除');
  });

  test('卸载残留 mcp.log (非 hooks) 目录不清空', async () => {
    // 先在 ~/.abs/log 造一个非本 agent 文件, 卸载 claude-code 后应保留
    await fs.mkdir(join(HOME, '.abs', 'log'), { recursive: true });
    await fs.writeFile(join(HOME, '.abs', 'log', 'mcp.log'), 'x', 'utf8');
    await run(['install', '--agent', 'claude-code', '--yes']);
    await run(['uninstall', '--agent', 'claude-code', '--yes']);
    await fs.access(join(HOME, '.abs', 'log', 'mcp.log'));
  });
});
