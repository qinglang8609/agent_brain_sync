/**
 * abs serve —— 把 .brain/ 挂成一个只读网页。
 *
 * 为什么需要 http 服务（而不是一个能双击打开的 html）：
 *   浏览器不允许 JS 列出本地目录，file:// 下 fetch 也被 CORS 禁。
 *   要"自动列出文件夹里的 md"，就必须有一个能读目录的东西 —— 服务端。
 *   这是浏览器安全模型决定的，不是实现选择。
 *
 * 渲染与样式全部走 CDN（marked 转 md、highlight.js 高亮）——
 * 不自己写解析器、不内嵌资源，页面本体只有布局和交互。
 * CDN 用 lib.baomitu.com（360 源，国内可达）。
 *
 * 边界（刻意收窄）：
 *   · 只绑 127.0.0.1 —— 不对外网开放
 *   · 只读 —— 没有任何写接口；图谱仍由 CLI 改
 *   · 只服务 .brain/ 内部 —— 路径穿越被拒
 *   · 零依赖 —— 只用 node 内置 http/fs；前端库由浏览器从 CDN 取
 */

import { promises as fs } from 'node:fs';
import { join, normalize, extname, relative, sep } from 'node:path';
import http from 'node:http';

const MIME = {
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** CDN 基址。换源只改这一行。 */
const CDN = 'https://lib.baomitu.com';

/** 递归收集 .brain/ 下的 md（相对 root 的路径）。 */
/**
 * 组名展示映射（2026-09-16 用户定）：
 *   · 根组 → 用【项目目录名】（.brain/ 的父目录），不看泛的"根"
 *   · 标准子目录 → 中文名，网页上比英文目录名直观
 * 未列出的目录用原名（用户自建的目录不该被改名）。
 */
export const GROUP_NAMES = {
  concepts: '概念', entities: '实体', syntheses: '综合',
  sources: '来源', sessions: '会话',
};

/** 把内部组 key 映射成展示名。rootLabel = 根组的显示名。 */
export function displayGroup(key, rootLabel) {
  if (key === ROOT_KEY) return rootLabel;
  return GROUP_NAMES[key] || key;
}

/** 内部约定：根组固定用这个 key 参与排序，展示时再换成目录名。 */
export const ROOT_KEY = '__root__';

export async function scanTree(root, { maxDepth = 3 } = {}) {
  const groups = {};
  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    let ents;
    try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { await walk(p, depth + 1); continue; }
      if (!e.name.endsWith('.md')) continue;
      const parts = relative(root, p).split(sep);
      const group = parts.length > 1 ? parts[0] : ROOT_KEY;
      (groups[group] ||= []).push({
        path: parts.join('/'),
        name: e.name.replace(/\.md$/, ''),
      });
    }
  }
  await walk(root, 0);
  for (const g of Object.keys(groups)) groups[g].sort((a, b) => a.name.localeCompare(b.name));

  // 顶部置顶的顺序：看板/日志/索引是每次开工先看的三个。
  // 它们本来就在根目录，但会被其它组插在中间 —— 显式排序而不靠目录遍历顺序。
  const ROOT_ORDER = ['index', 'todo', 'log'];
  const ordered = {};
  if (groups[ROOT_KEY]) {
    groups[ROOT_KEY].sort((a, b) => {
      const ia = ROOT_ORDER.indexOf(a.name), ib = ROOT_ORDER.indexOf(b.name);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.name.localeCompare(b.name);
    });
    ordered[ROOT_KEY] = groups[ROOT_KEY];
  }
  // 知识页在前（常用的），流水在后
  const DIR_ORDER = ['concepts', 'entities', 'syntheses', 'sources', 'sessions'];
  for (const d of DIR_ORDER) if (groups[d]) ordered[d] = groups[d];
  for (const g of Object.keys(groups)) if (!(g in ordered)) ordered[g] = groups[g];
  return ordered;
}

/** 解析请求路径 → .brain/ 内的绝对路径；越界返回 null。 */
export function safeResolve(root, urlPath) {
  const clean = decodeURIComponent(String(urlPath).split('?')[0]);
  const rel = normalize(clean).replace(/^(\.\.(\/|\\|$))+/, '');
  const abs = join(root, rel);
  const r = relative(root, abs);
  if (r.startsWith('..') || r.includes(`..${sep}`)) return null;
  return abs;
}

