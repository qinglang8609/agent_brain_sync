// code/limits.js — 跨模块共享的阈值常量（放这里是为了让 load 不必 import 整个 lint）。
//
// 历史：`SOURCES_MAX` 原本定义在 lint.js，而 load.js 只为一个数字 import 了它 →
// 每个 `abs load` 都把整个 lint（8 个检查器）加载进来（2026-11-16 实测多 ~10ms）。

/** sources/ 超过这个数量算「采了没消化」，lint 与 load 顶部提示共用。 */
export const SOURCES_MAX = 10;
