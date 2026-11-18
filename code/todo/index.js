// code/todo.js — 对外入口（re-export）。真正的实现在 src/todo/*.js。
// 保留这一层是为了对外接口稳定：store.js / lint.js / note.js / wrapup.js / 测试的
// import 路径与名字都不用改。

export { STATE_MARK, MARK_STATE, markOf, stateOfMark } from './common.js';
export { TODO_MAX_LINES, LOG_MAX_LINES, INDEX_MAX_LINES, today, localStamp, SEC, extractId, extractNote, extractAuthor, isLegacyAuthorTag, claimOf, sessionOf, parseChild, renderChild } from './common.js';
export { LEGACY_SECTION_RENAMES, TODO_SECTIONS, INDEX_SECTIONS, INDEX_LINK_SECTIONS, LOG_KINDS, H1_TO_FILE, ENTRY_SHAPES, TASK_STATES, RETIRED_SECTIONS, BREAKPOINT_MAX, TASK_LINE_MAX } from './spec.js';
export { todoTemplate, rebuildStructure, dropRetiredSections, enforceBrainFormat, normalizeTodo, ensureStateMark, stateOfTaskLine, stripStateMark, checkTaskBox } from './structure.js';
export { checkFileShape, violationSignatures, assertNoStrayBlank, assertTodoContent } from './validate.js';
export { dateOfLine, unitsOf, sortTodoLines, openLines, countDone, collapseDone } from './done.js';
export { parseTaskLine, renderTaskLine, renderChildLine, taskIdOf, taskTimeOf, taskSidOf, shortTitle, isTime } from './line.js';
export { restoreArchivedTasks, archivedTaskLines } from './restore.js';
export { readTodo, ensureTodo, setStateMark, setChildStateMark, addTask, upsertTask, idOfTaskLine, findTaskLine, setBreakpoint, setBreakpointDone, setMemo, readMemo, boardText } from './tasks.js';
export { migrateLegacyChild, isTaskLine, isChildLine, CHILD_INDENT } from './common.js';
