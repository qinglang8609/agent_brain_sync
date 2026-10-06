# 方案：页面超限加「显式豁免」出口（keep-oversize）

日期：2026-10-06
用户拍板：选 A（加页级豁免标记）

## 1. 需求（用户原话）

> `web-build-deploy-traps.md` 现在 154 行（上限 150），比我改之前多 6 行 ——
> 多出来的是必留的指针（不指就断链）。要压下去，得动别人沉淀的内容……
> **150 的限制让 ai 反复的改东西。**
> 这种情况不只出现在这里，许多限制让 llm 死循环。

要解决的不是那一页，是**规则缺出口**这件事。

## 2. 现状（实测）

### 2.1 硬框在哪

`src/lint.js`：

```js
const PAGE_MAX_LINES = 150;              // :18
const PAGE_MAX_BYTES = 8 * 1024;         // :48
...
if (pg.lines > PAGE_MAX_LINES || pg.bytes > PAGE_MAX_BYTES) {
  issues.push(`OVER-SIZE: ${pg.rel} (${pg.lines}L/... > 150L/8KB; 拆或外链)`);  // :199-200
}
```

只对 `concepts/entities/syntheses` 生效。

### 2.2 这个错**已经犯过一次**（lint.js:14 自己承认）

> 曾为 150L/5120B —— 实测偏紧：跨 4 项目 68 页里仅 2 页超限，且都只超一点……
> **为满足它还把一页从 5319B 压到 4972B（内容受损、收益为零）。**
> 放宽到 8KB……

当时的处理是**只放宽了 bytes，行数 150 留着没动** → 现在在行数上又撞一遍。
**局部妥协没解决问题，只是把撞墙点从 bytes 挪到了 lines。**

### 2.3 为什么它导致死循环

`拆或外链` 这个出口，在很多页面**根本不存在**。`web-build-deploy-traps` 就是活证据：

- 那 6 行是**必留指针** —— 不指就断链
- **拆**（拆成两页）→ 断链，拆出的半页也没意义
- **外链**（指向别页）→ 也是断链

于是 LLM 面对报错只剩一条路：**删内容凑行数**。删完下次涨回来，再删 —— 死循环。
**根因不是「阈值定低了」，是「规则没有出口」。** 放宽阈值只是把墙往后挪。

### 2.4 已有先例：Rule 17

> 体检输出必须按类型折叠计数，同类超限只报条数+样例

这就是「超限了，但因为别的原因允许它超」的**同思路先例**。本方案是把同一思路套到页面上。

### 2.5 目标页（范围外，本方案不动）

`/Users/fanchao/Code/corp_agent/.brain/concepts/web-build-deploy-traps.md`（154 行）。
真源 `packages/web/next.config.ts` 那段注释**确实比页面里的完整**（多说了 missing 块与
规则覆盖顺序），压成指向技术上成立 —— 但**那是别人沉淀的内容，不在本仓库，不动**。

## 3. 修法

**加一个页级豁免标记。页面上写明 `keep-oversize` 并给出理由，lint 就不再对它报 OVER-SIZE。**

### 3.1 标记形态

页面正文里加一行 HTML 注释（不渲染、不影响阅读）：

```markdown
<!-- keep-oversize: 必留指针，拆了断链 -->
```

- 理由**必填**：跟着 `keep-oversize:` 后面。空理由不算豁免。
- 放在正文任何位置都可（实现上扫全文，不限定位置）。

### 3.2 改动点（`src/lint.js`，只动 1 处）

`checkPage` 里那条 OVER-SIZE 判断加一个前置条件：

```js
if (['concepts', 'entities', 'syntheses'].includes(pg.dir)) {
  if ((pg.lines > PAGE_MAX_LINES || pg.bytes > PAGE_MAX_BYTES) && !oversizeExempt(pg.body)) {
    issues.push(`OVER-SIZE: ...`);
  }
}
```

新增一个纯函数（好测、无副作用）：

```js
/** 页面是否显式声明「允许超限」。理由必填 —— 空理由不算豁免。
 *  形态：<!-- keep-oversize: 理由 -->
 *  设计意图见 docs/plans/20261006-oversize-exempt.md：规则要出口，不要放宽阈值。 */
export function oversizeExempt(body) {
  const m = String(body || '').match(/<!--\s*keep-oversize\s*[:：]\s*([^>]*?)\s*-->/);
  return Boolean(m && m[1].trim());
}
```

### 3.3 复用而非另开（工程论 1「复用优先」）

- `pg.body` **已经在 `checkPage` 作用域里**（`idOfPage(pg.body, ...)`、`hasTail(pg.body)` 都在用）
  → **不需要改 `listPages`、不需要多读一次盘**。
- 复用现有的 issue 折叠机制：豁免后不产生 issue，自然不参与折叠，无需额外改动。
- 理由文本用 `[:：]` 兼容中英文冒号（与项目其它解析同一习惯）。

## 4. 明确不改的（划界）

- **不动 `PAGE_MAX_LINES` 的值** —— 放宽阈值不是本方案要做的事（§2.3 已说明为什么）。
- **不自动豁免** —— 必须人工显式写理由。没有「超一点就放过」这种模糊地带。
- **不豁免其它检查** —— 只豁免 OVER-SIZE 一条。DEAD-LINK / NO-TAIL / NO-INBOUND 等
  超限与否无关，照旧报。
- **不改 `corp_agent` 那一页** —— 范围外，别人沉淀的内容。
- **不加配置项/环境变量** —— 按 ponytail 阶梯，页级标记已够，不需要第二套开关。

## 5. 验证（三层）

1. **正常路径**：不带标记 → 超限仍报 OVER-SIZE（行为不变，防「修完把检查关掉了」）。
2. **豁免路径（核心）**：带 `<!-- keep-oversize: 理由 -->` → 超限**不报**；
   同时其它检查（NO-TAIL 等）**照常报**（证明只豁免了一条，没顺手关掉一片）。
3. **边界**：
   - 空理由 `<!-- keep-oversize: -->` / `<!-- keep-oversize -->` → **不算豁免**，仍报
   - 没超限 + 带标记 → 无副作用（不报、也不因此出别的错）
   - 中英文冒号都能认

测试落 `test/lint.test.js`（已有该文件，复用现有设施，不新建）。

**破坏验证必做**：把 `!oversizeExempt(...)` 去掉，第 2 条必须立刻失败 —— 否则断言是空转。

## 6. 落地后要做的一件事

`corp_agent` 那页在**修完这个之后**，才可以被合法豁免（而不是被压缩）。
但**跨仓库**，需单独确认后再动 —— 本方案不含。

## 7. 待确认

1. 标记名用 `keep-oversize` 可以吗？（也可叫 `oversize-ok` / `allow-oversize`）
2. lint 报错文案要不要在超限时**提示这个标记的存在**？
   好处：LLM 撞墙时知道有出口，不会一头去删内容（正是死循环的起点）。
   代价：可能被滥用成「啥都加标记」。我倾向**要提示**，但把理由必填当闸门。
