# Prompt

`Prompt` is the sole compiler for Senera-owned model context. It keeps reusable identity separate from turn-specific retrieval and workflow state.

- `AgentPromptContextBuilder` assembles the structured context.
- `AgentPromptToolContextProjector` projects registered tool descriptions and contracts.
- `AgentPromptContractRenderer` renders JSON Schema-derived parameter contracts.
- `AgentPromptDocumentationReader` reads selected Markdown resources.
- `AgentPromptRenderer` renders the final prompt.

The stable tier contains the Senera kernel, active persona identity and voice examples, execution environment, and the bounded resident profile. The request-local tier contains only task-live state: relevant persona lore, evaluated rules and their dependent signals, the compact current scene, in-flight Goal/Execution/Todo/delegation state, conversation-space identity, effective model identity, and active task resources. Historical continuity facts, events, temporal digests, evidence handles, and dialogue-style examples are not copied into every request; their authoritative sources are recalled explicitly through the corresponding Memory or Artifact capability. This keeps durable history in one place while preserving the live state needed to coordinate the active tool loop.

All model-facing structured context is serialized by `AgentPromptContextWireRenderer` before Liquid rendering. Each block declares its permitted lossless encodings and is measured with the active model tokenizer; uniform Todo, delegation, execution, Scene, and Continuity arrays generally select TOON, while heterogeneous state remains compact JSON. The selected representation is strict-decoded or parsed and compared with the source value before it can enter the prompt. A failed round trip is an error, not a prose fallback. The resulting wire starts with a versioned `senera.*=v1` envelope, marks the data as host-projected state, and keeps block boundaries explicit so the model can read the data without field-by-field XML expansion.

`renderAgentPromptContextWires` is the canonical per-turn projection set. It produces the merged volatile wire plus the named Scene, Continuity, facts, resident-profile, and Workflow adapters from one snapshot; the standalone helpers delegate to the same builders for diagnostics and compatibility templates. `SceneContext.liquid`, `ContinuityMemory.liquid`, `ContinuityFacts.liquid`, and `ResidentProfile.liquid` are thin adapters that accept those pre-rendered wires. They do not maintain a second field-by-field projection.

The old XML templates and XML planner projectors remain only as explicitly deprecated compatibility surfaces for persisted/exported callers. They are not selected by the Pi turn renderer or the BAML planner path.

Conversation-space and effective-model identity are volatile turn facts rather than stable prompt content. They stay in the request-local overlay, while the frozen and stable tiers remain byte-identical across sessions that share the same runtime and prompt revisions. Cache scopes remain host-side identifiers and are not presented as model instructions.

Pi receives the frozen and stable tiers as its system prompt. At provider-context projection time, it injects exactly one hidden `senera.live_context` custom message immediately after the active real user message. That overlay is request-local: it is never persisted into Pi session history, never becomes input to a compaction/tree summary, and is regenerated from the latest host state on the next lease. Legacy `senera.turn_context` entries remain in old JSONL only as audit evidence and are stripped from the runtime/provider path. This preserves a byte-stable provider prefix without accumulating duplicate live state across turns.

This module consumes the `AgentExtensionRegistry`; it does not scan System extension packages, MCP descriptors, or Skill directories. Active Skill documents are projected by Pi resources and injected once through Pi's standard Skill invocation envelope. Markdown documentation remains Markdown and is never converted node-by-node into XML. This module does not create schemas, execute model requests, or parse model output.
