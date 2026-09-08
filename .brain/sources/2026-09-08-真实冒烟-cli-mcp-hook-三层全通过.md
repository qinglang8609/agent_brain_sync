---
tags: [source, abs, 冒烟, 真实环境, 坑]
updated: 2026-09-08
status: draft
---

# 来源：真实冒烟: CLI/MCP/hook 三层全通过(CLI沙盒项目全链路、MCP独

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- 真实冒烟: CLI/MCP/hook 三层全通过(CLI沙盒项目全链路、MCP独立进程9/9、真实abs-Stop.sh Stop写wrapup+非Stop不写)。install层真实冲突: ~/.claude/settings.json 4个事件hooks被 moshi-hook(~/.local/bin/moshi-hook, Go二进制)接管, abs脚本stage在~/.abs/hooks/claude-code但未注册进settings.json——abs真机hook未生效,被moshi-hook顶掉

## 关联连接
（提炼成 concepts 规律页后，在此挂双链到该页）
