---
tags: [concept, 重构, 死代码, 模块拆分, 循环依赖, 方法论, 验证]
id: dead-code-vs-over-export
author: fanchao
updated: 2026-10-09
status: active
---

# 概念：死代码、多导出、模块拆分 —— 三种「看着像问题」要分开判

## 触发场景

要「清理无用的函数/方法/文件」「整理项目结构」「拆大文件」「收窄导出面」时先读这页。
2026-10-09 全项目整理时踩全了三种情况，**三种的判据完全不同**，混着判就会误删。

## 三种情况，三种判据

### ① 真死代码 —— 可删

**判据**：剥掉**声明行本身**后，在**整个项目**（src + bin + hooks + test + docs）里
该名字出现 **0 次**。

```bash
# 单个名字的快速判据
grep -rn "fixMarks" --include=*.js --include=*.ts --include=*.md . | grep -v node_modules
```

**关键：必须剥掉声明行再数**。不剥的话每个死函数都至少有 1 次出现（定义自己），
一眼看不出死活。可复制的检测命令见 [[2026-10-09-死代码与拆分实测]]。

**本次实测删掉的（都是 0 引用）**：
`src/store.js` 的 `fixMarks`、`src/todo.js` 的 `renameLegacySections`、
`src/install.js` 的 `absHookDir`、`src/install.js` 的 `JSON_MARK_KEY`、
`src/note.js` 的 `NOTE_DEDUP_MS`、`bin/abs.js` 的 `rawValues`。

### ② 多导出 —— **多数情况不该动**

**判据**：「文件内还在用，只是顺手 export 了、外部没人 import」。

**⚠ 本次最大的判断错误**：方案里列了 21 个「多余导出」，说可以收窄。
**实际一查，零个能收窄** —— 那些名字在文件内部被真实调用（出现 1~6 次），
去掉 `export` 没有收益，只是把接口面改小、把风险放大。见下一节「自动化脚本的坑」。

**正确的处理顺序**：先拆文件（情况③）→ 拆完再看导出面，
**拆分往往自然解决了多导出**（跨模块的必须 export，不跨的留在原地也无害）。

### ③ 文件过大要拆 —— 拆之前必须画依赖图

**判据**：行数明显超过同层文件（本次：`todo.js` 1305 行 vs 同层 `lint.js` 430 行）。

**但行数只是触发条件，能不能拆取决于依赖图。** 本次实测的教训：

```
按「职责直觉」切三刀  →  structure ⇄ validate 成了真环
按「真实依赖」重划    →  抽出 spec.js（共享数据）才断开
```

**真环的原样**（剥掉注释行后才看清，注释里的名字是假边）：

```
structure -> validate :  enforceBrainFormat -> checkFileShape
                         ENTRY_SHAPES       -> assertTodoContent
validate -> structure :  checkFileShape -> ENTRY_SHAPES / TODO_SECTIONS
                                         / isAllowedTodoSub / indexLinkSectionNeeds
```

**根因**：分区名常量与 `ENTRY_SHAPES` 是**共享数据**，被放在 structure 侧，
而 validate 要读它 → 回指。**解法不是调整函数归属，是把共享数据提成独立模块**。

## 拆分的正确姿势（本次有效）

### 1. 对外接口零变动 —— 保留 barrel 入口

```js
// src/todo.js —— 只做 re-export，实现全在 src/todo/*.js
export { TODO_MAX_LINES, today, SEC, /* … */ } from './todo/common.js';
export { TODO_SECTIONS, ENTRY_SHAPES, /* … */ } from './todo/spec.js';
// …
```

**为什么这是关键**：`store.js`/`lint.js`/`note.js`/`wrapup.js`/4 个测试文件的
import **一行都不用改** → 回归面被压到只剩「模块内部搬动是否等价」。

### 2. 拆完立刻验证导出清单逐个相等

