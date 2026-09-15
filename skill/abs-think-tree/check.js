/**
 * think-tree 自证器 —— 检查一次三层思考的填写质量。
 *
 * 用法:
 *   node skill/abs-think-tree/check.js <填好的答案文件.md>
 *
 * 输入格式(答案文件):
 *   ## L1
 *   - [动作] 想快速定位原因
 *   - [动作] 想确认是不是自己改错了
 *   ## L2
 *   - [客观][当下][判断] 在问因果
 *   ## L3
 *   - [产出] 一个嫌疑点 + 证据 + 验证方法
 *
 * 各类标签是硬判据: 不写 = 报错, 不是"提醒"。
 * 目的: 把"贴合用户原话"这句软话, 拆成能失败的检查。
 */

const ACTION_VERBS = /(定位|确认|判断|决定|选择|选定|挑选|修改|查找|比较|评估|验证|交付|得到|知道|排除|复现|区分|排查|了解|收尾|继续|停止|给出|输出|回答|说明|解释|分析|检查|拆|推|排|定|学)/;

/** L2 三轴标签。必须三轴齐全, 缺一轴 = 边界没划全。 */
const AXES = ["主观|客观", "当下|长期", "判断|操作"];

/** L3 可验收产出类型的白名单。 */
const OUTPUT_KINDS = ["代码", "结论", "选项", "追问", "证据", "复现条件", "命令"];

function fail(list, msg) {
  list.push(msg);
}

/** L1: 每个候选必须是"动作", 不能是"心情"。 */
function checkL1(lines, errs) {
  if (!lines.length) return fail(errs, "L1 为空: 至少写 1 个动机候选");
  if (lines.length < 2) fail(errs, "L1 只有 1 个候选: 无兄弟则无法竞争");
  lines.forEach((l, i) => {
    const m = l.match(/^-\s*\[动作\]\s*(.+)$/);
    if (!m) return fail(errs, `L1[${i}] 缺 [动作] 标签: "${l}"`);
    const body = m[1].trim();
    if (!body) return fail(errs, `L1[${i}] 标签后为空`);
    if (!ACTION_VERBS.test(body))
      fail(errs, `L1[${i}] 不像动作(无动词): "${body}"`);
    // 心情词黑名单
    if (/(了解一下|学习一下|感兴趣|好奇|随便看看)/.test(body))
      fail(errs, `L1[${i}] 是心情不是动作: "${body}"`);
  });
}

/** L2: 三轴必须齐全, 且每轴只能落一端。 */
function checkL2(lines, errs) {
  if (!lines.length) return fail(errs, "L2 为空: 边界没划");
  lines.forEach((l, i) => {
    const m = l.match(/^-\s*((?:\[[^\]]+\])+)\s*(.+)$/);
    if (!m) return fail(errs, `L2[${i}] 缺轴标签: "${l}"`);
    const tags = [...m[1].matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]);
    AXES.forEach((ax) => {
      const ends = ax.split("|");
      const hit = tags.filter((t) => ends.includes(t));
      if (!hit.length) fail(errs, `L2[${i}] 缺轴 [${ax}]: 边界没划全`);
      if (hit.length > 1) fail(errs, `L2[${i}] 轴 [${ax}] 落了两端: 必须只落一端`);
    });
    if (/(两者都有|都算|不确定|看情况)/.test(m[2]))
      fail(errs, `L2[${i}] 边界含糊(写了"两者都有"之类): "${m[2]}"`);
  });
}

/** L3: 必须能指出可验收产出类型, 或明确露怯。 */
function checkL3(lines, errs) {
  if (!lines.length) return fail(errs, "L3 为空: 既没给产出也没露怯");
  lines.forEach((l, i) => {
    // 露怯分支: 明确说没有可验收标准 —— 合法
    if (/\[无验收标准\]/.test(l)) {
      if (!/给(的)?是参考|不是答案|无法验收/.test(l))
        fail(errs, `L3[${i}] 标了无验收标准但没明说给的是参考: "${l}"`);
      return;
    }
    const m = l.match(/^-\s*\[产出\]\s*(.+)$/);
    if (!m) return fail(errs, `L3[${i}] 缺 [产出] 或 [无验收标准] 标签: "${l}"`);
    if (!OUTPUT_KINDS.some((k) => m[1].includes(k)))
      fail(errs, `L3[${i}] 产出不可验收(不含白名单类型 ${OUTPUT_KINDS.join("/")}): "${m[1]}"`);
  });
}

/** L2 是否逐条能对回 L1 的存活支 —— 需要显式写的 [父:N], 且不得越界。 */
function checkTrace(lines, l1count, errs) {
  lines.forEach((l, i) => {
    const m = l.match(/\[父:(\d+)\]/);
    if (!m) return fail(errs, `L2[${i}] 缺 [父:N] 标注: 无法证明它来自哪个 L1 支`);
    const n = Number(m[1]);
    if (n >= l1count)
      fail(errs, `L2[${i}] [父:${n}] 越界: L1 只有 ${l1count} 条, 指向不存在的父`);
  });
}

export function check(text) {
  const errs = [];
  const sec = { L1: [], L2: [], L3: [] };
  let cur = null;
  for (const raw of text.split("\n")) {
    const h = raw.match(/^##\s*(L[123])\s*$/);
    if (h) { cur = h[1]; continue; }
    if (cur && raw.trim().startsWith("-")) sec[cur].push(raw.trim());
  }
  checkL1(sec.L1, errs);
  checkL2(sec.L2, errs);
  checkTrace(sec.L2, sec.L1.length, errs);
  checkL3(sec.L3, errs);
  return { ok: errs.length === 0, errors: errs, counts: { L1: sec.L1.length, L2: sec.L2.length, L3: sec.L3.length } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("node:fs");
  const p = process.argv[2];
  if (!p) { console.log("用法: node check.js <答案文件.md>"); process.exit(2); }
  const r = check(fs.readFileSync(p, "utf8"));
  console.log(`L1=${r.counts.L1} L2=${r.counts.L2} L3=${r.counts.L3}`);
  if (r.ok) console.log("PASS");
  else { console.log(`FAIL (${r.errors.length})`); r.errors.forEach((e) => console.log("  ✗ " + e)); process.exit(1); }
}
