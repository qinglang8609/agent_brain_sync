# 📋 Todo Board

## Todo

## Done

### 2026-10-18
  - [x] 测试子项：故意不勾
- [x] subtask-hierarchy-in-done [[fanchao]] — 子任务完成进 Done 后必须保持缩进挂在主任务下，不能丢层级 【落地】 (完成 2026-10-18 01a14cf9-1259-73)
- [x] release-1.19.1-rest2 [[fanchao]] — 闸门四漏全修，629/629 过，已提交 31f9541（原 release-1.19.1 遗留） — 已完成（数据修正：原为主任务的子项，被旧逻辑错误升格） 【落地】 (完成 2026-10-18)
- [x] release-1.19.1-rest1 [[fanchao]] — 源码已提交 31f9541，629/629 过（原 release-1.19.1 遗留） — 已完成（数据修正：原为主任务的子项，被旧逻辑错误升格） 【落地】 (完成 2026-10-18)
- [x] mcp-restart-verify-rest1 [[fanchao]] — 临时子项A（原 mcp-restart-verify 遗留） 【否决】 (完成 2026-10-18)
- [x] mcp-restart-verify [[fanchao]] — 重启后验证 MCP 进程已加载 1.19.1 新逻辑 【落地】 (完成 2026-10-18 01a14cf9-1259-73)
- [x] release-1.19.1 [[fanchao]] — 提交三文件闸门加固 + 发布 npm + 本地安装 【落地】 (完成 2026-10-18 01a14cf9-1259-73)
- [x] write-path-hardening [[fanchao]] — 保证 index/log/todo 插入稳定，禁止脏字段与格式污染 【落地】 (完成 2026-10-18 01a14cf9-1259-73)
- [x] index-cleanup [[fanchao]] — 清理 index.md 里混入的无关内容 【落地】 (完成 2026-10-18 01a14cf9-1259-73)
- [x] subtask-done-not-in-panel [[fanchao]] — 排查 todo 子项未完成但父任务已完成时，子项不显示在面板 【落地】 (完成 2026-10-18 01a14cf9-1259-73)

### 2026-10-16
- [x] 补-LICENSE文件 [[fanchao]] — package.json 写 MIT 但仓库根没有 LICENSE — 已加 MIT LICENSE（Copyright 2026 fanchao）；npm pack 自动包含，无需改 files 白名单。顺手更正审核报告里被 awk 粗算错的函数长度数字。 【落地】 (完成 2026-10-16)
- [x] 拆-isAllowedTodoSub [[fanchao]] — src/todo/spec.js 里 119 行，占文件一半 — 任务本身作废：我审核报告里写的「119 行」是它的行号、不是函数长度，实际只有 3 行（纯只读谓词，无需拆）。报告数字已更正，并加了「别拿行号/粗脚本输出当结论」的教训。 【否决】 (完成 2026-10-16)
  - [x] 不急，等下次碰这块再拆
- [x] 升级SDK修依赖漏洞 [[fanchao]] — 升 @modelcontextprotocol/sdk 1.30.0 → 1.32.1，跑 npm audit fix — SDK 升 1.30.0→1.32.1（npm audit fix 在 ^1.30.0 范围内即修好，无需改 package.json 的版本约束）；4 个漏洞归零，proxy-addr/ip-address/fast-uri 全升；604 测试过 + MCP 真机握手通过 【落地】 (完成 2026-10-16)

### Archived
- [[log-2026-10-11]] 完成任务 2 条
- [[log-2026-10-09]] 完成任务 12 条
- [[log-2026-10-07]] 完成任务 7 条
- [[log-2026-10-06]] 完成任务 9 条
- [[log-2026-10-05]] 完成任务 35 条
- [[log-2026-10-03]] 完成任务 7 条
- [[log-2026-09-18]] 完成任务 2 条
- [[log-2026-09-17]] 完成任务 8 条
- [[log-2026-09-16]] 完成任务 14 条
- [[log-2026-09-15]] 完成任务 11 条
- [[log-2026-09-13]] 完成任务 5 条
- [[2026-09-12-todo归档]] 完成任务 13 条
