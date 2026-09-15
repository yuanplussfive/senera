# Prompt

`Prompt` is the sole compiler for Senera-owned model context. It keeps reusable identity separate from turn-specific retrieval and workflow state.

- `AgentPromptContextBuilder` assembles the structured context.
- `AgentPromptToolContextProjector` projects registered tool descriptions and contracts.
- `AgentPromptContractRenderer` renders JSON Schema-derived parameter contracts.
- `AgentPromptDocumentationReader` reads selected Markdown resources.
- `AgentPromptRenderer` renders the final prompt.

The stable tier contains the Senera kernel, active persona identity and voice examples, and execution environment. The turn tier contains the mutable resident profile, relevant persona lore, recalled continuity facts and evidence handles, evaluated conditions, Goal/Execution/Todo workflow state, the current world ledger, and the current root command. A compact `current_scene` projection is placed after the reference material so the resident can prioritize the immediate location, activity, body and emotion state, relationship, interruption, latest event, and next plan without duplicating the full world snapshot. Mutable state therefore cannot invalidate or silently replace the stable persona layer.

All model-facing structured context is serialized by `AgentPromptContextWireRenderer` before Liquid rendering. Each block declares its permitted lossless encodings and is measured with the active model tokenizer; uniform Todo, delegation, execution, Scene, and Continuity arrays generally select TOON, while heterogeneous state remains compact JSON. The selected representation is strict-decoded or parsed and compared with the source value before it can enter the prompt. A failed round trip is an error, not a prose fallback. The resulting wire starts with a versioned `senera.*=v1` envelope, marks the data as host-projected state, and keeps block boundaries explicit so the model can read the data without field-by-field XML expansion.

`renderAgentPromptContextWires` is the canonical per-turn projection set. It produces the merged volatile wire plus the named Scene, Continuity, facts, resident-profile, and Workflow adapters from one snapshot; the standalone helpers delegate to the same builders for diagnostics and compatibility templates. `SceneContext.liquid`, `ContinuityMemory.liquid`, `ContinuityFacts.liquid`, and `ResidentProfile.liquid` are thin adapters that accept those pre-rendered wires. They do not maintain a second field-by-field projection.

The old XML templates and XML planner projectors remain only as explicitly deprecated compatibility surfaces for persisted/exported callers. They are not selected by the Pi turn renderer or the BAML planner path.

Conversation-space and effective-model identity are volatile turn facts rather than stable prompt content. They are therefore appended to the hidden turn context, while the frozen and stable tiers remain byte-identical across sessions that share the same runtime and prompt revisions. Cache scopes remain host-side identifiers and are not presented as model instructions.

Pi receives the stable tier as its system prompt. The turn tier is persisted as one hidden append-only `senera.turn_context` message immediately after the owning user message. Earlier snapshots remain historical evidence; the newest snapshot is authoritative for current memory, world, workflow, Skill, and resource state. This layout preserves a byte-stable provider prefix across ordinary turns without hiding state changes from the model.

This module consumes the `AgentExtensionRegistry`; it does not scan System extension packages, MCP descriptors, or Skill directories. Active Skill documents are projected by Pi resources and injected once through Pi's standard Skill invocation envelope. Markdown documentation remains Markdown and is never converted node-by-node into XML. This module does not create schemas, execute model requests, or parse model output.
