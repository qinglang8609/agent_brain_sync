#!/bin/sh
# abs hook — 纯触发层。宿主生命周期事件 → 机械落盘一行 log（经 abs CLI）。
# 纪律（抄 ai-memory）:
#   fire-and-forget: 绝不阻塞 agent 热路径; 任何失败静默退出;
#   不写 todo (todo 由 agent/用户经 MCP/CLI 主动登记), 只写 log 流水。
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
  # 用 awk 截前 120 字符 (#/bin/sh 兼容: 无 ${var:0:n} bash 扩展)。
  # 经 node 调起 (bin 文件可能无 exec 位); 失败留痕到 /tmp 便于排查 (不静默到底)。
  SHORT=$(printf '%s' "$PAYLOAD" | awk '{print substr($0, 1, 120)}')
  "$NODE_BIN" "$ABS_BIN" log "[$EVENT] $SHORT" 2>>/tmp/abs-hook-err.log || true
) &

# Claude Code 等宿主要求 stdout 以 { 开头才不告警。
printf '{}\n'
exit 0
