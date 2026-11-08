// 圆角输入框的纯格式化函数（hooks/abs-rounded-editor/format.ts）。
// 单测这些而不是扩展本体：扩展要 import @earendil-works/pi-coding-agent，
// 测试进程里没有那个包；纯函数抽出来才能直接断言。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildStatus, effortAnsi, paintAnsi, roundBorder, shortenModel, shortTokens, textWidth } from '../hooks/abs-rounded-editor/format.ts';

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
      const got = roundBorder('─'.repeat(w - 2), (s) => s, '╰', '╯', '', 'fanchao');
      assert.equal(textWidth(got), w, `w=${w} 宽度应保持 ${w}，实际 ${textWidth(got)}`);
      assert.ok(got.startsWith('╰ fanchao'), `应紧跟在左圆角后（带 1 空格）: ${got}`);
      assert.ok(got.endsWith('╯'), got);
    }
  });

  // ★ 2026-11-07 用户实报：「输入框右下角底下的线冒出来了」——
  //   根因是按**字符数**算宽度，中文昵称「转发锦鲤求暴富」7 字实际 14 列，
  //   少算 7 列把右下角圆角挤到屏幕外。这条钉住「按显示宽度算」。
  it('★ 含中文标签按显示宽度算：右下角圆角不溢出', () => {
    for (const w of [30, 60, 106]) {
      const got = roundBorder('─'.repeat(w - 2), (s) => s, '╰', '╯', '', 'fanchao · 转发锦鲤求暴富');
      assert.equal(textWidth(got), w, `w=${w} 宽度应保持 ${w}，实际 ${textWidth(got)}: ${got}`);
      assert.ok(got.endsWith('╯'), `右下角圆角必须在: ${got}`);
      assert.ok(got.includes('转发锦鲤求暴富'), `标签应完整保留: ${got}`);
    }
  });

  it('★ 两侧同时带含中文标签，宽度仍精确', () => {
    const got = roundBorder('─'.repeat(104), (s) => s, '╰', '╯', '17.2%/1.0M deepseek-v4.1-flash', 'fanchao · 转发锦鲤求暴富');
    assert.equal(textWidth(got), 106, `宽度应精确为 106，实际 ${textWidth(got)}: ${got}`);
    assert.ok(got.startsWith('╰ fanchao'), got);
    assert.ok(got.endsWith('flash ╯'), got);
  });

  it('textWidth：CJK 计 2 列、边框符与 ASCII 计 1 列', () => {
    assert.equal(textWidth('ab'), 2);
    assert.equal(textWidth('中文'), 4);
    assert.equal(textWidth('─'), 1, 'U+2500 是 1 列，不能当宽字符');
    assert.equal(textWidth('╰╯'), 2);
    assert.equal(textWidth('a中─'), 4);
    // ANSI 不计入
    assert.equal(textWidth('\x1b[2m中文\x1b[0m'), 4);
  });

  it('★ 左右 label 同时用：左边作者名、右边状态，位置不串', () => {
    const got = roundBorder('─'.repeat(58), (s) => s, '╰', '╯', '8.0%/1.0M m', 'fanchao');
    assert.equal(textWidth(got), 60, `宽度应保持 60，实际 ${textWidth(got)}`);
    assert.ok(got.startsWith('╰ fanchao '), `左 label 应在最左: ${got}`);
    assert.ok(/ 8\.0%\/1\.0M m ╯$/.test(got), `右 label 应在最右: ${got}`);
  });

  it('★ 左 label 放不下就丢掉（不溢出、不影响右 label）', () => {
    const got = roundBorder('─'.repeat(8), (s) => s, '╰', '╯', 'R', '一个非常非常长的作者名昵称组合');
    assert.equal(textWidth(got), 10, `不得溢出: ${got}`);
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

// ===== 输入框文字跟着推理强度走绿色阶（2026-11-06 提出，2026-11-07 换成绿色阶）=====
// 为何要测：颜色错了不报错，只是看着不对 —— 没有断言就没人能发现回归。
describe('effortAnsi — 推理强度 → 主色（用户指定的六档 hex）', () => {
  // 2026-11-07 用户直接给了 hex，这里逐个钉死：改色就应让测试红，不能默默变掉。
  const HEX = {
    max: '#EEF2F8',
    xhigh: '#DDE4F0',
    high: '#C8D2E4',
    medium: '#B0BBD0',
    low: '#98A4BE',
    minimal: '#8090B0',
  };
  const toAnsi = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return `38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`;
  };

  it('★ 六档色值 = 用户指定的 hex', () => {
    for (const [level, hex] of Object.entries(HEX)) {
      assert.equal(effortAnsi(level), toAnsi(hex), `${level} 应为 ${hex}`);
    }
  });

  it('★ 256 色终端退到最近的一档', () => {
    // 256 色板里没有这种灰蓝，退到最近的灰/蓝灰档
    assert.equal(effortAnsi('max', '256color'), '38;5;255');
    assert.equal(effortAnsi('xhigh', '256color'), '38;5;254');
    assert.equal(effortAnsi('high', '256color'), '38;5;189');
    assert.equal(effortAnsi('medium', '256color'), '38;5;146');
    assert.equal(effortAnsi('low', '256color'), '38;5;110');
    assert.equal(effortAnsi('minimal', '256color'), '38;5;110');
  });

  it('★ off / 空值 → 空串（不上色，用默认前景色）', () => {
    for (const v of ['off', '', null, undefined, 'bogus']) {
      assert.equal(effortAnsi(v), '', `${JSON.stringify(v)} 不该上色`);
    }
  });

  it('容错：带空白、大小写不炸', () => {
    assert.equal(effortAnsi('  high  '), toAnsi(HEX.high));
    assert.equal(effortAnsi('HIGH'), toAnsi(HEX.high));
  });

  it('paintAnsi：包上开/关序列，空串原样返回', () => {
    assert.equal(paintAnsi(toAnsi(HEX.max), 'x'), `\x1b[${toAnsi(HEX.max)}mx\x1b[39m`);
    assert.equal(paintAnsi('', 'x'), 'x');
  });
});