拆分前记下清单、拆分后比对（缺失/新增都要为空），可复制命令见
[[2026-10-09-死代码与拆分实测]]。本次：**拆分前 55 个，拆分后 55 个，零丢失**。

### 3. 私有名跨模块后必须补 export

原来私有的顶层名（如 `sigOfLine`、`trimBlank`、`trimBlank`、`ARCHIVE_HEADING`），
一旦被别的模块引用，**就必须补上 `export`** —— 这是拆分引入的必要改动，不是「多导出」。

## ⚠ 自动化脚本的坑（本次踩了两个）

### 坑 1：注释里的名字是**假依赖**

第一版依赖分析没剥注释，`ENTRY_SHAPES` 里一句
`], // 任务行/断点行另由 assertTodoContent 卡长度` 就被当成了真边，
凭空造出一个 `spec → validate` 的环。

**修法**：剥整行注释 **+ 行尾注释**（代码见 [[2026-10-09-死代码与拆分实测]]）。

**教训**：`ENTRY_SHAPES -> assertTodoContent` 光看行号 grep 是存在的，
必须看**是不是在注释里** —— 本次靠打印上下文才发现。

### 坑 2：写检测脚本时，**grep 比自己的正则可信**

我写的 node 检测脚本因为 shell 里 `$` 转义层层塌陷，
误报「10 个导出无人使用」，而 `grep -l` 当场证明它们**都被跨模块 import 了**。

**判据**：检测结论与 `grep` 不一致时，**信 grep**。
自写正则容易在转义上出错（尤其 `$`、`\b`、`[]`），而 grep 的词边界是可靠的。

## 验证层级（本次实际跑的）

| 层 | 命令 | 期望 |
|---|---|---|
| 回归 | `npm test` | 与改动前**同一个数**（本次 556/0） |
| 静态 | `npm run check` | 语法 + eslint 全过 |
| 边界 | 导出清单比对 | 前 55 / 后 55，零丢失 |
| 真实运行 | `npm pack` → 空项目跑 `init`/`todo`/`lint`/`load` | 都正常 |

**第 4 层最该做也最容易漏** —— 单元测试全绿不代表打包产物能跑（`files` 白名单可能漏掉新目录）。

## ⚠ 拆大文件前，先确认「这个文件到底有没有命令」

本次方案写「`todo.js` 只留命令入口（`cmdTask`/`cmdBoard`/`cmdTodoArchive`）」——**全错**。
这三个命令**在 `store.js`**，`todo.js` 是**纯库模块，一个命令都没有**。

**判据**：拆之前先 grep 确认命令定义在哪个文件，别照名字想当然。

## 教训汇总（下次直接照做）

1. **死代码判据**：剥声明行 → 全项目数 0。别忘剥，别忘了算 test/ 和 docs/
2. **多导出**：先别动。拆分往往自然解决。收窄接口的风险大于收益
3. **拆文件前必须画依赖图**，并用「剥注释」的真边 —— 职责直觉常常是错的
4. **共享数据提成独立模块**是断环的标准解法，比调整函数归属有效
5. **保留 re-export 入口** → 对外接口零变动 → 回归面最小
6. **拆完必比对导出清单**，逐个相等才算等价重构
7. **自写检测脚本 vs grep 不一致时，信 grep**
8. **打包产物要真跑一次**，别只信单元测试

## 关联连接
- [[reuse-existing-field-over-new-one]] — 同族：都是用已有的、别急着造新的（那页讲数据结构，本页讲代码）
- [[2026-10-09-死代码与拆分实测]] — 本页的取证现场：可复制的检测命令 + 完整输出数据
- [[guard-check-then-set-across-await]] — 同族：判断的时机错了，结论就错了
- [[self-authored-evidence]] — 本页「坑 2」的同类：自己写的检测脚本不能自证
- [[perf-fixed-overhead]] — 同族：改动要能被量出来（本次靠 556 个测试与导出清单量化）
- [[fanchao]] — 本页沉淀者