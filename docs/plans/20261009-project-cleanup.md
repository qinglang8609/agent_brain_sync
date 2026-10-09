# 方案：项目结构化 / 工程化整理与清理

日期：2026-10-09
状态：**已拍板，实施中**

## 0. 用户拍板（2026-10-09）

| 议题 | 决定 |
|---|---|
| `.brain/sources/` 空目录 | ~~删掉~~ → **改：不删**（见「实施中的纠正 1」） |
| 做哪一阶段 | **两个阶段都做**（先清理，再拆） |
| CI / linter | **都引**：ESLint + Prettier；CI 只跑测试 + 语法检查 |
| `todo.js` 拆法 | **按真实依赖重划，先抽公共层**（原「按职责拆三个」已作废，见纠正 3） |

## 实施中的纠正（2026-10-09，实测后回头改方案 —— 工作流第 11 条）

### 纠正 1：`.brain/sources/` 不能删

原方案把它当「空目录残留」。实查：它是**功能目录** ——
`cmdInit` 在 `BRAIN_DIRS` 里建它；`lint` 在 `PAGE_DIRS` 里扫它（报 `SOURCES-PILED-UP` / `SOURCE-UNDISTILLED`）；
`load` 在堆积时提醒；`abs note` 往里写。**20+ 处测试**依赖它。

且那 8 个 `sources/*.md` 在本次开工**之前**就已被删（首次 `git status` 即为 `D`）。
→ **已全部 `git checkout` 恢复**，用户选的「删掉」作废。

### 纠正 2：`todo.js` 里没有任何命令

原方案写「`todo.js` 只留命令入口（`cmdTask`/`cmdBoard`/`cmdTodoArchive`）」—— **错**。
这三个命令在 `store.js`，`todo.js` 是**纯库模块**。

### 纠正 3：原来的「按职责拆三个」会造出环

实测调用图（已剥注释行避免假边）后，按原三刀切会产生 **`structure` ⇄ `validate` 真环**：

```
structure -> validate :  enforceBrainFormat -> checkFileShape
                         ENTRY_SHAPES       -> assertTodoContent
validate -> structure :  checkFileShape -> ENTRY_SHAPES / TODO_SECTIONS
                                         / isAllowedTodoSub / indexLinkSectionNeeds
```

根因：**分区名常量与 `ENTRY_SHAPES` 是「共享数据」**，却被放在了 structure 侧，
而 validate 要读它 → 回指。

## 最终生效的拆法（用户 2026-10-09 重拍板：先抽公共层）

**对外接口不变**：`src/todo.js` 保留为 re-export 入口 → `store.js`/`lint.js`/`note.js`/`wrapup.js`/测试
的 import **一行都不用改**（风险大幅降低）。

```
src/todo.js          ← re-export 入口（保持所有已有 export 名称）
src/todo/
  common.js     ← 常量 + 纯工具：行数上限、today/localStamp、SEC、
                   extract*/sigOfLine/isTaskLine/isChildLine/isPlaceholder/
                   daysAgo/sentenceCount/REPORT_MARKERS/trimBlank
  spec.js       ← 共享数据（专为破环而抽）：TODO_SECTIONS/TODO_SUBSECTIONS/
                   INDEX_*/LOG_KINDS/H1_TO_FILE/TASK_STATES/LEGACY_SECTION_RENAMES/ENTRY_SHAPES
  structure.js      ← rebuildStructure/enforceBrainFormat/normalizeTodo/…
  validate.js       ← checkFileShape/assert*/violationSignatures
  archive.js        ← collapseDone/archiveDoneInText/upsertArchiveSection/…
  tasks.js          ← readTodo/ensureTodo/addTask/upsertTask/setBreakpoint/boardText
```

依赖方向（单向，无环）：`tasks → {structure, archive, validate, spec, common}`；
`structure → {validate, spec, common}`；`validate → {spec, common}`；`archive → {spec, common}`。

## 实施进度

1. ✅ **第一阶段清理**（删 3 个死函数 + `.gitignore` 补 `.claude/`）→ 556 pass / 0 fail
2. ✅ **拆 `src/todo.js`** → 1305 行 → 6 个模块（55 导出零丢失、无环）→ 556 pass / 0 fail
3. ✅ **收窄多导出** → 实查后**无需收窄**：拆分后的 10 个“多余导出”全是真实跨模块 import（原计划的「21 个多导出」是拆分前误判）
4. ✅ **ESLint**（Prettier 已按用户决定去掉）→ 从 75 个问题清到 **0 问题**
5. ✅ **CI**（`.github/workflows/test.yml`，node 18 + 22，只跑语法检查 + 全量测试）
6. ⬜ 沉淀 concept 页 + 回头对方案

