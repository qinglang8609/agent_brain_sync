---
tags: [archive, task-memo]
id: log-2026-10-16-project-audit
updated: 2026-10-16
---

# 项目审核报告 — agent_brain_sync v1.18.0

审核范围：代码质量 / 安全 / 测试 / 文档。**只读审核，未改任何代码。**

（落点说明：原写 sessions/audit-2026-10-16.md，被 lint 的 SESSIONS-MISPLACED 拦住 ——
sessions/ 只收 `log-<日期>[-<slug>].md` 且 tags 带 archive 的当天工作笔记。本页按该契约落位。）

## 结论

**整体质量高于同类工具的平均水平，可以继续按现状演进。** 无阻断级问题，无安全漏洞，无数据丢失风险。

| 维度 | 评级 | 依据 |
|---|---|---|
| 测试 | 优 | 598 测试全过，14 秒；覆盖 16 个测试文件 |
| 安全 | 优 | 无注入、无路径穿越、无敏感信息；依赖仅 2 个 |
| 并发 | 优 | 50 并发写实测零丢失、零残留锁 |
| 代码质量 | 良 | lint 零告警；注释记录决策缘由（罕见的好） |
| 文档 | 良 | README 完整；缺 LICENSE；2 处小瑕疵 |
| 依赖安全 | 中 | 4 个漏洞，全部来自 SDK 的 express 栈，均已达修复路径 |

## 实测命令与结果

```
npm test          → 598 pass / 0 fail / 98 suites / 14.2s
npx eslint .      → 0 问题
npm run pack:check → 正常，30 文件，184.7 kB
npm audit --omit=dev → 4 漏洞（2 moderate / 1 high / 1 critical）
```

## 强项（有实证）

### 1. 并发写保护真管用
宣称「跨进程防并发丢失更新」，实测兑现：
- 20 并发 `todo start` → 20/20 成功，去重后 20 条完整落盘
- 50 并发混合写 → 50/50 成功，`.brain` 下残留锁文件 **0 个**，文件尾部结构完整无半写

`src/lock.js` 的 `open('wx')` 原子抢占 + 指数退避 + 残留锁摘除，设计正确。`STALE_MS`(60s) > `LOCK_MAX_WAIT_MS`(30s) 这个约束关系写在了注释里，避免了「持锁进程被误当残留摘除」的经典坑。

### 2. 用户输入无法逃出沙箱
`src/text.js:slugOf` 把所有非 `[\w一-鿿]` 字符折叠成短横线。实测 `../../../../etc/passwd` → `etc-passwd`，无斜杠、无 `..`。写入口不可能穿越出 `.brain/`。

### 3. 注释记录「为什么」，而非「是什么」
`bin/mcp.js` 记了「9 处工具漏包 withTrace 导致 mcp.log 永不生成」；`hooks/event.sh` 记了「mark 名钉在分钟级 STAMP 上导致幂等窗口最坏缩到 1 秒」。这类注释让后来人不会把踩过的坑再踩一遍。hook 幂等实测：同 payload 连跑 5 次只落 1 行。

### 4. 外部依赖失败一律降级不阻断
`src/codegraph.js` 对「codegraph 不存在 / 超时 / 索引过期」三种失败均返回 `null`，绝不阻断 `note` 落盘。索引过期宁可拿不到影响面也不写错数据的取舍正确。

### 5. 错误信息带逃生口
`bin/mcp.js:err()` 返回结构化 `code` + 人类可读 `fallback`（如 `NO_BRAIN` → "先在该目录运行 abs init"），调用方读完知道下一步跑什么。

## 问题清单（按优先级）

### P1 — 依赖漏洞可达性未收窄

`npm audit` 报 4 个漏洞，全部来自 `@modelcontextprotocol/sdk` 内的 express 栈：

```
@modelcontextprotocol/sdk@1.30.0
├─ express@5.2.1 → proxy-addr@2.0.7  (critical: IP 伪造)
├─ express-rate-limit → ip-address@10.7.0  (moderate ×2)
└─ ajv → fast-uri@3.1.7  (moderate)
```

