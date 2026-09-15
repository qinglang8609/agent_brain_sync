---
tags: [concept, 协议设计, 借鉴, 选型]
author: fanchao
updated: 2026-09-15
status: active
---

# 别人三个协议设计值得抄：manifest 分层 / fallback 自救 / id 抗改名

## 触发场景
设计「Agent 怎么读知识库」时；或自己的读取协议随规模膨胀、引用一改名就断链时。
来源：OpenContext(0xranx) 对比（2026-09-15），三项已在本仓落地并验证。

## 抄什么（三项，各自独立）

**① manifest 分层：先给「路径 + 一行 desc + 计数」，让 Agent 自己挑**
反面是**直接吐全文**。本仓对照：`abs load` 曾面临同样的膨胀问题。
但**实测推翻了原计划**：`abs load` 已折叠成计数、仅 2.9KB，**不随规模增长**。
→ 真正缺的不是"瘦身"，而是**中间缺一档「挑选入口」**：`load` 只给分区计数、
`query` 要先猜对词。补上 `abs_pages`（复用 index.md 已有的一句话，上限 40 页）。

**② 错误带 fallback：让调用方自救，而不是卡死**
`err(msg, {code, fallback})` → 输出 `[CODE] 原因` + `→ 下一步`，并带 `structuredContent`
供程序判分支。例：`INDEX_NOT_AVAILABLE → 改用 oc_manifest`。
本仓落地：9 处重复的 `'未找到 .brain'` 收口为 `errNoBrain`，**改一处即全改**。

**③ stable_id：引用跨改名存活**
用路径引用 → 改名即断链，lint 只能"事后查死链"。
用 stable id → **链不会断**，lint 从"事后查"变"事前防"。
本仓落地：frontmatter 写 `id:` 且**建页时冻结**；旧页无 id 回退 slug（存量 37 页**零迁移**）；
改名后 lint 报 `ID-DRIFT`，`abs resolve <id>` 仍能找回。

## ⚠️ 关键判断：不抄什么（同等重要）

**不上 uuid / 哈希** —— 哈希随内容变，比文件名**更不稳**；uuid 不可读且要全量迁移。
**slug 就是最合适的 id**，只要不再跟文件名跑（冻结即可）。

**它的代价本仓不付**：全局存储 + 向量检索 + LLM 提炼 + API key 依赖
→ 牺牲了 abs 的 **git 化 / 零依赖 / 项目隔离**。

**它的触发方式是反面教材**：其 Agent 集成是"写 AGENTS.md 建议 Agent 主动调"——
属**建议式触发**，正是 abs 已证明会失效的那类（见 [[feature-delete-not-patch]] 的硬规则）。

## 🛠 可复用的借鉴步骤
1. **先量自己的真实状态再抄**（本仓差点按错误前提去做"load 瘦身"）。
2. 抄**协议层**（读取形态、错误形态、引用形态），不抄**依赖层**（存储/检索/外部服务）。
3. 抄完必须**真跑验证**并记下"哪条被实测推翻"（`read-side-output-must-not-scale` 即此产物）。

## 验证命令
```bash
abs --version && abs query <词>          # 挑选入口是否可用
abs resolve <id>                          # id 反查（改名后仍应命中）
abs load | wc -c                          # 读取侧是否仍不随规模增长
```

## 关联连接
- [[read-side-output-must-not-scale]] — 三项之首的直接产物（读取侧收口）
- [[index-row-not-attribution]] — manifest 分层的配套（index 行只给一句话，不承载归因）
- [[feature-delete-not-patch]] — 「建议式触发」为何是反面教材（该硬规则的来源）
- [[npm-publish-flow]] — 落地后随版本发布的流程
- [[AgentBrainSync]] — 项目实体页
