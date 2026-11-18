// agents/pi/install/index.js — pi：extensions/abs.ts + plugins/ 下的每个插件 + mcp-adapter.json + skill。
import { promises as fs, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostConfigRoot, atomicWrite, backup, readJson, installSkills, uninstallSkills, mcpEntryPath, stableBinPath, renderPluginTemplate, MARK } from '../../../code/install/shared.js';

// ============================ Pi (TS extension) ============================
// Pi 与 Opencode 插件语法不同构：Pi 需要 default 工厂函数接收 ExtensionAPI、用 pi.on(event) 注册。
// 不能复用 opencodePluginSource 的写法（那是 export const ... = ({ project }) => ...）。
// 两者同纪律: 生命周期事件只进技术日志 hooks.log, 不进图谱 log.md。
function piPluginSource() {
  // 模板已外置到 agents/<宿主>/hook/abs.pi.ts。理由同 opencodePluginSource。
  return renderPluginTemplate(join('agents', 'pi', 'hook', 'abs.pi.ts'), {
    '@@ABS_BIN@@': stableBinPath('abs.js'),
    '@@MARK@@': MARK,
  });
}

// 插件清单：agents/pi/plugins/ 下每个子目录就是一个 pi 扩展，随 abs install 一起装上。
//
// 两种形态（按目录内容判定，不写死名字）:
//   ① 目录里有 index.ts  → 多文件扩展，整体拷成 extensions/<名>/（pi 只加载入口 index.ts，
//      helper 文件不参与扫描 —— 平铺会让 pi 把 helper 也当扩展，见下方 2026-11-04 的坑）
//   ② 目录里有 <目录名>.ts → 单文件扩展，拷成 extensions/<名>.ts
//
// 为什么不交给 `pi install <仓库路径>`：那会在 settings.json 里留一条指向本仓库的包记录
//   （pi 存成相对路径，仓库一挪就失效），而且这些插件本来就隶属于 abs ——
//   装与卸都该由 abs 一并管，用户只跑一条 `abs install`。
/** 改过名的插件（旧名 → 新名）。装与卸都要顺手清掉旧的，
 *  否则升级后机器上会同时加载两份（两份圆角编辑器、两块 todo 面板）。 */
const RENAMED_PLUGINS = ['abs-rounded-editor', 'abs-todo-panel'];

const PLUGINS_ROOT = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), 'agents', 'pi', 'plugins');

function pluginPlan() {
  const out = [];
  let entries = [];
  try { entries = readdirSync(PLUGINS_ROOT, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const src = join(PLUGINS_ROOT, e.name);
    if (existsSync(join(src, 'index.ts'))) {
      const files = readdirSync(src).filter((f) => f.endsWith('.ts'));
      out.push({ name: e.name, kind: 'dir', files });
    } else if (existsSync(join(src, `${e.name}.ts`))) {
      out.push({ name: e.name, kind: 'file', file: `${e.name}.ts` });
    }
  }
  return out;
}

export async function installPi({ withMcp, withSkill }) {
  const steps = [];
  const dir = join(hostConfigRoot('pi'), 'agent', 'extensions');
  const p = join(dir, 'abs.ts');
  await atomicWrite(p, piPluginSource()); // Pi 用专用模板, 语法与 OpenCode 不同构
  steps.push(`✓ hook(ts extension) → ${p}`);
  // 旧名残留：改过名的插件必须清掉，否则同一功能装了两份（pi 按路径去重，认不出是同一个）。
  for (const old of RENAMED_PLUGINS) {
    await fs.rm(join(dir, old), { recursive: true, force: true });
    await fs.rm(join(dir, `${old}.ts`), { force: true });
  }
  // 插件（圆角输入框、工具调用胶囊…）：每个都是独立扩展，删掉哪个都不影响 abs.ts。
  // 规则见 pluginPlan()：目录 + index.ts 的装成子目录，单文件的装成 <名>.ts。
  for (const plug of pluginPlan()) {
    if (plug.kind === 'dir') {
      const target = join(dir, plug.name);
      for (const f of plug.files) {
        await atomicWrite(join(target, f), renderPluginTemplate(join('agents', 'pi', 'plugins', plug.name, f), {}));
      }
      steps.push(`✓ plugin(${plug.name}) → ${join(target, 'index.ts')}`);
    } else {
      const target = join(dir, `${plug.name}.ts`);
      await atomicWrite(target, renderPluginTemplate(join('agents', 'pi', 'plugins', plug.name, plug.file), {}));
      steps.push(`✓ plugin(${plug.name}) → ${target}`);
    }
  }
  // MCP → ~/.pi/agent/mcp-adapter.json 的 mcpServers (stdio)
  // 坑（2026-09-30 用户实报）：曾写 mcp.json，但 pi-mcp-adapter 已不再读它
  //   （pi 自有 mcp.json 被 adapter 忽略，adapter 改读 mcp-adapter.json）→ 写了等于没写。
  if (withMcp) {
    const mcpP = join(hostConfigRoot('pi'), 'agent', 'mcp-adapter.json');
    await backup(mcpP);
    const cfg = await readJson(mcpP);
    cfg.mcpServers = cfg.mcpServers || {};
    cfg.mcpServers['abs'] = { type: 'stdio', command: process.execPath, args: [mcpEntryPath()] };
    await atomicWrite(mcpP, JSON.stringify(cfg, null, 2));
    steps.push(`✓ MCP    → ${mcpP} (mcpServers.abs, stdio)`);
  }
  if (withSkill) {
    steps.push(...await installSkills('pi'));
  }
  return steps;
}

export async function uninstallPi() {
  const steps = [];
  const extDir = join(hostConfigRoot('pi'), 'agent', 'extensions');
  await fs.rm(join(extDir, 'abs.ts'), { force: true });
  // 插件：两种形态都删（目录与单文件），不依赖它当前是哪种。
  for (const plug of pluginPlan()) {
    await fs.rm(join(extDir, plug.name), { recursive: true, force: true });
    await fs.rm(join(extDir, `${plug.name}.ts`), { force: true });
  }
  // 改过名的插件。
  for (const old of RENAMED_PLUGINS) {
    await fs.rm(join(extDir, old), { recursive: true, force: true });
    await fs.rm(join(extDir, `${old}.ts`), { force: true });
  }
  // 旧版本平铺遗留（1.25.0 装过那种布局）。
  for (const legacy of ['pi-rounded-editor.ts', 'pi-rounded-format.ts']) {
    await fs.rm(join(extDir, legacy), { force: true });
  }
  steps.push(`✓ extension 已删除`);
  steps.push(...await uninstallSkills('pi'));
  const mcpP = join(hostConfigRoot('pi'), 'agent', 'mcp-adapter.json');
  const cfg = await readJson(mcpP, { strict: false });
  if (cfg === null) {
    steps.push(`⚠ ${mcpP} 无法解析为 JSON，已跳过（未改动你的配置）`);
  }
  if (cfg && cfg.mcpServers && cfg.mcpServers.abs) {
    delete cfg.mcpServers.abs;
    await backup(mcpP);
    await atomicWrite(mcpP, JSON.stringify(cfg, null, 2));
    steps.push(`✓ MCP 已从 ${mcpP} 移除`);
  }
  return steps;
}
