# Glossary

`ActionPlanner`
: Structured model-call layer used by PiProxy for the next controller decision, tool argument materialization, repair, and related learning/safety calls.

`Artifact`
: Traceable record of a tool call, including redacted inputs, raw output, summaries, evidence, and workspace changes.

`Contract`
: A stable typed or schema-validated boundary, such as a tool JSON Schema, runtime configuration, or event payload.

`Evidence`
: Structured facts derived from a tool result and traceable through an evidence or artifact URI.

`Extension Registry`
: The normalized runtime catalog of System Tools, MCP tools, Skills, templates, and root-command policies.

`Host Capability`
: A trusted tool implementation inside the Senera host. Reserved for runtime control and internal services.

`MCP Package`
: A portable MCP server package using MCPB `manifest.json`, Registry `server.json`, or the legacy `.mcp.json` compatibility format. The server owns its `tools/list` declarations; Senera normalizes only connection and typed input metadata.

`System Extension`
: A trusted package under `System/Extensions/<id>` whose manifest maps package-contained contracts to pre-registered host capabilities. It cannot load arbitrary workspace modules.

`Projection`
: A transformation from internal state into the shape needed by a model, UI, artifact, or transport.

`Root Command`
: A single-step runtime policy that defines visible output and allowed tool scope.

`Skill`
: A standard `SKILL.md` package that contributes trigger guidance, workflows, and optional scripts/references. A Skill does not register a tool.

`System Tool`
: An always-loaded trusted host tool contributed by a System extension package and implemented by a pre-registered capability.

`Tool Contract`
: The input, output, execution, runtime, resource, search, approval, and artifact metadata of a registered tool.

`Turn Preparation`
: Deterministic activation of Skills, initial Tool retrieval, RootCommand construction, and the immutable per-turn authorization grant before Pi is prompted.
