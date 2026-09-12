---
tags: [source, 坑, skill, 所有权]
updated: 2026-09-12
status: draft
---

# 来源：~/.agents/skills/ 不是无主目录, 是 skills CLI(npx skills, ~/.agents/.skill-lock.json…

TITLE: ~/.agents/skills/ 不是无主目录, 是 skills CLI(npx skills, ~/.agents/.skill-lock.json 的所有者)的规范存储位置, 各宿主 skills/ 只是它 fan-out 的目标。判据: lockfile 的 skills 字段为空 + 目录 mtime 与某次 abs install 同秒 + 内容逐字节相同 = 手工 cp 的残留副本。abs 不该写那里(绕过 lockfile 会被 sync 覆盖), 正确处置是只读检测+告警+给清理命令。

## 记录（实时暂存，Teardown 时提炼进 concepts/ 后本页可删）
- ~/.agents/skills/ 不是无主目录, 是 skills CLI(npx skills, ~/.agents/.skill-lock.json 的所有者)的规范存储位置, 各宿主 skills/ 只是它 fan-out 的目标。判据: lockfile 的 skills 字段为空 + 目录 mtime 与某次 abs install 同秒 + 内容逐字节相同 = 手工 cp 的残留副本。abs 不该写那里(绕过 lockfile 会被 sync 覆盖), 正确处置是只读检测+告警+给清理命令。

## 关联连接
（提炼成 concepts 规律页后，在此挂双链到该页）
