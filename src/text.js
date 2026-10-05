// src/text.js — 无依赖的纯文本工具。从 store.js 拆出（2026-10-05）。
//
// 为何单独一个文件：clip / slugOf 被 log、note、concept 三处共用，而它们本身
// 零依赖。放在任何业务文件里都会逼出循环 import（note.js ⇄ store.js）。
// 纯工具独立成格，是谁都能往下依赖的底。

/** 摘要收口：超过 n 码点在**语义边界**收尾（标点 → 空格 → 硬切），加省略号。
 * 坑: 曾直接 `.slice(0, n)` 硬切 → log.md 34/85 条断在词中间(revert-c / file-write-lockin /
 * ~/.cl​aude/ski), 文件名也被切成 ...-decision-blo。而 abs load 开机读的就是这份残句,
 * 用户与后续会话看到的天然是半句 —— "摘要读起来抽象"的真因在写入口, 不在表述能力。 */
export function clip(text, n) {
  const s = String(text || '').trim();
  if (s.length <= n) return s;
  const head = s.slice(0, n);
  // 优先在标点处断开（中文句读 + 英文句读），其次空格，最后才硬切
  const cut = Math.max(
    head.lastIndexOf('。'), head.lastIndexOf('；'), head.lastIndexOf('！'), head.lastIndexOf('？'),
    head.lastIndexOf('，'), head.lastIndexOf('、'), head.lastIndexOf(';'), head.lastIndexOf(','),
    head.lastIndexOf('.'), head.lastIndexOf(' '),
  );
  // 边界太靠前（< 一半）说明这一段本就是长句，宁可硬切也不留个残破的短头
  const keep = cut > n / 2 ? cut : n;
  return `${s.slice(0, keep).replace(/[\s,，、;；.。]+$/, '')}…`;
}

/** slug：取前 n 码点 → 非词字符折叠为 '-'。只用于**文件名**，完整标题另存 TITLE 行。
 * 在标点/空格边界收口，不在字中间切断（否则出 `...-硬切-不` 这种残尾）。 */
export function slugOf(text, n = 24) {
  const s = String(text || '').trim();
  let head = s.slice(0, n);
  if (s.length > n) {
    const cut = Math.max(head.lastIndexOf('，'), head.lastIndexOf('。'), head.lastIndexOf('、'),
      head.lastIndexOf('：'), head.lastIndexOf(','), head.lastIndexOf('.'), head.lastIndexOf(' '));
    if (cut > n / 2) head = head.slice(0, cut);
  }
  return head.replace(/[^\w一-鿿]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}