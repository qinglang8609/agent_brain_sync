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

# 后台执行，hook 立即返回——宿主热路径零阻塞。
(
  # 幂等: 同一 payload 指纹在 60s 内只落一行 (防重复触发)。
  # mark 目录可经 ABS_MARK_DIR 覆盖(默认 /tmp)——测试注入沙盒目录隔离, 避免与真实/并发残留互扰。
  FINGER=$(printf '%s' "$PAYLOAD" | cksum | cut -d' ' -f1)
  STAMP=$(date +%Y%m%d%H%M)
  MARK_DIR="${ABS_MARK_DIR:-/tmp}"
  mkdir -p "$MARK_DIR" 2>/dev/null
  MARK="$MARK_DIR/abs-hook-${FINGER}-${STAMP}.mark"
  [ -e "$MARK" ] && exit 0
  : > "$MARK" 2>/dev/null

  # 定位项目由 CLI 完成 (向上找 .brain/, 代码写死); 找不到图谱则静默放弃。
  # 纪律: hook 事件只进技术日志 (~/.abs/log/), 不进图谱 log.md (那是活动流水, 不收琐碎请求)。
  # 用 awk 截前 120 字符 (#/bin/sh 兼容: 无 ${var:0:n} bash 扩展)。
  # 经 node 调起 (bin 文件可能无 exec 位); 失败留痕到 /tmp 便于排查 (不静默到底)。
  SHORT=$(printf '%s' "$PAYLOAD" | awk '{print substr($0, 1, 120)}')
  # 取 session_id 供 wrapup 提醒标注 (payload 截 500 内、id 靠前; 取不到则留空不中断)。
  SESSION_ID=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"session_id":"\([^"]*\)".*/\1/p' | head -1)
  LOG_DIR="${ABS_LOG_DIR:-$HOME/.abs/log}"
  mkdir -p "$LOG_DIR" 2>/dev/null
  {
    printf '[%s] %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$EVENT" "$SHORT"
  } >> "$LOG_DIR/hooks.log" 2>/dev/null || true

  # Stop 专用: 低噪声 wrap-up 提醒 (独立文件, 不进 per-event hooks.log, 不碰图谱 todo/log.md)。
  # 纯机械信号——"一个会话结束了"; 是否真有滞留任务/经验由 agent 自觉判断, hook 不替做。
  if [ "$EVENT" = "Stop" ]; then
    {
      printf '[%s] wrapup-remind 会话已结束(%s): 若 Today 有滞留任务或经验未沉淀, 下会话开头走收尾循环\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" "$SESSION_ID"
    } >> "$LOG_DIR/wrapup.log" 2>/dev/null || true
  fi
) &

# Claude Code 等宿主要求 stdout 以 { 开头才不告警。
printf '{}\n'
exit 0
