// src/hosts.js — 四宿主的接入机制定义。
// 关键事实（来自 ai-memory 学习）：
//   - Claude Code / Codex: JSON hooks 配置，可指向 shell 脚本 → 纯 shell hook 可行
//   - OpenCode / Pi:       只吃 TS plugin/extension，无 shell-hook 配置 → 需生成 TS
// 本文件集中每个宿主的：home 目录、MCP 注册 schema、hook 配置方式、skill 落点。
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();

// MCP 注册：我们的 MCP server 由 `node <abs>/bin/mcp.js` 启动（stdio transport）。
export function mcpServerEntry(absDir) {
  return {
    command: process.execPath, // node
    args: [join(absDir, 'bin', 'mcp.js')],
  };
}

export const HOSTS = [
  {
    key: 'claude-code',
    label: 'Claude Code',
    // 配置文件: ~/.claude/settings.json（config 根可经 env 覆盖，用于测试/自定义）
    configRoot: () => process.env.CLAUDE_CONFIG_DIR || join(HOME, '.claude'),
    skillSub: 'skills', // 相对 configRoot 的 skill 目录
    settingsPath: () => join(process.env.CLAUDE_CONFIG_DIR || join(HOME, '.claude'), 'settings.json'),
    // 事件 → 我们的 shell hook 脚本（从 hooks/ 拷到 .claude 侧后执行）
    events: ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'],
    hookKind: 'shell-json',   // settings.json 的 hooks 对象
  },
  {
    key: 'codex',
    label: 'Codex (OpenAI)',
    configRoot: () => process.env.CODEX_HOME || join(HOME, '.codex'),
    skillSub: 'skills', // 相对 configRoot 的 skill 目录
    settingsPath: () => join(process.env.CODEX_HOME || join(HOME, '.codex'), 'hooks.json'),
    events: ['SessionStart', 'UserPromptSubmit', 'Stop'],
    hookKind: 'codex-hooks',  // ~/.codex/hooks.json: { hooks: [...] }
  },
  {
    key: 'opencode',
    label: 'OpenCode',
    // 只吃 TS plugin：~/.config/opencode/plugins/abs.ts（config 根可经 env 覆盖，用于测试）
    configRoot: () => process.env.ABS_OPENCODE_HOME || join(HOME, '.config', 'opencode'),
    skillSub: 'skills', // 相对 configRoot 的 skill 目录
    settingsPath: () => join(process.env.ABS_OPENCODE_HOME || join(HOME, '.config', 'opencode')),
    events: ['SessionStart', 'UserPromptSubmit', 'Stop'],
    hookKind: 'ts-plugin',
  },
  {
    key: 'pi',
    label: 'Pi',
    configRoot: () => process.env.ABS_PI_HOME || join(HOME, '.pi'),
    skillSub: join('agent', 'skills'), // pi 用户级 skill 在 ~/.pi/agent/skills (非 ~/.pi/skills)
    settingsPath: () => join(process.env.ABS_PI_HOME || join(HOME, '.pi'), 'agent', 'extensions'),
    events: ['SessionStart', 'UserPromptSubmit', 'Stop'],
    hookKind: 'ts-extension',
  },
];

export function hostByKey(key) {
  const h = HOSTS.find((x) => x.key === key);
  if (!h) throw new Error(`未知 agent: ${key} (可用: ${HOSTS.map((x) => x.key).join(', ')})`);
  return h;
}
