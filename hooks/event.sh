#!/bin/sh
# abs hook — 纯触发层。宿主生命周期事件 → 技术日志一行（~/.abs/log/hooks.log）。
# 纪律:
#   fire-and-forget: 绝不阻塞 agent 热路径; 失败留痕不中断;
#   事件只进技术日志, 不进图谱 log.md (log.md 是活动流水: 任务/沉淀, 不收琐碎请求);
#   不写 todo (todo 由 agent/用户经 MCP/CLI 主动登记)。
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
  FINGER=$(printf '%s' "$PAYLOAD" | cksum | cut -d' ' -f1)
  STAMP=$(date +%Y%m%d%H%M)
  MARK="/tmp/abs-hook-${FINGER}-${STAMP}.mark"
  [ -e "$MARK" ] && exit 0
  : > "$MARK" 2>/dev/null

  # 定位项目由 CLI 完成 (向上找 .brain/, 代码写死); 找不到图谱则静默放弃。
  # 纪律: hook 事件只进技术日志 (~/.abs/log/), 不进图谱 log.md (那是活动流水, 不收琐碎请求)。
  # 用 awk 截前 120 字符 (#/bin/sh 兼容: 无 ${var:0:n} bash 扩展)。
  # 经 node 调起 (bin 文件可能无 exec 位); 失败留痕到 /tmp 便于排查 (不静默到底)。
  SHORT=$(printf '%s' "$PAYLOAD" | awk '{print substr($0, 1, 120)}')
  LOG_DIR="${ABS_LOG_DIR:-$HOME/.abs/log}"
  mkdir -p "$LOG_DIR" 2>/dev/null
  {
    printf '[%s] %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$EVENT" "$SHORT"
  } >> "$LOG_DIR/hooks.log" 2>/dev/null || true
) &

# Claude Code 等宿主要求 stdout 以 { 开头才不告警。
printf '{}\n'
exit 0
