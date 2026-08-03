# MCP Packages

MCP packages are portable MCP server bundles discovered from bundled `McpServers` and workspace `.senera/mcp` roots. Descriptor adapters normalize MCPB `manifest.json`, Registry `server.json`, and legacy `.mcp.json`; pure MCP packages never require Senera `extension.json`. A package with multiple runnable descriptors or routes is rejected rather than resolved by first match. Tool names, descriptions, input/output Schemas, annotations, cancellation, progress, tasks, elicitation, and list-change notifications remain MCP protocol concerns.

MCPB `user_config` and Registry Input metadata become typed definitions with explicit Secret/config bindings. Secret values use the encrypted server-scoped Vault; ordinary values use typed JSON storage. Host environment fallback exists only when explicitly declared or inside the legacy adapter. Settings events never project Secret values.

The settings client edits all inputs for one server locally and commits them with one `mcpInput.update` request. The request carries a required correlation id plus `values` and optional `deletes`. The service resolves definitions by exact input id, validates the complete batch before writing, rejects set/delete conflicts and undeclared inputs, then commits encrypted Secrets and ordinary JSON values in one SQLite transaction. A failed field leaves every table and revision unchanged. Each affected Secret/config revision advances at most once per batch.

Successful snapshots echo only the operation correlation id. Failures echo request type, server id and correlation id, never request values or delete names. `mcpInput.set/delete` and `mcpCredential.set/delete` remain compatibility commands for older clients; the settings UI uses only the batch command.

Settings discovery uses shared revision-driven snapshots. The System extension snapshot is keyed by the canonical runtime configuration and the `System/Extensions` directory revision. MCP package discovery adds bundled and workspace MCP directory revisions; input-storage and restart revisions only invalidate the lightweight server-status projection. A System settings request therefore traverses and parses each extension once per source revision, and credential edits never rescan package descriptors.

`AgentMcpPackageDiscovery` opens each server, reads `tools/list`, and validates every declaration and JSON Schema before publication. `AgentMcpPackageToolProjector` maps validated declarations into the common registry without adding package-specific runtime code.

Standard MCP `readOnlyHint` annotations are preserved in the registry. A package may additionally project explicit Senera resource claims when it can identify workspace or host resources from arguments. Scheduling uses those declarations rather than package names or tool-name rules.

`AgentMcpPackageCatalog` owns publication. Initial installation and later updates replace tools by server owner. Updates are serialized per server and transactional: reference validation failure restores the previous tools. Successful publication invalidates ToolSearch so the next retrieval observes the new catalog.

Startup discovery and persistent execution share the runtime-owned MCP client pool, keyed by endpoint, execution profile, and negotiated host capabilities. The discovery connection therefore remains subscribed through the MCP SDK's `listChanged.tools` option before the first tool call. The SDK negotiates server support, debounces notifications, and refreshes `tools/list`; Senera does not parse custom stdout frames or implement a second notification protocol. A notification racing initial publication is retained per server and replayed after the first catalog snapshot is installed.

An active Pi turn keeps its original tool Schemas. Calls carry the projected contract digest to the executor, which rejects a same-name tool if its registry contract changed mid-turn. Newly added tools are outside that turn's immutable authorization grant and become eligible on the next turn.

MCP execution is resource-aware rather than globally serialized. Explicit resource claims take precedence. Without them, calls are isolated by MCP server identity: read-only calls to the same server may run concurrently, a write conflicts with reads and writes on that server, and calls to different servers do not block one another. Elicitation remains serialized per live connection because the MCP client owns one active user interaction at a time.
