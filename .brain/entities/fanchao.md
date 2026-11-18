---
tags: [entity, person]
author: fanchao
updated: 2026-11-18
status: active
---

# fanchao

本图谱的使用者/作者。`todo.md` / `log.md` 里的 `[[fanchao]]` 标记都指向本页。

## 技术栈
- 主力: TypeScript / Node（ESM，`node:test`，零外部依赖偏好）
- 工具链: MCP 协议、pi 扩展与 TUI 渲染（`@earendil-works/pi-tui`）、各宿主 hook；常用终端含 Herdr（转轮字形、滚轮事件那类差异都从它身上暴露）
- 存储: markdown 图谱（Obsidian 风格 wiki 双链），倾向"文本可读 + 可 diff"而非数据库
- 发布: npm（scoped 包 + 代理环境）+ GitHub；包发布流程见 [[publish-pi-package-to-npm]]

## 特点 / 工作习惯
- **先要方案后动手**：报 bug 或提需求时希望先看到「问题复述 / 根因 / 改哪些文件 / 怎么验证」，确认后才改代码（已固化成 skill 的「新需求受理协议」）。
- **质疑需求本身**：会问"这个能不能不做"，反对为未来可能性预留抽象。
- **要求区分"想过"与"做完了"**：Done 条目必须带结语（落地/否决/仅方案），否则下一个会话会把没做的当成做完了。
- **不信未验证的结论**：反复强调"证据到手前不给结论"，反对只测恒真式的假验证。
- **在意静默失败**：对"装上了≠加载了≠触发了"这类无症状故障格外警惕，要求可观测性留痕。
- **实时落盘**：会话中就要求把经验/断点写进图谱，不攒到最后。
- **性能先压测**：不按体感猜瓶颈（fullscreen 卡顿那轮先铺 2000 个胶囊量帧耗时）。
- **归因到真凶**：不接受「按目录猜」「按经验大概是」。

## 名下踩过的坑
- [[summary-truncation-hidden-cause]] — 散文截断是"摘要读起来抽象"的隐形根因
- [[silent-data-loss-diagnosis]] — 静默丢数据的排查顺序
- [[symbol-reference-needs-real-run]] — 判"等价"只测恒真式不算验证
- [[pi-tool-renderer-override]] — 接管 pi 内置工具渲染
- [[pi-tool-renderer-animation]] — 转轮定时器雪球、lastComponent 按行分开
- [[tui-line-width-limit]] — 行超宽抛异常、截断打掉背景色
- [[pi-call-result-double-row]] — call/result 各画一次导致重复
- [[test-handmade-data-hides-key-mismatch]] — 手造测试数据一起猜错键名
- [[publish-pi-package-to-npm]] — 发 npm 包、2FA staged publishing
- [[git-proxy-troubleshooting]] — git push 走代理失败的三种情形
- [[installed-pi-package-check]] — 已装版体检、node 24 类型剥离限制
- [[tui-spinner-glyph-compat]] — 盲文转轮字体兼容、fullscreen 卡顿排查
- [[capsule-hot-path-perf]] — 胶囊热路径性能（firstLine / diff / 展开复用）

## 关联连接
- [[AgentBrainSync]] — 本图谱对应的项目
- [[todo]] — 作者标记出现在看板行
- [[log]] — 作者标记出现在流水行
