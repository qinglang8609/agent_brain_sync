---
tags: [concept, 坑, 格式归一, 复现]
id: normalize-branch-forgot-empty
author: fanchao
updated: 2026-10-06
status: active
---

# 概念：排版归一只测了「有内容」分支：空分区的接缝被吃掉

## 触发场景
写**格式化/归一/重建**类代码时——把文本重排成标准形态、补空行、补标题、折叠空区。
尤其当某个分支的条件是「有没有内容」时：`if (body.length) … else …`。
也适用于排查一切**「同一个东西反复丢」**的现象（补回去、过几天又没了）。

## ❌ 表现
`corp_agent` 的 `index.md` 里，`## Sources` 前的那个空行反复消失。人工补回（提交
`17961e5` 明说「补回空行」），之后随便一次写操作又没了（`f3f7e84`）。看起来像
「abs 每次重建 index 就丢」。

上一轮会话的判断是「`abs load` 动了文件」—— **这个结论是错的**：
`cmdLoad` 对 index 只走 `readIfExists`，**只读不写**。看到「load 之后文件变了」
就归因给 load，是把「同一次调用里发生的事」当成了「load 这个命令做的事」。

真凶是 load **顺带调用**的 `checkBrainShape → enforceBrainFormat → rebuildStructure`。

## 🛠 解法
根因在 `src/todo.js` 的 `rebuildStructure`：

```js
if (body.length || first) out.push('', name, ...body);  // 有内容：补前导空行
else out.push(name);                                    // 空分区：不补 ← 坑
```

「**有内容分区 → 空分区**」的接缝因此塌掉：上一条页面条目紧贴 `## Sources`。
而「空分区 → 有内容分区」是好的（下一个分区自己有前导空行），所以现象**只出现在
空区的前面**，看着像「随机丢一个空行」。

原注释给这个 else 的理由是「否则每次首跑都会把空行加进去而写盘一次」。**这个担心
经实测不成立**：归一后的产物本身就是稳定形态，第二次跑 `fixed` 为空、零字节改动。
写盘一次的顾虑换来一个永久性排版缺陷，不值。

修法：去掉分支，**所有分区标题前恒补一个空行**（H1 后那一个由同一句覆盖）。

### 为什么会反复发生
`enforceBrainFormat` 跑在**每次写盘前**（见 [[validation-gate-on-shared-write-path]]），
所以不是「某次操作丢的」，而是「任何人补回 → 下一次任意写操作又归一掉」的拉锯。
人工修补对这类 bug **无效**：它不是数据坏了，是**归一规则本身把好东西判成坏的**。

### 定位方法（可复用）
1. 先分清**是哪个命令写的**：读代码看该命令有没有写路径，别按「什么时候变的」归因。
2. **拿真库文件做复现实验**，别只读代码推理。当时写 4 个变体（全有内容 / Sources 空 /
  Sources+Syntheses 空 / 末尾 Sessions 空），一个脚本跑出规律表，「空分区前置空行恒为 0」
  一眼就看出来了。这一步比读三遍 `rebuildStructure` 都快。
3. 补一条**破坏验证**的回归测试：把修复 stash 掉，确认新测试**红**，再恢复确认绿。

## 验证
- 真库判据：对 `corp_agent/.brain/index.md` 跑 `checkBrainShape` 后，
  **每个 `## ` 标题的前置空行数恒为 1**（旧行为：空分区为 0）。
  一行脚本即可：算每个 `## ` 前连续空行数。
- 幂等判据：把归一后的文本**再喂一次** `enforceBrainFormat`，`fixed` 为空且字节相同
  （证明「写盘一次」的旧顾虑不成立）。
- 回归测试：`test/store.test.js` 的「空分区前也要有一个空行」——
  修复前红、修复后绿（已做破坏验证）。
- 全量：`npm test` 545 passed / 0 failed。

## 关联连接
- [[file-shape-check-on-load]] — 同一块代码（load 里的形状核对）；本页是它某个分支写错的实例
- [[validation-gate-on-shared-write-path]] — 归一侧的根因：规则跑在所有写路径上，所以错一次就全局生效
- [[todo-rewrite-not-map]] — 同类纪律：重排/归一只动排版、不动语义；但「不动语义」不等于「排版可以乱改」
- [[symbol-reference-needs-real-run]] — 同源教训：靠读代码推理不如跑一次真实数据
- [[fanchao]] — 本页沉淀者
