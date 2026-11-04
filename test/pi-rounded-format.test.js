// 圆角输入框的纯格式化函数（hooks/abs-rounded-editor/format.ts）。
// 单测这些而不是扩展本体：扩展要 import @earendil-works/pi-coding-agent，
// 测试进程里没有那个包；纯函数抽出来才能直接断言。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildStatus, roundBorder, shortenModel, shortTokens } from '../hooks/abs-rounded-editor/format.ts';

describe('圆角输入框 格式化', () => {
  it('shortenModel：去 provider 前缀与日期后缀', () => {
    assert.equal(shortenModel('deepseek/deepseek-v4.1-flash'), 'deepseek-v4.1-flash');
    assert.equal(shortenModel('claude-sonnet-4-5-20250929'), 'claude-sonnet-4-5');
    assert.equal(shortenModel('gpt-5'), 'gpt-5');
    assert.equal(shortenModel(''), '');
  });

  it('shortTokens：百万/千/原值三档', () => {
    assert.equal(shortTokens(1048576), '1.0M');
    assert.equal(shortTokens(280000), '280k');
    assert.equal(shortTokens(999), '999');
    assert.equal(shortTokens(0), '0');
    // 未知量不该崩，也不该编造数字
    assert.equal(shortTokens(null), '?');
    assert.equal(shortTokens(undefined), '?');
    assert.equal(shortTokens(NaN), '?');
  });

  it('buildStatus：百分比/上限/模型名拼成一行', () => {
    const usage = { tokens: 83886, contextWindow: 1048576, percent: 8.04 };
    assert.equal(buildStatus(usage, 'deepseek/deepseek-v4.1-flash'), '8.0%/1.0M deepseek-v4.1-flash');
  });

  it('buildStatus：缺字段就省掉那一段，不留空占位', () => {
    assert.equal(buildStatus(undefined, 'gpt-5'), 'gpt-5');
    assert.equal(buildStatus({ percent: null, contextWindow: 1048576 }, 'gpt-5'), '/1.0M gpt-5');
    assert.equal(buildStatus({ percent: 12.3, contextWindow: 0 }, ''), '12.3%');
    assert.equal(buildStatus(undefined, ''), '');
  });

  it('roundBorder：可见宽度不变（圆角各占 1 列，替掉原边框两端的 ─）', () => {
    const width = 40;
    const inner = '─'.repeat(width - 2);
    for (const w of [20, 40, 80]) {
      const line = '─'.repeat(w - 2);
      const got = roundBorder(line, (s) => s, '╭', '╮');
      assert.equal([...got].length, w, `w=${w} 应仍是 ${w} 列，实际 ${[...got].length}`);
    }
    assert.equal(inner.length, width - 2);
  });

  it('roundBorder：label 贴右端，两侧各留 1 空格', () => {
    const got = roundBorder('─'.repeat(38), (s) => s, '╭', '╮', 'abc');
    assert.ok(got.startsWith('╭'), got);
    assert.ok(got.endsWith('╮'), got);
    assert.ok(got.includes(' abc '), `label 两侧应有空格: ${got}`);
    assert.equal([...got].length, 40, `宽度应保持 40，实际 ${[...got].length}`);
  });

  it('roundBorder：放不下 label 就整个丢掉，绝不溢出', () => {
    const narrow = '─'.repeat(8); // 总宽 10
    const got = roundBorder(narrow, (s) => s, '╭', '╮', '8.0%/1.0M deepseek-v4.1-flash');
    assert.equal([...got].length, 10, `不得溢出: ${got}`);
    assert.ok(!got.includes('deepseek'), `放不下就不该硬塞: ${got}`);
  });

  it('roundBorder：含 ANSI 的边框行不会被切坏转义序列', () => {
    const plainBorder = '─'.repeat(38);
    const colored = `\x1b[2m${plainBorder}\x1b[0m`;
    const got = roundBorder(colored, (s) => `\x1b[2m${s}\x1b[0m`, '╭', '╮', 'abc');
    // 剥色后可见内容正确、宽度不变
    const visible = got.replace(/\x1b\[[0-9;]*m/g, '');
    assert.equal([...visible].length, 40, `可见宽度应 40: ${visible}`);
    assert.ok(visible.startsWith('╭') && visible.endsWith('╮'), visible);
    // 不得残留裸的 ESC 或残缺序列
    assert.ok(!/\x1b(?!\[)/.test(got), '不得出现残缺转义序列');
  });
});
