// code/hosts.js — 宿主接入定义。
//
// **当前只支持 pi 一家**（2026-11-18 用户定：其余四家等 pi 完善了再考虑）。
// claude-code / codex / opencode / omp 的接入曾经写完并跑通，已按此决定从树里移除；
// 要恢复它们，去 git 历史里 1.32.6 那版的 src/install.js 与 hooks/ 取回原始实现
// （拆成 agents/<宿主>/install/ 的版本从未提交过，捞不到）。
//
// 本文件集中每个宿主的：config 根、skill 落点。
//
// 没有「生命周期事件」字段：那套是 shell hook 时代（claude-code / codex 把脚本挂到宿主的
// events 上）才需要的，pi 用 TS 扩展自己 pi.on(...)，事件名单在扩展里写。四宿主删掉后
// events 已无消费者，删掉免得让人以为改它能改变行为。
// hook 形态（ts-extension / shell-json …）不在此声明 —— 装/卸的分支在
// agents/<宿主>/install/ 里各写一份，靠 key 字符串分派。
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();

export const HOSTS = [
  {
    key: 'pi',
    label: 'Pi',
    // 落盘: <configRoot>/agent/extensions/abs.ts
    configRoot: () => process.env.ABS_PI_HOME || join(HOME, '.pi'),
    skillSub: join('agent', 'skills'), // pi 用户级 skill 在 ~/.pi/agent/skills (非 ~/.pi/skills)
  },
];

export function hostByKey(key) {
  const h = HOSTS.find((x) => x.key === key);
  if (!h) throw new Error(`未知 agent: ${key} (可用: ${HOSTS.map((x) => x.key).join(', ')})`);
  return h;
}
