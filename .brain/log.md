# 🗒 操作日志
## [2026-09-08 23:33] note | 并发写安全审计心法: 别对'所有写入'一律加锁, 先按风险分类——①读改写(读旧覆盖别人新行)才需锁; ②append日
## [2026-09-08 23:31] note | hook测试脆弱点: event.sh 幂等 mark 硬编码 /tmp/abs-hook-<cksum>-<分钟>.m
## [2026-09-08 23:29] note | hooks/event.sh幂等mark文件用date分钟粒度写共享/tmp/abs-hook-*.mark, 跨测试运
## [2026-09-08 23:28] note | abs markdown并发写冲突: 所有读-改-全写回文件操作都应经共享editFile锁(open wx原子锁文件+
## [2026-09-08 23:27] dev | TASK-DEEP-TEST 真实冒烟 + INSTALL-COEXIST: CLI/MCP/hook 三层真机通过; install.js 覆盖式改共存合并(追加保留moshi), 4新测试12/1
## [2026-09-08 23:27] note | 解决 abs 与 moshi-hook 共存: installClaudeCode 从覆盖式 settings.hook
## [2026-09-08 23:14] note | 真实冒烟: CLI/MCP/hook 三层全通过(CLI沙盒项目全链路、MCP独立进程9/9、真实abs-Stop.sh
## [2026-09-08 23:09] dev | [pi:session_start]
## [2026-09-08 22:58] dev | 收尾提醒(不越界)落地: Stop hook 在 ~/.abs/log/wrapup.log 留一行 wrapup-remind(session_id); 非 Stop 事件不写; 已重装 4 hoo
## [2026-09-08 22:40] dev | 收尾自动化测试: Stop hook 机械层触发验证通过(hooks.log 落痕/stdout {} /幂等); skill/SKILL.md v2(185行) 同步装到 ~/.claude/ski
## [2026-09-08 22:33] note | 测试 Stop hook 机械层触发通过: 模拟宿主事件 stdin → 落 ~/.abs/log/hooks.log 
## [2026-09-08 22:25] dev | 整合版 skill 重写完成(174行): 以原版为骨架+图谱定位节+每轮结束收尾循环, 清 bootstrap/.sh 旧方法, 分工具/手工边界; 沉淀 concept skill-rewrite-residual-old-methods
## [2026-09-08 22:20] note | skill 重写陷阱: 以旧文档为主时, 旧方法引用(bootstrap.sh/.sh/手工建图)会残留成悬空引用; 必
## [2026-09-08 21:40] dev | 修 log.md 定位: 只记工作成果沉淀, 去掉 task 过程自动刷; 时间戳改本地(原 UTC 差8h)
## [2026-09-08 21:30] dev | 修 done 归位断点残留 bug(markDone trimStart), 50测试绿
## [2026-09-08 21:20] dev | lint 对 sources/ 豁免孤立页检查(abs note 暂存页不再误报 ORPHAN)
## [2026-09-08 20:30] dev | 目录重构: abs/* 上移仓库根做根 npm 包, install.js ABS_DIR 自动适配, 47测试绿
## [2026-09-08 12:24] dev | 整批变更已提交 5 commits (gitignore/PLAN/abs核心/SKILL/brain)
## [2026-09-08 11:15] dev | 补分工节: hook机械记log + task/note实时落盘 + skill自觉深提炼; 37测试绿
## [2026-09-08 10:45] dev | 全局安装 npm link + hook 经 node 调起修复(不依赖 exec 位)
## [2026-09-08 10:00] dev | D1补全: query/lint CLI+MCP, task幂等, done归位Done, hook sh兼容, 29测试绿
