// test/text.test.js — 纯文本工具的边界（clip / slugOf）。
//
// 为何单独测：这两个是 log/note/concept 三条写入路径共用的收口函数，改坏了
// 影响面很广，但原先只有「顺带被别的测试走到」——边界（空串、正好 n、全标点、
// emoji）从没被直接钉过。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { clip, slugOf } from '../src/text.js';

describe('clip — 语义边界收口', () => {
  test('不超长时原样返回（不加省略号）', () => {
    assert.equal(clip('短句', 10), '短句');
    assert.equal(clip('正好九个字啊啊啊', 9), '正好九个字啊啊啊');  // 正好等于 n
  });

  test('超长时在标点处收口（不硬切在词中间）', () => {
    // 这是它存在的理由：曾直接 slice 把 log.md 切断在词中间，load 读到半句
    const s = '第一条线索很长很长很长，第二条线索也很长很长很长很长';
    const r = clip(s, 15);
    assert.ok(r.endsWith('…'), '应加省略号');
    assert.ok(!/[,，、;；.。]\s*…$/.test(r), '不应留着标点再省略号');
    assert.ok(r.length <= 16, `不该比 n 长太多: ${r.length}`);
  });

  test('长句无标点时硬切（宁可硬切也不留残破短头）', () => {
    const s = '一二三四五六七八九十一二三四五六七八九十';
    const r = clip(s, 10);
    assert.equal(r.length, 11, `应为 10 + 省略号: ${r}`);
  });

  test('空/undefined 返回空串（不抛）', () => {
    assert.equal(clip('', 5), '');
    assert.equal(clip(undefined, 5), '');
    assert.equal(clip(null, 5), '');
  });

  test('n=0 不炸', () => {
    assert.doesNotThrow(() => clip('abc', 0));
  });
});

describe('slugOf — 文件名 slug', () => {
  test('中文转小写连字符形式，保留可读性', () => {
    assert.equal(slugOf('修复插件加载失败'), '修复插件加载失败');
  });

  test('英文/空格转连字符，全小写', () => {
    assert.equal(slugOf('Fix Plugin Load'), 'fix-plugin-load');
  });

  test('特殊字符折叠为单个连字符，首尾不留', () => {
    const r = slugOf('  a///b  c  ');
    assert.ok(!/^-|-$/.test(r), `首尾不该有连字符: ${r}`);
    assert.ok(!/--/.test(r), `不该有连续连字符: ${r}`);
  });

  test('超长在标点边界收口（不切出残字）', () => {
    // 坑源：曾出现 `...-硬切-不` 这种残尾
    const r = slugOf('这是一个非常长的标题，后面还有很多内容需要被截断掉', 12);
    assert.ok(!/-$/.test(r), `不该以连字符结尾: ${r}`);
  });

  test('空输入返回空串（调用方据此跳过）', () => {
    assert.equal(slugOf(''), '');
    assert.equal(slugOf('   '), '');
    assert.equal(slugOf('！！！'), '');   // 全标点 → 折叠后为空
  });
});
