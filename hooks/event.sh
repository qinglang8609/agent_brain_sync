#!/bin/sh
# abs hook — 纯触发层。宿主生命周期事件 → 技术日志一行（~/.abs/log/hooks.log）。
# 纪律:
#   fire-and-forget: 绝不阻塞 agent 热路径; 失败留痕不中断;
#   事件只进技术日志, 不进图谱 log.md (log.md 是活动流水: 任务/沉淀, 不收琐碎请求);
#   不写 todo (todo 由 agent/用户经 MCP/CLI 主动登记)。
#   Stop 额外在 wrapup.log 留一行「疑似未收尾」提醒(低噪声、独立文件)——仍只进技术日志,
#   不碰图谱; 由 agent/用户下会话自觉跑收尾循环, hook 不替 agent 判断什么该沉淀。
# 用法: 由宿主 hook 配置以 stdin JSON 调起; __ABS_BIN__ 安装时替换为 abs CLI 绝对路径,
# __NODE_BIN__ 替换为 node 绝对路径 (经 node 调起, 不依赖 exec 位)。
set +e
ABS_BIN="__ABS_BIN__"
NODE_BIN="__NODE_BIN__"
EVENT="__EVENT__"

PAYLOAD=$(cat 2>/dev/null | head -c 500)

# ── Stop 收尾注入 (CC/Co​dex 的"主动推") ─────────────────────────────────
# 守卫同 pi 插件四条件: ①本会话真改过文件 ②本项目有 .brain ③log.md 今日无条目 ④每会话一次。
# 判定在 CLI 里做(cmdTeardownCheck)，这里只解析结果。
# 关键: 回宿主的 decision:block 必须走 stdout 同步输出，所以判定要在前台算完，不能放后台子 shell。
BAIL='{}'
if [ "$EVENT" = "Stop" ]; then
  TEARDOWN=$("$NODE_BIN" "$ABS_BIN" teardown-check --payload "$PAYLOAD" 2>/dev/null)
  case "$TEARDOWN" in
    push:*) BAIL=$(printf '%s' "$TEARDOWN" | sed 's/^push://') ;;
  esac
fi

