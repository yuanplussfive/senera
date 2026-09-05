# ToolSearch

ToolSearch indexes registered Dynamic Tools and records Tool routing experience. Conversation facts remain owned by `Memory`; Skill selection remains a separate capability path.

Bootstrap System Tools are always merged from the registry and do not enter the search index. Dynamic system extensions and MCP tools share the same capability document model. Search documents are derived from descriptions, authoritative contracts, capabilities, tags, examples, and discovery sources; the index never scans extension directories or contains a hard-coded capability list.

Retrieval is lexical-first by design. BM25 supplies exact recall, and local `fuzzysort` adds typo- and abbreviation-tolerant matching only over declared tool names, capability IDs, titles, and aliases. It never scans long-form descriptions or injects a hard-coded synonym list. Learned usage contributes revision-bound evidence, RRF merges rankers, the local feature reranker applies deterministic domain signals, and MMR removes redundant candidates. Only when lexical recall is empty can enabled embedding retrieval supply cross-language candidates; enabled remote reranking then operates only on the bounded recalled set. Tool and Skill routing use the same lexical, embedding, document-cache, and remote-rerank services. An unavailable vector channel is observable but does not fail lexical retrieval; an aborted turn still propagates cancellation.

`ToolSearch.Fuzzy` owns local typo recovery (`Enabled`, `MinScore`, `CandidateLimit`) and has no model or network dependency. `ToolSearch.Embedding` owns only vector retrieval policy (`Enabled` and `ScoreThreshold`). Provider, model, dimensions, batching, input limits, timeout, and retry policy are owned exclusively by `VectorModels.Embedding`. The same separation applies to remote reranking: ToolSearch decides whether reranking participates, while `VectorModels.Rerank` owns transport configuration. Both remote layers are disabled by default. A vector request is possible only after the user enables both layers and selects a configured model with the matching `Embedding` or `Rerank` capability.

Learning is an observable side path. Every episode reaches `learned`, `skipped`, or `failed` without changing the main task result. Skill experience is tied to the active Skill revision, and ambiguous multi-Skill attribution is skipped rather than copied to every active Skill. Static descriptions remain authoritative; learned triggers only improve recall and ordering.

Safety is enforced at execution time by approval, OPA, resource projection, and the selected execution environment. Search ranking must not duplicate those policies.

## Meta-tool contract

Each turn begins with only registry-declared `Bootstrap` tools exposed. Dynamic tools remain authorized by the root command but do not enlarge the Native provider schema. Native planning invokes them through the fixed `ToolCall` bridge after `ToolDescribe`; BAML planning retains explicit session loading because its planner consumes the exposure snapshot.

| Tool                      | Responsibility                                                                                                                        | Session effect                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `ToolSearch`              | Returns ranked names, scores, source and matching evidence.                                                                           | None                                     |
| `ToolDescribe`            | Returns generic TS-like and XML argument views, required and optional inputs, output summary, usage metadata, provenance and effects. | None                                     |
| `ToolCall`                | Native-only fixed bridge that unwraps an exact dynamic tool name, contract revision, and arguments before normal authorization.       | Does not change the provider tool schema |
| `ToolLoad` / `ToolUnload` | Adds or removes authorized dynamic tools by exact name for BAML planning.                                                             | Updates BAML's exposure snapshot         |

`ToolSearch` returns every eligible Dynamic tool in deterministic score order. Matched entries include source and capability evidence; unmatched entries remain compact with name, title, summary, and zero confidence so the model can still discover them without receiving every contract. `ToolSearch` does not publish contracts or load candidates. `ToolDescribe` never executes or loads a tool. Its TypeScript-like view is the model-facing explanation, while the underlying JSON Schema remains authoritative for host validation. `ToolCall` accepts only Dynamic tools already present in the immutable authorization grant and rejects stale contract revisions. `ToolLoad` requires a current catalog revision when supplied, and can never expand the immutable authorization grant. `ToolUnload` preserves every Bootstrap tool. Skill recommendations remain contextual hints; they neither alter ranking invisibly nor bypass the active planning protocol.

## Cache identity and invalidation

Capability indexes and embeddings are content-addressed, not revision-label-addressed. The catalog identity is a canonical hash of each document's stable ID, kind, declared revision, and complete `semanticText`. The embedding identity is a canonical hash of `(embedding model, document ID, SHA-256(semanticText))`. Changing only a description, example, capability, parameter summary, owner text, or embedding model therefore invalidates the affected vector even when a producer forgot to bump its revision string.

The shared embedding cache is a bounded `AgentLruCache`. Its capacity scales with the active catalog, accesses refresh recency, and catalog refresh removes identities that are no longer reachable. Query vectors are not mixed into the document cache. A failed embedding channel remains observable and falls back to lexical retrieval; cancellation is never converted into fallback success.

MCP `notifications/tools/list_changed` is handled by the MCP SDK's negotiated list-change support. Refreshed declarations pass the same JSON Schema validation as startup discovery, replace one server owner transactionally, and invalidate the search index. Invalid updates leave the previous catalog installed.
