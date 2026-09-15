// test/install.test.js — 安装器 (src/install.js) 深度测试。
// 覆盖: 四宿主(claude-code/codex/opencode/pi)配置烧录、幂等重装、卸载只删自己(R3)、
//       skill 落点随 config 根 env 走(R2)、备份、hook 脚本模板替换正确。
// 隔离关键: homedir() 在进程首次调用即缓存 —— 故全部在 child_process 里以沙盒 $HOME + env 跑,
//           绝不写真实 ~/.claude ~/.abs ~/.codex 等。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
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
  const env = {
    ...process.env,
    HOME,
    CLAUDE_CONFIG_DIR: CC_CFG,
    CODEX_HOME: CODEX_CFG,
    ABS_OPENCODE_HOME: join(sandbox, 'opencode'),
    ABS_PI_HOME: join(sandbox, 'pi'),
    ...extra,
  };
  // 清掉 npm 注入的变量，让子进程看到与真实用户一致的环境。
  // 坑: 跑 npm test / npx 时 npm_config_prefix 会被自动设置，而 stableBinPath
  // 恰好因它命中"全局包"分支 —— 于是即使默认候选已写坏（少一层 ..），
  // 测试仍会变绿，掩盖真实回归。手动跑 abs install 的用户环境里该变量为空。
  delete env.npm_config_prefix;
  delete env.npm_config_global_prefix;
  return env;
}

