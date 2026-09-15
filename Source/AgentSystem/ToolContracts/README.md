# Tool Contracts

`AgentJsonSchemaPromptContractProjector` turns a validated JSON object schema into the compact parameter view used by planning and prompt projection.

System Tool schemas originate from package-contained contracts under `System/Extensions`; Zod-defined contracts are generated and drift-checked at build time. MCP schemas originate from each standard MCP server's `tools/list` response after descriptor adaptation. Runtime registration validates and freezes those declarations before this projector sees them. This directory does not discover source packages or reinterpret descriptor formats.
