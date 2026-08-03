# ToolSearch

ToolSearch indexes registered Tools and Skills, ranks relevant candidates, controls progressive Tool disclosure, and records Tool/Skill routing experience. Conversation facts remain owned by `Memory`.

Bootstrap System Tools are always merged from the registry and do not enter the search index. Dynamic MCP tools and Skills are projected into one capability document model and one `AgentCapabilitySearchIndex`. Search documents are derived from descriptions, authoritative contracts, capabilities, tags, examples, and discovery sources; the index never scans extension directories or contains a hard-coded capability list.

Retrieval is hybrid by design. BM25 supplies exact and identifier-sensitive recall, `VectorModels.Embedding` supplies cross-language semantic recall, learned usage contributes revision-bound evidence, RRF merges rankers, the local feature reranker applies deterministic domain signals, MMR removes redundant candidates, and `VectorModels.Rerank` performs the final cross-encoder ordering over the small recalled set. Tool and Skill routing use the same lexical, embedding, document-cache, and remote-rerank services. An unavailable vector channel is observable but does not fail lexical retrieval; an aborted turn still propagates cancellation.

`ToolSearch.Embedding` owns only retrieval policy (`Enabled` and `ScoreThreshold`). Provider, model, dimensions, batching, input limits, timeout, and retry policy are owned exclusively by `VectorModels.Embedding`. The same separation applies to remote reranking: ToolSearch decides whether reranking participates, while `VectorModels.Rerank` owns transport configuration.

Learning is an observable side path. Every episode reaches `learned`, `skipped`, or `failed` without changing the main task result. Skill experience is tied to the active Skill revision, and ambiguous multi-Skill attribution is skipped rather than copied to every active Skill. Static descriptions remain authoritative; learned triggers only improve recall and ordering.

Safety is enforced at execution time by approval, OPA, resource projection, and the selected execution environment. Search ranking must not duplicate those policies.

## Turn retrieval contract

Every user turn performs retrieval against the current input. A compatible session snapshot is only a warm cache: fresh semantic hits replace its dynamic candidates, while a zero-hit query retains the warm candidates so short follow-ups such as "continue" do not lose useful tools. Bootstrap tools are always merged from the registry.

`AgentTurnPreparationService` activates Skills, merges their recommendations as soft ranking inputs, and creates the initial exposure from this retrieval result. It does not call a planner or synthesize another hidden query. During the Pi turn, the ToolSearch tool can issue additional explicit queries and progressively disclose more tools from the immutable authorization grant. Recommendations and preferred tools never filter unrelated authorized tools.

## Cache identity and invalidation

Capability indexes and embeddings are content-addressed, not revision-label-addressed. The catalog identity is a canonical hash of each document's stable ID, kind, declared revision, and complete `semanticText`. The embedding identity is a canonical hash of `(embedding model, document ID, SHA-256(semanticText))`. Changing only a description, example, capability, parameter summary, owner text, or embedding model therefore invalidates the affected vector even when a producer forgot to bump its revision string.

The shared embedding cache is a bounded `AgentLruCache`. Its capacity scales with the active catalog, accesses refresh recency, and catalog refresh removes identities that are no longer reachable. Query vectors are not mixed into the document cache. A failed embedding channel remains observable and falls back to lexical retrieval; cancellation is never converted into fallback success.

`ToolSearchTool` returns a catalog revision and progressively disclosed candidates:

| Level       | Model-facing data                                 | Callable |
| ----------- | ------------------------------------------------- | -------- |
| `reference` | name, title, summary, source, relevance evidence  | no       |
| `preview`   | reference fields, use cases, parameter summary    | no       |
| `callable`  | preview fields plus registry-backed Tool exposure | yes      |

The disclosure planner combines the retrieval relevance frontier with the live turn token budget. Only `callable` names are sent to `AgentToolExposureState`; the host then resolves the authoritative Schema from the registry. Search output can neither publish a Schema nor expand the immutable turn authorization grant. A precise follow-up search by Tool name can promote a reference or preview without starting a new conversation.

MCP `notifications/tools/list_changed` is handled by the MCP SDK's negotiated list-change support. Refreshed declarations pass the same JSON Schema validation as startup discovery, replace one server owner transactionally, and invalidate the search index. Invalid updates leave the previous catalog installed.
