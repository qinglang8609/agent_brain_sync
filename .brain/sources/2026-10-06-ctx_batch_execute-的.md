---
tags: [source, tool, ctx, 误读, 证据]
id: 2026-10-06-ctx_batch_execute-的
author: fanchao
updated: 2026-10-06
status: draft
---

# 来源：ctx_batch_execute 的 section 是 query 匹配结果，未命中的段显示为空——会被误读成「命令没输出/仓库干净」。实测：git…

TITLE: ctx_batch_execute 的 section 是 query 匹配结果，未命中的段显示为空——会被误读成「命令没输出/仓库干净」。实测：git status/git log 明明有内容，agent 看到空 section 推断「工作区干净」，差点带错误结论走。判据：batch 工具的空段 ≠ 空输出，要核实得直接跑命令看原始 stdout。

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- ctx_batch_execute 的 section 是 query 匹配结果，未命中的段显示为空——会被误读成「命令没输出/仓库干净」。实测：git status/git log 明明有内容，agent 看到空 section 推断「工作区干净」，差点带错误结论走。判据：batch 工具的空段 ≠ 空输出，要核实得直接跑命令看原始 stdout。

## 关联连接
- [[fanchao]] — 本页沉淀者
（提炼成 concepts 规律页后，在此挂双链到该页）
