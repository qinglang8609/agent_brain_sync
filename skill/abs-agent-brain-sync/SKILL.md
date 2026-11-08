---
name: abs-agent-brain-sync
description: "USE FOR abs / agent-brain-sync cross-session memory and task handoff. Triggers: the user types `abs` alone or `abs` + a command (e.g. 'abs 开工', 'abs 沉淀'), or asks to 开工续接状态 / 沉淀会话收获 / 任务登记不丢 / 经验落成知识页 / 图谱体检."
---

# abs — cross-session memory

`.brain/` is your memory across sessions: bugs, decisions, verified fixes.

**Querying it is your decision, not something you wait to be reminded of.** The moment a
keyword forms or a question appears ("was this bug solved before?", "who decided this?"),
run `abs query <词>` — do not wait for an error or for the user to prompt you.

## Startup: one command

```bash
abs load
```

Returns: unfinished todos + usage + last 3 log lines. If the top shows `⏳ 上会话滞留`,
reconcile first — finished items get `abs todo done <id> --as 落地|否决|仅方案 "结语"`,
unfinished ones get `abs todo note <id> --note "where it stopped"`.

**Never `cat .brain/` end-to-end.** Search by topic; `abs resolve <page>` then read that one page.

## Format gates (reject, do not guess)

- `todo start/add` without `--note "what"` → rejected. One sentence, verb-first, ≤40 chars.
- `todo done` without a conclusion → rejected. Every Done line must say what happened.
- `abs log` without a one-line conclusion → rejected.
- index rows without a real description (date-template only) → rejected by lint.
- Sub-items are one sentence each. Reports go to `abs log` / `sources/`, not the board.

## Find knowledge: one entry

| Situation | Command |
|---|---|
| Have keywords | `abs query <词…>` — multi-word OR over `.brain/`, page name + summary |
| Got a page name | `abs resolve <页名>` → read only that page |

One entry, no tiers: `query` is the only search (2026-11-08 — the SQLite graph库 with
`abs search` / `abs recall` / `abs db` was deleted; it was write-only in practice:
881 sessions logged `search` 3 times, `recall` 9 times, while the todo board ran 1897).
Cite sources as `[[页面名]]`.

## Write knowledge: three sinks, do not mix

| What you have | Sink | Command |
|---|---|---|
| One experience, not yet clear | `sources/` | `abs note "一句话"` |
| A real page (4-section skeleton) | `concepts/` | `abs concept <slug> --title "…"` |
| One line, date as timeline | `concepts/` | `abs capture --layer 2/3/4 "…"` |
| Hard rule that must stop the agent | index `## Rules` | `abs rule add "≤42 字"` |

`concept` = four sections (trigger / symptom / fix / verify). `capture` = one line + date.
Then run `abs lint` (dead links, over-size, NO-TAIL).

## Tasks: the board is alive

```bash
abs todo start <id> --note "做什么"      # register (note required)
abs todo note <id> --note "到哪一步"      # append child (one sentence)
abs todo done <id> --as 落地|否决|仅方案 "结语"
abs todo state <id> --note 进行中|讨论中|滞留中|搁置
abs todo remove <id>                     # delete incl. children, no undo
```

- Register before touching files. A rough id is fine (`rename` later).
- `done` immediately when a unit of work finishes; do not batch at session end.
- One `[进行中]` at a time. `搁置` = parked on the board; `remove` = never existed.
- `memo` for extra notes; it does not occupy the board.

## Triggers are intent, not keywords

`todo` / `沉淀` / `load` / `note` in a sentence that is discussion, a question, or
rule-making → respond only, do not execute.

Exception: the user types `abs` alone or `abs` + command → execute; no subcommand = startup.

## Document diet (todo / knowledge pages)

1. Everything serves the topic; cut the rest.
2. No unverified summaries. Only what was done, run, tested.
3. Ordered, layered, plain declarative sentences. No coined words.
4. No rhetorical questions, no guessing.
5. No duplication — cite the other page instead.
6. Bans are direct, not chatty.

## ⛔ Never

1. Hand-build skeletons or hand-register tasks — `abs init` / `abs todo start`.
2. Read `.brain/` end-to-end — `abs load` for state, `abs query` for topics, `abs resolve` for one page.
3. Delete a knowledge page to mark it obsolete — `abs supersede <页> --by <新页>`.
4. Write Rules directly — propose `[Rules 提议]`, wait for the user, then `abs rule add`.
5. Host-native todo for cross-session work — use `abs todo`.
6. Invent verification results that were not run.

## Details live in the graph, not in memory

| Need | Read |
|---|---|
| Seven layers, `--kind`, deep wrap-up | `abs resolve abs-skill-details` |
| Session page shapes, ingest hooks | `abs resolve session-digest-design` |
| New-request protocol (plan → register → start) | `abs resolve abs-skill-details` |
| `.brain/` layout, frontmatter | `abs resolve abs-skill-details` |
| Lint codes (NO-INBOUND / NO-TAIL / …) | `abs resolve abs-skill-details` |

Only read/write `.brain/` and target code. Broken dual-links = broken handoff.
