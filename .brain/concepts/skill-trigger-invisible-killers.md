---
tags: [concept, skill, 触发, symlink, 坑]
updated: 2026-10-05
status: active
---

# skill 自动触发的两个隐形杀手：描述没写触发词 + symlink 指向陈旧副本

## 触发场景
用户说「以前输入 abs 就自动弹 skill 激活，现在没反应了」——skill 文件明明在、
内容也对、宿主的 skills 目录里也有它，**但就是不被激活**，且**零报错**。

## ❌ 表现
输入触发词，界面上不出现 skill 激活提示；AI 也不按 skill 流程走。
没有任何错误信息（skill 加载失败通常也静默）。

## 🛠 两个独立杀手（各能单独致死）

### 杀手 A：`description` 写成"主题描述"而非"触发条件"
skill 被激活靠**模型读 `description` 判断是否匹配**，不是字符串包含匹配。

| 写法 | 例子 | 结果 |
|---|---|---|
| ✅ 触发条件 | `USE FOR web search. ...` / `Use only when the user mentions Herdr` | 能激活 |
| ❌ 主题描述 | `abs (agent-brain-sync) 跨会话记忆与任务续接。适用于「...」` | 匹配不上「用户输入 abs」 |

**修法**：description 里显式写出**用户会说的话**（触发词、`USE FOR`/`Use when` 句式）。

**配套坑**：光改 description 不够——skill 正文若写了「关键词不是触发器，意图才是」这类
自我约束，模型读进去后会被这条规则**劝住**（"用户只输了个 abs 词，按规则不该动手"）。
必须在同一处补**明确例外**：「用户直接输入 `abs` = 明确触发，直接执行」。

### 杀手 B：symlink 把落点指向「不受管理的陈旧副本」
```
~/.pi/agent/skills/abs-agent-brain-sync  →  ~/.agents/skills/abs-agent-brain-sync
        ↑ install 往这里写                          ↑ 实际读到的（陈旧，install 从不碰）
```
`abs install` 写进 symlink 会**穿透到目标**，看起来"装成功了"，但：
- 如果目标是**孤儿副本**（手工 cp 进去的、不在任何 lockfile 里），它不随版本更新；
- 想改的文件和实际生效的文件是两个 inode，**改了没变化**。

**判据**（一行查清）：
```bash
ls -l ~/<host>/skills/abs-agent-brain-sync        # 是 symlink 就要警惕
readlink -f ~/<host>/skills/abs-agent-brain-sync  # 看真身在哪
grep -c "USE FOR abs" $(readlink -f ~/<host>/skills/...)/SKILL.md   # 0 = 读到的还是旧的
```

**修法**：删孤儿副本 + 把 symlink 换成真目录（让 install 能直接管住），重跑 `abs install`。
动手前**先确认没有别的宿主依赖该 symlink**，并备份。

## 排查顺序（别搞反）

1. **文件在不在** —— `ls` 落点；注意是 symlink 还是真目录（杀手 B）。
2. **内容是不是你改的那份** —— 比对 mtime + `grep` 关键串（杀手 B 最容易骗过第 1 步）。
3. **description 有没有触发词** —— 读 frontmatter（杀手 A）。
4. **正文有没有自我否定条款** —— 总则/纪律里是否把触发词降级成了"非触发器"。

> 第 1、2 步看着像废话，但**"文件存在且内容对"和"宿主读到的就是这份"是两码事**。

## 关联连接
- [[host-plugin-silent-failure]] — 插件侧同构的"静默失效"（导出契约/symlink 之外的三坑）
- [[deploy-artifact-copies]] — 产物多副本问题（本页杀手 B 是它的 skill 版）
- [[agents-skills-not-ownerless]] — `~/.agents/skills/` 归 skills CLI 所有，abs 不写它
