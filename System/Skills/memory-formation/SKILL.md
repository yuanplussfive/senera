---
name: memory-formation
metadata:
  senera:
    icon: stack
description: Design or evaluate durable memory, user profiles, stable preferences, project knowledge, candidate memories, consolidation, conflicts, relationship graphs, or cross-session recall. Use when information must be filtered, evidenced, persisted, related, and projected back into future context. 适用于设计、诊断或优化长期记忆、用户偏好、项目知识、记忆合并、冲突处理和跨会话召回。
---

# Memory Formation

1. Classify information as identity, stable preference, project rule, task fact, tool evidence, knowledge, or relation.
2. Retain only stable, repeated, reusable, or explicitly confirmed information.
3. Exclude secrets, unverified guesses, and low-value conversation. Classify temporary progress, failed attempts and outcomes as context, never as a durable preference or fact. Historical context may later supply useful experience without becoming another task's current progress.
4. Link every candidate to user statements, tool evidence, artifacts, or repeated observations.
5. Preserve time, provenance and versions when facts conflict; supersede outdated information with explicit recent corrections.
6. Project only the minimum relevant memory into future context.
7. Make entity and concept relationships explainable from their evidence.
8. Memory weight starts at 50/100. The host computes `100 * (1 + helpfulTasks) / (2 + helpfulTasks + unhelpfulTasks)` from completed, distinct tasks. Helpful use increases weight with diminishing gains toward 100. Unused, uncertain and pending assessments are recorded separately and do not affect weight. Delivery alone is not helpful use. This weight is a retention priority, not a probability that a fact is true. Query relevance is assessed separately and multiplied by the weight once.
9. Learn from current user statements and actual tool results; retain their host-managed provenance. Do not generate exact-quote validation, supports/contradicts evidence scores or model-assigned confidence. Assistant output can show that an existing memory was used, but cannot independently establish new facts. Evaluate every delivered memory even when no new memory is written. Answering a question from a remembered preference or following its constraints counts as helpful use; do not require the user to repeat it. Use supersede for explicit corrections.
10. Preferences and the diary title index, including a successfully empty selection, are frozen per conversation and preserved across restart. A new conversation or native compaction selects this background again. Each user turn also queries relevant facts, relationships, preferences not covered by the frozen version, and historical task experience across accessible conversations. Current task context follows its session and durable task identity; the host state card can resume an earlier topic after an intervening one. Past success never proves current completion. Failed reads or assessments remain observable and retryable. Use MemoryRecall for exact detail; do not rewrite already frozen preferences into live context.
11. Preserve Agent/workspace and speaker attribution. A group member is not implicitly the console owner. Do not transfer a person's preferences or permissions to another person.
12. Preferences and relationships have no default time-based expiry. A separate fact-only Pi structured call chooses the number of days from current user intent, context and source material, returning only `days`; zero means no time-based expiry. The configured fact default is seven days when the material gives no basis for a different lifetime. Context has a one-day default for historical recall; the exact original session task can retain its working state when resumed. Recall frequency and weight changes never renew retention. Expiry removes automatic eligibility, preserving explicit historical inspection and source deletion. A failed retention decision is durable retryable work, never implicit permanent storage.

## Diaries and historical work

The host writes daily and monthly Markdown diaries in the current workspace's
Agent UUID learning directory. A day is consolidated after its calendar boundary;
a month is consolidated only after month-end. The configured memory model uses
the shared Pi structured-output path and returns exactly a title and a Markdown
body. Do not edit diary files or their provenance sidecars yourself.

Daily input covers completed conversation turns, including turns whose semantic
learning was skipped or failed. Each turn supplies the user message and final
assistant reply as separate previews, by default at most 128 model tokens each,
alongside committed memories and the actual learning state. The host derives
these previews from existing physical sources; they do not become extra semantic
knowledge. Previews may be truncated. An assistant's final claim is not proof
that an action succeeded. Preserve uncertainty and any reported learning gaps.

Start with the system background's `Memory index`: it captures titles from the
previous seven completed calendar days at the session/compaction boundary,
never the full bodies. It stays frozen across turns and restarts; use `diary/list`
when a newer directory is needed. A title is a discovery hint,
not proof that an event happened. Choose a relevant date and run
`senera diary read YYYY-MM-DD` through a Local Shell. To explore an older month,
use `senera diary list YYYY-MM`; read its completed monthly diary with
`senera diary read YYYY-MM`. Omit `agentId`: the host
binds the active session's Agent. Missing diaries are reported explicitly.

Use diary reading for chronological progress and decisions. Use `MemoryRecall`
for semantic facts, preferences and exact memory evidence. Diaries are derived
narrative, not a source of extra task-use votes. Monthly diaries
see daily titles and only the opening 512 model tokens of each body, with `...`
for truncation; read a daily diary when that omitted detail matters. Both diary
input paths obey a complete input ceiling of 32768 model tokens and current
model headroom. Preserve the distinction between completed work and open work,
and between different speakers, even when their work appears on the same day.
