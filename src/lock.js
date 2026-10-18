// src/lock.js — .brain markdown 并发写保护。
// 所有读-改-全写回 .md 的操作都经此串行化，避免跨进程(CLI/MCP/hook)丢失更新。
// 原语：同目录 <file>.lock 用 open('wx') 原子抢占；拿不到则带过期让步重试。
import { promises as fs } from 'node:fs';
import { join, dirname, basename } from 'node:path';

/** 哨兵：mutator 返回它表示「无需写盘」；editFile 原样把它回传给调用方。 */
export const SKIP = Symbol('editFile.skip');

export class LockTimeout extends Error {}

/** 写入侧格式闸门（由 todo.js 注入，避免循环依赖）。
 * 对 .brain 的 index/todo/log 三个文件，写盘前统一过一遍格式校验。
 * 返回 null = 该文件不归闸门管；否则返回整理后的 text。 */
let formatGate = null;
export function setFormatGate(fn) { formatGate = fn; }

/** 三个受管文件名 —— 它们存在就是为了当“数据库表”，格式必须恒定。 */
const MANAGED = new Set(['index.md', 'log.md', 'todo.md']);

/** 懒加载闸门：**漏了 setFormatGate 就等于没闸门**，而注册是 import 副作用，
 *  谁少 import 一次 store.js 就静默裂开（2026-10-18 实测：只 import lock.js 时
 *  裸散文直接写进了 index.md）。故这里不信任外部注册，缺失时自己补上。
 *
 * 补不上（= store.js 没调 setFormatGate）就对受管文件硬拒：宁可写失败也不要格崩坏
 * ——写不进去能重试，写脏了没人知道。 */
async function gateFor(file) {
  if (!formatGate) await import('./store.js'); // 它的模块顶层会调 setFormatGate
  if (formatGate) return formatGate;
  if (MANAGED.has(basename(file))) {
    throw new Error(`✗ ${basename(file)} 是受管文件，但格式闸门未注册 —— 拒绝写入（防止格崩坏）`);
  }
  return null;
}
const LOCK_WAIT_BASE_MS = 15;  // 指数退避起始重试间隔
const LOCK_WAIT_MAX_MS = 150;  // 指数退避上限
// 抢锁总预算：排队等锁的进程须依次排完。多进程高并发(CLI/MCP/hook 同刻抢一文件)下,
// 3s 会让后到进程在排队中途 LockTimeout 崩溃丢写入。设 30s 容纳大批排队者正常排完。
const LOCK_MAX_WAIT_MS = 30 * 1000;
// 超过此年龄视为残留锁(持锁进程崩溃没释放)，允许摘除。须 > LOCK_MAX_WAIT_MS，
// 否则持锁进程在排队预算内会被误当残留摘除导致临界区重叠。
const STALE_MS = 60 * 1000;

async function acquireLock(lockPath) {
  const start = Date.now();
  let backoff = LOCK_WAIT_BASE_MS;
  for (;;) {
    let handle = null;
    try {
      handle = await fs.open(lockPath, 'wx'); // 原子创建(O_EXCL)；已存在则抛 EEXIST → 排队等
      await handle.close(); // 锁的存在即持有信号；无需保持 fd
      return;
    } catch (e) {
      if (handle) await handle.close().catch(() => {});
      if (e.code !== 'EEXIST') throw e;
      // 残留锁检测：锁太老(持锁进程崩溃没释放)则摘除重试；正常排队者持锁时间远小于阈值
      try {
        const st = await fs.stat(lockPath);
        if (Date.now() - st.mtimeMs > STALE_MS) {
          await fs.rm(lockPath, { force: true });
          backoff = LOCK_WAIT_BASE_MS; // 摘除残留后重置退避
          continue;
        }
      } catch { /* stat 失败(锁刚被释放) → 下一轮重试 */ }
      if (Date.now() - start > LOCK_MAX_WAIT_MS) {
        throw new LockTimeout(`写锁排队超时(等 ${Date.now() - start}ms > 预算 ${LOCK_MAX_WAIT_MS}ms): ${lockPath} 仍被占用`);
      }
      // 指数退避等待：让排队者按先后逐步拿到锁(依次排队)。固定 300ms 粗间隔会让
      // 高并发下后到进程累积等待过久、在预算内排不完而饿死。
      await new Promise((r) => setTimeout(r, backoff + Math.floor(Math.random() * backoff)));
      backoff = Math.min(backoff * 2, LOCK_WAIT_MAX_MS);
    }
  }
}

async function releaseLock(lockPath) {
  await fs.rm(lockPath, { force: true }).catch(() => {});
}

/** 串行读-改-写一个文件：锁内 readFile → mutator(currentText) → 写盘。
 * 文件不存在时 currentText 传 null。mutator 返回三种形态：
 *   - { text: <新内容> }          → 若非空且不同于当前则整体覆盖写盘（常用）
 *   - { text: <新内容>, ...meta } → 同上，把 meta 透传给调用方（结果回传用）
 *   - SKIP                       → 不写盘（幂等命中/未找到目标），返回 SKIP
 * 返回：写盘后=mutator 返回值；SKIP 时原样返回 SKIP。抛错则锁内不落盘、锁释放、上抛。 */
export async function editFile(file, mutator) {
  const lockPath = join(dirname(file), `.${basename(file)}.lock`);
  await acquireLock(lockPath);
  try {
    let current = null;
    try { current = await fs.readFile(file, 'utf8'); } catch { /* 尚无文件 */ }
    const res = await mutator(current);
    if (res === SKIP) return SKIP;
    let write = typeof res === 'string' ? res : res && typeof res.text === 'string' ? res.text : null;
    // 格式闸门：所有写 index/todo/log 的路径（CLI/MCP/hook 共 ~15 处）都在此收口，
    // 不必逐个改调用点 —— 破坏格式的写入在这里被整理回标准形态（见 todo.js）。
    //
    // ★ 对三个受管文件，闸门**必须存在**：它们不是自由文本，是数据库表。
    //   闸门缺失时以前会静默跳过（直写盘），现在改为自己补加载；补不上就硬拒，
    //   宁可写失败也不要格崩坏——写不进去能重试，写脏了没人知道。
    if (write) {
      const gate = await gateFor(file);
      if (gate) write = gate(file, write, current) ?? write;
    }
    if (write && write !== current) {
      await fs.writeFile(file, write, 'utf8');
    }
    return res;
  } finally {
    await releaseLock(lockPath);
  }
}
