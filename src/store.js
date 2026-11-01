// src/store.js — 命令聚合入口（2026-11-01 拆分后的壳）。
//
// 拆分前 1114 行、27 个导出，8 个互不相干的职责塞一起。现在按职责落到子模块：
//   brain/init.js     建骨架、结构体检、三个受管文件模板
//   brain/shape.js    标准形状表 + 结构核对（init 与 load 共用）
//   brain/gate.js     写入侧格式闸门的全局注册（import 即生效）
//   brain/load.js     board / status / load —— 只读呈现
//   brain/rules.js    index.md 的 `## Rules` 区读写
//   brain/maintain.js 滞留快照 / Done 归档 / 收尾体检
//   todo/task-cmd.js  abs todo 命令入口 + abs show
//
// 本文件只做转发，不含任何实现。bin/abs.js 与 bin/mcp.js 的导入路径不变。
// 新增命令时：实现放对应子模块，这里加一行 export。

// ---- 骨架与模板 ----
export { cmdInit, cmdRepair, reportBrain, indexTemplate, logTemplate } from './brain/init.js';
export { BRAIN_SHAPE, LEGACY_MARKS, checkBrainShape } from './brain/shape.js';
// 闸门靠 import 副作用注册，必须在此引入（谁先 import store.js 谁就完成注册）
import './brain/gate.js';

// ---- 只读呈现 ----
export { cmdBoard, cmdStatus, cmdLoad, cmdShow, extractBlocks } from './brain/load.js';

// ---- Rules ----
export { RULES_HEADING, RULES_MAX, RULE_BODY_MAX, readRules, cmdRule } from './brain/rules.js';

// ---- 维护 ----
export { cmdWrapup, cmdTodoArchive, cmdTeardownCheck } from './brain/maintain.js';

// ---- 按七层总结 ----
export { cmdCapture, layerGuide } from './brain/capture.js';

// ---- 任务 ----
export { cmdTask } from './todo/task-cmd.js';

// ---- 以下为既有模块的转发（拆分前就在此聚合，保留原样） ----
export { clip, slugOf } from './text.js';

export {
  idOfPage, backfillPageId, PAGE_STATUS, statusOfPage, supersededByOf,
  cmdSupersede, resolvePage, cmdReview, cmdResolve, collapseIndex,
} from './page.js';

export { cmdLog, cmdNote, cmdConcept, ensurePersonPage, registerInIndex } from './note.js';
export { cmdLint, listPages, hasTail, PAGE_DIRS, foldSameKind } from './lint.js';
export { cmdQuery } from './query.js';
