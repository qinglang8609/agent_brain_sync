---
title: abs 流程（会话落页 / 提炼 / 收尾 / 维护）
tags: [concept, abs, 操作手册]
status: active
author: fanchao
updated: 2026-11-13
---

# abs 流程

从 SKILL 移出的长尾之二。开工跑 `abs load` 就够，下面这些是「到某一步时才查」的做法。

## 开场：Init Sync（开工 / 默认续 todo）

1. **读状态**：`abs load`（MCP `abs_load`）读 Rules + 图谱计数 + todo + 最近 log，**先看 `## Rules`**。输出已折叠，全量明细用 `abs todo --full` / `abs index`。
2. **对账滞留（强制）**：顶部出现 `⏳ 上会话滞留` 说明上会话断了，先收尾再开工 —— 做完的 `abs todo done <id>`；没做完的 `abs todo note <id> --note "接到哪"`。
3. **读命中页**：`abs query <词>` → `abs resolve <页名或id>` 拿路径，**只读命中那几页**，绝不通读 `.brain/`；多文件汇总交 `ctx_execute` 在沙箱处理，只打印结论。
4. **续 todo**：把顶部未完成项当当前任务开做；有新任务而 todo 没有 → `abs todo add <id> --note 做什么` 再动工。

## 会话总结（把整场会话变成知识）

abs 不只记编程经验 —— **会话本身的结论也是知识**。两条路径，用途不同：

| 想要 | 命令 | 产出 |
|---|---|---|
| 一场会话干了什么/谈成了什么 | `abs ingest <会话文件或 id 前 8 位>` | 当天的 `sessions/log-<日期>.md` 里加一段 `## 会话 <id8>`，带三种骨架之一 |
| 还没落页的会话 | `abs summon` | 清单，不写盘 |

`abs ingest` 按「改过什么文件」机械判形状，不让模型猜：

- **技术类**（改了代码）→ 出了什么问题 / 怎么解决的 / 验证什么命令
- **业务操作类**（只改数据/配置/文档）→ 做了什么操作 / 结果怎样 / 下次注意事项
- **讨论类**（一个文件没改）→ 谈成了什么 / 没结论的地方

它只给骨架和素材（用户原话、改过的文件、工具调用次数），**不写结论** —— 内容要读会话后填。

**与会话的双向挂钩**（不要手改这三行）：`session`（pi 会话 id）、`session-file`（jsonl 文件名）、
`project`（会话发生时的 cwd）。页文件名也带会话 id 前 8 位，拿会话文件能反查有没有总结过。

会话摘要落在当天的 `log-<日期>.md` 里，填没填的判据是 `digestFilled`（`layers.js`）——
它现在只服务 `abs load` 顶部那条提醒（图数据库那套检索已于 2026-11-08 拆掉，见 [[no-graph-db]]）。

`abs load` 顶部会列出未填的张数（一行计数，不列页名）。**不必全部填** ——
挑最近、有结论的几场；其余留着当流水。

## 主动提炼（不等人说「收尾」）

提炼是**你的自觉**，不是等用户发指令。两个触发时机，任中一个就主动做：

1. **sources 积压**：`abs load` 顶部出现「♻ 待消化」或 `abs lint` 报 `SOURCES-PILED-UP`（> 10 条）→ 主动收拢。
2. **一段活收尾**：任务 `done`、或踩坑后刚 `abs_note` 暂存完 → 顺手看这条值不值得提炼成规律。

动作只有一步判断 + 一个落点：

```bash
abs review                        # 列出待确认的 draft 页（concepts + sources）
# 值得留 → 用自己的判断提炼成一句话，落到正确层：
abs capture --layer 3 "某工具怎么用/有什么坑"     # 工具经验
abs capture "踩坑的根因与解法"                    # 认知（默认 L4）
# 不值得留 → 否决掉：
abs review --reject <页名>
```

**判断力在你（agent），工具只做落点**——`capture` 不替你判「这条值不值得留、归哪一层」。提炼成规律后删原 source、清指向它的引用（防死链，见 Teardown 第 5 步）。

## 收尾循环（一轮活干完就走，不等人开口）

1. **读 todo**：`abs load`，看还有哪些没完成。
2. **对账**：按「进行中」四个落点补记 —— 漏登记的 `done`、做一半的补 `note` 子项、卡住的转 `滞留中`。
3. **沉淀经验**（值得才沉淀）：坑 / 可复用技巧 → `abs note` 暂存；值得深提炼的走下面的 Teardown。
4. **判教训够不够格进 Rules**：只有「违反会丢数据 / 静默失效 / 白干活」级才提；够格就输出一行 `[Rules 提议] <一句话>` 问用户，确认后才 `abs rule add "<一句话>"`。
5. **更新 index / log / todo**：新页同步进 index；`abs log "完成 X：…"`；`abs lint` 确认自洽。

**完成标准**：看板反映真实状态（Done 区没有滞留半成品）、该沉淀已落、够格教训已提议、index / log / todo 与事实一致。

两个当前的代码事实，别多做：

- `abs todo done` 成功时会**自动**往 `log.md` 落一条（1.31.4 起，正文 = 任务 id + 结语）。第 5 步只为**没登记任务**的活补 log，不要重复写。
- Stop 时 hook 把「未完成 + 子项」快照进 `~/.abs/log/wrapup.log`，下会话 `abs load` 自动顶到顶部 —— 本节不往对话里插提醒。

## 收尾：Teardown Sync（深提炼）

把**真实发生**的写回图谱，只写做过/跑过/测过的事实。按序：

1. **暂存线索**：`abs note` 记做了什么、改了哪些文件、验证命令。
2. **抽规律**：`abs concept <slug> --title "…"` 建页（自动带四段骨架）再填；四段别缺，尤其末尾「验证」段（`abs lint` 报 NO-TAIL）。留不留、新建还是并入由你判断；核实过的 `status` 改 `active`。
3. **查推翻**：旧页有被推翻的说法 → `abs supersede <旧页> --by <新页>`，别删页。
4. **沉淀实体 / 综合**：重要未记录的事物 → `entities/<TitleCase>.md`；选型取舍 → `syntheses/`。
5. **收拢 sources**：提炼成规律的删 source，**同步清指向它的引用**（防死链）。
6. **修 index + 记 log**：新页同步 index；过门槛的规律加进 `## Rules`。
7. **留接力棒**：`sessions/log-YYYY-MM-DD.md` 写 `## 🪝 Next Session Hook`。

## 维护：query / lint

- `abs query <词>` → 读命中页 → 答时用双链标来源。代码问题（符号在哪/谁调用）不在 `.brain`，直接读源码；已推翻经验默认不返回（`--all` 可看）。
- `abs lint` 报错码：`NO-INBOUND` / `SOURCE-UNDISTILLED` / `SUPERSEDED-DANGLING` / `DRAFT-STALE` / `NO-TAIL`。

## 验证

```bash
abs load                  # 开工能读到 Rules + 任务板 + 最近流水
abs lint                  # 0 问题
abs ingest --list         # 会话板：还有哪些没落页
```
判据：`abs load` 顶部没有未对账的滞留任务，`abs lint` 不报 NO-INBOUND / NO-TAIL。

## 关联连接
- [[abs-skill-structure]] — 姊妹页：七层判据 / 知识页格式 / 受理协议
- [[session-digest-design]] — 会话页机制的设计全貌
- [[fanchao]] — 本页沉淀者
