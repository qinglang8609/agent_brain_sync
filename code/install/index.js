// code/install/index.js — 安装/卸载调度器：分派到 agents/<宿主>/install/。
//
// 现在只有 pi 一个宿主（2026-11-18 用户定）。仍保留「注册表 + 各宿主自带实现」的形态：
// 将来恢复 claude-code / codex / opencode / omp 时，写一份 agents/<宿主>/install/，
// 在 INSTALLERS 里挂上就够 —— 不用碰这里的调度逻辑。
import { HOSTS } from '../hosts.js';
import { agentsSkillWarning, staleBinWarning, duplicateInstallWarning } from './shared.js';
import { installPi, uninstallPi } from '../../agents/pi/install/index.js';

const INSTALLERS = {
  pi: { on: installPi, off: uninstallPi },
};

/** 默认装的宿主。
 *
 * 2026-11-02 用户定：默认只装 pi。2026-11-18 起它是唯一支持的宿主 —— 装到不用的
 * 宿主上会往那边的配置文件里塞 hook/MCP 条目，用户没在用时那是纯污染。
 */
export const DEFAULT_AGENT = 'pi';

/** 宿主清单（人看得懂的写法）。 */
export function installSummary() {
  return HOSTS.map((h) => `  ${h.key.padEnd(12)} ${h.label}`).join('\n');
}

/** 选要装的宿主。只有一个宿主时不再弹交互 —— 留这层是为了 CLI 的调用点不变。 */
export async function pickAgents() {
  return [DEFAULT_AGENT];
}

export async function runInstall({ agent, all = false, mcp = true, skill = true, yes = false } = {}) {
  // all=true 保留：CLI 的 --all 仍在（现在等于装唯一那个宿主），别让老脚本撞未知参数。
  const targets = agent ? [agent] : (all ? Object.keys(INSTALLERS) : await pickAgents(yes));
  for (const key of targets) {
    const inst = INSTALLERS[key];
    if (!inst) throw new Error(`未知 agent: ${key} (可用: ${Object.keys(INSTALLERS).join(', ')})`);
    console.log(`\n▸ 安装到 ${key} …`);
    // 不吞异常: 装坏了要当场看见，而不是「完成」了但宿主里什么都没有。
    for (const line of await inst.on({ withMcp: mcp, withSkill: skill })) {
      console.log('  ' + line);
    }
  }
  if (skill) {
    const w = agentsSkillWarning();
    if (w) console.log('\n' + w);
  }
  const stale = staleBinWarning();
  if (stale) console.log('\n' + stale);
  const dup = duplicateInstallWarning();
  if (dup) console.log('\n' + dup);

  console.log('\n完成。项目内运行 abs init 建图谱; 会话里说 "abs load" 续接。');
}

export async function runUninstall({ agent } = {}) {
  const targets = agent ? [agent] : Object.keys(INSTALLERS);
  for (const key of targets) {
    const inst = INSTALLERS[key];
    if (!inst) throw new Error(`未知 agent: ${key}`);
    console.log(`\n▸ 从 ${key} 卸载 …`);
    for (const line of await inst.off()) console.log('  ' + line);
  }
  console.log('\n卸载完成。');
}

// 转出共用函数：调用方（bin/abs.js、测试）仍从 code/install/index.js 取，不必知道内部拆法。
export { hostConfigRoot, hostSkillDir, staleBinWarning, duplicateInstallWarning } from './shared.js';