const ABS_HOOK_MARK = '/.abs/hooks/';
/** 测试侧判定: 条目是否 abs 装的(兼容 {hooks:[{command}]} 与扁平 {command})。 */
function entryHasAbsLocal(e) {
  const hs = e && e.hooks ? (Array.isArray(e.hooks) ? e.hooks : [e.hooks]) : [];
  return hs.some((h) => String(h?.command || '').includes(ABS_HOOK_MARK));
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
    // Codex 真实形态: 对象 {EventName: [{hooks:[{command}]}]}
    assert.ok(hooks.hooks && !Array.isArray(hooks.hooks), 'hooks 应为对象映射');
    const evs = Object.keys(hooks.hooks);
    assert.ok(evs.length > 0);
    for (const ev of evs) {
      const arr = hooks.hooks[ev];
      assert.ok(Array.isArray(arr) && arr.length === 1, `${ev} 应 1 条`);
      assert.ok(arr[0].hooks[0].command.includes('/.abs/hooks/'), `${ev} command 指向 ~/.abs/hooks/`);
    }
    const toml = await fs.readFile(join(CODEX_CFG, 'config.toml'), 'utf8');
    assert.ok(toml.includes('[mcp_servers.abs]'), toml);
    await fs.access(join(CODEX_CFG, 'skills', 'abs-agent-brain-sync', 'SKILL.md'));

  // 回归: 曾经只找单行 `/^\s*args\s*=/` 并原地替换 —— args 写成多行数组时
  // 那一行不匹配，走 else 只打印"无 args 行, 未动"，旧路径**静默保留**成陈旧配置。
  test('args 写成多行数组时也被校正 (不再静默留旧路径)', async () => {
    await fs.mkdir(CODEX_CFG, { recursive: true });
    const stale = '/Users/someone/Code/skills/agent_brain_sync/bin/mcp.js';
    await fs.writeFile(join(CODEX_CFG, 'config.toml'), [
      'model = "gpt-5"',
      '',
      '[mcp_servers.abs]',
      'command = "/old/node"',
      'args = [',
      `  "${stale}",`,
      ']',
      '',
      '[mcp_servers.other]',
      'command = "z"',
      '',
    ].join('\n'), 'utf8');
    const r = await run(['install', '--agent', 'codex', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const toml = await fs.readFile(join(CODEX_CFG, 'config.toml'), 'utf8');
    assert.ok(!toml.includes(stale), '陈旧路径必须被清掉: ' + toml);
    assert.ok(toml.includes('node_modules'), '应写入稳定全局路径: ' + toml);
    assert.ok(toml.includes('[mcp_servers.other]'), '其它 section 不得丢');
    assert.ok(toml.includes('command = "/old/node"'), 'command 不得改');
  });

  test('section 无 args 行时整段补写 args (不再只提示不动)', async () => {
    await fs.mkdir(CODEX_CFG, { recursive: true });
    await fs.writeFile(join(CODEX_CFG, 'config.toml'), [
      '[mcp_servers.abs]',
      'command = "/old/node"',
      '',
    ].join('\n'), 'utf8');
    const r = await run(['install', '--agent', 'codex', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const toml = await fs.readFile(join(CODEX_CFG, 'config.toml'), 'utf8');
    assert.ok(toml.includes('args = ['), '应补上 args: ' + toml);
    assert.ok(toml.includes('node_modules'), toml);
  });

  test('args 旧但 command 含正确串时, 不误判为"已是正确路径"', async () => {
    // 坑: 旧代码用 body.includes(`"${want}"`) 判等 —— command 行里恰好出现同串就被骗过。
    await fs.mkdir(CODEX_CFG, { recursive: true });
    const rr = await run(['install', '--agent', 'codex', '--yes']);
    assert.equal(rr.code, 0, rr.stderr);
    let toml = await fs.readFile(join(CODEX_CFG, 'config.toml'), 'utf8');
    const want = toml.match(/args = \["([^"]+)"\]/)[1];
    toml = toml.replace('args = ["' + want + '"]', 'args = ["/stale/old/mcp.js"]');
    toml = toml.replace(/command = "[^"]*"/, 'command = "' + want + '"');
    await fs.writeFile(join(CODEX_CFG, 'config.toml'), toml, 'utf8');
    const r = await run(['install', '--agent', 'codex', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const after = await fs.readFile(join(CODEX_CFG, 'config.toml'), 'utf8');
    assert.ok(!after.includes('/stale/old/mcp.js'), 'args 的旧路径必须被校正: ' + after);
  });

  });

  // 回归: 三处 MCP 注册曾用 join(ABS_DIR,...) —— ABS_DIR = "install.js 自己住哪",
  // 从仓库跑 abs install 就把仓库路径写进宿主配置(不稳定: 移包/卸全局即失效)。
  // 且 codex 分支"已存在即跳过" → 写错永不修正。
  test('MCP 路径写稳定的全局安装位置, 而非仓库路径', async () => {
    const r = await run(['install', '--agent', 'codex', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const toml = await fs.readFile(join(CODEX_CFG, 'config.toml'), 'utf8');
    const m = toml.match(/\[mcp_servers\.abs\][^\[]*?args\s*=\s*\["([^"]+)"\]/s);
    assert.ok(m, `应写入 abs MCP args: ${toml}`);
    const written = m[1];
    assert.ok(written.endsWith('/bin/mcp.js'), `应指向 mcp.js: ${written}`);
    assert.ok(written.startsWith('/'), `必须是绝对路径: ${written}`);
    // 核心断言: 若本机存在全局安装, 必须写全局路径而不是仓库路径。
    // (若不存在全局包, 回退仓库路径可以接受 —— 但那时本断言跳过)
    const repoMcp = join(REPO, 'bin', 'mcp.js');
    const globalMcp = join(dirname(process.execPath), '..', 'lib', 'node_modules',
      '@fanchao8609/agent_brain_sync', 'bin', 'mcp.js');
    if (existsSync(globalMcp)) {
      assert.equal(written, globalMcp,
        `存在全局包时应写全局路径(稳定), 而非仓库路径(移包/卸全局即失效): ${written}`);
      assert.notEqual(written, repoMcp, '绝不能写仓库路径');
    }
  });

  // 回归: 已存在的 abs 条目若路径过时(旧版写过仓库路径), 重装应校正
  test('已存在但路径过时的 abs MCP 条目会被校正', async () => {
    await fs.mkdir(CODEX_CFG, { recursive: true });
    const p = join(CODEX_CFG, 'config.toml');
    await fs.writeFile(p, '\n[mcp_servers.abs]\ncommand = "/usr/bin/node"\nargs = ["/stale/old/bin/mcp.js"]\n');
    const r = await run(['install', '--agent', 'codex', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const toml = await fs.readFile(p, 'utf8');
    assert.ok(!toml.includes('/stale/old/'), `陈旧路径应被替换: ${toml}`);
    assert.ok(toml.includes('[mcp_servers.abs]'), '条目应保留');
  });

  test('对象形态 hooks.json 幂等重装 + 保留既有 hook; 卸载只删 abs', async () => {
    const p = join(CODEX_CFG, 'hooks.json');
    await fs.mkdir(CODEX_CFG, { recursive: true });
    await fs.writeFile(p, JSON.stringify({ hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'moshi-hook' }] }] } }));
    for (let i = 0; i < 2; i++) {
      const r = await run(['install', '--agent', 'codex', '--yes']);
      assert.equal(r.code, 0, r.stderr);
    }
    const cfg = JSON.parse(await fs.readFile(p, 'utf8'));
    assert.equal(cfg.hooks.Stop.length, 2, '重装后 Stop 应 1 既有 + 1 abs');
    assert.equal(cfg.hooks.Stop.filter(entryHasAbsLocal).length, 1, 'abs 只 1 条');
    const u = await run(['uninstall', '--agent', 'codex', '--yes']);
    assert.equal(u.code, 0, u.stderr);
    const after = JSON.parse(await fs.readFile(p, 'utf8'));
    assert.equal((after.hooks.Stop || []).filter(entryHasAbsLocal).length, 0, 'abs 已删');
    assert.equal((after.hooks.Stop || []).length, 1, 'moshi 保留');
  });

  test('扁平数组形态 hooks.json 不报错且迁移为对象', async () => {
    const p = join(CODEX_CFG, 'hooks.json');
    await fs.mkdir(CODEX_CFG, { recursive: true });
    await fs.writeFile(p, JSON.stringify({ hooks: [{ event: 'Stop', command: 'legacy-cmd' }] }));
    const r = await run(['install', '--agent', 'codex', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const cfg = JSON.parse(await fs.readFile(p, 'utf8'));
    assert.ok(!Array.isArray(cfg.hooks), '应迁移为对象');
    assert.equal(cfg.hooks.Stop.length, 2, 'legacy 保留 + abs 追加');
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

  // pi 的 skill 扇出交给 CC Switch（常驻自动同步器, skillOwner: 'cc-switch'）——
  // abs 再写同一批路径就是两个写入者互相覆盖; 且 pi 同时扫 ~/.pi/agent/skills
  // 与 ~/.agents/skills, 同名实体两份会被判成 skill 冲突。
  test('pi: 只装 hook/MCP, 不碰 skill（skillOwner=cc-switch 时让路）', async () => {
    const r = await run(['install', '--agent', 'pi', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    await fs.access(join(sandbox, 'pi', 'agent', 'extensions', 'abs.ts'));
    assert.ok(r.stdout.includes('交给 cc-switch 管'), '应说明让路: ' + r.stdout);
    assert.ok(!existsSync(join(sandbox, 'pi', 'agent', 'skills')), 'pi 不该写入任何 skill');
  });

  // ---------- skill 包规则: skill/ 下每个含 SKILL.md 的子目录 = 一个 skill ----------
  // 目录名 = 宿主安装目录名 = frontmatter name（三者必须一致，否则 pi 告警）。
  // 坑: 曾把附带 skill 装成不带前缀的 bug-hunter，与 ~/.agents/skills/bug-hunter
  //   （pi 也扫那个目录）同名 —— 两份同名实文件 → pi 报 skill 冲突。现全带 abs- 前缀。
  test('skill/ 下每个子目录都装进宿主，源与目标逐字节一致', async () => {
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const root = join(CC_CFG, 'skills');
    const want = (await fs.readdir(join(REPO, 'skill'), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    assert.ok(want.length >= 2, '至少应有主 skill + 附带 skill: ' + want);
    for (const name of want) {
      const got = await fs.readFile(join(root, name, 'SKILL.md'), 'utf8');
      const src = await fs.readFile(join(REPO, 'skill', name, 'SKILL.md'), 'utf8');
      assert.equal(got, src, `${name}: 副本漂移`);
    }
    // 反面: 不带 abs- 前缀的名字不该出现
    assert.ok(!existsSync(join(root, 'bug-hunter')), '不该装出不带前缀的副本');
  });

  test('abs 自管的宿主都装全部 skill', async () => {
    const want = (await fs.readdir(join(REPO, 'skill'), { withFileTypes: true }))
      .filter((e) => e.isDirectory()).map((e) => e.name);
    for (const [agent, root] of [
      ['claude-code', CC_CFG],
      ['codex', CODEX_CFG],
      ['opencode', join(sandbox, 'opencode')],
    ]) {
      const r = await run(['install', '--agent', agent, '--yes']);
      assert.equal(r.code, 0, `${agent}: ${r.stderr}`);
      for (const name of want) await fs.access(join(root, 'skills', name, 'SKILL.md'));
    }
  });

  // 卸载残留: 曾经只有 claude-code 删附带 skill，其余三宿主留下 abs-bug-hunter/
  test('卸载清理全部 skill，不留残留', async () => {
    for (const [agent, root] of [
      ['claude-code', CC_CFG],
      ['codex', CODEX_CFG],
      ['opencode', join(sandbox, 'opencode')],
    ]) {
      await run(['install', '--agent', agent, '--yes']);
      await fs.access(join(root, 'skills', 'abs-bug-hunter', 'SKILL.md'));
      const r = await run(['uninstall', '--agent', agent, '--yes']);
      assert.equal(r.code, 0, `${agent}: ${r.stderr}`);
      assert.ok(!existsSync(join(root, 'skills', 'abs-bug-hunter')), `${agent}: 卸载后不应留 abs-bug-hunter/`);
      assert.ok(!existsSync(join(root, 'skills', 'abs-agent-brain-sync')), `${agent}: 卸载后不应留主 skill`);
    }
  });

  // pi 已交给 CC Switch, 但历史上 abs 往那儿写过 —— 卸载要还这笔账
  test('卸载仍清理 pi 的历史 skill 副本（欠账要还）', async () => {
    const root = join(sandbox, 'pi', 'agent', 'skills');
    await fs.mkdir(join(root, 'abs-bug-hunter'), { recursive: true });
    await fs.writeFile(join(root, 'abs-bug-hunter', 'SKILL.md'), 'stale', 'utf8');
    const r = await run(['uninstall', '--agent', 'pi', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!existsSync(join(root, 'abs-bug-hunter')), '卸载后不应留历史副本');
  });

  // 回归: 曾经 withMcp 只打印「走 extension 内桥接」而没有任何桥接代码 ——
  // 靠 mcp-adapter 的 hostConfigDiscovery 间接读到 claude 注册才"看起来能用",
  // 没有 claude 宿主的机器上 abs MCP 直接缺失。必须真写 mcp.json。
  test('pi 必须真注册 MCP 到 mcp.json (不能只靠 hostConfigDiscovery 间接发现)', async () => {
    await run(['install', '--agent', 'pi', '--yes']);
    const cfg = JSON.parse(await fs.readFile(join(sandbox, 'pi', 'agent', 'mcp.json'), 'utf8'));
    const entry = cfg.mcpServers?.abs;
    assert.ok(entry, 'mcpServers.abs 必须存在');
    assert.equal(entry.type, 'stdio');
    assert.ok(entry.args[0].endsWith('bin/mcp.js'), 'args 应指向 bin/mcp.js');
  });

  test('pi MCP 幂等重装 + 不覆盖既有 mcpServers / settings / imports', async () => {
    const p = join(sandbox, 'pi', 'agent', 'mcp.json');
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify({
      mcpServers: { other: { command: 'foo' } },
      settings: { hostConfigDiscovery: 'on' },
      imports: ['claude-code'],
    }));
    await run(['install', '--agent', 'pi', '--yes']);
    const first = await fs.readFile(p, 'utf8');
    await run(['install', '--agent', 'pi', '--yes']);
    assert.equal(await fs.readFile(p, 'utf8'), first, '重装必须幂等');
    const cfg = JSON.parse(first);
    assert.ok(cfg.mcpServers.other, '既有 mcpServers 条目必须保留');
    assert.equal(cfg.settings.hostConfigDiscovery, 'on', '既有 settings 必须保留');
    assert.deepEqual(cfg.imports, ['claude-code'], '既有 imports 必须保留');
  });

  test('pi 卸载只删 mcpServers.abs, 保留其它宿主体', async () => {
    const p = join(sandbox, 'pi', 'agent', 'mcp.json');
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify({ mcpServers: { other: { command: 'foo' } } }));
    await run(['install', '--agent', 'pi', '--yes']);
    await run(['uninstall', '--agent', 'pi', '--yes']);
    const cfg = JSON.parse(await fs.readFile(p, 'utf8'));
    assert.ok(!cfg.mcpServers.abs, 'abs 必须被移除');
    assert.ok(cfg.mcpServers.other, '别人的 MCP 不能被误删');
  });

  // 回归: 收尾注入必须在 agent_end 上(只挂 session_shutdown 时, 干活到一半永远不触发收尾)。
  test('pi 扩展挂 agent_end 收尾注入: 真改过文件 + 今日未收尾才注入, 每会话一次', async () => {
    await run(['install', '--agent', 'pi', '--yes']);
    const src = await fs.readFile(join(sandbox, 'pi', 'agent', 'extensions', 'abs.ts'), 'utf8');
    assert.ok(/pi\.on\("agent_end"/.test(src), '必须在 agent_end 挂收尾注入(不只 session_shutdown)');
    assert.ok(src.includes('sendUserMessage'), '应用 sendUserMessage 注入收尾指令(而非只记日志)');
    assert.ok(src.includes('followUp'), '流式中注入应用 deliverAs: followUp');
    assert.ok(src.includes('teardownNudged'), '应有每会话一次的节流标志');
    assert.ok(src.includes('hasWriteWork'), '应只在本会话真改过文件时触发');
    assert.ok(src.includes('loggedToday'), '今日已收尾则不再打扰');
    assert.ok(src.includes('findBrain'), '无 .brain 的项目不打扰');
    // 只读命令不得触发(bash 里跑 ls/grep 不算改文件)
    assert.ok(src.includes('READONLY_CMD'), '应区分只读 bash 与真改文件');
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

  // 回归: opencode 插件曾把 event 回调入参写成 ({ name }), 但官方 API 是 ({ event }) 且事件名在
  // event.type —— 导致 name 恒 undefined, 插件从未触发(0 条日志) 静默失效。
  test('opencode 插件用正确的 event 回调签名与事件名 (event.type, 非 name)', async () => {
    await run(['install', '--agent', 'opencode', '--yes']);
    const src = await fs.readFile(join(sandbox, 'opencode', 'plugins', 'abs.ts'), 'utf8');
    assert.ok(/event:\s*async\s*\(\{\s*event\s*\}\)/.test(src), 'event 回调应解构 { event }');
    assert.ok(!/event:\s*async\s*\(\{\s*name\s*\}\)/.test(src), '不得再用错误的 ({ name }) 签名');
    assert.ok(src.includes('event.type') || src.includes('event && event.type'), '应从 event.type 取事件名');
    assert.ok(!src.includes('"session.start"') && !src.includes('"session.end"'), 'opencode 事件名不是 session.start/end');
    assert.ok(src.includes('session.idle'), '应用 session.idle 作为每轮结束信号');
  });

  // 回归: opencode 加载器取 default 导出; 用 export const 命名导出会被静默忽略
  // (实际踩过: 签名/事件名都修对了, 但导出方式错 → 插件仍不加载, 日志恒 0 条)。
  test('opencode 插件用 default 导出 (mod.default.server), 非命名导出', async () => {
    await run(['install', '--agent', 'opencode', '--yes']);
    const src = await fs.readFile(join(sandbox, 'opencode', 'plugins', 'abs.ts'), 'utf8');
    assert.ok(/export default \{/.test(src), '应有 export default { id, server }');
    assert.ok(/^\s*server,?\s*$/m.test(src), 'default 应挂 server 字段');
    assert.ok(!/export const AbsPlugin/.test(src), '不得用命名导出(加载器取 default, 命名导出被忽略)');
    assert.ok(/const server = async \(\{ client, directory \}\)/.test(src), 'server 应接收 { client, directory }');
  });

  // 回归: opencode 侧的收尾自动化 (与 pi 的 agent_end 同策略)
  test('opencode 插件 session.idle 收尾注入: 真改过文件才推, 每会话一次', async () => {
    await run(['install', '--agent', 'opencode', '--yes']);
    const src = await fs.readFile(join(sandbox, 'opencode', 'plugins', 'abs.ts'), 'utf8');
    assert.ok(src.includes('tool.execute.after'), '应用 tool.execute.after 观测真实写操作');
    assert.ok(src.includes('wroteFiles'), '应有本会话是否改过文件的标志');
    assert.ok(src.includes('nudged'), '应有每会话一次的节流标志');
    assert.ok(src.includes('promptAsync'), '应用 client.session.promptAsync 注入收尾指令');
    assert.ok(src.includes('findBrain'), '无 .brain 的项目不打扰');
    assert.ok(src.includes('loggedToday'), '今日已收尾则不再打扰');
    assert.ok(src.includes('client') && src.includes('directory'), '插件应接收 { client, directory } 入参');
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

// ---------- 全量安装 (install --yes) 保留既有配置 ----------
// 为什么单列: 既有测试只覆盖 `install --agent <单个>`；全量安装是四宿主同一条进程里
// 依次跑，是用户实际最常用的路径（`abs install --yes`），且一旦某宿主"读-改-写"
// 退化成"直接覆盖"，会静默清掉用户其它工具的 hook/MCP 配置 —— 后果重且难察觉。
// 本层用真实文件预置"别人的"配置，逐宿主断言安装后仍在。
describe('全量安装 install --yes 不破坏既有配置', () => {
  const PI_MCP = () => join(sandbox, 'pi', 'agent', 'mcp.json');
  const OC_JSON = () => join(sandbox, 'opencode', 'opencode.json');
  const CODEX_TOML = () => join(sandbox, 'codex', 'config.toml');
  const CODEX_HOOKS = () => join(sandbox, 'codex', 'hooks.json');

  /** 预置四宿主的"他人配置"，返回原始文本快照。 */
  async function seedAll() {
    await fs.mkdir(join(sandbox, 'pi', 'agent'), { recursive: true });
    await fs.writeFile(PI_MCP(), JSON.stringify({
      mcpServers: { othersrv: { command: 'echo' } },
      settings: { model: 'x' },
      imports: ['@a/b'],
      _custom: 'MUST-SURVIVE',
    }, null, 2));
    await fs.mkdir(dirname(OC_JSON()), { recursive: true });
    await fs.writeFile(OC_JSON(), JSON.stringify({ mcp: { other: { command: 'echo' } } }, null, 2));
    await fs.mkdir(CODEX_CFG, { recursive: true });
    await fs.writeFile(CODEX_TOML(), '[other]\nkey = 1\n# MINE-KEEP\n');
    await fs.writeFile(CODEX_HOOKS(), JSON.stringify(
      { SessionStart: [{ type: 'command', command: '/usr/local/bin/moshi-codex' }] }, null, 2));
  }

  test('pi: 全量安装后 mcpServers/settings/imports/自定义字段全保', async () => {
    await seedAll();
    const r = await run(['install', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const cfg = JSON.parse(await fs.readFile(PI_MCP(), 'utf8'));
    assert.ok(cfg.mcpServers.othersrv, '他人 mcpServers 必须保留');
    assert.deepEqual(cfg.settings, { model: 'x' }, '既有 settings 必须保留');
    assert.deepEqual(cfg.imports, ['@a/b'], '既有 imports 必须保留');
    assert.equal(cfg._custom, 'MUST-SURVIVE', '未知自定义字段必须保留');
    assert.ok(cfg.mcpServers.abs, 'abs 自身必须已注册');
  });

  test('opencode: 全量安装后既有 mcp 服务保留', async () => {
    await seedAll();
    await run(['install', '--yes']);
    const cfg = JSON.parse(await fs.readFile(OC_JSON(), 'utf8'));
    assert.ok(cfg.mcp.other, '他人 MCP 服务必须保留');
    assert.ok(cfg.mcp.abs, 'abs 必须已注册');
  });

  test('codex: 全量安装后 config.toml 既有内容与 hooks.json 他人 hook 保留', async () => {
    await seedAll();
    await run(['install', '--yes']);
    const toml = await fs.readFile(CODEX_TOML(), 'utf8');
    assert.ok(toml.includes('MINE-KEEP'), 'config.toml 既有内容必须保留');
    assert.ok(toml.includes('[mcp_servers.abs]'), 'abs MCP 必须已写入');
    const hooks = await fs.readFile(CODEX_HOOKS(), 'utf8');
    assert.ok(hooks.includes('moshi-codex'), '他人 hook 必须保留');
    assert.ok(hooks.includes('/.abs/hooks/'), 'abs hook 必须已追加');
  });

  test('四宿主全量安装后均无 @@占位符@@ 残留 (模板替换完整)', async () => {
    await run(['install', '--yes']);
    const tplFiles = [
      join(sandbox, 'pi', 'agent', 'extensions', 'abs.ts'),
      join(sandbox, 'opencode', 'plugins', 'abs.ts'),
    ];
    for (const f of tplFiles) {
      const src = await fs.readFile(f, 'utf8');
      const left = src.match(/@@[A-Z_]+@@/g);
      assert.ok(!left, `${f} 残留占位符 ${left?.join(',')} —— 安装产物会是坏 TS`);
    }
  });

  test('全量安装幂等: 连续两次安装四宿主产物逐字节一致', async () => {
    await seedAll();
    await run(['install', '--yes']);
    const snap = {};
    for (const f of [PI_MCP(), OC_JSON(), CODEX_TOML(), CODEX_HOOKS(), CC_SETTINGS(),
      join(sandbox, 'pi', 'agent', 'extensions', 'abs.ts'),
      join(sandbox, 'opencode', 'plugins', 'abs.ts')]) {
      snap[f] = await fs.readFile(f, 'utf8');
    }
    await run(['install', '--yes']);
    for (const [f, before] of Object.entries(snap)) {
      assert.equal(await fs.readFile(f, 'utf8'), before, `${f} 重装必须幂等`);
    }
  });

  test('全量卸载: 四宿主都清 abs, 且都保留他人配置', async () => {
    await seedAll();
    await run(['install', '--yes']);
    const r = await run(['uninstall', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    // 各自的 abs 都没了
    assert.ok(!existsSync(PI_MCP()) || !JSON.parse(await fs.readFile(PI_MCP(), 'utf8')).mcpServers?.abs);
    assert.ok(!existsSync(join(sandbox, 'pi', 'agent', 'extensions', 'abs.ts')), 'pi 扩展应删');
    assert.ok(!existsSync(join(sandbox, 'opencode', 'plugins', 'abs.ts')), 'opencode 插件应删');
    // 他人的还在
    const pi = JSON.parse(await fs.readFile(PI_MCP(), 'utf8'));
    assert.ok(pi.mcpServers.othersrv, 'pi 他人 MCP 必须保留');
    assert.deepEqual(pi.imports, ['@a/b'], 'pi imports 必须保留');
    const oc = JSON.parse(await fs.readFile(OC_JSON(), 'utf8'));
    assert.ok(oc.mcp.other, 'opencode 他人 MCP 必须保留');
    assert.ok((await fs.readFile(CODEX_TOML(), 'utf8')).includes('MINE-KEEP'), 'codex toml 必须保留');
    assert.ok((await fs.readFile(CODEX_HOOKS(), 'utf8')).includes('moshi-codex'), 'codex 他人 hook 必须保留');
    const cc = JSON.parse(await fs.readFile(CC_SETTINGS(), 'utf8'));
    assert.equal(cc._custom ?? 'MUST-SURVIVE', 'MUST-SURVIVE', 'cc 自定义字段必须保留');
  });
});

// ---------- opencode 路径歧义警告 ----------
// 背景: opencode 默认读 ~/.config/opencode/，但它同样尊重 XDG_CONFIG_HOME。
// 若用户设了该变量而本工具仍写默认路径，插件会装了不生效（静默失效）。
// 本组钉死"何时警告、何时不警告"——警告不该刷屏，也不该在真有问题时沉默。
describe('opencode 路径歧义警告', () => {
  const XDG = () => join(sandbox, 'xdg');
  // 注意: sbEnv 默认注入 ABS_OPENCODE_HOME（测试隔离需要），而它会压制警告。
  // 测警告时须显式清空它，模拟"真实用户没设该变量"的情形。
  const realEnv = (extra = {}) => ({ ABS_OPENCODE_HOME: '', ...extra });

  test('设了 XDG_CONFIG_HOME(与默认不同) → 警告并指出两个路径', async () => {
    const r = await run(['install', '--agent', 'opencode', '--yes'], {
      env: realEnv({ XDG_CONFIG_HOME: XDG() }),
    });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes('XDG_CONFIG_HOME'), `应警告 XDG: ${r.stdout}`);
    assert.ok(r.stdout.includes(join(XDG(), 'opencode')), '应指出 opencode 实际会读的路径');
    assert.ok(r.stdout.includes('可能不一致'), '应说明风险');
  });

  test('未设 XDG_CONFIG_HOME → 不警告(不刷屏)', async () => {
    const r = await run(['install', '--agent', 'opencode', '--yes'], {
      env: realEnv({ XDG_CONFIG_HOME: '' }),
    });
    assert.ok(!r.stdout.includes('可能不一致'), `不该警告: ${r.stdout}`);
  });

  test('设了 OPENCODE_CONFIG → 警告', async () => {
    const r = await run(['install', '--agent', 'opencode', '--yes'], {
      env: realEnv({ OPENCODE_CONFIG: join(sandbox, 'custom.json') }),
    });
    assert.ok(r.stdout.includes('OPENCODE_CONFIG'), `应警告 OPENCODE_CONFIG: ${r.stdout}`);
  });

  test('显式指定 ABS_OPENCODE_HOME 且与 XDG 不一致 → 仍警告', async () => {
    // 修复: 曾经 ABS_OPENCODE_HOME 一被设置就无条件静默，
    // 于是"显式指定的目标"与"opencode 实际会读的位置"不一致时也不提示。
    // 正确语义: 只比较路径是否一致，与目标来自默认值还是 env 无关。
    const r = await run(['install', '--agent', 'opencode', '--yes'], {
      env: { XDG_CONFIG_HOME: XDG() }, // ABS_OPENCODE_HOME 由 sbEnv 注入 → 两者必不一致
    });
    assert.ok(r.stdout.includes('可能不一致'), `不一致就该警告: ${r.stdout}`);
    assert.ok(r.stdout.includes('显式指定'), '应说明目标是显式指定的，便于用户判断');
  });

  test('显式指定 ABS_OPENCODE_HOME 且无 XDG → 静默(无歧义)', async () => {
    const r = await run(['install', '--agent', 'opencode', '--yes'], {
      env: { XDG_CONFIG_HOME: '', OPENCODE_CONFIG: '' },
    });
    assert.ok(!r.stdout.includes('可能不一致'), `无歧义时不该警告: ${r.stdout}`);
  });

  test('XDG_CONFIG_HOME 指向的位置恰好等于默认路径 → 不警告(无歧义)', async () => {
    // 清空 ABS_OPENCODE_HOME 后，本工具写入 HOME/.config/opencode；
    // 让 XDG_CONFIG_HOME 的父目录正好是 HOME/.config，即推导出的路径与写入路径一致。
    const cfgParent = join(HOME, '.config');
    const r = await run(['install', '--agent', 'opencode', '--yes'], {
      env: realEnv({ XDG_CONFIG_HOME: cfgParent }),
    });
    assert.ok(!r.stdout.includes('可能不一致'),
      `路径一致时不该警告: ${r.stdout}`);
  });

  test('警告不妨碍安装本身完成', async () => {
    const r = await run(['install', '--agent', 'opencode', '--yes'], {
      env: realEnv({ XDG_CONFIG_HOME: XDG() }),
    });
    assert.equal(r.code, 0);
    // 清空 ABS_OPENCODE_HOME 后，配置根是 HOME/.config/opencode
    const root = join(HOME, '.config', 'opencode');
    await fs.access(join(root, 'plugins', 'abs.ts'));
    await fs.access(join(root, 'skills', 'abs-agent-brain-sync', 'SKILL.md'));
  });
  // 顺手补一条: 清空后确实写入默认路径（上面两条断言依赖此前提）
  test('未显式指定时写入默认路径 ~/.config/opencode', async () => {
    await run(['install', '--agent', 'opencode', '--yes'], { env: realEnv() });
    const root = join(HOME, '.config', 'opencode');
    await fs.access(join(root, 'plugins', 'abs.ts'));
  });

});
// ---------- 四宿主安装流程: 用户数据安全回归 ----------
// 本组全部来自一次只读审查 + 逐条实证复现。每条都曾在真实代码里复现过，
// 修复后钉死于此 —— 若改动回滚，这些断言必须变红。
describe('安装流程: 用户数据安全', () => {
  test('[C1] 配置为 JSONC(带注释) → 中止安装且不覆盖用户配置', async () => {
    // 修复前: readJson 的 catch 把"解析失败"当成"文件不存在"返回 {}，
    // 安装以 {} 为基底重写 → 用户的 hooks/permissions/自定义字段静默全消失，退出码还是 0。
    // JSONC 正是 claude code 官方文档鼓励的写法，命中率不低。
    await fs.mkdir(CC_CFG, { recursive: true });
    const body = '{\n  // user comment\n  "myKey": "MUST-SURVIVE",\n  "permissions": { "allow": ["Bash"] }\n}\n';
    await fs.writeFile(CC_SETTINGS(), body, 'utf8');
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.notEqual(r.code, 0, '解析失败必须非零退出（否则脚本无法感知）');
    assert.equal(await fs.readFile(CC_SETTINGS(), 'utf8'), body, '用户文件必须一字不动');
  });

  test('[C1] 正常 JSON 仍照常安装（修复不误伤）', async () => {
    await fs.mkdir(CC_CFG, { recursive: true });
    await fs.writeFile(CC_SETTINGS(), JSON.stringify({ myKey: 'KEEP', hooks: {} }, null, 2), 'utf8');
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const cfg = JSON.parse(await fs.readFile(CC_SETTINGS(), 'utf8'));
    assert.equal(cfg.myKey, 'KEEP');
    assert.ok(JSON.stringify(cfg.hooks).includes('.abs/hooks/'));
  });

  test('[C2] 卸载 codex: [mcp_servers.abs] 后仍有其它 section → TOML 不被破坏', async () => {
    // 修复前: 正则 /\n?\[mcp_servers\.abs\][^\[]*/s 的 [^\[]* 在 args = [...] 的 [ 处截断，
    // 留下非法行 ["/…/mcp.js"] 冒充 section 头 → 用户 codex 启动时 TOML 解析失败。
    await fs.mkdir(CODEX_CFG, { recursive: true });
    await fs.writeFile(join(CODEX_CFG, 'config.toml'),
      '[other]\nkeep = 1\n\n[mcp_servers.abs]\ncommand = "node"\nargs = ["/x/bin/mcp.js"]\n\n[third]\nkeep = 2\n', 'utf8');
    await run(['install', '--agent', 'codex', '--yes']);
    await run(['uninstall', '--agent', 'codex', '--yes']);
    const t = await fs.readFile(join(CODEX_CFG, 'config.toml'), 'utf8');
    assert.ok(t.includes('[third]'), 'abs 段之后的用户 section 必须保留');
    assert.ok(t.includes('keep = 2'), '后续 section 的内容必须保留');
    assert.ok(t.includes('[other]') && t.includes('keep = 1'), '前面的 section 必须保留');
    assert.ok(!t.includes('[mcp_servers.abs]'), 'abs 段应被移除');
    // 不得出现把数组值当 section 头的非法形态
    const bad = t.split('\n').filter((l) => /^\s*\["/.test(l));
    assert.equal(bad.length, 0, `TOML 出现非法 section 头: ${bad.join(' | ')}`);
    assert.ok(!/args\s*=\s*\[[^\]]*$/.test(t.replace(/\n[\s\S]*$/, '')), 'args 数组不应被截断');
  });

  test('[H1] config.toml 里只有注释形式的 [mcp_servers.abs] → 仍真实注册', async () => {
    // 修复前: includes('[mcp_servers.abs]') 不区分注释，判定"已存在且路径正确, 跳过"，
    // 实际从未注册（用户永久连不上 MCP，且重装永不修复）。
    await fs.mkdir(CODEX_CFG, { recursive: true });
    await fs.writeFile(join(CODEX_CFG, 'config.toml'), '[other]\nkeep = 1\n# 例: [mcp_servers.abs]\n', 'utf8');
    const r = await run(['install', '--agent', 'codex', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const t = await fs.readFile(join(CODEX_CFG, 'config.toml'), 'utf8');
    const real = t.split('\n').filter((l) => l.trim() === '[mcp_servers.abs]');
    assert.equal(real.length, 1, `必须有一个真实(非注释)的 [mcp_servers.abs] 段: \n${t}`);
    assert.ok(t.includes('keep = 1'), '用户原有内容必须保留');
  });

  test('[H2] 用户 hook 命令含 /.abs/hooks/ 子串 → 安装与卸载都不得删它', async () => {
    // 修复前: entryHasAbs 用 command.includes('/.abs/hooks/')，任何命令文本里恰好
    // 出现该片段的用户 hook 都会被当成 abs 的，安装时静默丢弃、卸载时删掉。
    await fs.mkdir(CC_CFG, { recursive: true });
    const userCmd = 'grep -r try /home/u/.abs/hooks/ > /tmp/report';
    await fs.writeFile(CC_SETTINGS(), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: userCmd }] }] },
    }, null, 2), 'utf8');
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok((await fs.readFile(CC_SETTINGS(), 'utf8')).includes('grep -r try'),
      '安装不得丢弃用户 hook');
    await run(['uninstall', '--agent', 'claude-code', '--yes']);
    const after = await fs.readFile(CC_SETTINGS(), 'utf8');
    assert.ok(after.includes('grep -r try'), '卸载不得误删用户 hook');
    assert.ok(!after.includes('abs-SessionStart.sh'), 'abs 自己的 hook 仍应被清理');
  });

  test(`[H2-边界] 用户脚本名形如 abs-mine.sh → 不得被当成 abs 自己的`, async () => {
    // 边界: 早期正则用 abs-[^/]*$ 匹配，会把用户自己的 abs-mine.sh 也判成我们的 ——
    // 概率低但后果同样是误删用户配置。现改为只认本工具会生成的精确脚本名
    // (abs-<已知事件>.sh)。
    await fs.mkdir(CC_CFG, { recursive: true });
    const userScript = `/home/u/.abs/hooks/claude-code/abs-mine.sh`;
    await fs.writeFile(CC_SETTINGS(), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: `command`, command: userScript }] }] },
    }, null, 2), `utf8`);
    await run([`install`, `--agent`, `claude-code`, `--yes`]);
    assert.ok((await fs.readFile(CC_SETTINGS(), `utf8`)).includes(`abs-mine.sh`),
      `安装不得丢弃用户的 abs-mine.sh`);
    await run([`uninstall`, `--agent`, `claude-code`, `--yes`]);
    const after = await fs.readFile(CC_SETTINGS(), `utf8`);
    assert.ok(after.includes(`abs-mine.sh`), `卸载不得误删用户的 abs-mine.sh`);
    assert.ok(!after.includes(`abs-SessionStart.sh`), `abs 自己的 hook 仍应被清理`);
  });
});

// ---------- ~/.claude.json 用户级 MCP store 校正 ----------
// 背景: ~/.claude.json 是 Claude Code 自己的用户级 MCP store（`claude mcp add` 写它），
// abs 原本从不读写它。它里面的 mcpServers.abs 若是历史/手工写入的仓库路径，就没人校正，
// 且会被 pi-mcp-adapter 的 hostConfigDiscovery 读走，盖过 abs 自己写对的 settings.json。
// 故 install 时"顺带校正已存在的条目"（不新增），uninstall 时"对称只删这一键"。
describe('~/.claude.json 用户级 MCP store 校正', () => {
  // CLAUDE_CONFIG_DIR=<sandbox>/cc → CC home = <sandbox>，故该文件在 <sandbox>/.claude.json
  const USER_JSON = () => join(sandbox, '.claude.json');
  const STALE = '/Users/someone/Code/skills/agent_brain_sync/bin/mcp.js';

  const seed = async (obj) => {
    await fs.writeFile(USER_JSON(), JSON.stringify(obj, null, 2), 'utf8');
  };
  const read = async () => JSON.parse(await fs.readFile(USER_JSON(), 'utf8'));
  test('单宿主安装 (--agent codex) 也会校正外部 store', async () => {
    // 坑: 校正若放在 installClaudeCode 里，`abs install --agent coDEX` 就完全跳过它。
    // 外部 store 与"装了哪个宿主"无关，故必须挂在 runInstall 层。
    const AG = join(HOME, '.agents', 'mcp.json');
    await fs.mkdir(dirname(AG), { recursive: true });
    await fs.writeFile(AG, JSON.stringify({ mcpServers: { abs: { command: '/n', args: [STALE] } } }), 'utf8');
    const r = await run(['install', '--agent', 'codex', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const cfg = JSON.parse(await fs.readFile(AG, 'utf8'));
    assert.notEqual(cfg.mcpServers.abs.args[0], STALE, '单宿主安装也必须校正: ' + r.stdout);
    assert.ok(!cfg.mcpServers.abs.args[0].includes('some/skills'), cfg.mcpServers.abs.args[0]);

  test('单宿主卸载 (--agent coDEX) 也会清理外部 store', async () => {
    // 坑: 清理若放在 uninstallClaudeCode 里，`abs uninstall --agent coDEX` 就漏清理。
    const AG = join(HOME, '.agents', 'mcp.json');
    await fs.mkdir(dirname(AG), { recursive: true });
    await fs.writeFile(AG, JSON.stringify({
      mcpServers: { abs: { command: '/n', args: ['/x/mcp.js'] }, keep: { command: 'z' } },
      topKeep: 1,
    }), 'utf8');
    const r = await run(['uninstall', '--agent', 'codex', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const cfg = JSON.parse(await fs.readFile(AG, 'utf8'));
    assert.ok(!cfg.mcpServers.abs, '单宿主卸载也必须清理: ' + r.stdout);
    assert.deepEqual(cfg.mcpServers.keep, { command: 'z' }, '他人条目不得删');
    assert.equal(cfg.topKeep, 1, '无关顶层键不得删');

  test('coDEX config.json 两种容器名 (mcp_servers / mcpServers) 都能校正', async () => {
    // pi-mcp-adapter 读的是 obj.mcp_servers ?? obj.mcpServers（extractServers），
    // 故两种写法都得认，否则写成 mcpServers 的那份会漏校正成陈旧值。
    const J = join(CODEX_CFG, 'config.json');
    for (const k of ['mcp_servers', 'mcpServers']) {
      await fs.mkdir(dirname(J), { recursive: true });
      await fs.writeFile(J, JSON.stringify({
        [k]: { abs: { command: '/old/node', args: [STALE] }, keep: { command: 'z' } },
        topKeep: 1,
      }), 'utf8');
      const r = await run(['install', '--agent', 'codex', '--yes']);
      assert.equal(r.code, 0, r.stderr);
      const cfg = JSON.parse(await fs.readFile(J, 'utf8'));
      assert.ok(!cfg[k].abs.args[0].includes('skills'), `${k}: 陈旧路径应被校正: ` + r.stdout);
      assert.ok(cfg[k].abs.args[0].includes('node_modules'), k);
      assert.equal(cfg[k].abs.command, '/old/node', `${k}: command 不得改`);
      assert.deepEqual(cfg[k].keep, { command: 'z' }, `${k}: 他人条目不得丢`);
      assert.equal(cfg.topKeep, 1, `${k}: 无关顶层键不得丢`);

      await run(['uninstall', '--agent', 'codex', '--yes']);
      const after = JSON.parse(await fs.readFile(J, 'utf8'));
      assert.ok(!after[k].abs, `${k}: 卸载应删 abs`);
      assert.deepEqual(after[k].keep, { command: 'z' }, `${k}: 卸载不得删他人条目`);
    }
  });

  });

  });


  test('陈旧的仓库路径被校正为稳定路径（只改 args，command 与其它键保留）', async () => {
    await seed({
      numStartups: 42,
      mcpServers: { abs: { type: 'stdio', command: '/some/node', args: [STALE], env: {} } },
      projects: { '/x': { y: 1 } },
    });
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const cfg = await read();
    assert.notEqual(cfg.mcpServers.abs.args[0], STALE, '陈旧路径应被校正');
    assert.ok(!cfg.mcpServers.abs.args[0].includes('some/skills'), cfg.mcpServers.abs.args[0]);
    assert.equal(cfg.mcpServers.abs.command, '/some/node', 'command 不得改动');
    assert.deepEqual(cfg.mcpServers.abs.env, {}, '其它键不得丢失');
    assert.equal(cfg.numStartups, 42, '无关顶层键不得丢失');
    assert.deepEqual(cfg.projects, { '/x': { y: 1 } }, 'projects 不得丢失');
    assert.ok(r.stdout.includes('已校正'), r.stdout);
  });

  test('已正确时幂等: 不写文件、mtime 不变', async () => {
    // 该文件不存在时 abs 不会创建它（不往别人的 store 里塞东西），故先预置一份
    // 已存在的条目，再由 install 校正成正确值 —— 第二次才谈得上幂等。
    await seed({ mcpServers: { abs: { type: 'stdio', command: '/some/node', args: [STALE] } } });
    await run(['install', '--agent', 'claude-code', '--yes']);
    const mtime1 = (await fs.stat(USER_JSON())).mtimeMs;
    await new Promise((res) => setTimeout(res, 12)); // 让 mtime 有区分度
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal((await fs.stat(USER_JSON())).mtimeMs, mtime1, '幂等时不应重写文件');
    assert.ok(!/已校正/.test(r.stdout), '已正确时不应再校正: ' + r.stdout);
  });

  test('无 mcpServers.abs 键时不新增条目', async () => {
    await seed({ mcpServers: { other: { command: 'x' } }, foo: 1 });
    const before = await fs.readFile(USER_JSON(), 'utf8');
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const cfg = await read();
    assert.ok(!cfg.mcpServers.abs, '不得往别人的 store 里塞条目');
    assert.deepEqual(cfg.mcpServers.other, { command: 'x' }, '既有条目不得改动');
    assert.equal(await fs.readFile(USER_JSON(), 'utf8'), before, '文件应一字不动');
  });

  test('文件不存在: 静默跳过, 不创建文件', async () => {
    assert.ok(!existsSync(USER_JSON()));
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!existsSync(USER_JSON()), '不得凭空创建 CC 的 store');
  });

  test('JSON 损坏: 不抛错、不写坏文件', async () => {
    const broken = '{ // JSONC\n  "mcpServers": {}\n}\n';
    await fs.writeFile(USER_JSON(), broken, 'utf8');
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, '坏 JSON 不得中断安装: ' + r.stderr);
    assert.equal(await fs.readFile(USER_JSON(), 'utf8'), broken, '用户文件一字不动');
    // 安装本身仍应完成
    assert.ok(existsSync(CC_SETTINGS()), 'settings.json 仍应写入');
  });

  test('卸载: 只删 mcpServers.abs, 保留其它键与文件', async () => {
    await seed({
      mcpServers: {
        abs: { type: 'stdio', command: '/some/node', args: [STALE] },
        keepme: { command: 'y' },
      },
      someTop: 'KEEP',
    });
    await run(['install', '--agent', 'claude-code', '--yes']);
    const r = await run(['uninstall', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const cfg = await read();
    assert.ok(!cfg.mcpServers.abs, 'abs 条目应删除');
    assert.deepEqual(cfg.mcpServers.keepme, { command: 'y' }, '他人条目不得删');
    assert.equal(cfg.someTop, 'KEEP', '无关顶层键不得删');
    assert.ok(r.stdout.includes('已移除'), r.stdout);
  });

  test('卸载时无该键: 不动文件、不报错', async () => {
    await seed({ mcpServers: { other: { command: 'x' } } });
    const before = await fs.readFile(USER_JSON(), 'utf8');
    await run(['install', '--agent', 'claude-code', '--yes']);
    await fs.writeFile(USER_JSON(), before, 'utf8'); // 还原成无 abs 键状态
    const r = await run(['uninstall', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(await fs.readFile(USER_JSON(), 'utf8'), before, '文件应一字不动');
  });

  test('共享/通用 store (~/.agents/mcp.json、~/.config/mcp/mcp.json) 同样被校正', async () => {
    // 这两个也是 pi-mcp-adapter 的发现源（AGENTS_GLOBAL_CONFIG_PATHS /
    // GENERIC_GLOBAL_CONFIG_PATH），陈旧值同样会经发现链复活。
    const AG = join(HOME, '.agents', 'mcp.json');
    const GEN = join(HOME, '.config', 'mcp', 'mcp.json');
    await fs.mkdir(dirname(AG), { recursive: true });
    await fs.mkdir(dirname(GEN), { recursive: true });
    await fs.writeFile(AG, JSON.stringify({ mcpServers: { abs: { command: '/some/node', args: [STALE] } } }), 'utf8');
    await fs.writeFile(GEN, JSON.stringify({ mcpServers: { abs: { command: '/some/node', args: [STALE] } } }), 'utf8');
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    for (const f of [AG, GEN]) {
      const cfg = JSON.parse(await fs.readFile(f, 'utf8'));
      assert.notEqual(cfg.mcpServers.abs.args[0], STALE, `${f} 的陈旧路径应被校正`);
      assert.equal(cfg.mcpServers.abs.command, '/some/node', `${f} command 不得改`);
    }
    await run(['uninstall', '--agent', 'claude-code', '--yes']);
    for (const f of [AG, GEN]) {
      const cfg = JSON.parse(await fs.readFile(f, 'utf8'));
      assert.ok(!cfg.mcpServers.abs, `${f} 的 abs 条目应被移除`);
    }
  });
});


// ---------- ~/.agents/skills/ 只读检测 ----------
// 背景: ~/.agents/skills/ 归 `skills` CLI 所有（~/.agents/.skill-lock.json 是它的账本），
// 各宿主 skills/ 只是它 fan-out 的目标。abs **不写**那里 —— 写了就绕过 lockfile，
// 会被它下次 sync 判成异常或覆盖。但现实里常有一份手工 cp 的副本（实测与 abs install
// 同一秒、内容相同、lockfile 却没人认领），它不会随 install 更新、会与真身脱节。
// 处置: 只读检测 + 告警提示清理命令，绝不代删代写。
describe('~/.agents/skills/ 只读检测', () => {
  const AG_SKILL = () => join(HOME, '.agents', 'skills', 'abs-agent-brain-sync', 'SKILL.md');

  test('不存在时不打扰 (无告警、不创建目录)', async () => {
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!r.stdout.includes('~/.agents/skills'), '不该无中生有告警: ' + r.stdout);
    assert.ok(!existsSync(join(HOME, '.agents')), 'abs 绝不得创建 ~/.agents');
  });

  test('存在但内容陈旧 → 告警并给出清理命令 (仍不改写它)', async () => {
    await fs.mkdir(dirname(AG_SKILL()), { recursive: true });
    const stale = '---\nname: abs-agent-brain-sync\ndescription: 旧版本\n---\n\n旧内容\n';
    await fs.writeFile(AG_SKILL(), stale, 'utf8');
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes('不一致的副本'), '应告警: ' + r.stdout);
    assert.ok(r.stdout.includes('rm -rf'), '应给清理命令: ' + r.stdout);
    // 关键: 绝不代用户删或改 —— 那是别人的目录
    assert.equal(await fs.readFile(AG_SKILL(), 'utf8'), stale, 'abs 不得改写该文件');
  });

  test('内容与当前版本一致时不告警', async () => {
    await fs.mkdir(dirname(AG_SKILL()), { recursive: true });
    await fs.copyFile(join(REPO, 'skill', 'abs-agent-brain-sync', 'SKILL.md'), AG_SKILL());
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!r.stdout.includes('不一致的副本'), '一致时不该告警: ' + r.stdout);
  });

  test('--no-skill 时不检查', async () => {
    await fs.mkdir(dirname(AG_SKILL()), { recursive: true });
    await fs.writeFile(AG_SKILL(), '---\nname: x\ndescription: y\n---\n旧\n', 'utf8');
    const r = await run(['install', '--agent', 'claude-code', '--yes', '--no-skill']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!r.stdout.includes('不一致的副本'), '装了 skill 才需要看 skill 告警: ' + r.stdout);
  });
});


// ---------- 入口路径必须稳定（不烧仓库路径） ----------
// 背景: ABS_DIR = "install.js 自己住哪"。从仓库跑 `abs install` 就把仓库路径
// 烧进 hook 脚本/宿主配置；仓库被移动或删除后，hook 静默失效（脚本里那个 bin 不存在）。
// MCP 侧早已修成"优先全局包"，但 hook 与 pi 扩展没跟上 —— 同一份安装里
// hook 指向仓库、MCP 指向全局，是两个不同的包。现统一走 stableBinPath()。
describe('入口路径稳定性', () => {
  /** 从生成的 hook 脚本里取 ABS_BIN= 的值。 */
  async function stagedAbsBin(agent) {
    const p = join(HOME, '.abs', 'hooks', agent, 'abs-Stop.sh');
    const src = await fs.readFile(p, 'utf8');
    const m = src.match(/ABS_BIN="([^"]*)"/);
    assert.ok(m, `hook 脚本里应有 ABS_BIN: ${p}`);
    return m[1];
  }

  test('从仓库运行时, hook 脚本指向全局包而非仓库', async () => {
    // 关键: 只要本机存在全局安装，就必须断言"指向全局包"。
    // 早期版本写成"若含 node_modules 才断言不含仓库路径"——条件分支让它漏掉过一次
    // 真实回归（stableBinPath 少了一层 .. → 解析失败 → 静默回退到仓库路径）。
    const r = await run(['install', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    const bin = await stagedAbsBin('claude-code');
    assert.ok(bin.endsWith(join('bin', 'abs.js')), bin);
    const globalMjs = join(
      dirname(process.execPath), '..', 'lib', 'node_modules',
      '@fanchao8609/agent_brain_sync', 'bin', 'abs.js',
    );
    if (existsSync(globalMjs)) {
      assert.ok(bin.includes('node_modules'), `本机有全局包, hook 应指向它, 实际: ${bin}`);
      assert.ok(!bin.includes(REPO), `hook 不得烧仓库路径: ${bin}`);
    }
  });

  test('hook 与 MCP 解析到同一个包（不出现两个不同的包）', async () => {
    await run(['install', '--agent', 'claude-code', '--yes']);
    const hookBin = await stagedAbsBin('claude-code');
    const mcp = JSON.parse(await fs.readFile(CC_SETTINGS(), 'utf8')).mcpServers.abs.args[0];
    // 取各自的"包根"比较: hook 是 <pkg>/bin/abs.js，MCP 是 <pkg>/bin/mcp.js
    const pkgOf = (p) => dirname(dirname(p));
    assert.equal(pkgOf(hookBin), pkgOf(mcp), `hook=${hookBin} 与 mcp=${mcp} 应属同一个包`);
  });

  test('pi 扩展的 ABS_BIN 同样不烧仓库路径', async () => {
    await run(['install', '--agent', 'pi', '--yes']);
    const p = join(sandbox, 'pi', 'agent', 'extensions', 'abs.ts');
    const m = (await fs.readFile(p, 'utf8')).match(/const ABS_BIN = "([^"]*)"/);
    assert.ok(m, 'pi 扩展应有 ABS_BIN');
    if (m[1].includes('node_modules')) {
      assert.ok(!m[1].includes(REPO), `pi 扩展不得烧仓库路径: ${m[1]}`);
    }
  });

  test('[C1-卸载] 配置损坏时: 保留用户文件 + 仍清理 abs 自己的脚本与 skill', async () => {
    // 修复 C1 后引入的取舍: 若卸载也在解析失败时直接抛错，abs 的 staged 脚本与 skill
    // 会残留（清理代码在 readJson 之后）。故卸载走宽松模式: 跳过配置文件、继续清理自己的东西。
    await fs.mkdir(CC_CFG, { recursive: true });
    await fs.writeFile(CC_SETTINGS(), JSON.stringify({ myKey: 'KEEP' }, null, 2), 'utf8');
    await run(['install', '--agent', 'claude-code', '--yes']);
    const broken = '{ // broken\n  "myKey": "KEEP"\n}\n';
    await fs.writeFile(CC_SETTINGS(), broken, 'utf8');
    const r = await run(['uninstall', '--agent', 'claude-code', '--yes']);
    assert.equal(r.code, 0, `卸载应正常完成: ${r.stderr}`);
    assert.ok(r.stdout.includes('无法解析'), '应明确告知跳过了该文件');
    assert.equal(await fs.readFile(CC_SETTINGS(), 'utf8'), broken, '用户文件一字不动');
    assert.ok(!existsSync(join(HOME, '.abs', 'hooks', 'claude-code', 'abs-Stop.sh')), 'abs hook 脚本应被清理');
    assert.ok(!existsSync(join(CC_CFG, 'skills', 'abs-agent-brain-sync')), 'abs skill 应被清理');
  });
});

// ---------- 安装健壮性: 中途失败 / --yes 语义 ----------
describe('安装健壮性', () => {
  test('[M1] 某宿主失败不阻断其余宿主，且不留 tmp 残骸', async () => {
    // 修复前: 任一处抛错直接上抛 → 前序宿主已装、后续宿主全未装（半成品）；
    // atomicWrite 失败还会留下 <file>.abs-tmp-* 残骸。
    // 用「目录占位文件路径」制造 atomicWrite 的 EISDIR。
    await fs.mkdir(join(CODEX_CFG, 'config.toml'), { recursive: true });
    const r = await run(['install', '--yes']);
    assert.notEqual(r.code, 0, '有宿主失败时应非零退出');
    assert.ok(r.stdout.includes('安装失败'), `应报告失败宿主: ${r.stdout}`);
    // 后续宿主（codex 之后的 opencode / pi）必须已安装 —— 不被跳过
    await fs.access(join(sandbox, 'opencode', 'plugins', 'abs.ts'));
    await fs.access(join(sandbox, 'pi', 'agent', 'extensions', 'abs.ts'));
    // 不得留 tmp 残骸
    const codexFiles = await fs.readdir(CODEX_CFG);
    const tmpLeft = codexFiles.filter((f) => f.includes('.abs-tmp-'));
    assert.equal(tmpLeft.length, 0, `不应留 tmp 残骸: ${tmpLeft.join(', ')}`);
  });

  test('[M1] 单宿主失败时仍上抛（保持非零退出语义）', async () => {
    await fs.mkdir(join(CODEX_CFG, 'config.toml'), { recursive: true });
    const r = await run(['install', '--agent', 'codex', '--yes']);
    assert.notEqual(r.code, 0, '单宿主失败必须非零退出');
  });

  test('[M1] atomicWrite 失败时清理 tmp（不留半成品）', async () => {
    // 目标路径被目录占位 → rename 必失败；断言目录里没有 .abs-tmp-* 残留
    await fs.mkdir(join(CODEX_CFG, 'config.toml'), { recursive: true });
    await run(['install', '--agent', 'codex', '--yes']);
    const left = (await fs.readdir(CODEX_CFG)).filter((f) => f.includes('.abs-tmp-'));
    assert.equal(left.length, 0, `tmp 必须被清理: ${left.join(', ')}`);
  });

  test('[M2] --yes 语义: 非 TTY 下不弹交互（自动化不挂起）', async () => {
    // pickAgents 以前只看 isTTY、忽略 yes。本测试在非 TTY 下跑（spawn 无 pty），
    // 断言安装直接完成全四宿主 —— 若哪天改成 TTY-only 判定，这里会挂或超时。
    const r = await run(['install', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    for (const [p, name] of [
      [join(CC_CFG, 'settings.json'), 'claude-code'],
      [join(sandbox, 'pi', 'agent', 'extensions', 'abs.ts'), 'pi'],
      [join(sandbox, 'opencode', 'plugins', 'abs.ts'), 'opencode'],
    ]) {
      await fs.access(p).catch(() => { throw new Error(`${name} 未安装: ${p}`); });
    }
    assert.ok(!r.stdout.includes('选择要安装'), `--yes 不应弹交互: ${r.stdout}`);
  });

  test('[M4] 同日多次安装产生多份备份（不被覆盖），且总量有上限', async () => {
    // 修复前: 备份名只有日期 → 同日第二次安装直接覆盖第一份，
    // 用户想回滚到"装坏之前"时最早的副本已不存在。
    await fs.mkdir(CC_CFG, { recursive: true });
    await fs.writeFile(CC_SETTINGS(), JSON.stringify({ v: 0 }, null, 2), 'utf8');
    // 逐次修改内容再安装，确保每次备份的源不同
    for (let i = 1; i <= 3; i++) {
      await fs.writeFile(CC_SETTINGS(), JSON.stringify({ v: i, hooks: {} }, null, 2), 'utf8');
      await run(['install', '--agent', 'claude-code', '--yes']);
      await new Promise((r) => setTimeout(r, 1100)); // 时间戳精度到秒
    }
    const baks = (await fs.readdir(CC_CFG)).filter((f) => f.includes('.abs-bak-'));
    assert.ok(baks.length >= 2, `同日多次安装应留下多份备份，实际 ${baks.length}: ${baks.join(', ')}`);
    // 上限: 不能无限增长
    for (let i = 4; i <= 8; i++) {
      await fs.writeFile(CC_SETTINGS(), JSON.stringify({ v: i, hooks: {} }, null, 2), 'utf8');
      await run(['install', '--agent', 'claude-code', '--yes']);
      await new Promise((r) => setTimeout(r, 1100));
    }
    const after = (await fs.readdir(CC_CFG)).filter((f) => f.includes('.abs-bak-'));
    assert.ok(after.length <= 5, `备份应保留上限 5，实际 ${after.length}`);
    assert.ok(after.length >= 2, '仍应保留最近几份');
  }, { timeout: 60000 });
});
