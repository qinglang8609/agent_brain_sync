// code/lock.js — .brain markdown 并发写保护。
// 所有读-改-全写回 .md 的操作都经此串行化，避免跨进程(CLI/MCP/hook)丢失更新。
// 原语：同目录 <file>.lock 用 open('wx') 原子抢占；拿不到则带过期让步重试。
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, dirname, basename } from 'node:path';

/** 哨兵：mutator 返回它表示「无需写盘」；editFile 原样把它回传给调用方。 */
export const SKIP = Symbol('editFile.skip');

export class LockTimeout extends Error {}

/** 写入侧格式闸门（由 todo.js 注入，避免循环依赖）。
 * 对 .brain 的 index/todo/log 三个文件，写盘前统一过一遍格式校验。
 * 返回 null = 该文件不归闸门管；否则返回整理后的 text。 */
let formatGate = null;
export function setFormatGate(fn) { formatGate = fn; }

/** 懒加载闸门：**漏了 setFormatGate 就等于没闸门**，而注册是 import 副作用，
 *  谁少 import 一次 store.js 就静默裂开（2026-10-18 实测：只 import lock.js 时
 *  裸散文直接写进了 index.md）。故这里不信任外部注册，缺失时自己补上。
 *
 * 返回 null 表示「该文件不归闸门管」（非受管文件，或闸门自己说不管）—— 原样写盘。
 * 依赖：`store.js` 顶层无条件调 `setFormatGate`（见那里）。若那行被删，受管文件
 * 会退回静默直写 —— 这是已知的单点，防它靠 review 不靠代码（加守卫就是给不可能发生的
 * 情况多写 6 行，2026-10-18 审查定）。 */
async function gateFor() {
  if (!formatGate) await import('./store.js'); // 它的模块顶层会调 setFormatGate
  return formatGate;
}
const LOCK_WAIT_BASE_MS = 15;  // 指数退避起始重试间隔
const LOCK_WAIT_MAX_MS = 150;  // 指数退避上限
// 抢锁总预算：排队等锁的进程须依次排完。多进程高并发(CLI/MCP/hook 同刻抢一文件)下,
// 3s 会让后到进程在排队中途 LockTimeout 崩溃丢写入。设 30s 容纳大批排队者正常排完。
const LOCK_MAX_WAIT_MS = 30 * 1000;
// 兜底年龄：锁文件里没有有效 PID 时（旧版空锁 / PID 读不出），超过此年龄才当残留摘除。
// 有 PID 后不再按年龄摘活人的锁 —— mutator 跑慢一点也不能让两个进程同时进临界区。
const STALE_MS = 60 * 1000;

/** 进程还活着吗。true=活 / false=已死 / null=判不了（没写 PID、权限不够等）。 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH = 没这个进程；其它（权限等）当活着，宁可等也不误抢
    return e.code === 'ESRCH' ? false : true;
  }
}

async function acquireLock(lockPath) {
  const start = Date.now();
  let backoff = LOCK_WAIT_BASE_MS;
  let lockToken = '';
  for (;;) {
    let handle = null;
    try {
      handle = await fs.open(lockPath, 'wx'); // 原子创建(O_EXCL)；已存在则抛 EEXIST → 排队等
      // 写入「PID + 本进程唯一令牌」：
      //   · PID 让后来者判断持锁人是否已死（崩溃残留可立刻摘，不等 60s）
      //   · 令牌让**释放时能确认真是自己的锁** —— 旧实现无条件 rm，一旦有进程误判残留
      //     摘了别人的锁，原持有者释放时会把新持有者的锁删掉 → 两个写者同时进临界区 → 丢写。
      //     （2026-11-16 并发 task start 偶发丢一条，怀疑就是这一类。）
      lockToken = `${process.pid} ${randomUUID()}`;
      await handle.writeFile(lockToken, 'utf8').catch(() => {});
      await handle.close(); // 锁的存在即持有信号；无需保持 fd
      return lockToken;     // 交给调用方，释放时据此确认「是自己的锁」
    } catch (e) {
      if (handle) await handle.close().catch(() => {});
      if (e.code !== 'EEXIST') throw e;
      // 残留锁检测：优先看 PID（持锁进程已死 → 立刻摘，不等 60s）；
      // PID 读不出再退回按年龄（兼容旧版空锁文件）。
      // ★ 持锁进程还活着就绝不摘 —— 哪怕超过 STALE_MS。
      //   旧逻辑按 60s 硬摘，mutator 跑慢一点就让两个进程同时进临界区（2026-11-10 审查）。
      try {
        const raw = (await fs.readFile(lockPath, 'utf8')).trim().split(/\s+/)[0];
        const alive = pidAlive(Number(raw));
        if (alive === false) {
          await fs.rm(lockPath, { force: true });
          backoff = LOCK_WAIT_BASE_MS;
          continue;
        }
        if (alive === null) {
          const st = await fs.stat(lockPath);
          if (Date.now() - st.mtimeMs > STALE_MS) {
            await fs.rm(lockPath, { force: true });
            backoff = LOCK_WAIT_BASE_MS;
            continue;
          }
        }
      } catch { /* 读锁失败(刚被释放) → 下一轮重试 */ }
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

/** 只释放**自己**的锁：内容对不上说明锁已被别人接手，绝不能删。 */
async function releaseLock(lockPath, token) {
  if (!token) return;
  try {
    const cur = (await fs.readFile(lockPath, 'utf8')).trim();
    if (cur === token) await fs.rm(lockPath, { force: true });
  } catch { /* 锁已被移除或读不到 → 什么都不做 */ }
}

/** 串行读-改-写一个文件：锁内 readFile → mutator(currentText) → 写盘。
 * 文件不存在时 currentText 传 null。mutator 返回三种形态：
 *   - { text: <新内容> }          → 若非空且不同于当前则整体覆盖写盘（常用）
 *   - { text: <新内容>, ...meta } → 同上，把 meta 透传给调用方（结果回传用）
 *   - SKIP                       → 不写盘（幂等命中/未找到目标），返回 SKIP
 * 返回：写盘后=mutator 返回值；SKIP 时原样返回 SKIP。抛错则锁内不落盘、锁释放、上抛。 */
export async function editFile(file, mutator) {
  const lockPath = join(dirname(file), `.${basename(file)}.lock`);
  const lockToken = await acquireLock(lockPath);
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
      const gate = await gateFor();
      // prevForGate：muttor 显式声明「这份文本自身就是基线」（唯一用户：abs todo restore）。
      // 回捞的历史行是**存量**数据 —— 闸门该放行存量、只拒本次新引入的违规，
      // 否则 2026-09 的老结论（超过 400 字）会把整次回捞顶回去。
      const prevForGate = res && typeof res === 'object' && typeof res.prevForGate === 'string'
        ? res.prevForGate
        : current;
      if (gate) write = gate(file, write, prevForGate) ?? write;
    }
    if (write && write !== current) {
      // 原子落盘：先写同目录临时文件再 rename。
      // fs.writeFile 是「截断再写」，进程死在中间 = 图谱剩半截/空文件。
      // rename 在同一文件系统上是原子的 —— 读方要么见旧要么见新，不见半截。
      // tmp 名带随机段：同毫秒两个进程写同一文件也不会撞名（summon.js 同坑）。
      const tmp = join(dirname(file), `.${basename(file)}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      try {
        await fs.writeFile(tmp, write, 'utf8');
        await fs.rename(tmp, file);
      } catch (e) {
        await fs.rm(tmp, { force: true }).catch(() => {});
        throw e;
      }
    }
    return res;
  } finally {
    await releaseLock(lockPath, lockToken);
  }
}
