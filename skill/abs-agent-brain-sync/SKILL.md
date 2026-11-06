---
name: abs-agent-brain-sync
description: "USE FOR abs / agent-brain-sync 跨会话记忆与任务续接。触发词：用户直接输入 abs（单独一个词或 abs + 命令，如 'abs 开工'、'abs 沉淀'），以及「开工续接状态」「沉淀会话收获」「任务登记不丢」「经验落成知识页」「图谱体检」等任务。"
---

# abs — 跨会话记忆 (agent-brain-sync)

`.brain/` 是**你自己的跨会话记忆库**：踩过的坑、做过的决定、验证过的做法都在里面。

**查它是你的决定，不是别人提醒你才做。** 干活中一旦心里形成关键词、对某件事有疑问
（这个坑以前踩过吗？这个约定是谁定的？），那一刻就主动查 —— 不要等报错、不要等用户提醒。

## 开工：跑一句就够

```bash
abs load
```

它给：Rules（铁律，最先读）+ 图谱计数 + 任务板 + 最近流水 + 未填会话页提醒。
顶部若有 `⏳ 上会话滞留`，先对账再开工 —— 做完的 `abs todo done <id>`，
没做完的 `abs todo note <id> --note "接到哪"`。

**绝不 `cat .brain/` 通读**。要主题用检索，要单页用 `abs resolve` 后只读那一页。

## 找东西：三档，按精确度选

| 你在干什么 | 用哪个 |
|---|---|
| 不知道找什么，卡住了 | `abs recall [词…]` —— 按当前处境推（不给词也行） |
| 知道关键词，要最准 | `abs search <词>` —— 亮度排序 + 邻居扩散 + 跨项目 |
| 要字面精确、输出短 | `abs query <词…>` —— 多词 OR 命中 |

`abs search` 与 `abs query` 是**详略两档，不是重复**：前者带亮度和扩散更准，
后者只给页名+摘要更省 token。MCP 侧分别对应 `abs_search` / `abs_query`。

拿到页名后 `abs resolve <页名>` 反查路径，只读命中的那几页。答时用 `[[页面名]]` 标来源。

## 写知识：三个落点，别混

| 你手上的东西 | 落点 | 命令 |
|---|---|---|
| 一句经验，还没想清 | `sources/` 待提炼 | `abs note "一句话"` |
| 要成页（有骨架好填） | `concepts/` | `abs concept <slug> --title "…"` |
| 一句话记下，日期即时间线 | `concepts/` | `abs capture --layer 2/3/4 "…"` |
| 违反就必须停下的硬约束 | index 的 `## Rules` | `abs rule add "≤42 字"` |

`concept` 与 `capture` 都写 `concepts/`，但产出不同：前者带四段骨架（触发场景/表现/解法/验证），
后者只落一句话 + 日期前缀。要「写细」用 concept，要「快记」用 capture。

**写完跑 `abs lint`**，它报死链、超限、无尾（`NO-TAIL`：页要有「做完怎么确认」那段）。

## 写任务：todo 是活看板

```bash
abs todo add <id> --note "做什么"        # 登记
abs todo note <id> --note "到哪一步"      # 追加子项（一句话）
abs todo done <id> --as 落地|否决|仅方案 "结语"
abs todo state <id> --note 进行中|讨论中|滞留中|搁置
abs todo remove <id>                     # 删除（连子项，不可恢复）
```

- **开工前先登记**：要动文件/跑命令就先 `start`，名字粗糙没关系（事后可 `rename`）。
- **一段活干完立刻 done**：别攒着等大需求收尾。
- `搁置` = 先不做、还留在看板上；`remove` = 当作没登记过。**两者别混**。
- 随手记多句发现用 `abs todo memo <id> "…"`，不占看板。

## 触发器：意图，不是关键词

句子里出现 todo / 沉淀 / load / note 这些词，若是**谈论、提问、定规则**，只回应不执行。

唯一例外：用户直接输入 `abs`（单独一个词或 `abs` + 命令，如 `abs 开工`）—— 明确要用 abs，
直接执行；无子命令时走开工流程。

## 文档精简（写 todo / 知识库文档必须遵守）

1. 所有内容服务于主题目标，无关的直接去掉。
2. 不写没验证过的经验和总结。
3. 层次分明，按前因后果组织，不用自造词。
4. 禁止反问、猜测。
5. 拒绝重复，已有文档写过的优先引用。
6. 禁令直接了当，不唠叨。

## ⛔ 禁止做

1. 禁止手工建骨架 / 手工登记任务 —— 用 `abs init` / `abs todo add`。
2. 禁止通读 `.brain/` —— 要状态用 `abs load`，要主题用检索，要单页用 `abs resolve`。
3. 禁止删知识页表达"已失效" —— 用 `abs supersede <页> --by <新页>`。
4. 禁止直写 Rules —— 先提 `[Rules 提议]` 问用户，确认后 `abs rule add`。
5. 禁止用宿主原生 todo 承载跨会话任务 —— 用 `abs todo`。
6. 禁止编造没跑过的验证结论。

## 需要时再查的细节

以下内容已移到图谱页，**不要凭记忆猜**，用到时读它：

| 要做什么 | 读哪页 |
|---|---|
| 七层怎么判、`--kind` 怎么选、收尾深提炼全流程 | `abs resolve abs-skill-details` |
| 会话页怎么落、三种骨架、与会话的挂钩 | `abs resolve session-digest-design` |
| 新需求受理协议（先方案→登记→问开工） | `abs resolve abs-skill-details` |
| `.brain/` 目录结构、知识页 frontmatter 格式 | `abs resolve abs-skill-details` |
| 体检报错码含义（NO-INBOUND / NO-TAIL / …） | `abs resolve abs-skill-details` |

## 自我约束

只读写 `.brain/` 与目标代码，不动全局配置（一次性接入除外）；
双链、frontmatter、index 必须自洽 —— 坏链等于掰断接力棒。
