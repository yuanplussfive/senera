# Memory

MemOS owns semantic knowledge, immutable turn fragments, daily/monthly
summaries, and tool/skill scenario retrieval. The physical source repository
keeps completed-turn provenance for bounded model context, recovery, and
deletion. It is not searched as a semantic substitute.

## Reading order

1. AgentMemoryService commits a normally completed episode and invokes its
   completed-turn sinks.
2. AgentMemoryEpisodeRecords and AgentMemorySourceRecords preserve the user
   request, final assistant text, state card, and execution sources.
3. Continuity/AgentMemOSSemanticLearningRuntime extracts and reconciles
   knowledge, then updates Shanghai calendar summaries from immutable fragments.
4. Continuity/AgentMemOSEmbeddingRuntime distinguishes document and query
   projections across SDK asynchronous operations.
5. Continuity/AgentContinuityMemOSRuntime searches native records and owns
   scenario persistence and deletion.
6. Continuity/AgentContinuityMemoryService budgets knowledge and digests and
   tracks delivery by node revision.
7. Continuity/AgentContinuityToolRuntime exposes native recall and deferred
   explicit learning intents.

## Durable boundaries

The physical database contains episodes, source records, session delivery
receipts, execution/todo records, compaction candidates, and background-request history. It contains
no semantic fact/rule/profile/graph/vector catalog. MemOS stores the semantic
nodes, links, validity, and embeddings. Its metadata does not duplicate the
physical episode/request/session identifiers.

The extractor receives same-session past history and similar native knowledge
in one Pi request. Its new/update/supersede decision uses native MemOS types
without semantic remapping. Extraction and commit are durably tracked so
restart or a partial write cannot silently duplicate or regress knowledge.

Daily summaries derive from per-turn fragments, not mutable canonical
knowledge; monthly summaries derive from daily summaries. Input revisions
avoid repeated summaries. Both generation limits and retry/concurrency policy
come from configuration. No obsolete worldbook, separate boundary classifier,
or substitute semantic backend participates in this chain.

The database contract is a single current baseline. Retired worldbook, goal,
semantic-catalog and resident-emotion schemas are not shipped as migration
history. A physical database from a retired schema is backed up and rebuilt
by the shared database kernel; MemOS and configuration databases keep their
independent contracts.

Physical text is not truncated at a separate fixed limit. Semantic requests
apply the configured assistant preview token budget using the selected model's
tokenizer to both the current turn and history; changing that budget does not
require recovering text previously discarded by storage.