/** 浏览器页面。布局与交互在此，渲染/高亮由 CDN 库负责。 */
export const PAGE = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>brain</title>
<link rel="stylesheet" href="${CDN}/highlight.js/11.4.0/styles/github.min.css" data-hl="light">
<link rel="stylesheet" href="${CDN}/highlight.js/11.4.0/styles/github-dark.min.css" data-hl="dark">
<style>
/* ============================================================
   主题：5 套配色 × 2 档明暗 = 一套变量切换。
   不引外部 CSS 表 —— 那些是整站样式，会和侧栏布局打架。
   变量只覆盖颜色与字体，布局与结构不受影响。
   ============================================================ */
:root{
  --fs:16px; --lh:1.75;
  --radius:9px;
  --serif:"Songti SC","SimSun",Georgia,serif;
  --sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Source Han Sans SC","Noto Sans CJK SC","Segoe UI",sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}

/* --- 主题 1: github（中性，默认） --- */
[data-theme="github"]{
  --bg:#fff;--fg:#1f2328;--dim:#656d76;--side:#f6f8fa;--line:#d8dee4;
  --link:#0969da;--sel:#dbeafe;--code-bg:#f6f8fa;--mark:#fff3bf;--hl-line:#eaeef2;
  --f-body:var(--sans);--f-head:var(--sans);
}
[data-theme="github"][data-mode="dark"]{
  --bg:#0d1117;--fg:#e6edf3;--dim:#8b949e;--side:#161b22;--line:#30363d;
  --link:#4493f8;--sel:#1f3352;--code-bg:#161b22;--mark:#4a3d1a;--hl-line:#21262d;
}

/* --- 主题 2: 阅读（衬线、宽行距、暖底，适合长文） --- */
[data-theme="read"]{
  --bg:#fdfcf8;--fg:#2b2b2b;--dim:#8a8078;--side:#f6f2ea;--line:#e6dfd4;
  --link:#b45309;--sel:#fde9c8;--code-bg:#f6f2ea;--mark:#ffe9a8;--hl-line:#efe9dd;
  --fs:17px;--lh:1.9;
  --f-body:var(--serif);--f-head:var(--serif);
}
[data-theme="read"][data-mode="dark"]{
  --bg:#1a1815;--fg:#ddd6cc;--dim:#8a8078;--side:#221f1b;--line:#37322b;
  --link:#e0a458;--sel:#3d3528;--code-bg:#221f1b;--mark:#4d3f1e;--hl-line:#2a2621;
}

/* --- 主题 3: 松（冷绿、紧凑、信息密度高） --- */
[data-theme="pine"]{
  --bg:#ffffff;--fg:#24292f;--dim:#57606a;--side:#eef4f1;--line:#cfe0d9;
  --link:#0f766e;--sel:#cceee7;--code-bg:#eef4f1;--mark:#d3f2c4;--hl-line:#e3ede9;
  --fs:15.5px;--lh:1.68;
  --f-body:var(--sans);--f-head:var(--sans);
}
[data-theme="pine"][data-mode="dark"]{
  --bg:#0e1512;--fg:#d5e0db;--dim:#7d9189;--side:#141d19;--line:#26362f;
  --link:#5eead4;--sel:#1b3a33;--code-bg:#141d19;--mark:#33471f;--hl-line:#1a2620;
}

/* --- 主题 4: 墨（黑白灰、极简、无彩色） --- */
[data-theme="ink"]{
  --bg:#fff;--fg:#111;--dim:#888;--side:#fafafa;--line:#e0e0e0;
  --link:#111;--sel:#ededed;--code-bg:#f7f7f7;--mark:#ffe97a;--hl-line:#f0f0f0;
  --fs:16px;--lh:1.78;
  --f-body:var(--sans);--f-head:var(--sans);
}
[data-theme="ink"][data-mode="dark"]{
  --bg:#111;--fg:#eee;--dim:#8a8a8a;--side:#1a1a1a;--line:#2e2e2e;
  --link:#fff;--sel:#2a2a2a;--code-bg:#1a1a1a;--mark:#5a5024;--hl-line:#242424;
}

/* --- 主题 5: 蓝调（深蓝底，低对比护眼） --- */
[data-theme="ocean"]{
  --bg:#f4f7fb;--fg:#1e293b;--dim:#64748b;--side:#e8eef7;--line:#cbd8e8;
  --link:#1d4ed8;--sel:#d5e3fb;--code-bg:#e8eef7;--mark:#cfe0ff;--hl-line:#dfe8f4;
  --fs:16px;--lh:1.78;
  --f-body:var(--sans);--f-head:var(--sans);
}
[data-theme="ocean"][data-mode="dark"]{
  --bg:#0a1120;--fg:#dbe4f0;--dim:#7f8ea4;--side:#111c30;--line:#1f2f47;
  --link:#7ea6ff;--sel:#1c2c4a;--code-bg:#111c30;--mark:#2f4573;--hl-line:#16233a;
}

/* 未指定主题 / 跟随系统时的兜底 = github */
html:not([data-theme]){ --bg:#fff;--fg:#1f2328;--dim:#656d76;--side:#f6f8fa;--line:#d8dee4;--link:#0969da;--sel:#dbeafe;--code-bg:#f6f8fa;--mark:#fff3bf;--f-body:var(--sans);--f-head:var(--sans) }
@media(prefers-color-scheme:dark){
  html:not([data-theme]):not([data-mode="light"]){ --bg:#0d1117;--fg:#e6edf3;--dim:#8b949e;--side:#161b22;--line:#30363d;--link:#4493f8;--sel:#1f3352;--code-bg:#161b22;--mark:#4a3d1a }
}

*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;background:var(--bg);color:var(--fg);
  font:var(--fs)/var(--lh) var(--f-body);
  text-spacing-trim:space-first;      /* 中西文自动间距，中文整齐的关键 */
  -webkit-text-size-adjust:100%;
  overflow-x:hidden;
  transition:background .18s,color .18s;
}

/* ---- 侧栏 ---- */
aside{width:290px;flex:0 0 290px;background:var(--side);border-right:1px solid var(--line);
  height:100vh;position:sticky;top:0;display:flex;flex-direction:column;
  transition:transform .22s ease}
#wrap{display:flex;min-height:100%}
#hd{padding:12px 14px 10px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:6px}
#hd .brand{flex:1;font-size:12.5px;font-weight:700;letter-spacing:.1em;color:var(--dim)}
#hd button{border:1px solid var(--line);background:var(--bg);color:var(--dim);border-radius:6px;
  width:30px;height:30px;line-height:1;cursor:pointer;font-size:14px;padding:0;flex:0 0 auto}
#hd button:hover{color:var(--fg);border-color:var(--link)}
#q{margin:10px 14px 0;padding:7px 10px;border:1px solid var(--line);border-radius:7px;
  background:var(--bg);color:var(--fg);font-size:13px;font-family:inherit;width:calc(100% - 28px)}