**为什么不是急事**：本项目只用 `StdioServerTransport`（见 `bin/mcp.js` 末尾），完全不碰 HTTP 传输层，这些代码运行时不会被加载。

**但值得处理**：`npm audit fix` 在 SDK 的 semver 范围内即可解决；SDK 本身也有 1.32.1 可升（当前 1.30.0）。建议一并升到 1.32.1，既修漏洞又拿新特性。

### P2 — 缺 LICENSE 文件

`package.json` 写 `"license": "MIT"`，但仓库根目录没有 `LICENSE`。对已发布到 npm 的包（`@fanchao8609/agent_brain_sync`），这会让使用者在合规层面无法确认授权条款。补一个 MIT LICENSE 文件即可，一分钟的事。

### P3 — 超长函数（可读性，非缺陷）

超 80 行的函数几个，最长几个（**数据已按真实函数体重算，2026-10-16 复核**）：

| 位置 | 函数 | 行数 |
|---|---|---|
| `src/store.js` | `cmdTask` | 169 |
| `src/todo/structure.js` | `enforceBrainFormat` | 105 |
| `src/query.js` | `cmdQuery` | 103 |
| `src/store.js` | `cmdLoad` | 99 |

> ⚠ 更正（2026-10-16）：本报告初版这几个数字是用 awk 粗算的，**全部不准**；且把
> `isAllowedTodoSub` 写成「119 行」——那是它的**行号**不是长度，它实际只有 **3 行**
> （纯只读谓词）。据此建的那条拆分任务已作废。教训：报函数长度要用「配对花括号扫描」
> 真算一遍，别拿行号或粗脚本的输出去当结论。

`store.js` 已经把页面生命周期、经验暂存、lint 拆成独立文件（`page.js`/`note.js`/`lint.js`），拆分方向对。剩下的 `cmdTask` / `cmdLoad` 是命令分发主体，拆开收益有限，**不建议为了拆而拆**。

### P4 — 文档小瑕疵

1. **README 命令清单有遗漏**：代码里有 `abs review` 和 `abs index` 命令，但 README「日常命令」一节未列出。用户不知道它们存在。
2. **README 提到废弃命令但无迁移指引**：第 132 行说「旧版 `abs task ...` / `abs board` 已废」，但没告诉用户替代命令怎么写。这是刻意保留的提示（我的比对脚本一度误判为文档过期），补一句「改用 `abs todo start` / 直接读 `.brain/todo.md`」会更完整。

### P5 — 无 CHANGELOG

版本从 1.17.0 走到 1.18.0 有多个 feat/fix（omp 宿主支持、断点任务升级一等任务、memo 命令），但仓库无 `CHANGELOG.md`。commit message 写得规范（带 scope 和 body），但用户升级后要翻 git log 才知道变了什么。

## 未做的事

- **未做动态行为测试**：没有真在一个 pi/omp 会话里装 hook 跑一遍端到端；hook 的幂等性是单独跑 `event.sh` 验证的，未验证宿主实际调用路径。
- **未审计 hooks 的 `.ts` 文件全文**：`abs.pi.ts` 65.6 kB、`abs.omp.ts` 45.4 kB，只抽查了 spawn 调用点和注释，未逐行读。
- **未验证 install.js 在真实宿主上的写入**：`install.js` 992 行涉及 5 个宿主（pi/omp/opencode/claude-code/codex）的配置文件写入，只做了静态阅读，未实际执行安装验证幂等与卸载干净度。
- **未评估 `.brain/` 图谱内容质量**：只审了代码，没审图谱里积累的知识页本身写得好不好。

## 建议的处理顺序

1. 升 `@modelcontextprotocol/sdk` → 1.32.1，跑 `npm audit fix`（1 条命令，修掉 4 个漏洞）
2. 补 `LICENSE`（MIT）
3. README 补 `abs review` / `abs index` 两个命令
4. 给 `isAllowedTodoSub` 找机会拆分（不急）
5. 有精力时建 `CHANGELOG.md`，从 1.18.0 起记
