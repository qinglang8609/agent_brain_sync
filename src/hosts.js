// src/hosts.js — 四宿主的接入机制定义。
// 关键事实（来自 ai-memory 学习）：
//   - Claude Code / Codex: JSON hooks 配置，可指向 shell 脚本 → 纯 shell hook 可行
//   - OpenCode / Pi:       只吃 TS plugin/extension，无 shell-hook 配置 → 需生成 TS
// 本文件集中每个宿主的：config 根、skill 落点、生命周期事件。
// hook 形态（shell-json / codex-hooks / ts-plugin / ts-extension）不在此声明 ——
// 装/卸分支靠 key 字符串判断（install.js 每个宿主一个 installer 函数）。
// 曾有一份 hookKind 字段四处写死却无人读；settingsPath 同样零调用者，均已删。
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();

export const HOSTS = [
  {
    key: 'claude-code',
    label: 'Claude Code',
    // 配置文件: ~/.claude/settings.json 的 hooks 对象（config 根可经 env 覆盖，用于测试/自定义）
    configRoot: () => process.env.CLAUDE_CONFIG_DIR || join(HOME, '.claude'),
    skillSub: 'skills', // 相对 configRoot 的 skill 目录
    // 事件 → 我们的 shell hook 脚本（从 hooks/ 拷到 .claude 侧后执行）
    events: ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'],
  },
  {
    key: 'codex',
    label: 'Codex (OpenAI)',
    // 配置: ~/.codex/hooks.json: { hooks: [...] }
    configRoot: () => process.env.CODEX_HOME || join(HOME, '.codex'),
    skillSub: 'skills', // 相对 configRoot 的 skill 目录
    events: ['SessionStart', 'UserPromptSubmit', 'Stop'],
  },
  {
    key: 'opencode',
    label: 'OpenCode',
    // 只吃 TS plugin：<configRoot>/plugins/abs.ts（config 根可经 env 覆盖，用于测试）
    configRoot: () => process.env.ABS_OPENCODE_HOME || join(HOME, '.config', 'opencode'),
    skillSub: 'skills', // 相对 configRoot 的 skill 目录
    events: ['SessionStart', 'UserPromptSubmit', 'Stop'],
  },
  {
    key: 'pi',
    label: 'Pi',
    // 落盘: <configRoot>/agent/extensions/abs.ts
    configRoot: () => process.env.ABS_PI_HOME || join(HOME, '.pi'),
    skillSub: join('agent', 'skills'), // pi 用户级 skill 在 ~/.pi/agent/skills (非 ~/.pi/skills)
    events: ['SessionStart', 'UserPromptSubmit', 'Stop'],
  },
];

export function hostByKey(key) {
  const h = HOSTS.find((x) => x.key === key);
  if (!h) throw new Error(`未知 agent: ${key} (可用: ${HOSTS.map((x) => x.key).join(', ')})`);
  return h;
}
