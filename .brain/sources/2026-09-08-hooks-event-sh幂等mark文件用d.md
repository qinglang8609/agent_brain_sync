---
tags: [source, testing, gotcha]
updated: 2026-09-08
status: draft
---

# 来源：hooks/event.sh幂等mark文件用date分钟粒度写共享/tmp/a

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- hooks/event.sh幂等mark文件用date分钟粒度写共享/tmp/abs-hook-*.mark, 跨测试运行同分钟同payload会撞车致skip写入, 测试偶发ENOENT。修法: 沙盒隔离mark路径或清/tmp残留再跑。

## 关联连接
（提炼成 concepts 规律页后，在此挂双链到该页）