#q:focus{outline:none;border-color:var(--link);box-shadow:0 0 0 3px var(--sel)}
#tree{overflow-y:auto;flex:1;padding:6px 0 24px}
.g{margin:10px 0 3px;padding:5px 14px;font-size:11.5px;color:var(--dim);font-weight:700;letter-spacing:.05em;
  display:flex;align-items:center;gap:5px}
.g.fold{cursor:pointer;user-select:none}
.g.fold:hover{background:var(--sel);color:var(--fg)}
.g .cnt{margin-left:auto;opacity:.6;font-weight:500}
#tree a{display:block;padding:5px 14px 5px 22px;color:var(--fg);text-decoration:none;font-size:13.5px;
  border-left:2px solid transparent;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#tree a:hover{background:var(--sel)}
#tree a.on{background:var(--sel);border-left-color:var(--link);color:var(--link);font-weight:600}
#mask{display:none}

/* ---- 正文 ---- */
main{flex:1;min-width:0;padding:34px 44px 96px;max-width:900px}
main h1,main h2{border-bottom:1px solid var(--line);padding-bottom:.32em;line-height:1.42;font-family:var(--f-head)}
main h1{font-size:1.75em;margin:.2em 0 .8em;font-weight:700}
main h2{font-size:1.34em;margin:1.7em 0 .7em;font-weight:700}
main h3{font-size:1.14em;margin:1.5em 0 .6em;font-weight:600;font-family:var(--f-head)}
main h4{font-size:1.02em;margin:1.3em 0 .5em;font-weight:600}
main p{margin:.85em 0}
main ul,main ol{padding-left:1.6em;margin:.85em 0}
main li{margin:.3em 0}
main table{border-collapse:collapse;margin:1.1em 0;display:block;overflow-x:auto;font-size:.93em}
main th,main td{border:1px solid var(--line);padding:7px 12px;line-height:1.55}
main th{background:var(--side);font-weight:600;white-space:nowrap}
main blockquote{margin:1em 0;padding:.1em 1em;border-left:.25em solid var(--line);color:var(--dim)}
main hr{border:none;border-top:1px solid var(--line);margin:1.8em 0}
main a{color:var(--link);text-decoration:none}
main a:hover{text-decoration:underline}
main code{font-family:var(--mono);font-size:.86em}
main :not(pre)>code{background:var(--code-bg);padding:.18em .42em;border-radius:5px;border:1px solid var(--line)}
main pre{border-radius:var(--radius);overflow-x:auto;border:1px solid var(--line);margin:1em 0}
main pre code{border:none;background:none;padding:0;font-size:.84em;line-height:1.62}
main img{max-width:100%;height:auto;border-radius:6px}
a.wl{cursor:pointer;border-bottom:1px dotted currentColor}
a.wl:hover{background:var(--mark)}
a.wl.miss{opacity:.4;text-decoration:line-through}
#empty{color:var(--dim);padding:80px 0;text-align:center;font-size:14px}
main>*:first-child{margin-top:0}

