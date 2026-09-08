---
tags: [source, abs, hook, 测试, 坑, 幂等]
updated: 2026-09-08
status: draft
---

# 来源：hook测试脆弱点: event.sh 幂等 mark 硬编码 /tmp/abs

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- hook测试脆弱点: event.sh 幂等 mark 硬编码 /tmp/abs-hook-<cksum>-<分钟>.mark, 测试与真实共用/tmp; 同payload同分钟残留mark会让hook幂等短路exit0不写日志→测试ENOENT。清理/tmp残留后恢复。根治方向: mark目录env可覆盖(ABS_MARK_DIR)让测试指沙盒隔离, 或测试beforeEach清/tmp

## 关联连接
（提炼成 concepts 规律页后，在此挂双链到该页）
