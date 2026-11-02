# Continuity

MemOS is the semantic memory authority. Physical episodes and the background
request ledger support recovery and deletion; they are not a second recall
engine.

## Completed-turn learning

Only normally completed state-card turns enter learning. The Pi-backed model
receives the current user text and state card, the assistant preview, explicit
memory-write intents, the last configured number of completed turns from the
same session, and similar MemOS knowledge. Future and other-session turns are
excluded. User text is preserved; assistant previews use the model tokenizer.
State cards share one validated contract with physical history and tool/skill
scenario learning. There is no synthetic resident mood, stance transition
table, persisted emotion state, or emotion injection into model prompts.

The model returns topic, summary, native MemOS type, and one action choice:
new, update:<ref>, or supersede:<ref>. The published schema offers only choices
for the supplied candidates; an empty candidate set offers only new. The same
schema validates output in both native-tool and text planning modes. Candidates
are bound to stable node IDs in the durable extraction ledger. Invalid results
fail and retry within the configured policy; they do not produce substitute
knowledge.

Every delivered memory participates in task-use assessment, including explicitly
read legacy records whose subject could not be established. These records are
assessment-only: neither the native schema nor BAML action choices permit
updating or superseding them. Extraction cache identity includes the delivered
node revisions so recovery cannot reuse an incomplete assessment set.

Each turn contributes an immutable fragment. Canonical knowledge is separate:
new stores a node, update refines the existing node, and supersede preserves
the old node with native validity and a temporal edge. A derived_from edge
records the contribution. These edges also prevent partial-write retries from
reapplying old knowledge after a newer update.

Facts receive a separate `AssessMemoryRetention` call after extraction through
the same Pi structured client, including its Native/BAML output contract. It
receives the extracted fact, current user intent, bounded source material,
recent history, original confirmation time and any previous retention. Output
is exactly `{days: integer}` without a reason field. Zero means no time-based
expiry. `Retention.FactDays` defaults to seven when the source material gives no
basis for another lifetime. Preferences and relationships have no default time
expiry; `Retention.ContextDays` defaults to one for historical recall. Expired
records remain explicitly inspectable. The original session task can resume
its own context beyond that TTL, but cannot revive superseded source validity.
Reads, delivery, utility weight updates and restarts never renew a lifetime.
The decision input shares `MemOS.RelevanceInputTokenBudget` with other memory
assessments and must also fit the selected model's available window.

Retention decisions have their own content-addressed durable learning stage.
A failed second call does not publish the fact and retries within the existing
learning policy, reusing extraction. Source erasure during either call prevents
publication. Legacy semantic records acquire retention from their original
content time on migration; reading an old record does not start a new lifetime.

## File diaries

Daily and monthly diaries are Markdown files, not MemOS nodes. The workspace
layout owns `.senera/data/agents/<uuid>/diary/YYYY/MM/DD/diary.md` for days and
`YYYY/MM/diary.md` for months. Each document is `# title` followed by the complete
Markdown body. A `.diary.json` sidecar stores generation revision, content hash
and source provenance, never another copy of the diary. Atomic writes keep a
partially committed revision detectable after restart.

After a calendar day ends, its physical completed turns provide diary coverage
across that Agent's conversations. Each input record contains `userPreview` and
`assistantPreview`, the subject when known, semantic learning status, and any
committed memory fragments with their actual task-use weight. The previews read
the existing source repository and independently use the shared model tokenizer
with `Diary.TurnPreviewTokens` (default 128); they are not copied into MemOS
knowledge or its embeddings. Assistant previews contain only the final response,
whose claims are not independent evidence of task success.

Turns with a memory weight sort ahead of unweighted activity, then by weight,
completion time and stable identity. The single bounded input selects the
highest-priority records first; provenance remains complete on the host even
when some source text does not fit. The last fitting record can shorten its
text fields while retaining its structured roles and status. Learning-state
counts cover all turns, including entries omitted from the model input.
`Diary.InputTokenBudget` defaults
to and cannot exceed 32768 model tokens, counting the input envelope,
instructions and output schema. Pi's shared window reserve can reduce it further.
The shared Pi structured client supports required native tool output and BAML;
both return exactly `title` and `body`. Generated Markdown is not cut to the
semantic fragment's short summary limit.

Only completed months are generated. They read each daily title and the opening
`Diary.MonthlyPreviewTokens` (default/maximum 512) tokens of its Markdown body,
using `...` only for truncation. All daily titles remain present; excerpts shrink
together when necessary to fit the total input budget. Failed days block that
month's generation while independent dates continue. Startup recovers all
retained turns even when one extraction fails. Skipped, pending and failed
semantic learning remains explicit in the turn input and does not block its day
or month. Successful later learning changes the source revision and refreshes
the affected closed period without discarding its physical conversation.
Diary generation shares the learning model concurrency budget with
fragment extraction. Startup catches up on closed periods, unchanged revisions
skip model calls, and current-day turns do
not repeatedly rebuild the diary collection. The configured IANA
`Diary.TimeZone` controls real calendar boundaries, including DST.

