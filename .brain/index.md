# 🗂 图谱索引

本文件唯一入口。每新建/大改一个知识页，同步在此分类下加一行 `[[页面名]] — 一句话`。

## 当前路线 (Roadmap)
> D0-D4 已落地（hook→MCP→CLI + 四宿主安装器）。当前: D1 收尾（query/lint/幂等/归位）→ 多项目隔离实测（D2 验收）→ 端到端 hook（D3）。

## Concepts
- [[abs-install-layout]] — 全局安装形态: npm link 单一真源 + hook/MCP 烧绝对路径
- [[todo-rewrite-not-map]] — todo 行操作必须整文件重写保序，map 改不了分区结构
- [[hook-sh-not-bash]] — hook 脚本 shebang 与语法必须同方言（POSIX sh 无子串扩展）
- [[skill-rewrite-residual-old-methods]] — skill 以旧文档为基底重写时, 旧方法(bootstrap/.sh)残留成悬空引用; 须对照实际工具清单逐条核对
- [[file-write-locking]] — 并发写保护: 读改写才需 editFile 锁; append/原子写/单用户动作天然安全不妄加锁
- [[npm-publish-flow]] — npm 发布全流程: 2FA发布限制/scoped改名绕相似名/发布后registry读延迟/全局link清理/宿主install零宽字符坑
## Entities
- [[AgentBrainSync]] — 本项目实体页：三层架构、代码入口、开发命令
## Sources
- [[2026-09-08-hook-调-js-文件必须经-node-调起]] — hook 调 .js 文件必须经 node 调起(bin 无 exec 位), 
- [[2026-09-08-测试重启后经验暂存是否正常-test-重启]] — 测试重启后经验暂存是否正常 test,重启
- [[2026-09-08-测试-stop-hook-机械层触发通过-模拟]] — 测试 Stop hook 机械层触发通过: 模拟宿主事件 stdin → 落 ~
- [[2026-09-08-真实冒烟-cli-mcp-hook-三层全通过]] — 真实冒烟: CLI/MCP/hook 三层全通过(CLI沙盒项目全链路、MCP独
- [[2026-09-08-解决-abs-与-moshi-hook-共存]] — 解决 abs 与 moshi-hook 共存: installClaudeCod
- [[2026-09-08-abs-markdown并发写冲突-所有读-改]] — abs markdown并发写冲突: 所有读-改-全写回文件操作都应经共享edi
- [[2026-09-08-hooks-event-sh幂等mark文件用d]] — hooks/event.sh幂等mark文件用date分钟粒度写共享/tmp/a
- [[2026-09-08-hook测试脆弱点-event-sh-幂等-m]] — hook测试脆弱点: event.sh 幂等 mark 硬编码 /tmp/abs
- [[2026-09-08-并发写安全审计心法-别对-所有写入-一律加锁]] — 并发写安全审计心法: 别对'所有写入'一律加锁, 先按风险分类——①读改写(读旧
- [[2026-09-08-lock-js并发丢根因-非锁失效-临界区重叠]] — lock.js并发丢根因: 非锁失效(临界区重叠=0完美互斥), 而是 LOCK
- [[2026-09-09-方案-落定-跨会话任务只用-abs-task]] — 方案②落定: 跨会话任务只用 abs task(.brain/todo.md唯一
## Syntheses
## Sessions
- [[log-2026-09-08]] — 本轮开发全记录+测试清单（D1收尾→D2→D3→实时化→全局安装）
