// src/todo.js — 对外入口（re-export）。真正的实现在 src/todo/*.js。
// 保留这一层是为了对外接口稳定：store.js / lint.js / note.js / wrapup.js / 测试的
// import 路径与名字都不用改。

export { TODO_MAX_LINES, LOG_MAX_LINES, INDEX_MAX_LINES, today, localStamp, SEC, extractId, extractNote, extractAuthor, isLegacyAuthorTag, claimOf, sessionOf, parseChild, renderChild } from './todo/common.js';
export { LEGACY_SECTION_RENAMES, TODO_SECTIONS, TODO_SUBSECTIONS, isAllowedTodoSub, INDEX_SECTIONS, INDEX_LINK_SECTIONS, LOG_KINDS, H1_TO_FILE, ENTRY_SHAPES, TASK_STATES, RETIRED_SECTIONS, BREAKPOINT_MAX, TASK_LINE_MAX, DONE_KINDS, ARCHIVE_SECTION } from './todo/spec.js';
export { todoTemplate, rebuildStructure, dropRetiredSections, enforceBrainFormat, normalizeTodo, ensureStateMark, stateOfTaskLine, stripStateMark, checkTaskBox } from './todo/structure.js';
export { checkFileShape, violationSignatures, assertNoStrayBlank, assertTodoContent } from './todo/validate.js';
export { doneDateOf, doneKindOf, withDoneKind, collapseDone, archiveDoneInText, renderArchiveBody, upsertArchiveSection, groupDoneSection, insertDoneGrouped } from './todo/archive.js';
export { readTodo, ensureTodo, setStateMark, addTask, upsertTask, idOfTaskLine, findTaskLine, setBreakpoint, setBreakpointDone, setMemo, readMemo, boardText } from './todo/tasks.js';
export { migrateLegacyChild, isTaskLine, isChildLine, CHILD_INDENT } from './todo/common.js';