The system background captures only the previous `Diary.RecentDays` completed
days' titles (default seven) as a Markdown index. It persists with the same
session/compaction snapshot, including when there are no long-term records.
Crossing midnight, editing diaries and restarting do not rewrite it. New sessions
and native compaction capture it again. The whole index counts against the
background token budget; a smaller model may omit the block without changing
the stored snapshot. `senera diary list [YYYY-MM|YYYY-MM-DD]` discovers current entries;
`senera diary read YYYY-MM-DD` or `YYYY-MM` reads one full daily/monthly document.
Model commands bind the current Agent UUID; the human CLI can select an Agent.
The recent index is also written as `diary/index.md` with relative Markdown links.
Index titles and diary bodies are derived narrative, not additional task-use votes.

Startup exports legacy MemOS period content before retiring those nodes. Closed
periods become file diaries; migration-only archives retain original content
without exposing unfinished monthly summaries. Source erasure invalidates
affected files and month summaries, erases unattributable migration exports,
and prevents in-flight model results from restoring erased content. Removing
the Agent removes its whole learning directory, including diaries and archives.
Deletion requests become durable before waiting for extraction. Once source
erasure commits, diary rebuilding runs as separately tracked background work;
a provider failure cannot turn successful erasure into a deletion failure.

## Retrieval and delivery

Automatic context separates frozen preferences and diary titles from per-turn
task state and related knowledge. Queried preferences, facts and relationships pass the same bounded semantic
relevance assessment through the configured memory model before quality ranking.
Global preferences also have a reserved budget. Candidates join by immutable node
ID, with assessed query results replacing catalog projections, never the reverse.
The host applies the ledger's task-utility weight once; SDK trust is a uniform
retrieval multiplier and does not add a second weighting factor.
Assessments use the shared Native/BAML contract and content-addressed durable
request cache. Already frozen versions do not require repeated assessment;
dynamic query candidates are assessed independently without changing system bytes.

`Recall.FrozenBudgetRatio` defaults to 0.25 of the complete available budget for
preferences and the diary index; a whole diary index can expand that share when
it still fits the total. `Recall.TaskBudgetRatio` defaults to 0.5, reserving space
for current task state. The two configured ratios cannot sum above one. Unused
dynamic space remains available to both task state and related knowledge.
Task records use task-ID-scoped structured queries and rank
by query relevance, recency within the task and memory weight. Live workflow state
provides unresolved steps and TODOs without parsing summary keywords. Diary
bodies are read explicitly through `diary/read`. Each turn's query can also recall
facts, relationships, unfrozen preference versions and historical context from
other accessible sessions. Historical experiences are explicitly marked as
reference, never evidence of current task completion. Workspace/Agent storage
and speaker ownership still bound every automatic selection. Internal turn
fragments are not exposed by MemoryRecall.

Task identity follows both the session and topic. The existing state-card
rewrite receives budgeted durable task references alongside recent history.
It can select a supplied request to resume an earlier task; it cannot invent a
reference or cross session/speaker ownership. Compaction retains this binding.

`Recall.PromptBudget.MaxTokens` (default 16384) and actual model headroom bound
the complete serialized wire, including references and preamble. Records are
selected whole by priority, then time and identity; length controls fit rather
than rank. Frozen entries retain their original score, score breakdown and
preference reservation when projected into a smaller model window. Successful
empty selections also freeze and survive restart. Learning new preferences or
facts and changing topics cannot rewrite that background within a generation;
related new knowledge can still enter dynamic context. A new session or
compaction selects preferences again. Both frozen and dynamic budgets measure
their actual delivery wires, including the separate historical-task rules.
Unreadable storage and failed
assessments remain retryable, never a successful empty snapshot. Dynamic read
failure preserves an existing frozen snapshot and reports unavailable status;
it cannot silently clear system memory. Detached
write/document-embedding failures are reported separately. Successful native Pi compaction advances
the background generation idempotently and refreshes it from the current
request plus committed summary. Source deletion invalidates snapshots and
in-flight selections cannot resurrect them.

Public memory references use the shared resource registry; internal MemOS node
IDs never need to be copied by the model. Delivery receipts count distinct tasks
that actually received each memory, rather than previews or repeated steps.
Delivery alone does not increase memory weight. Source ownership, time and versions
remain distinct from the task-utility algorithm.
The producer, frontend live reducer and history replay share one strict snapshot
contract including task records, related records, retention, quality and diagnostics. The producer reports
ranking and assessed-relevance aggregates separately; the browser formats them
without rescoring. Unassessed global preferences never become 50% relevant by
substituting their ranking score. Frozen quality and counts describe selection
time. A separate current-quality projection reports the ledger at turn preparation,
without rewriting frozen entries. Retrieval timing and channel counts come directly
from the automatic selection pipeline, including an explicit frozen-reuse source.

