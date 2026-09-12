---
tags: [concept, 验证, 导入, ReferenceError, 坑]
updated: 2026-09-12
status: reviewed
---

# 引用新符号后必须真跑一条命令：语法检查查不出「未导入」

## 触发场景
新增/修改了一个标识符引用（`import`、常量、函数名），
你跑了 `node --check` 或「测试全绿」，就认为改对了。

## 坑
`node --check` **只查语法**，查不出「未导入的标识符」——
它跑到那一行才抛 `ReferenceError`。测试也可能没覆盖到那条分支。

本次一轮内栽两次：
- `store.js` 用了 `BRAIN_DIR`，实际只导入了 `BRAIN_DIRS`
- `bin/abs.js` 用了不存在的 `run()`（daemon 撤销后的遗留）

## 为什么这个库特别容易犯
命名高度相似，肉眼扫过去像对的：
- `BRAIN_DIR` / `BRAIN_DIRS`
- `PAGE_MAX_LINES` / `PAGE_MAX_BYTES`
- `MARK` / `ABS_HOOK_MARK`
- `findBrain` / `findBrainRoot`

## 做法
新增或改引用后，**立即用真实入口跑一条命令**，不要只看 `node --check` 或测试绿：

```bash
node bin/abs.js lint --dir .
node bin/abs.js status --dir .
```

判据很简单：**能跑到那条代码路径，才算验证过。** 语法检查证明"能解析"，
不等于"能执行"——中间隔着一个运行时符号解析。

## 关联连接
- [[host-plugin-silent-failure]] — 同源：把"通过了一项弱检查"当成"验证过了"
- [[silent-data-loss-diagnosis]] — 同属"证据不充分就下结论"的坑
- [[AgentBrainSync]] — 项目实体页
