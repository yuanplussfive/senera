# Prompt

`Prompt` is the sole compiler for Senera-owned model context. It keeps reusable identity separate from turn-specific retrieval and workflow state.

- `AgentPromptContextBuilder` assembles the structured context.
- `AgentPromptToolContextProjector` projects registered tool descriptions and contracts.
- `AgentPromptContractRenderer` renders JSON Schema-derived parameter contracts.
- `AgentPromptDocumentationReader` reads selected Markdown resources.
- `AgentPromptRenderer` renders the final prompt.

The stable tier contains the Senera kernel, active persona identity and voice examples, and execution environment. The turn tier contains the mutable resident profile, relevant persona lore, recalled continuity facts and evidence handles, evaluated conditions, Goal/Execution/Todo workflow state, the current world ledger, and the current root command. A compact `current_scene` projection is placed after the reference material so the resident can prioritize the immediate location, activity, body and emotion state, relationship, interruption, latest event, and next plan without duplicating the full world snapshot. Mutable state therefore cannot invalidate or silently replace the stable persona layer.

Pi receives the stable tier as its system prompt. The turn tier is persisted as one hidden append-only `senera.turn_context` message immediately after the owning user message. Earlier snapshots remain historical evidence; the newest snapshot is authoritative for current memory, world, workflow, Skill, and resource state. This layout preserves a byte-stable provider prefix across ordinary turns without hiding state changes from the model.

This module consumes the `AgentExtensionRegistry`; it does not scan System extension packages, MCP descriptors, or Skill directories. Active Skill documents are projected by Pi resources and injected once through Pi's standard Skill invocation envelope. Markdown documentation remains Markdown and is never converted node-by-node into XML. This module does not create schemas, execute model requests, or parse model output.
