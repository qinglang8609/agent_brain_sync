# 方案：开局 load 段「没走完就补注入」

日期：2026-10-06
用户拍板：选 A（标记后移到 `agent_end`，只在「这一轮真跑完」时才置位）

## 1. 需求（用户原话复述）

用户在 pi 里打一句话立刻按 ESC，发现 abs 的 hook「第一轮注入失败了」，
后面只能用 `abs` 硬引入。期望：**没注入成就补**，不要出现「这轮没注入、后面永远不注入」。

## 2. 现状（先摆事实，全部来自实测）

### 2.1 `before_agent_start` 的真实触发时机

`dist/core/agent-session.js` 的 `prompt()` / `_sendPrompt` 流程：

```
prompt(text)
  → _flushPendingBashMessages / _flushPendingCustomMessages
  → 校验 model、auth
  → _checkCompaction
  → emitBeforeAgentStart(...)     ← hook 在这里才跑
  → 组装 user message
  → 进 agent loop
```

即 **hook 触发点在「用户回车提交」之后**。回车前按 ESC → `prompt()` 根本没走到那一行 →
hook **一次都没跑**。所以不是「注入失败」，是「这一轮压根没发生」。

### 2.2 真正烧掉标记的路径（比 ESC 更常见）

`hooks/abs.pi.ts:883-891`：

```js
if (!loadInjected) {
  const loadText = await readLoadForGuide(cwd)
  if (loadText) { injectLoadGuideline(...); loadInjected = true; loadState = 'on' }
  else { loadState = 'empty'; loadInjected = true }   // 失败也不重试
}
```

标记在 `before_agent_start` 里就置了 —— 此时对话**还没发出去**。

真实日志 `~/.abs/log/hooks.log`（一次会话内）：

```
07:06:02 session_start
07:06:06 before_agent_start load_guide=on     ← 置位
07:06:32 before_agent_start load_guide=skip   ← 标记已烧
07:07:49 skip   07:08:04 skip   07:08:37 skip ...
```

同一时段 `turn_end` 次数少于 `before_agent_start` 次数 → 存在「hook 跑了但对话没走完」的轮次。
这些轮次里标记**已被烧掉且不回滚** → 后续所有轮次全部 `skip`。

**结论：病根是标记语义错了 —— 记的是「我跑过了」，我们要的是「LLM 真看到了」。**
两者在中断场景下不等价。

### 2.3 已否决的方向（不要重走）

- **「注入过标记到内存，每轮检测没注入就注入」** —— 这就是现有代码的逻辑
  （`if (!loadInjected)` + `session_start` 重置），日志里的 `skip` 正是它产出的。
  重写一遍不解决任何问题。
- 看板段（`BOARD_MARK`）**本来就是每轮都摆**，无 `if (!seen)` 守卫，不需要额外加。

## 3. 修法（方案 A）

**核心：标记只在「这一轮真的结束」之后置位，中断则保持未置位 → 下轮自动补注入。**

### 3.1 改动点（`hooks/abs.pi.ts`）

| 位置 | 现状 | 改为 |
|---|---|---|
| 模块级状态 | `let loadInjected = false` | 保留，语义改为「本会话已**确认送达**过 load 段」 |
| 新增模块级 | — | `let loadPending = false`：本轮已注入、等 `agent_end` 确认 |
| `before_agent_start` (:883-891) | 注入后立刻 `loadInjected = true` | 注入后 `loadPending = true`，**不置** `loadInjected` |
| `agent_end` (:914) | 只有 seen 埋点 | 末尾加：`if (loadPending) { loadInjected = true; loadPending = false }` + `load_delivered` 痕 |
| `session_start` (:803) | `loadInjected = false` | 同时 `loadPending = false` |

### 3.2 行为对照

| 场景 | 现状 | 改后 |
|---|---|---|
| 第一轮正常跑完 | 注入 ✓，后续 skip | 注入 ✓，`agent_end` 置位，后续 skip（不变） |
| 第一轮 ESC / 中断 | 注入 ✓ 但标记已烧 | `agent_end` 没到 → `loadInjected` 未置 → **下轮补注入** ✓ |
| 回车前 ESC | hook 未跑 | hook 未跑（同现状，无解也无需解） |
| load 子进程失败 | `loadInjected=true`，永不重试 | 保持**不重试**（见 3.3） |

### 3.3 为什么「load 失败」仍然不重试

`loadState='empty'` 分支保持「置位」不变。理由：读盘失败/超时是**环境问题**，
每轮白查一次盘（spawn 2s 超时）代价 > 收益，且撞 `before_agent_start` 的时延预算。
区分：**「已送达」才需要回滚保护，「读不出来」是另一类，不在此方案范围。**

### 3.4 代价

中断后补注入一次 load（~2.7k 字符）。这是**要买的东西**，不是副作用：
宁可重注入，不可漏注入。

## 4. 不改的东西（明确划界）

- **看板段照旧每轮摆** —— 它是「反复对齐」，与 load 的一次性无关（用户 2026-10-05 定的铁律）。
- **不加 `sendUserMessage`** —— 历史两次失败都因往对话插话，不重走。
- **load 段不改成每轮摆** —— 它会随图谱无界膨胀，撞项目 Rule「读取侧输出不得随规模增长」。

---

# 第二个 bug（用户实报后追加，2026-10-06）

## 8. 现象