/* ---- 主题选择面板 ---- */
#tp{position:absolute;right:10px;top:50px;z-index:30;background:var(--bg);border:1px solid var(--line);
  border-radius:10px;padding:10px;box-shadow:0 6px 24px rgba(0,0,0,.16);display:none;min-width:150px}
#tp.on{display:block}
#tp .t{font-size:11px;color:var(--dim);font-weight:700;letter-spacing:.05em;margin:0 0 6px 2px}
#tp .row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px}
#tp .row:hover{background:var(--sel)}
#tp .row.cur{background:var(--sel);font-weight:600}
#tp .sw{width:14px;height:14px;border-radius:4px;border:1px solid var(--line);flex:0 0 auto}
#hdr{position:relative}

/* ---- 手机：侧栏变抽屉 ---- */
@media(max-width:820px){
  aside{position:fixed;left:0;top:0;z-index:20;width:min(84vw,320px);flex-basis:auto;
    transform:translateX(-100%);box-shadow:2px 0 18px rgba(0,0,0,.2)}
  body.nav-open aside{transform:translateX(0)}
  body.nav-open #mask{display:block;position:fixed;inset:0;background:rgba(0,0,0,.44);z-index:10}
  main{padding:16px 18px 90px;max-width:100%}
  main h1{font-size:1.42em}main h2{font-size:1.2em}
  :root{--fs:15.5px;--lh:1.8}
  main table{font-size:.88em}
}
#fab{display:none}
@media(max-width:820px){
  #fab{display:flex;position:fixed;left:14px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:9;
    width:46px;height:46px;border-radius:50%;border:1px solid var(--line);background:var(--side);color:var(--fg);
    align-items:center;justify-content:center;font-size:19px;cursor:pointer;box-shadow:0 3px 14px rgba(0,0,0,.22)}
}
</style></head>
<body>
<div id="wrap">
<aside>
  <div id="hd">
    <span class="brand">BRAIN</span>
    <button id="mode" title="明/暗">◐</button>
    <button id="theme" title="主题">🎨</button>
    <button id="close" title="收起" style="display:none">✕</button>
  </div>
  <div id="hdr">
    <div id="tp"></div>
  </div>
  <input id="q" placeholder="筛选文件名…">
  <div id="tree"></div>
