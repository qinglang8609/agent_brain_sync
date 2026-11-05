---
tags: [concept, 命令设计, 重叠, 精简]
id: command-surface-narrow
author: fanchao
updated: 2026-11-05
status: active
kind: decision
---

# 命令面要窄：两个入口做同一件事时删一个

命令越多，agent 每次动手前都要先选一个。**选不选对没有后果时，选择本身就是纯成本。**

## 触发场景

- 想加一个新命令，而它和某个已有命令做的是同一件事
- 帮助里的命令清单越来越长，agent 却总用那两三个
- 发现自己写文档时要解释「这两个有什么区别」

## 判据：怎么算真重叠

不是「功能相似」，而是**落点相同**：同样的输入进去，同样的文件出来。

实测三例（2026-11-05）：

| 命令 | 重叠对象 | 实测证据 | 处理 |
|---|---|---|---|
| `capture --layer 7` | `abs note` | 两边都写 `sources/`，文件名与正文结构一致 | 改拒，指向 note |
| MCP `abs_board` | `abs_load` | load 输出里已含 Todo Board 段 | 删 |
| MCP `abs_wrapup` | hook 内部调用 | 会话关闭时自己会跑，给人调无意义 | 删 |

哪边留下，看真实用量：`~/.abs/log/mcp.log` 里 `abs_note` 228 次、`abs_query` 24 次。

## 🛠 做法

1. **留下被真实用过的那条**，另一条改成明确拒绝 + 给出等价命令。不要静默转发 ——
   转发等于两个入口都留着，只是绕过了一层。
2. **同时清理所有出口**：CLI 分支、MCP 工具注册、skill 文档、README、help 文案。
   漏一个就是「名字还在、调用即报错」的坏状态。
3. **删减后必须实际握手验证**，不能只看源码字符串：

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize",...}' \
  ... | node bin/mcp.js | 看 tools/list 的返回
```

## 边界：用量少不等于该删

`abs_pages` 只用过 1 次，但它**已经不是命令**（代码里查不到），那次是旧日志。
判据是「落点是否相同」，不是「用得少」—— 用得少可能是新功能，也可能是入口藏得深。

## 验证

```bash
npm test                          # 758 全绿（改判据的那个测试是破坏验证：删掉拒绝逻辑即红）
node bin/abs.js capture --layer 7 "x"   # 应输出 ✗ 并指向 abs note，且 sources/ 不落文件
node bin/abs.js db status          # lint 0 问题
```

MCP 实测（2026-11-05）：`tools/list` 返回 11 个工具，`abs_board` 与 `abs_wrapup` 均不在其中。

## 关联连接

- [[feature-delete-not-patch]] — 上位判据：重叠就删，别新增（本页是它在命令面上的应用）
- [[read-side-output-must-not-scale]] — 「复用已有」而不是再给一份
- [[session-digest-design]] — 同批改动：会话页与 note 的落点边界
- [[fanchao]] — 本页沉淀者
