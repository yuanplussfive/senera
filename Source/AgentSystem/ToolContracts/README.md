# Tool Contracts

`AgentJsonSchemaPromptContractProjector` turns a validated JSON object schema into the compact parameter view used by planning and prompt projection.

System Tool schemas originate from package-contained contracts under `System/Extensions`; Zod-defined contracts are generated and drift-checked at build time. MCP schemas originate from each standard MCP server's `tools/list` response after descriptor adaptation. Runtime registration validates and freezes those declarations before this projector sees them. This directory does not discover source packages or reinterpret descriptor formats.

`AgentToolModelOutput` owns the `x-senera-model-output` schema annotation. A producer declares JSON Pointer patterns for diagnostic fields omitted from the model's result. Registry validation checks the pointers before publication. The shared copy-on-write projection preserves stored results and array positions; tool discovery and memory token selection consume the same declaration. It does not guess field meaning or own token limits and compression.

Its keyword meta-schema inherits the enclosing validator's dialect. The generated policy uses vocabulary shared by draft-07 and draft-2020-12, so both strict validators register the same policy without requiring the other's root meta-schema.

`AgentJsonSchemaPointer` follows local reference chains and recursive schemas with cycle detection at each pointer position. Relative paths and collection fields retain their owning root schema, including when an array item references a shared definition. Local references use the shared RFC 6901 reader, including array positions and URI-fragment decoding. Resolution preserves reference siblings, matches declared property patterns and supports both draft-07 tuple items and draft-2020-12 `prefixItems`, so model visibility and resource declarations use the same path semantics. Object and array constants are not classified as scalar fields.
