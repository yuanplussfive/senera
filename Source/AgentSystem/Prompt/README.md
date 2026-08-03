# Prompt

`Prompt` projects registered tools, execution context, root commands, and presets into model-readable context.

- `AgentPromptContextBuilder` assembles the structured context.
- `AgentPromptToolContextProjector` projects registered tool descriptions and contracts.
- `AgentPromptContractRenderer` renders JSON Schema-derived parameter contracts.
- `AgentPromptDocumentationReader` reads selected Markdown resources.
- `AgentPromptRenderer` renders the final prompt.

This module consumes the `AgentExtensionRegistry`; it does not scan System extension packages, MCP descriptors, or Skill directories. Active Skill documents are projected by Pi resources and injected once through Pi's standard Skill invocation envelope. Markdown documentation remains Markdown and is never converted node-by-node into XML. This module does not create schemas, execute model requests, or parse model output.
