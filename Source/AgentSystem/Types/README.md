# Types

`Types` contains cross-module contracts without parsing, defaults, I/O, or runtime behavior.

- `AgentConfigTypes` and the domain-specific config files describe resolved configuration.
- `AgentToolContractTypes` describes normalized tool policy and discovery metadata.
- `AgentToolRuntimeTypes` describes registered tools and handlers.
- `AgentExtensionRuntimeTypes` describes System Tool and MCP ownership.
- `AgentArtifactContractTypes` and `AgentToolSearchContractTypes` describe evidence and search contracts.
- `ToolRuntimeTypes` contains execution results and runtime service boundaries.

Import from the owning type module. Avoid aggregate compatibility barrels and avoid coupling these contracts to a source directory layout.
