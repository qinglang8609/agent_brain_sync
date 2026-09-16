---
tags: [concept, 命名契约, lint判据, 数据迁移]
author: fanchao
updated: 2026-09-15
status: active
---

# 目录契约与判据精度：结构与命名都要「一天一文件」

## 触发场景
给知识库/文档目录定命名规则时；写 lint/校验判据时；迁移存量数据时。
本页来自 2026-09-15 把 6 个项目 `sessions/` 统一治理的实践。

## ❌ 表现：没有命名契约，同一天散成 5 个文件

实测 codebuddy 项目 `sessions/` 同一天（2026-09-07）有 **5 个文件、5 种 tags**：

```
2026-09-07-init-brain.md      tags: [source]
2026-09-07-todo-md-archive.md tags: [source, archive]
2026-09-07-todo归档.md         tags: [todo-archive, 历史]
2026-09-07-ui-fixes.md        tags: [source, session-log]
log-2026-09-07.md             tags: [session-log]
```

**症状**：查一天的事要开 5 个文件；`sessions/` 与 `sources/` 语义互相污染。

## 🛠 解法 1：一天一文件（硬契约）

**一天只允许一个文件，且只能叫 `log-<日期>.md`**，该日一切都放进它：

```
log-2026-09-08.md
  ├─ 快照正文（人写：做了什么/怎么定位/结论）
  ├─ ## 关联连接
  ├─ ## 🪝 Next Session Hook（强制）
  └─ ## 📦 任务归档（`abs todo archive` 自动写，勿手改）
```

**归档不另建文件** —— 跑 `abs todo archive` 即写进当天快照的归档段
（已有快照只替换该段、段外逐字保留；无快照则建只有归档段的页）。

## 🛠 解法 2：判据看**结构**，不看关键词（两次踩到）

| 判据 | 错误写法 | 问题 | 正确写法 |
|---|---|---|---|
| 缺尾巴 NO-TAIL | 页内出现「验证」二字 | 正文随口提"验证环境"就冒充有尾 | 认段标题/列表项 + **段内有真内容** |
| 知识冲突 UNRESOLVED | `/知识冲突/` 裸子串 | 任务描述写"（知识冲突裁决）"即误报 | 认 `^#{2,6}.*知识冲突` 段标题 |

**通则：凡是"某段存在与否"的判据，都必须匹配段标题（`^#{2,6}`），不用裸子串。**

## ⚠️ 正则词边界陷阱（豁免判据）

豁免要**精确匹配标签**，不能用 `\b`：

```js
/\barchive\b/.test('todo-archive')   // → true  ← 陷阱！'-' 与 'a' 之间也是词边界
tagList.includes('archive')          // → false ← 正确
```

**后果**：本想豁免「外部产物全文归档」（如仓库 todo.md 全文），结果把**全部旧命名
归档页**也豁免了 → 4 天漏报，一个都不报。

## 🛠 迁移存量数据的方法（无损三判据）

1. **先备份**：git 提交点，或 `cp -r` 到 `/tmp`
2. **逐行核对无损**：脚本比对每一条任务/每一行，不看"像不像"，看计数
3. **发现真丢失就补**：实测 codebuddy 的 `ui-fixes` 有 **2 项 log 里没有**
   （组件标准化/Field 表单原语、引用改链）—— 「目的是重复」不等于「真的重复」

**合并同天多份快照时**：各自 `## 🪝 Next Session Hook` 都要留（它们是不同主线的接力棒）。

## 🛠 治理范围要全：用 find 而非"我知道那几个"

**实测漏扫**：第一轮只查了 `~/Code/*`，漏掉 `~/Docker` 与 `~/.brain`（家目录图谱）。

```bash
find ~ -maxdepth 4 -type d -name ".brain" -not -path "*/node_modules/*"
```

**通则：说"全部/所有"之前，先跑一遍发现命令。**

## 验证命令
```bash
# 判据是否有牙: 故意造一个违规页，跑 lint 看它报不报
abs lint | grep -E "SESSIONS-|NO-TAIL"
# 迁移是否无损: 计数比对（旧条数 == 新段条数）
# 治理是否覆盖全:
find ~ -maxdepth 4 -type d -name ".brain" -not -path "*/node_modules/*"
```

## 关联连接
- [[feature-delete-not-patch]] — 同族：靠提醒/靠自觉的功能不如代码结构强制
- [[learning-loop-collect-distill-deliver]] — 写入侧定结构（本页是它在目录层的应用）
- [[abs-install-layout]] — 另一个「命名/布局须与读取方同一版本」的实例
- [[silent-data-loss-diagnosis]] — 漏报（该报不报）属于静默失效的一种
- [[audit-claims-verify-before-fix]] — 判据类断言（正则/结构）必须先跑过再认
- [[AgentBrainSync]] — 项目实体页