# 后台执行，hook 立即返回——宿主热路径零阻塞。
(
  # 幂等: 同一 payload 指纹在 60s 内只落一行 (防重复触发)。
  # mark 目录可经 ABS_MARK_DIR 覆盖(默认 /tmp)——测试注入沙盒目录隔离, 避免与真实/并发残留互扰。
  #
  # 坑（2026-09-17 实测定根因）：原实现把 mark 名钉在 STAMP=$(date +%Y%m%d%H%M)（分钟级）上，
  # 而文档/测试约定的是【60s 窗口】。两者不等价：两次调用只要**跨过分钟边界**，
  # STAMP 不同 → mark 路径不同 → [ -e ] 不命中 → 各写一行，实际窗口最坏缩到 1 秒。
  # 实测复现（同 payload、STAMP 从 2359 跳到 0000）→ 落 2 行，违反 60s 承诺。
  # 也是 test/hook.test.js「同一 payload 60s 内幂等」偶发失败的真因（不是测试写得不好）。
  #
  # 修法：mark 名**只含指纹**（与时间无关），幂等判据改看**写在 mark 里的时间戳**。
  # 为何不靠 find -newermt：BSD find(macOS) 不认 `@epoch` 格式（实测报
  #   `Can't parse date/time: @1789619554`）→ 守卫恒不命中 → 幂等彻底失效。
  # 也不用 -mmin：只能到分钟级，正是原 bug 的同类误差。
  # 把时间戳写进文件、用 shell 纯数字比 —— 不依赖任何平台工具的日期解析。
  FINGER=$(printf '%s' "$PAYLOAD" | cksum | cut -d' ' -f1)
  MARK_DIR="${ABS_MARK_DIR:-/tmp}"
  mkdir -p "$MARK_DIR" 2>/dev/null
  MARK="$MARK_DIR/abs-hook-${FINGER}.mark"
  NOW=$(date +%s)
  PREV=$(cat "$MARK" 2>/dev/null)
  case "$PREV" in ''|*[!0-9]*) PREV=0 ;; esac
  # 60s 内已记过 → 幂等退出。窗口是真 60 秒，与分钟边界无关。
  [ "$PREV" -gt 0 ] && [ "$((NOW - PREV))" -lt 60 ] && exit 0
  printf '%s\n' "$NOW" > "$MARK" 2>/dev/null
  # 清理: 只删**超龄**(>60s)的 mark。
  # 不按分钟批量删 —— 那会在跨分钟时误删刚写的 mark（旧 bug 的帮凶）。
  for old in "$MARK_DIR"/abs-hook-*.mark; do
    [ -e "$old" ] || continue
    [ "$old" = "$MARK" ] && continue
    OV=$(cat "$old" 2>/dev/null)
    case "$OV" in ''|*[!0-9]*) OV=0 ;; esac
    [ "$OV" -gt 0 ] && [ "$((NOW - OV))" -lt 60 ] && continue
    rm -f "$old" 2>/dev/null
  done

  # 定位项目由 CLI 完成 (向上找 .brain/, 代码写死); 找不到图谱则静默放弃。
  # 纪律: hook 事件只进技术日志 (~/.abs/log/), 不进图谱 log.md (那是活动流水, 不收琐碎请求)。
  # 用 awk 截前 120 字符 (#/bin/sh 兼容: 无 ${var:0:n} bash 扩展)。
  # 经 node 调起 (bin 文件可能无 exec 位); 失败留痕到 /tmp 便于排查 (不静默到底)。
  SHORT=$(printf '%s' "$PAYLOAD" | awk '{print substr($0, 1, 120)}')
  # 取 session_id 供 wrapup 提醒标注 (payload 截 500 内、id 靠前; 取不到则留空不中断)。
  SESSION_ID=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"session_id":"\([^"]*\)".*/\1/p' | head -1)
  LOG_DIR="${ABS_LOG_DIR:-$HOME/.abs/log}"
  mkdir -p "$LOG_DIR" 2>/dev/null

  # 日志轮转: hooks.log 是 append-only 热路径, 无上限会无限长。
  # 用 wc -c 判大小(/bin/sh 无 GNU stat -c); 超限就轮转一份 .1 并截断。
  # 阈值可经 ABS_LOG_MAX_BYTES 覆盖; 只要一份历史(.1), 不做多层——排查靠近期痕迹, 旧的不值当留。
  ABS_LOG_MAX="${ABS_LOG_MAX_BYTES:-1048576}"   # 1 MiB
  LOGF="$LOG_DIR/hooks.log"
  if [ -f "$LOGF" ]; then
    SZ=$(wc -c < "$LOGF" 2>/dev/null | tr -d ' ')
    case "$SZ" in ''|*[!0-9]*) SZ=0 ;; esac
    if [ "$SZ" -gt "$ABS_LOG_MAX" ] 2>/dev/null; then
      mv -f "$LOGF" "$LOGF.1" 2>/dev/null || : > "$LOGF"
      printf '[%s] logrotate hooks.log (%s bytes -> .1)\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$SZ" >> "$LOGF" 2>/dev/null || true
    fi
  fi
  {
    printf '[%s] %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$EVENT" "$SHORT"
  } >> "$LOG_DIR/hooks.log" 2>/dev/null || true

  case "$BAIL" in
    '{}') ;;
    *) printf '[%s] %s teardown-nudge 注入收尾指令\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$EVENT" >> "$LOG_DIR/hooks.log" 2>/dev/null || true ;;
  esac

  # Stop 专用: 低噪声 wrap-up 提醒 (独立文件, 不进 per-event hooks.log, 不碰图谱 todo/log.md)。
  # 纯机械信号——"一个会话结束了"; 是否真有滞留任务/经验由 agent 自觉判断, hook 不替做。
  if [ "$EVENT" = "Stop" ]; then
    {
      printf '[%s] wrapup-remind 会话已结束(%s): 若 Today 有滞留任务或经验未沉淀, 下会话开头走收尾循环\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" "$SESSION_ID"
    } >> "$LOG_DIR/wrapup.log" 2>/dev/null || true
    # 机械快照滞留清单: abs wrapup 把当前项目未完成任务+断点追加到 wrapup.log (跨会话收尾保险)。
    # abs wrapup 已自行写 wrapup.log (honor ABS_LOG_DIR); 这里 stdout 只进 hooks.log 作痕迹, 避免污染 wrapup.log。
    "$NODE_BIN" "$ABS_BIN" wrapup >>"$LOG_DIR/hooks.log" 2>/dev/null || true
  fi
) &

# Claude Code 等宿主要求 stdout 以 { 开头才不告警。
printf '%s\n' "$BAIL"
exit 0
