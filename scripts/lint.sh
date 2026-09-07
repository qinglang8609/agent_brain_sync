#!/usr/bin/env bash
# abs-agent-brain-sync lint: check a graph (.brain/) for self-consistency + size discipline.
# Usage: ./lint.sh [<graph-root>]   (default graph dir is <proj>/.brain; pass it)
# Scope: entities/ concepts/ sources/ syntheses/ sessions/ under the graph root.
#   (index.md / log.md / todo.md are manifest files, not linted.)
# Checks per knowledge page:
#   (1) NO-FRONTMATTER     - YAML frontmatter must open the file.
#   (2) DEAD-LINK          - [[X]] where no *.md basename X exists in the graph.
#   (3) TEMPLATE-LINK      - leftover placeholder [[slug]]/[[EntityName]] from a template.
#   (4) ORPHAN-PAGE        - no [[link]] inside AND never [[linked]] from elsewhere.
#   (5) UNRESOLVED-CONFLICT - page has ## 知识冲突 but is still status: draft.
#   (6) OVER-SIZE          - concept/entity/synthesis page >150 lines or >5KB (容量纪律).
#   (7) SOURCES-PILED-UP   - sources/ has >10 files (暂存区该提炼归档了).
#   (8) INDEX-MISSING       - durable page not listed as [[basename]] in index.md (忘更新索引).
# Fails (exit 1) listing problems. Bash 3.2-safe, zero deps.
set -u
VAULT="${1:-}"
if [ -z "$VAULT" ] || [ ! -d "$VAULT" ]; then
  echo "usage: $0 <graph-root> (a .brain dir)"; exit 2
fi

MAX_LINES=150
MAX_BYTES=$((5*1024))
MAX_SOURCES=10

targets=$(mktemp)   # every linkable basename (all *.md minus leading '_' templates)
find "$VAULT" -name '*.md' -not -name '_*' -exec basename {} .md \; | sort -u > "$targets"

pages=$(find "$VAULT" \( -path '*/entities/*' -o -path '*/concepts/*' \
        -o -path '*/sources/*' -o -path '*/syntheses/*' \
        -o -path '*/sessions/*' \) -name '*.md' -not -name '_*' 2>/dev/null)

issues=$(mktemp)

# basenames that are [[linked]] from anywhere (for orphan detection)
refd=$(mktemp)
find "$VAULT" -name '*.md' -not -name '_*' -print0 \
  | while IFS= read -r -d '' f; do
      grep -oE '\[\[[^]]+\]\]' "$f" 2>/dev/null | sed -E 's/\[\[//; s/\|.*//; s/\]\]//' >> "$refd"
    done
sort -u "$refd" -o "$refd"

for p in $pages; do
  [ -f "$p" ] || continue
  b=$(basename "$p" .md)

  # (1) frontmatter
  if [ "$(head -1 "$p")" != "---" ]; then echo "NO-FRONTMATTER: $p" >> "$issues"; fi

  # (2)/(3) dead + template links
  grep -oE '\[\[[^]]+\]\]' "$p" 2>/dev/null | sed -E 's/\[\[//; s/\]\]//; s/\|.*//' \
    | sort -u | while read -r ln; do
        case "$ln" in
          *slug|*Name|*name|*Date|*页面名) echo "TEMPLATE-LINK: $p -> [[$ln]]" >> "$issues";;
        esac
        grep -qx "$ln" "$targets" || echo "DEAD-LINK: $p -> [[$ln]]" >> "$issues"
      done

  # (4) orphan
  if ! grep -q '\[\[' "$p" 2>/dev/null && ! grep -qx "$b" "$refd"; then
    echo "ORPHAN-PAGE: $p (no links out, no links in)" >> "$issues"
  fi

  # (5) unresolved conflict
  if grep -q '知识冲突' "$p" 2>/dev/null && grep -q 'status: draft' "$p" 2>/dev/null; then
    echo "UNRESOLVED-CONFLICT: $p" >> "$issues"
  fi

  # (6) size discipline: only concept/entity/synthesis pages are knowledge (not sources/sessions)
  case "$p" in
    */concepts/*|*/entities/*|*/syntheses/*)
      nlines=$(wc -l < "$p" | tr -d ' ')
      nbytes=$(wc -c < "$p" | tr -d ' ')
      if [ "$nlines" -gt "$MAX_LINES" ] || [ "$nbytes" -gt "$MAX_BYTES" ]; then
        echo "OVER-SIZE: $p (${nlines}L/${nbytes}B > ${MAX_LINES}L/${MAX_BYTES}B; 拆或外链)" >> "$issues"
      fi
      ;;
  esac
done

# (8) index drift: durable knowledge pages (concept/entity/synthesis/session) must be listed
#     in index.md as [[basename]], else the agent forgot to update the index (single source).
INDEX="$VAULT/index.md"
if [ -f "$INDEX" ]; then
  for p in $pages; do
    case "$p" in
      */sources/*) continue;;          # transient, don't force into index
    esac
    b=$(basename "$p" .md)
    if ! grep -qF "[[$b]]" "$INDEX" 2>/dev/null; then
      echo "INDEX-MISSING: $p not listed as [[$b]] in index.md" >> "$issues"
    fi
  done
fi

# (7) sources 暂存区堆积
nsrc=$(find "$VAULT"/sources -name '*.md' -not -name '_*' 2>/dev/null | wc -l | tr -d ' ')
if [ "${nsrc:-0}" -gt "$MAX_SOURCES" ]; then
  echo "SOURCES-PILED-UP: sources/ has ${nsrc} files > ${MAX_SOURCES}; 提炼归档旧 source" >> "$issues"
fi

rm -f "$refd" "$targets"
cat "$issues"
n=$(wc -l < "$issues" | tr -d ' ')
rm -f "$issues"
echo "lint: ${n} problem(s)."
[ "$n" -eq 0 ]
