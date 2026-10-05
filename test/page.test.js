// test/page.test.js — 拆出的 page.js 的纯函数边界。
//
// 拆文件本身有风险（2026-10-05 拆 store.js 时，漏一个 import 就让 200+ 测试红）。
// 这层专门钉住「页面 id / 状态」这几个纯函数，让拆分回归立刻现形。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { idOfPage, statusOfPage, supersededByOf, collapseIndex, PAGE_STATUS } from '../src/page.js';

describe('page — id / status 解析', () => {
  test('idOfPage: 有 id 行时取它，否则用 slug 兜底', () => {
    assert.equal(idOfPage('id: abc123\n其他内容', 'slug-x'), 'abc123');
    assert.equal(idOfPage('没有 id 行', 'slug-x'), 'slug-x');
  });

  test('idOfPage: 空输入不炸', () => {
    assert.equal(idOfPage('', 'fallback'), 'fallback');
    assert.equal(idOfPage(null, 'fb'), 'fb');
  });

  test('statusOfPage: frontmatter 参数省略时从 body 的 --- 块提取', () => {
    // 注意第二参数语义：**省略**才走 body 提取；传值（哪怕是 {}）就直接用它。
    assert.equal(statusOfPage('无状态行'), 'active', '无 status 行 → active');
    assert.equal(statusOfPage('---\nstatus: draft\n---\n正文'), 'draft');
    assert.equal(statusOfPage('---\nstatus: superseded\n---\n正文'), 'superseded');
  });

  test('statusOfPage: 非法状态值回落到 active（不返回脏值）', () => {
    assert.equal(statusOfPage('---\nstatus: 乱写\n---\n'), 'active');
    assert.equal(statusOfPage('', {}), 'active');
  });

  test('PAGE_STATUS 只含三个合法值', () => {
    assert.deepEqual([...PAGE_STATUS].sort(), ['active', 'draft', 'superseded']);
  });

  test('supersededByOf: 无标记返回空', () => {
    assert.equal(supersededByOf('普通内容'), '');
    assert.match(supersededByOf('superseded-by: newer-page'), /newer-page/);
  });
});

describe('collapseIndex — 清单区折叠（读取侧不得随规模增长）', () => {
  test('清单区只留计数（读取侧不得随规模增长）', () => {
    // 这是它的存在理由：index.md 会被 abs load 全量打印，页数一多就膨胀。
    const t = '## Concepts\n- [[a]] — x\n- [[b]] — y\n';
    const r = collapseIndex(t);
    assert.match(r, /## Concepts（2 页）/, `应折叠成计数: ${r}`);
    assert.ok(!r.includes('[[a]]'), '不该保留条目本身');
  });

  test('空分区只留标题（不带计数）', () => {
    const r = collapseIndex('## Concepts\n');
    assert.match(r, /## Concepts/);
    assert.ok(!/\（0 页\）/.test(r), '0 页不该显示计数');
  });

  test('空输入不炸', () => {
    assert.doesNotThrow(() => collapseIndex(''));
    assert.doesNotThrow(() => collapseIndex(null));
  });
});
