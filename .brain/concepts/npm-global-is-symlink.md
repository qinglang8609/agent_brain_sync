---
tags: [concept, install, 部署, 坑]
id: npm-global-is-symlink
author: fanchao
updated: 2026-11-05
status: active
layer: 3
kind: gotcha
---

# npm install -g . 建的是软链，但 hook 模板是拷贝

本仓库里「改了代码要不要重装」有**两套完全相反的答案**，取决于产物落在哪。混为一谈就会得出错误结论。

## 触发场景

- 改完 `src/` 或 `bin/` 的代码，怀疑「宿主里跑的是不是新代码」
- 改完 `hooks/abs.pi.ts`，面板行为没变
- 看到「未知命令」怀疑版本落后

## ❌ 表现

2026-11-05 实测踩了两次，且第一次判断错了：

**误判一：** 以为 `npm install -g .` 是「真拷贝」，于是写下「以后改完都要重装」。
实际是软链接：

```bash
$ readlink -f ~/.nvm/versions/node/v24.18.0/lib/node_modules/@fanchao8609/agent_brain_sync
/Users/fanchao/Code/agent_brain_sync
```

**误判二：** 面板「todo 标题空格」改了仓库却没生效，误以为也是全局包版本问题。
真因是 `~/.pi/agent/extensions/abs.ts` 是 **69KB 实体文件**，不是软链。

## 🛠 两类产物，两套规则

| 产物 | 形态 | 改完之后 |
|---|---|---|
| CLI / MCP（全局包里的 `bin/abs.js`、`bin/mcp.js`） | **软链**指向仓库 | ✅ 立即生效，无需重装 |
| hook 模板（`~/.pi/agent/extensions/abs.ts`） | `renderPluginTemplate()` 读成字符串**写进宿主** | ❌ 必须 `abs install` 重跑 |
| SKILL 文档（`~/.pi/agent/skills/abs-agent-brain-sync/SKILL.md`） | 安装器**拷贝**整份文件 | ❌ 必须 `abs install` 重跑 |

2026-11-05 实测：仓库里的 SKILL 加了「未填会话页整页排除」整节，宿主那份落后 28 行
—— 意味着下一个会话会按旧规矩干活。`diff` 一眼就能看出来：

```bash
diff skill/abs-agent-brain-sync/SKILL.md ~/.pi/agent/skills/abs-agent-brain-sync/SKILL.md
```

`renderPluginTemplate`（`src/install.js`）只读单个文件、替换 `@@占位符@@`、写成独立文件。所以：

- 安装产物是**自包含单文件** → 它不能 `import './shared/x.ts'`，否则装到宿主后路径不存在
- 想抽公共模块，必须先改安装器（整目录复制或打包），不能只加个文件

## 判据

**问「谁把它写到宿主里」**，而不是问「装没装」。

- `src/`、`bin/` 的代码由 node 从软链加载 → 运行期读最新
- `hooks/*.ts` 的代码由安装器**读成字符串**写死 → 运行期读的是上次安装的副本

验证方式：

```bash
# 软链：看指向
readlink -f $(which abs)

# 拷贝：比对内容，不比对时间
diff <(sed 's/@@[A-Z_]*@@//g' hooks/abs.pi.ts) ~/.pi/agent/extensions/abs.ts | head
```

## 关联连接

- [[mcp-stale-paths-multi-store]] — 「被读到的才算数」的完整版：外部 store 会盖过自己写的注册
- [[deploy-artifact-copies]] — 部署总则：改一份不算改
- [[abs-install-layout]] — 四宿主安装器与各自落点
- [[detached-子进程的可验证性]] — 姊妹页：改完重装之后，还得验 detached 进程真能跑完
- [[fanchao]] — 本页沉淀者