## 实施结果（实测）

### 死代码清理（第一阶段）

| 删掉 | 位置 | 依据 |
|---|---|---|
| `fixMarks` | `src/store.js` | 全项目零引用 |
| `renameLegacySections` | `src/todo.js` | 全项目零引用 |
| `absHookDir` | `src/install.js` | 文件内零调用（上方 bug 历史注释保留） |
| `JSON_MARK_KEY` | `src/install.js` | 只定义未使用 |
| `NOTE_DEDUP_MS` | `src/note.js` | 只定义未使用（去重逻辑实际按内容包含） |
| `rawValues` | `bin/abs.js` | 解构后未用 |
| 11 个未用 import | `src/store.js` | 不在重导出名单，也不在内部使用 |
| `maxWaitMs` | `src/lock.js` | 选项既无调用方传、也无内部使用 |
| 4 个未用参数 | `install.js` 各 installer / `runUninstall` | 签名统一但实际未用 |
| `resolve`/`dirname` | `src/page.js` | 导入未用 |

### `todo.js` 拆分结果

```
src/todo.js         10 行   re-export 入口（对外 55 个名字逐个不变）
src/todo/
  common.js        163 行   常量 + 纯工具（无本地依赖）
  spec.js          218 行   分区名/白名单/条目形状/行数上限（只依赖 common）
  validate.js      204 行   形状校验/长度/空行（依赖 spec + common）
  archive.js       320 行   Done 结语契约与归档（依赖 common + spec）
  structure.js     324 行   结构重排与格式归一（依赖 spec + validate + common）
  tasks.js         163 行   任务读写入口（依赖 common + structure + spec + archive）
```

依赖方向单向无环：`common ← spec ← {validate, archive} ← structure ← tasks`。

**关键点：对外接口零变动** —— `store.js`/`lint.js`/`note.js`/`wrapup.js`/4 个测试文件的
import 一行都没改，所以回归风险被压到最低。

### 工程化基础设施

- `eslint.config.js`：扁平配置，抓真问题（未用变量/可疑写法/prefer-const）；
  对项目的刻意做法做了显式说明（零宽字符匹配、稀疏数组、重导出模式、测试 fixture）
- `package.json` 加 `lint` / `check` 脚本（`format*` 已随 Prettier 一起移除）
- `.github/workflows/test.yml`：node 18 + 22 矩阵，跑语法检查 + 全量测试

### 验证层级（复现 / 回归 / 边界）

1. **回归**：`npm test` → 556 pass / 0 fail（改动前后一致）
2. **静态**：`npm run check` → 语法 + eslint 全过
3. **边界**：导出清单逐个比对 → 拆分前 55 个、拆分后 55 个，零丢失
4. **真实运行**：`npm pack` 后装到空项目，`abs init` / `todo add` / `todo` / `lint` / `load` 全部正常


## 1. 需求（用户原话）

> 整个项目结构化 工程化，文件目录整理清晰明确  无用的文件 知识沉淀 没有引用的函数 方法文件 整理清理

翻译成可交货的功能点：

1. 目录结构清晰明确，每层放什么有说法
2. 无用文件清理掉（不删有价值的历史，只删真正的垃圾）
3. 死代码清理掉（没有引用的函数 / 方法 / 文件）
4. 知识沉淀归位（`.brain/` 图谱 + `docs/` 方案 + README 三者不打架）

## 2. 现状（全部来自实测，2026-10-09）

### 2.1 健康的部分 —— 不用动

- **测试基线**：`npm test` → 556 tests / 96 suites / **0 fail**（13985ms）。改动全程要守住这个数。
- **src 模块无孤儿**：15 个 src 文件全部被引用，没有整个文件死掉的情况。
- **入口清晰**：`bin/abs.js`（CLI）、`bin/mcp.js`（MCP 服务），两者都只从 `src/store.js` 等取命令。分层没有乱。
- **`.githooks/`** 只有 pre-commit / pre-push 两个，职责明确，已跟踪。
- **无 legacy 备份残留**：`backup-legacy-*/` 之类一个都没有。

### 2.2 真问题

#### 问题 A：两处真死代码（确凿）

逐个剥掉声明行后统计「文件内实际使用 0 次 + 全项目 0 引用」：

| 位置 | 名字 | 证据 |
|---|---|---|
| `src/store.js:227` | `fixMarks` | 全项目 grep 只剩它自己的声明行；测试、文档、hook 全无引用 |
| `src/todo.js:86` | `renameLegacySections` | 同上 |

两者都被 export 了但没人用（历史遗留的迁移动能，迁移已完成）。