</aside>
<div id="mask"></div>
<main id="main"><div id="empty">← 从左边选一个文件</div></main>
<button id="fab" title="目录">☰</button>
</div>
<script src="${CDN}/marked/4.0.2/marked.min.js"></script>
<script src="${CDN}/highlight.js/11.4.0/highlight.min.js"></script>
<script>
const $ = (s) => document.querySelector(s);
const FILES = {};
let TREE = {};
const isMobile = () => matchMedia('(max-width:820px)').matches;

/* 主题清单：id / 名称 / 预览色（给面板画色块） */
const THEMES = [
  ['github', 'GitHub', '#ffffff', '#0969da'],
  ['read',   '阅读',   '#fdfcf8', '#b45309'],
  ['pine',   '松',     '#eef4f1', '#0f766e'],
  ['ink',    '墨',     '#ffffff', '#111111'],
  ['ocean',  '蓝调',   '#f4f7fb', '#1d4ed8'],
];

/* --- 主题与明暗：存 localStorage --- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('brain-theme', t);
  renderThemePanel();
}
function applyMode(m) {
  document.documentElement.dataset.mode = m;
  localStorage.setItem('brain-mode', m);
  // highlight.js 主题跟着切（深色主题用 github-dark）
  document.querySelectorAll('link[data-hl]').forEach((l) => { l.disabled = l.dataset.hl !== m; });
}
function currentMode() {
  return document.documentElement.dataset.mode ||
    (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
}
function renderThemePanel() {
  const box = $('#tp');
  const cur = document.documentElement.dataset.theme || 'github';
  box.innerHTML = '<div class="t">主题</div>' + THEMES.map(([id, name, bg, acc]) =>
    '<div class="row' + (id === cur ? ' cur' : '') + '" data-t="' + id + '">' +
    '<span class="sw" style="background:' + bg + ';border-color:' + acc + '"></span>' + name + '</div>'
  ).join('');
  box.querySelectorAll('.row').forEach((r) => {
    r.onclick = () => { applyTheme(r.dataset.t); box.classList.remove('on'); };
  });
}
(() => {
  const t = localStorage.getItem('brain-theme') || 'github';
  document.documentElement.dataset.theme = t;
  const m = localStorage.getItem('brain-mode');
  if (m) document.documentElement.dataset.mode = m;
  applyMode(m || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'));
  $('#theme').onclick = (e) => { e.stopPropagation(); $('#tp').classList.toggle('on'); };
  $('#mode').onclick = () => applyMode(currentMode() === 'dark' ? 'light' : 'dark');
  document.addEventListener('click', (e) => {
    if (!$('#tp').contains(e.target) && e.target !== $('#theme')) $('#tp').classList.remove('on');
  });
  renderThemePanel();
})();

/* --- 抽屉 --- */
function openNav(on) {
  document.body.classList.toggle('nav-open', on);
  $('#close').style.display = isMobile() && on ? '' : 'none';
}
$('#fab').onclick = () => openNav(true);
$('#close').onclick = () => openNav(false);
$('#mask').onclick = () => openNav(false);
matchMedia('(max-width:820px)').addEventListener('change', () => openNav(false));

/** [[双链]] 扩展 */
const wlExt = {
  name: 'wl', level: 'inline',
  start(src) { return src.indexOf('[['); },
  tokenizer(src) {
    const m = src.match(/^\\[\\[([^\\]\\n]+)\\]\\]/);
    if (m) return { type: 'wl', raw: m[0], slug: m[1].trim() };
  },
  renderer(t) { return '<a class="wl" data-slug="' + t.slug + '">' + t.slug + '</a>'; },
};
marked.use({ extensions: [wlExt], mangle: false, headerIds: false });

