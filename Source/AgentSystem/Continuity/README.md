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

Each turn contributes an immutable fragment. Canonical knowledge is separate:
new stores a node, update refines the existing node, and supersede preserves
the old node with native validity and a temporal edge. A derived_from edge
records the contribution. These edges also prevent partial-write retries from
reapplying old knowledge after a newer update.

## Time summaries

Fragments are indexed by completion time in Asia/Shanghai. Daily summaries
read those immutable fragments; monthly summaries read daily summaries. The
configured model-token budget splits large inputs into bounded parallel
batches, followed by consolidation when there is more than one batch.
Unchanged input revisions skip another model call. Empty periods are removed
after deletion. Period ends are exclusive calendar boundaries.

## Retrieval and delivery

Normal live context searches knowledge and daily/monthly summaries separately,
then shares one token budget across them (`Recall.PromptBudget.MaxTokens`,
default 16384). The selected standalone memory wire is measured with the
request's model tokenizer, including references, encoding and preamble. The
same wire is placed in liveContext. Smaller model input headroom tightens the
budget; records are included whole, with no entry count or character cap.
Raw per-turn fragments are not duplicated in normal context.

Model-facing entries expose `ref=memos:<node-id>` for exact recall. Content
versions and ranking/coverage diagnostics remain host-owned. Persistent
receipts record selected node versions and their current near-duplicate
coverage. Changing query rankings or creating another equivalent node cannot
repeat the covered knowledge; updating a covered identity can deliver its
new version. Only selected coverage is committed after the Pi run and terminal
event commit succeed. A compaction clears active-context receipts because
earlier memory input may no longer be present. In-flight selections are
recomputed when that context epoch changes, and stale commits are rejected.

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
JSON result also shares the configured token ceiling and reports matched
versus returned records. Exact requested IDs remain separately addressable.
MemoryWrite
accepts an intent for learning after normal completion; it does not claim the
knowledge is already persisted.
Public references are decoded once by the generated tool input contract.
The internal MemOS runtime receives native node IDs without prefix parsing.

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

The background ledger records extraction, commits, summary input revisions,
and deletion operations. Failed persistence is surfaced. Restart resumes
incomplete work. Deletion rebuilds connected retained contributions and their
period summaries; failed deletion resumes from its durable operation record.
Shutdown drains semantic work and embeddings before closing the SDK.

Internal period/write tags use one encoder and decoder. Invalid owned records
fail validation instead of being silently filtered or read as empty objects.
Recovery retrieves the stored candidate node ID directly, so changing search
rankings cannot change a previously committed reconciliation decision.
The Pi continuity ledger keeps compaction and checkpoint references only;
the unused lexical recall and duplicate search text have been removed.
Its current contract uses a versioned Pi entry identity. Retired entries are
not read or converted; current entries are validated strictly.