```
$ grep -rn "fixMarks\|renameLegacySections" --include=*.js --include=*.ts --include=*.md .
./src/store.js:227:export function fixMarks(text, spec) {
./src/todo.js:86:export function renameLegacySections(text) {
```

#### 问题 B：一处「定义了但一次都没调用」的私有函数

`src/install.js:248` 的 `absHookDir(agentKey)` —— 未被 export，文件内出现 1 次（就是定义那行）。

**注意**：它上面那条注释解释了「曾经用子串匹配导致误删用户 hook」的真实 bug，最终修法是 `isAbsStagedCommand` 里的正则 token 比对，**不再走 `absHookDir`**。所以函数是死的，但那段注释是有价值的历史 —— 删函数、**保留注释**。

#### 问题 C：一处「多导出」（不是死代码，是接口面偏大）

以下都是 **文件内部在用**（1~6 次），只是顺手 export 了、外部没人 import。不影响运行，但让外部无法判断哪些是稳定接口：

- `src/wrapup.js`：`WRAPUP_MAX_BYTES`（内部用 1 次）
- `src/store.js`：`RULES_HEADING`（内部用 6 次）
- `src/relevant.js`：`FUZZY_MIN_GRAMS`（内部用 1 次）
- `src/todo.js`：`TODO_SECTIONS`、`TODO_SUBSECTIONS`、`isAllowedTodoSub`、`INDEX_SECTIONS`、`INDEX_LINK_SECTIONS`、`H1_TO_FILE`、`ENTRY_SHAPES`、`RETIRED_SECTIONS`、`dropRetiredSections`、`BREAKPOINT_MAX`、`TASK_LINE_MAX`、`violationSignatures`、`assertNoStrayBlank`、`renderArchiveBody`、`ARCHIVE_SECTION`、`extractId`、`extractNote`、`isLegacyAuthorTag`（共 19 个）

**处置建议**：这批**先不动**。理由——把 `export` 去掉属于「改接口面」，风险大于收益；而且 `todo.js` 1320 行本身是更大的问题（见问题 E）。等真的要拆 `todo.js` 时一起处理。

#### 问题 D：临时 / 本地文件状态（需要你确认）

| 路径 | 状态 | 体积 | 判断 |
|---|---|---|---|
| `.claude/` | 未跟踪，且**未被 .gitignore 覆盖** | 4.3KB | `settings.local.json` 是本机权限白名单。它显示为 `!!`（被忽略），但 `.gitignore` 里没这条 —— 说明是被全局 gitignore 或 `.git/info/exclude` 挡的。**建议显式加进 `.gitignore`**。 |
| `.codegraph/` | 已忽略（含自带 `.gitignore`） | 4.6MB db + 30KB log | daemon.log 是日志，可留；db 4.6MB 是本地缓存。**已正确忽略，不动**。 |
| `.omo/` | 已忽略 | 0.4KB | 两个 session json。已忽略，不动。 |
| `.pi-glla/` | 已忽略 | 548KB `active.jsonl` | GLLA 运行数据。已忽略，不动。 |
| `.brain/sources/` | 空目录 | 0 | 曾 8 个文件，git status 显示全被 `D` 删除。**空目录要么删、要么留着等新素材** —— 看下面问题 F。 |

#### 问题 E：`src/todo.js` 1320 行 / 66KB —— 单文件过载（最大结构问题）

对比同层其他文件：

```
todo.js      1320L  66.4KB  ← 异常
store.js     1000L  51.1KB  ← 异常
install.js    944L  44.1KB  ← 偏大但它是安装逻辑，内聚
lint.js       430L  20.1KB
relevant.js   333L  14.4KB
page.js       264L  12.6KB
note.js       275L  13.7KB
其余           <170L
```

`todo.js` 一个文件里塞了：todo 模板/分区定义、结构重排（`rebuildStructure`）、遗留分区迁移、行级校验（`BREAKPOINT_MAX`/`TASK_LINE_MAX`/`assertNoStrayBlank`）、ID/note 解析、归档渲染、看板生成。**至少是 3 件事**。

这违反工程论第 2 条（一个模块只管一件事）。但**拆它是大手术**，本方案把它列为「第二阶段」。

#### 问题 F：知识沉淀现状

- `.brain/`：63 文件 / 411KB，**46 个 concepts 页** —— 沉淀是活跃的、健康的。
- `docs/plans/`：只有 2 份 2026-10-06 的方案页。按 vibe-coding-help 工作流第 7 条，方案应落这里。**这两份已完成，属于历史归档**。
- `README.md` 208 行 / 9.5KB —— 结构完整（安装/怎么用/更新/卸载/开发/目录），没问题。
- `skill/abs-agent-brain-sync/SKILL.md` 194 行 —— 独立的 skill 副本，是发布产物的一部分（`package.json` 的 `files` 里有 `skill/`），**不能删**。