function renderTree(filter) {
  const box = $('#tree'); box.innerHTML = '';
  let n = 0, idx = 0;
  for (const [g, arr] of Object.entries(TREE)) {
    const hit = arr.filter((f) => !filter || f.name.toLowerCase().includes(filter));
    if (!hit.length) continue;
    // 第一个组（项目名）常看：不折叠；其他文件夹默认收起
    const collapsible = idx > 0;
    const open = !!filter || !collapsible;
    const h = document.createElement('div');
    h.className = 'g' + (collapsible ? ' fold' : '');
    h.innerHTML = (collapsible ? '<span class="ar">' + (open ? '▾' : '▸') + '</span>' : '') +
      '<span>' + g + '</span><span class="cnt">' + hit.length + '</span>';
    const body = document.createElement('div');
    body.style.display = open ? '' : 'none';
    if (collapsible) h.onclick = () => {
      const on = body.style.display === 'none';
      body.style.display = on ? '' : 'none';
      h.querySelector('.ar').textContent = on ? '▾' : '▸';
    };
    box.appendChild(h); box.appendChild(body); idx++;
    for (const f of hit) {
      FILES[f.name] = f.path; FILES[f.path] = f.path;
      const a = document.createElement('a');
      a.textContent = f.name; a.dataset.path = f.path; a.title = f.path;
      a.onclick = () => load(f.path, a);
      body.appendChild(a); n++;
    }
  }
  if (!n) box.innerHTML = '<div style="padding:16px;color:var(--dim);font-size:13px">无匹配</div>';
}

async function load(path, el) {
  document.querySelectorAll('#tree a.on').forEach((a) => a.classList.remove('on'));
  if (el) el.classList.add('on');
  const text = await (await fetch('/raw/' + path)).text();
  const main = $('#main');
  main.innerHTML = marked.parse(text);
  main.querySelectorAll('pre code').forEach((b) => { try { hljs.highlightElement(b); } catch {} });
  main.querySelectorAll('a.wl').forEach((a) => {
    a.onclick = () => {
      const s = a.dataset.slug;
      const p = FILES[s] || FILES[s.split('/').pop()];
      if (p) {
        const link = [...document.querySelectorAll('#tree a')].find((x) => x.dataset.path === p);
        load(p, link);
      } else { a.classList.add('miss'); a.title = '图谱里没有这一页'; }
    };
  });
  document.title = path.split('/').pop() + ' · brain';
  localStorage.setItem('brain-last', path);
  if (isMobile()) openNav(false);
  window.scrollTo(0, 0);
}

(async () => {
  const meta = await (await fetch('/files.json')).json();
  TREE = meta.groups || meta;
  document.querySelector('#hd .brand').textContent = (meta.rootLabel || 'BRAIN').toUpperCase();
  renderTree('');
  $('#q').oninput = (e) => renderTree(e.target.value.trim().toLowerCase());
  if (!isMobile()) {
    const last = localStorage.getItem('brain-last');
    const target = last && [...document.querySelectorAll('#tree a')].find((x) => x.dataset.path === last)
      ? last : Object.values(TREE)[0]?.[0]?.path;
    if (target) {
      const link = [...document.querySelectorAll('#tree a')].find((x) => x.dataset.path === target);
      load(target, link);
    }
  }
})();
</script></body></html>`;





/**
 * 起服务。
 * @param {{root:string, port?:number, host?:string}} cfg  root = .brain/ 绝对路径
 *   port = 0（默认）让系统挑空闲端口，多个项目可同时开。
 */
export async function serve({ root, port = 0, host = '127.0.0.1' }) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = req.url || '/';
      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        return res.end(PAGE);
      }
      if (url.startsWith('/files.json')) {
        const tree = await scanTree(root);
        // 把内部组 key 换成展示名，并按展示名重排。
        // 根组用项目目录名（.brain/ 的父目录）—— "根" 太泛，看不出是哪个项目。
        const { basename, dirname } = await import('node:path');
        const projName = basename(dirname(root)) || '项目';
        const out = {};
        for (const [k, arr] of Object.entries(tree)) out[displayGroup(k, projName)] = arr;
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        return res.end(JSON.stringify({ rootLabel: projName, groups: out }));
      }
      if (url.startsWith('/raw/')) {
        const abs = safeResolve(root, url.slice('/raw'.length));
        if (!abs) { res.writeHead(403); return res.end('forbidden'); }
        const body = await fs.readFile(abs).catch(() => null);
        if (body === null) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[extname(abs)] || MIME['.txt'] });
        return res.end(body);
      }
      res.writeHead(404);
      res.end('not found');
    } catch (e) {
      res.writeHead(500);
      res.end(String(e && e.message ? e.message : e));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actual = server.address().port;
  return { server, port: actual, url: `http://${host}:${actual}/` };
}
