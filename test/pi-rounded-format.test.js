// 圆角输入框的纯格式化函数（hooks/abs-rounded-editor/format.ts）。
// 单测这些而不是扩展本体：扩展要 import @earendil-works/pi-coding-agent，
// 测试进程里没有那个包；纯函数抽出来才能直接断言。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildStatus, roundBorder, shortenModel, shortTokens, thinkingColorToken } from '../hooks/abs-rounded-editor/format.ts';

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

  // ===== 左 label（作者名 · 昵称，2026-11-07 用户要求放输入框左下角）=====
  it('★ 左 label 贴在左圆角之后，两侧各留 1 空格，宽度不变', () => {
    for (const w of [20, 40, 80]) {
      const got = roundBorder('─'.repeat(w - 2), (s) => s, '╰', '╯', '', 'fanchao · 云旅游专家');
      assert.equal([...got].length, w, `w=${w} 宽度应保持 ${w}，实际 ${[...got].length}`);
      assert.ok(got.startsWith('╰ fanchao'), `应紧跟在左圆角后（带 1 空格）: ${got}`);
      assert.ok(got.includes('云旅游专家 '), `label 后应有 1 空格: ${got}`);
      assert.ok(got.endsWith('╯'), got);
    }
  });

  it('★ 左右 label 同时用：左边作者名、右边状态，位置不串', () => {
    const got = roundBorder('─'.repeat(58), (s) => s, '╰', '╯', '8.0%/1.0M m', 'fanchao');
    assert.equal([...got].length, 60, `宽度应保持 60，实际 ${[...got].length}`);
    assert.ok(got.startsWith('╰ fanchao '), `左 label 应在最左: ${got}`);
    assert.ok(/ 8\.0%\/1\.0M m ╯$/.test(got), `右 label 应在最右: ${got}`);
  });

  it('★ 左 label 放不下就丢掉（不溢出、不影响右 label）', () => {
    const got = roundBorder('─'.repeat(8), (s) => s, '╰', '╯', 'R', '一个非常非常长的作者名昵称组合');
    assert.equal([...got].length, 10, `不得溢出: ${got}`);
    assert.ok(!got.includes('非常非常长'), `放不下就不该硬塞: ${got}`);
    assert.ok(got.includes(' R '), `右 label 仍应变正常: ${got}`);
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

// ===== 输入框文字跟着推理强度变色（2026-11-06 用户需求）=====
// 为何要测：theme 里确实有这七档 token，但若映射拼错（如 'minimal' → 'thinkingminimal'），
// theme.fg 会静默返回不上色的文本 —— 颜色悄悄没了，没有断言就发现不了。
describe('thinkingColorToken — 推理强度 → 主题 token', () => {
  it('★ 七档齐全，且拼法对上主题（thinking + 首字母大写）', () => {
    assert.equal(thinkingColorToken('minimal'), 'thinkingMinimal');
    assert.equal(thinkingColorToken('low'), 'thinkingLow');
    assert.equal(thinkingColorToken('medium'), 'thinkingMedium');
    assert.equal(thinkingColorToken('high'), 'thinkingHigh');
    assert.equal(thinkingColorToken('xhigh'), 'thinkingXhigh');
    assert.equal(thinkingColorToken('max'), 'thinkingMax');
  });

  it('★ off / 空值 → 空串（不上色，用默认前景色）', () => {
    // 不能返回 thinkingOff：主题给它的是接近背景的暗灰，染文字会看不清。
    assert.equal(thinkingColorToken('off'), '');
    assert.equal(thinkingColorToken(''), '');
    assert.equal(thinkingColorToken(null), '');
    assert.equal(thinkingColorToken(undefined), '');
  });

  it('容错：带空白、大小写异常不炸', () => {
    assert.equal(thinkingColorToken('  high  '), 'thinkingHigh');
    assert.equal(thinkingColorToken('HIGH'), 'thinkingHIGH');
  });
});
