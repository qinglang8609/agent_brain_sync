---
tags: [source, opencode, probe, 插件, 污染, 清理]
updated: 2026-09-10
status: draft
---

# 来源：实验中发现: ~/.config/opencode/plugins/probe-

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- 实验中发现: ~/.config/opencode/plugins/probe-oc.ts (上个会话留的探针, session.idle → promptAsync 注入 "[probe] injected by plugin") 会在真实会话每次 idle 时注入一条消息, 污染真机验证. 观察时该文件已从磁盘删除(13:28建, 后被清理), 但正在运行的 server 内存里仍加载着并继续注入(直到 server 重启). 教训: 插件文件删了≠生效; 已 load 的插件要重启 server 才失效. 排查真机注入异常时先确认 plugins/ 目录干净 + server 是重启后状态. 已 kill 所有实验 server(4599/4600), 现无 opencode serve 运行.

## 关联连接
（提炼成 concepts 规律页后，在此挂双链到该页）
