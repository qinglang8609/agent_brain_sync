#!/usr/bin/env bash
# abs-agent-brain-sync: create a .brain/ graph skeleton in a project (self-contained).
# Usage: ./bootstrap.sh <project-root>
#   <project-root>  target project (must exist)
# Creates <project-root>/.brain/ with empty class dirs + index/log/todo skeletons.
# Per-file templates live in SKILL.md ("文件标准" section); this only seeds the graph.
set -euo pipefail

PROJECT="${1:-}"
[ -n "$PROJECT" ] || { echo "usage: $0 <project-root>"; exit 1; }
[ -d "$PROJECT" ] || { echo "not a dir: $PROJECT"; exit 1; }

BRAIN="$PROJECT/.brain"
[ -d "$BRAIN" ] && { echo "already exists: $BRAIN (abort)"; exit 1; }

mkdir -p "$BRAIN"/{entities,concepts,sources,syntheses,sessions}

cat > "$BRAIN/index.md" <<'EOF'
# 🗂 图谱索引

本文件唯一入口。每新建/大改一个知识页，同步在此分类下加一行 `[[页面名]] — 一句话`。

## 当前路线 (Roadmap)
> 里程碑与方向（可链到 syntheses/）。

## Concepts
## Entities
## Sources
## Syntheses
## Sessions
EOF

cat > "$BRAIN/log.md" <<'EOF'
# 🗒 操作日志
YYYY-MM-DD | ingest | 沉淀 <concept-slug>
EOF

cat > "$BRAIN/todo.md" <<'EOF'
# 📋 Todo 看板
## In Progress
- [ ] 最高优先级任务放最上
## Todo
- [ ] 任务
## Blocked
- [ ] 任务 — 原因 + 最近失败输出
## Done
- [x] 任务 — 完成日期
EOF

echo "ok -> $BRAIN (页面模板见 SKILL.md「文件标准」节)"