Normal completion settles acknowledged delivery receipts independently of memory
creation. Every delivered candidate requires one reasoned task assessment, even
when extraction returns `skip`. The shared Native/BAML contract distinguishes
helpful, unhelpful, unused and uncertain; absent assessments remain pending.
Using a remembered preference to answer a question or tailor a result is helpful
without requiring the user to restate or explicitly confirm that preference.

For distinct completed helpful and unhelpful tasks `h` and `u`, memory weight is
`100 * (1+h)/(2+h+u)`: a Beta(1,1) prior gives 50 initially, 66.67 after one
helpful task, 75 after two, and diminishing gains toward 100. It is a retention
priority, not a truth probability. Unused, uncertain and pending deliveries do
not alter weight. Within one task the latest effective-use assessment wins in
original request order; an unused follow-up cannot erase an earlier actual use.
Retries cannot manufacture extra votes. Source erasure retracts task contributions.

The versioned utility contract can reassess old completed deliveries independently
of committed semantic content. It never duplicates knowledge or modifies old
sources. Migration retires support/contradiction scoring, preserves historical
utility for audit, queues SDK trust repair and invalidates current derived system
snapshots once. New generations then stay frozen until their usual boundary.
Historical event decoding preserves selections and drops obsolete score fields
instead of relabeling them as current task weight.

The durable node outbox coalesces utility and recall changes and acknowledges only
the matching revision. SDK trust stays at a uniform multiplier of 1, with all
memory weighting owned by the host. Failed nodes remain pending without blocking
other nodes. Startup recovers completions already in physical history. Assessment
replacement is transactional; failed replacement preserves prior utility.

Native `MemOS.dedupe({dryRun:true})` groups persisted document embeddings in a
background revision cache. Node/validity/vector changes invalidate it; reads
reuse a coherent snapshot. It performs no LLM calls and never deletes or
merges nodes. `MemOS.RecallDedupeThreshold` defaults to 0.92, independently of
the automatic graph link threshold. Native types and digest calendar periods
partition coverage; context episodes also retain their Asia/Shanghai date.
Partial overlap across day/month/knowledge layers is not
treated as equivalent knowledge. Weak single-linkage cluster means are
rejected. Vector similarity is approximate, not proof of factual equivalence.
The SDK 1.6.26 scan has a native 10000-node window, and
`MemOS.RecallDedupeMaxPairs` bounds its initial candidate comparisons (default 10000);
unscanned records retain their independent identities.

Explicit MemoryRecall reads native node references directly. Time filtering
runs before token selection and includes historical validity. Its complete
model view shares the configured token ceiling and reports matched versus
returned records. Diagnostic metadata does not consume its selection budget.
The stored result retains full identity, revision and ranking data; the model
receives one content body, type and occurrence time per record. The learning
ledger consumes the full internal identities and revisions. Exact requested IDs remain separately addressable.
MemoryWrite
accepts an intent for learning after normal completion; it does not claim the
knowledge is already persisted.
Public references are decoded once by the generated tool input contract.
The internal MemOS runtime receives native node IDs without prefix parsing.

The host result type and published MemoryRecall output schema share
`AgentMemoryRecallToolContract`. Quality and retrieval score fields reuse the
same contracts as automatic continuity. `npm run generate.system-tool-contracts`
updates the package schema; the existing extension-contract build check rejects
stale generated schemas before release.

## Embeddings and scenario learning

The public MemOS adapter scopes initialization/backfill and writes as document
encoding, and searches as query encoding. Async operation scopes survive queued
jobs and retries. The persisted embedding model identity includes the document
projection so the SDK rebuilds vectors produced with a different projection.
Automatic graph linking uses the configured threshold, defaulting to 0.75.

Tool/skill scenarios use separate tags in the same MemOS database. Every source
turn has its own identity; replay updates that turn rather than duplicating it.
Request-local retrieval scores weight successful tool calls and matching skill
revisions, together with outcome quality and configured time decay. There is
no extra keyword gate or persistent in-process hydration cache.

## Recovery and deletion

The background ledger records extraction, commits, diary input revisions,
and deletion operations. Failed persistence is surfaced. Restart resumes
incomplete work. Deletion rebuilds connected retained contributions and their
file diaries; failed deletion resumes from its durable operation record.
Shutdown drains semantic work and embeddings before closing the SDK.

Tags describe categories; native IDs and direct provenance live in validated
metadata. Startup can restore attribution only when retained exact sources
prove one subject, and task context additionally requires a proven task binding.
Ambiguous legacy records remain explicitly retrievable without automatic
injection. Invalid owned records fail validation rather than becoming empty objects.
Recovery retrieves the stored candidate node ID directly, so changing search
rankings cannot change a previously committed reconciliation decision.
The Pi continuity ledger keeps compaction and checkpoint references only;
the unused lexical recall and duplicate search text have been removed.
Its current contract uses a versioned Pi entry identity. Retired entries are
not read or converted; current entries are validated strictly.
