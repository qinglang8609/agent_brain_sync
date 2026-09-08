# 📋 Todo 看板
## Backlog
## Today / In Progress
- [ ] 制作为产品模式，打包成可执行文件安装到系统内，给我一个安装步骤 类似 npm install xxx -g (认领 2026-09-08)
- [ ] 更新readme.md (认领 2026-09-08)
- [ ] TASK-DEEP-TEST — 深度测试四层CLI/install/MCP/hook, 产出可回归单测+真实冒烟 (认领 2026-09-08)
  ↳ 断点: 四层真实冒烟全部完成: CLI/MCP/hook 真机通过; install 层 moshi-hook 共存冲突已解决(INSTALL-COEXIST done, 真实settings 4事件 moshi+abs 共存, 备份~/.claude/settings.json.abs-bak-20260908-232634)。剩收尾: 提炼 concept + 全量测试确认 + 归位
## Blocked
## Done（只留近期，旧的迁 log.md/快照）
- [x] 本轮反馈处理: log.md只记工作沉淀(去task自动刷+重写) + 时间戳本地化 + codebuddy todo迁移B4 + cmdShow走readTodo触发迁移 (完成 2026-09-08)
- [x] TASK-01 — 修 .gitignore 缺 node_modules（提交前必须）  (完成 2026-09-08)
- [x] TASK-ABS-PI-TEST — 测试 pi opencode 的 abs 功能是否正常、触发是否稳定（MCP 调用链、触发时机）  (完成 2026-09-08)
  ↳ 断点: 全项目写文件审计完成(不止.brain): 分类=①读改写丢失更新(.brain todo/index/log全锁了; install.js的settings/hooks.json readJson→atomicWrite, atomic保证无半写, 且install是离散单用户动作不加锁) ②append日志(hooks.log/wrapup.log/mcp.log)多宿主并发, 实测短行O_APPEND单write原子不撕裂≤200字符行 ③新文件原子写(tmp+rename源页/install全部atomicWrite) ④init/repair仅建缺失文件由requireBrain门控安全。结论:唯一丢失更新类已全锁; append与原子写天然安全不需锁(锁反而拖慢fire-forget热路径)
- [x] INSTALL-COEXIST — installClaudeCode 覆盖式写 settings.hooks[ev] 会顶掉同事件的 moshi-hook 等其它 hook; 改成分区合并追加(去掉旧abs条目幂等 + push新条目, 保留moshi), 沙盒验证后备份应用真实配置  (完成 2026-09-08)
  ↳ 断点: install.js 共存改造完成+4新测试(12/12绿): installClaudeCode 覆盖式→分区合并追加(entryHasAbs去重幂等,保留moshi), uninstallClaudeCode 整删→只删abs条目。剩: 待claude-code-guide确认多hook条目并存官方支持后, 备份并应用真实~/.claude/settings.json
- [x] 每轮结束收尾自动化: Stop hook 读todo→判未登记完成→沉淀经验→更新 index/log/todo  (完成 2026-09-08)
  ↳ 断点: 本会话测试: Stop hook 机械层触发验证通过(hooks.log落痕/stdout {} 合法/非阻塞/60s幂等); v2 skill(收尾循环节)已同步装到 ~/.claude/skills/abs-agent-brain-sync; 收尾循环走通(对账/落log); 剩 agent 收尾循环的自动化触发 + TASK-DEEP-TEST
- [x] TASK-SKILL-V2: 以原版完整SKILL为骨架+新增「每轮结束收尾循环」节, 整合abs工具命令, 重写skill/SKILL.md并重装  (完成 2026-09-08)
  ↳ 断点: skill已重写(174行)含图谱定位节/收尾循环, 清了bootstrap等旧方法, 手工/工具边界说清; 剩装到~/.claude/skills + 删旧agent_brain_sync
- [x] TASK-BP-BUG — task note 在目标任务不存在/已完成时, 断点错挂到同区第一条任务下; 应找不到即报错不落盘  (完成 2026-09-08)
- [x] TASK-LINT-SOURCE — abs note 产出的 source 暂存页被判 ORPHAN: lint 应对 sources/ 豁免孤立检查(暂存页天然无链接, 提炼后才挂链)  (完成 2026-09-08)
- [x] TASK-FIX — 测试反馈: hook请求流水移出log.md→技术日志; MCP请求跟踪日志; todo格式归一; task操作自动记log  (完成 2026-09-08)
- [x] TEST-RT — 更新后的note  (完成 2026-09-08)
- [x] TASK-02 — 实现 abs query + abs lint（PLAN D1 验收缺项）  (完成 2026-09-08)
- [x] TASK-03 — task start 幂等（同 id 不重复写行）  (完成 2026-09-08)
- [x] TASK-04 — event.sh shebang #!/bin/sh 但用 bash 语法 ${PAYLOAD:0:120}，dash 下静默失败  (完成 2026-09-08)
- [x] TASK-05 — second  (完成 2026-09-08)
- [x] TASK-D2 — 多项目隔离实测: 两个项目各自 CLI/MCP 读写不串 (PLAN D2 验收)  (完成 2026-09-08)
- [x] TASK-D3 — CC hook端到端: 装机已完(settings.json 4事件+MCP+skill), 验证 hook→log 落盘  (完成 2026-09-08)
- [x] TASK-RT — 实时化: task blocked/note 断点命令 + abs note 经验暂存通道(CLI+MCP+测试)  (完成 2026-09-08)
- [x] TASK-SKILL — 补分工节: hook机械记log + task/note实时落盘 + skill自觉深提炼; 两份SKILL.md同步  (完成 2026-09-08)
- [x] TASK-LOG — 写详细操作日志到 .brain/sessions/ 供用户测试追溯  (完成 2026-09-08)
- [x] TASK-GLOBAL — npm link 全局命令 + 安装形态概念页  (完成 2026-09-08)
- [x] TASK-CLI — board→todo改名 + index/log 查看命令 (log无参看带参写)  (完成 2026-09-08)
- [x] TASK-COMMIT — 整批变更提交 git (分 conventional commits)  (完成 2026-09-08)