`.brain/sources/` 空掉是因为 8 个源文件被删（git status 里的 `D`）。需要你决定是保留空目录还是删掉。

#### 问题 G：缺少工程化基础设施

- **无 CI**（`.github/` 不存在）—— 有 556 个测试但只在本地跑
- **无 linter / formatter 配置**（无 eslint / prettier / editorconfig）
- ~~无 `check-syntax.mjs` 调用入口~~ → **已核实：不是问题**。`scripts/check-syntax.mjs` 被 `.githooks/pre-commit` 第 12 行调用（`node --experimental-vm-modules --no-warnings scripts/check-syntax.mjs`）。它没进 `package.json` 是因为它是 git hook 的第一道门，不需要 npm script 入口。**保持现状**。

## 3. 修改方案

按「风险从低到高」分两阶段。**第一阶段全是低风险删减，第二阶段才动结构。**

### 第一阶段：清理（低风险）

| # | 动作 | 文件 | 为什么 |
|---|---|---|---|
| 1 | 删死函数 `fixMarks` | `src/store.js` | 全项目零引用 |
| 2 | 删死函数 `renameLegacySections` | `src/todo.js` | 全项目零引用 |
| 3 | 删私有死函数 `absHookDir` | `src/install.js` | 文件内零调用；**保留上方那段 bug 历史注释** |
| 4 | `.gitignore` 补 `.claude/` | `.gitignore` | 本地权限文件不该进版本库，现在靠全局规则挡着，不显式 |
| 5 | ~~加 `npm run check` script~~ | — | **已撤销**：`check-syntax.mjs` 已被 pre-commit 正式调用，不需要新入口（避免造重复入口） |

**验证**：改完跑 `npm test`，必须是 556 pass / 0 fail。再跑一次语法检查。

**预计 diff**：约 -40 行。

### 第二阶段：结构（已拍板，做）

| # | 动作 | 说明 |
|---|---|---|
| 6 | 拆 `src/todo.js`（1320 行） | 建议拆成 `todo/structure.js`（模板+分区+重排）、`todo/validate.js`（行级校验+断言）、`todo/archive.js`（归档渲染）；`todo.js` 保留命令入口 |
| 7 | 收紧多导出（问题 C 的 21 个） | 拆的时候顺带把不对外用的 `export` 去掉 |
| 8 | 引入 CI | `.github/workflows/test.yml` 跑 `npm test` |
| 9 | 加 eslint / prettier | 统一风格；现在靠人肉保持 |

**为什么排在第一阶段之后**：第 6 条是纯重构，动 1320 行的文件，回归风险显著；先清理再拆，万一测试红了能一眼看出是清理还是拆分引入的。

### 知识沉淀归位

- 本次体检结论（哪些是死代码、哪些是「多导出」、为什么 `absHookDir` 的注释要留）**沉淀成一张 concept 页**：`.brain/concepts/dead-code-vs-over-exported.md`
- 两个方案页保留在 `docs/plans/`（历史归档，不删）

## 4. 影响面

改这些会碰到谁：

- `src/store.js` / `src/todo.js` / `src/install.js` 的 export 表 → 需确认 `test/store.test.js`（2627 行）、`test/install.test.js`（1289 行）里没有引用
- `.gitignore` → 只影响 git 状态显示
- `package.json` scripts → 影响 `npm run check`

## 5. 已拍板的决定（原「待你决定」）

1. ~~`.brain/sources/` 空目录~~ → **删**
2. ~~第二阶段做不做~~ → **做，两个阶段都做**
3. ~~CI / linter~~ → **都引**（ESLint + Prettier；CI 只跑测试+语法检查）
4. ~~`todo.js` 拆法~~ → **按职责拆三个**（见问题 E）

## 6. 附：完整文件清单（53 个，排除 node_modules/.git/.brain/.pi-glla）

```
bin/         abs.js(583L) mcp.js(300L)
src/         todo.js(1320L) store.js(1000L) install.js(944L) lint.js(430L)
             relevant.js(333L) note.js(275L) page.js(264L) wrapup.js(162L)
             query.js(146L) userconfig.js(115L) codegraph.js(88L) lock.js(88L)
             index.js(66L) hosts.js(55L) text.js(38L)
hooks/       abs.pi.ts(1144L) event.sh(115L) abs.opencode.ts(72L)
test/        16 个测试文件，共 7550 行
skills/      abs-agent-brain-sync/SKILL.md(194L)
docs/plans/  2 份方案页
scripts/     check-syntax.mjs(90L)
.githooks/   pre-commit(70L) pre-push(33L)
根目录       README.md(208L) package.json(43L) .gitignore .npmignore
```
