// src/lock.js — .brain markdown 并发写保护。
// 所有读-改-全写回 .md 的操作都经此串行化，避免跨进程(CLI/MCP/hook)丢失更新。
// 原语：同目录 <file>.lock 用 open('wx') 原子抢占；拿不到则带过期让步重试。
import { promises as fs } from 'node:fs';
import { join, dirname, basename } from 'node:path';

/** 哨兵：mutator 返回它表示「无需写盘」；editFile 原样把它回传给调用方。 */
export const SKIP = Symbol('editFile.skip');

export class LockTimeout extends Error {}
const LOCK_WAIT_MS = 300; // 重试间隔
const LOCK_MAX_WAIT_MS = 3000; // 抢锁总预算
const STALE_MS = 10 * 1000; // 超过此年龄视为残留锁(崩溃进程没释放)，允许摘除

async function acquireLock(lockPath) {
  const start = Date.now();
  for (;;) {
    let handle = null;
    try {
      handle = await fs.open(lockPath, 'wx'); // 原子创建；已存在则抛 EEXIST
      await handle.close(); // 锁的存在即持有信号；无需保持 fd
      return;
    } catch (e) {
      if (handle) await handle.close().catch(() => {});
      if (e.code !== 'EEXIST') throw e;
      // 残留锁检测：文件太老则摘除重试（真实竞争者持有时间远小于阈值）
      try {
        const st = await fs.stat(lockPath);
        if (Date.now() - st.mtimeMs > STALE_MS) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch { /* stat 失败(被释放) → 下一轮重试 */ }
      if (Date.now() - start > LOCK_MAX_WAIT_MS) {
        throw new LockTimeout(`写锁超时(>${LOCK_MAX_WAIT_MS}ms): ${lockPath} 仍被占用`);
      }
      await new Promise((r) => setTimeout(r, LOCK_WAIT_MS + Math.floor(Math.random() * 50)));
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
export async function editFile(file, mutator, { maxWaitMs = LOCK_MAX_WAIT_MS } = {}) {
  const lockPath = join(dirname(file), `.${basename(file)}.lock`);
  await acquireLock(lockPath);
  try {
    let current = null;
    try { current = await fs.readFile(file, 'utf8'); } catch { /* 尚无文件 */ }
    const res = await mutator(current);
    if (res === SKIP) return SKIP;
    const write = typeof res === 'string' ? res : res && typeof res.text === 'string' ? res.text : null;
    if (write && write !== current) {
      await fs.writeFile(file, write, 'utf8');
    }
    return res;
  } finally {
    await releaseLock(lockPath);
  }
}