用户：「输入一个具体任务，比如查看 git 提交历史，就会跳过 abs load」。

## 9. 根因：标记「会话级」但内容「按目录」

`loadInjected` 原是**会话级单个布尔量**，而 load 的内容取自 `cwd/.brain/` ——
**每个目录不同**。后果：任一目录拿到 load 后，**其它所有目录被永久跳过**。

干净复现（用户新开 pi 会话实测，~/.abs/log/hooks.log）：

```
07:40:08  session_start                                          ← 新会话，标记清空
07:40:10  before_agent_start load_guide=on   cwd=~/.agents        ← 注入 ✓
07:40:17  agent_end load_delivered           cwd=~/.agents        ← 标记置位
07:40:43  before_agent_start load_guide=skip cwd=agent_brain_sync ← ✗ 被跳过
```

关键背景：一个 pi 会话里 `turn_end` 会在**多个 cwd 之间交替**
（实测 07:40:13-07:40:17 在 `corp_agent` 与 `~/.agents` 之间来回）。

### 9.1 为何之前统计看不出来

按「每个会话的首轮」统计时成功率很高（9/10），因为新会话会清空标记。
**问题不在「首轮」，在「首轮之后切目录」** —— 统计口径恰好掩盖了它。

## 10. 修法

标记从「会话级单值」改为「**会话 × cwd 集合**」：

```js
const loadInjected = new Set<string>()   // 已确认送达的 cwd 集合
let loadPending = ''                     // 本轮待确认的 cwd
```

- `before_agent_start`：`if (!loadInjected.has(cwd))` → 注入 → `loadPending = cwd`
- `agent_end`：`if (loadPending) { loadInjected.add(loadPending); loadPending = '' }`
- `session_start`：`loadInjected.clear(); loadPending = ''`

### 10.1 为什么用「按目录」而不是「一律重注」

切回一个已达送的目录**不**重复注入（用例已盖）—— 否则多项目来回切会每轮重塞 load，
撞项目 Rule「读取侧输出不得随规模增长」。代价：切到新目录多一次 load（~2.7k 字符），
但那是**该付的**：在 A 目录干活就该看到 A 的看板与滞留任务。

## 11. 验证（第二个 bug，也已实跑）

新增 2 条用例（与方案 A 的 4 条同一 describe）：

- `★ 切目录必须重新注入` —— A 送达 → 切 B 必须 on → 回 A 不再注
- `切目录后中断 → 那个目录仍要补注入` —— 两条语义叠加（按目录 + 没走完就补）

**破坏验证（关键）**：把 `loadInjected` 临时改回会话级单值，
上述 2 条立刻 `✖` 失败 → 证明断言不是空转。已还原。

全量：`npm test` **540 pass / 0 fail**（第二修前 538，+2）。已 install 到 ~/.pi。

## 12. 仍未做

- `~/.agents`（全局目录也带 `.brain`）该不该注入 —— **用户尚未回答**。
  本方案按「按 cwd 分」统一处理（切过去就注入），因为未拿到否定的理由。
- 真机端到端确认（用户下次实际切目录使用）。

## 5. 验证（三层，改完必须都过）

1. **正常路径**：新会话 → 第一轮正常跑完 → `load_guide=on` 且后续 `skip`（行为不变）。
2. **中断路径（本次核心）**：新会话 → 第一轮 `before_agent_start` 后**不触发 `agent_end`** →
   第二轮 `load_guide` 必须仍是 `on`（现状是 `skip`，这就是回归点）。
3. **边界**：`session_start` 重置 `loadPending`（同进程第二会话不得继承）；
   load 失败仍只 `empty` 一次不重试。

测试落到 `test/plugin-behavior.test.js`（该文件已有行为级 harness：`loadPi` + `harness` +
`handlers` 直接驱动真实事件序列），复用现有设施，不新建测试文件。

## 6. 实施结果（2026-10-06 已落地）

改动文件：
- `hooks/abs.pi.ts` —— 5 处（模块级状态 + 文件头注释 + session_start 重置 +
  before_agent_start 注入点 + agent_end 送达确认）。
- `test/plugin-behavior.test.js` —— 新增 4 条行为级用例（`开局 load 段 送达确认`），
  复用现有 harness，不新建测试文件。

验证（三层，全部实跑）：

1. **正常路径**：`正常跑完一轮 → 注入一次，后续轮次不再注入` ✔
2. **中断路径（本次核心）**：`★ 第一轮被中断(无 agent_end) → 第二轮必须补注入` ✔
3. **边界**：`新会话不得继承已送达状态` ✔；load 失败仍只 `empty` 一次不重试（3.3 保持不变）

**破坏验证（关键）**：把注入点临时回退成旧的 `loadInjected = true`，
第 2、3 条用例立刻 `✖` 失败 → 证明断言不是空转。已还原。

全量：`npm test` **538 pass / 0 fail**（改前 534，+4 为新用例）。

判据取的是「注入出的 `[开工]` 段是否存在」，而不是日志文本 ——
日志只能证「代码跑过」，证不了「真的注进去了」。

## 7. 未做（明确留给后续）

- 3.3 那条保持不变：load 子进程失败仍不重试（已与用户确认）。
- **切目录不重新 load**（`loadInjected` 未按 cwd 分开）—— 独立问题，本方案未动。
- 真机端到端验证（真按 ESC）—— 待用户实际使用确认。
