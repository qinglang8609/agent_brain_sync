---
tags: [concept, shell, 门禁, 静默失效, 退出码]
id: gate-exit-code-not-piped
author: fanchao
updated: 2026-10-07
status: active
---

# 概念：门禁静默放行 —— 退出码被管道吞掉

## 触发场景
写**靠退出码决定放行/拦截**的脚本：pre-commit / pre-push、CI 步骤、发布门禁、
"测试不过就别推"这类守卫。尤其是**为了少打点日志而接了个 `| tail`** 的时候。

一句话判据：**脚本里出现 `cmd | 别的命令`，而你还指望 `$?` 反映 `cmd` 的结果** ——
那就已经错了。

## ❌ 表现
门禁**恒放行**，且输出看着完全正常，甚至打出「✓ 通过」。

2026-10-07 本仓实测（`.githooks/pre-push`）：

```sh
if ! npm test 2>&1 | tail -20; then
  echo "❌ 测试未过，推送已拦截。"
  exit 1
fi
echo "✓ pre-push 通过"
```

管道的退出码取的是**最后一个命令**（`tail`）的，而 `tail` 永远成功。
用假 npm 模拟（打印 `fail 3` 后 `exit 1`）：

```
▸ 全量测试（约 30-60s）...
ℹ fail 3
✓ pre-push 通过        ← 放行了
pre-push 退出码=0
```

**后果**：这个 hook 存在的唯一意义就是「测试不过不许推」。静默失效后它退化成
一句装饰性输出 —— 而它是**唯一挡在坏代码和远端之间的东西**。

**为何特别难发现**：
1. 输出完全正常（不是静默无输出，是静默"报成功"）；
2. 它只在**测试失败时**才该起作用，而测试失败是少数情况 → 平时永远看不到它失效；
3. 门禁本身**没有测试守着**（本仓当时 `test/` 里 `grep pre-push` 命中 0）。

## 🛠 解法
**别接管道。** 要截断输出就落临时文件、退出码走命令本身：

```sh
TEST_LOG=$(mktemp -t gate.XXXXXX)
trap 'rm -f "$TEST_LOG"' EXIT
if ! npm test >"$TEST_LOG" 2>&1; then
  tail -20 "$TEST_LOG"          # 失败时才打摘要
  echo "❌ 测试未过，已拦截。"
  exit 1
fi
tail -20 "$TEST_LOG"
```

要点：
1. **`sh` 没有 `PIPESTATUS`**（那是 bash 的）。想「既接管道又取真码」在 `sh` 里做不到，
   只能走临时文件。
2. **`trap ... EXIT` 清理临时文件**，否则 `/tmp` 攒垃圾（有测试守这条）。
3. **不要用 `set -o pipefail` 糊过去** —— 它只让管道整体失败，取不到"是哪一段失败"，
   且 `sh`/`dash` 支持不一（本仓另有 [[hook-sh-not-bash]] 记过同类差异）。

### 配套：门禁必须有测试，否则它会再次烂掉
门禁的判据是**退出码**，不是输出文字：

```js
// test/hooks-gate.test.js 的形状
const r = spawnSync('sh', ['.githooks/pre-push'], {
  env: { ...process.env, PATH: `${fakeNpmDir}:${process.env.PATH}` },  // 假 npm 按需退出
});
assert.equal(r.status, 1, '测试失败时必须退出 1');
```

**只断言输出文字是错的** —— 文字会被措辞改动带偏，而「✓ 通过」这个假信号
恰恰是原 bug 的表现形态。

## 验证
```bash
# 造一个只返回指定退出码的假 npm，看门禁会不会拦
mkdir -p /tmp/fakenpm
printf '#!/bin/sh\necho "ℹ fail 3"\nexit 1\n' > /tmp/fakenpm/npm
chmod +x /tmp/fakenpm/npm
PATH=/tmp/fakenpm:$PATH sh .githooks/pre-push; echo "退出码=$?"   # 期望 1
```

本仓实测：修前退出码 **0**（放行），修后 **1**（拦截）。
破坏验证（把管道写法注回去）→ `test/hooks-gate.test.js` 2 个用例变红，还原后 4 绿。

## 关联连接
- [[vacuous-test-passes-on-broken-code]] — 同族：那页是"断言恒真"，本页是"退出码恒真"；
  两者都只能靠破坏验证揪出来
- [[hook-sh-not-bash]] — 同族：`sh`/`dash` 与 bash 的差异常在这类脚本里静默发作
- [[remind-vs-gate]] — 门禁是本页讨论的对象；那页记"门禁为何是唯一有效的兜底"
- [[fanchao]] — 本页沉淀者
