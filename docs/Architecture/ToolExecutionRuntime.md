# Tool Execution Runtime

Senera separates model actions from executable capabilities. BAML projects a portable final answer, question, or tool plan; Pi coordinates dependencies and tool calls; the tool runtime validates, authorizes, executes, records, and returns observations.

## Registration

At runtime startup:

1. `AgentSystemExtensionCatalog` validates `System/Extensions/<id>/extension.json`, package-contained contracts, and pre-registered host capability references.
2. `AgentMcpPackageScanner` adapts MCPB `manifest.json`, Registry `server.json`, and legacy `.mcp.json` packages into one internal endpoint/input model. Conflicting descriptors and ambiguous routes fail instead of using first-match selection.
3. `AgentMcpPackageDiscovery` connects with the official MCP client, calls `tools/list`, validates returned JSON Schemas, and projects the resulting tools into the registry.
4. `System/Skills` and workspace `.senera/skills` are scanned as standard `SKILL.md` packages.
5. `AgentExtensionRegistry` rejects duplicate tool identities and invalid Skill references.

There is one registered-tool contract after discovery. The executor does not branch on package names or descriptor kinds. System packages cannot load arbitrary runtime modules, and MCP tool schemas remain owned by `tools/list`.

## Execution targets

Legacy MCP packages may declare `execution.targets`; MCPB and Registry stdio packages receive source-based defaults plus optional namespaced policy metadata. The host grants only the intersection with enabled persistent-process backends and rejects an empty intersection. A package cannot weaken the host boundary. Workspace access remains read-only unless the host exposes an authorized native capability.

## Inputs and Secrets

External descriptor inputs normalize to typed definitions and explicit bindings. Secret bindings resolve only from encrypted Vault/OAuth sources; ordinary configuration resolves from typed JSON storage; host environment access occurs only for an explicit host binding or the legacy `.mcp.json` compatibility adapter. Defaults and choices remain descriptor data rather than runtime name heuristics. Missing inputs disable only the affected server.

## Validation and resources

Input JSON Schema is validated before dispatch and output JSON Schema after a successful response. Resource arguments use RFC 6901 pointers and named capabilities. The generic projector resolves canonical paths/uploads, applies workspace containment and OPA rules, and produces resource claims. Independent reads can run concurrently; overlapping writes serialize; an unclassifiable claim conservatively receives an exclusive lease.

## MCP lifecycle

Each package owns a standard MCP Server implementation. Persistent clients are pooled by endpoint revision and execution profile. Cancellation, progress, elicitation, task recovery, and connection replacement use MCP protocol behavior rather than a private stdout control protocol.

`ToolExecution.TimeoutSeconds` is the host deadline for a synchronous tool invocation. The runtime composes that deadline with turn cancellation and passes the resulting signal through both HostCapability and MCP execution. MCP Servers must forward the request signal to upstream I/O. A tool argument or Server-local upstream timeout may request a shorter operation, but cannot extend the host deadline. Long-running work uses execution resources or MCP Tasks instead of increasing a synchronous request timeout. A `RemoteJob` is not assigned a total synchronous deadline: task creation, polling, event replay, and result retrieval each receive the configured MCP request timeout while cancellation remains active for the complete job lifetime.

## Results and evidence

The immediate model observation and durable artifact are separate outputs. The artifact recorder commits the complete redacted result before `AgentToolObservationContextCompiler` builds a bounded source view. System Tools own package-local declarative projection files; MCP keeps standard `outputSchema` and `structuredContent` and receives the host's generic bounded projection. See [Tool Observation Projection](./ToolObservationProjection.md).

Structural limits run before exact tokenization. Pi then allocates the remaining turn budget across already-bounded observations in one `prepare()` pass. Every partial view records omissions and retains its artifact URI. Incremental stdout/stderr and progress events are an out-of-band UI surface and never replace the terminal observation.

Every executed call carries one authoritative three-axis `outcome`:

- `execution.status` records lifecycle facts: `completed`, `timed_out`, `cancelled`, or `not_started`.
- `assessment.status` records `success`, `failure`, or `unassessed`. A failure retains a stable code plus semantic `kind`, `source`, and `retryable` fields.
- `output.availability` records whether the terminal output is `complete`, `partial`, or absent.

`Runtime.ResultAssessment` chooses the assessment policy before dispatch. `ProcessExit` lets the host interpret a nonzero process exit or signal as failure. `Unassessed` preserves exit code, signal, stdout, and stderr without claiming success or failure. Timeout, cancellation, startup failure, invalid protocol responses, MCP `CallToolResult.isError`, and typed HostCapability failures remain authoritative failures under either policy.

Pi observations preserve all three axes. Tool learning accepts only assessed success as a positive example. A plan dependency may consume partial output from a failed call or complete output from an unassessed call; the plan retains the assessment and diagnostic rather than relabeling that call as successful.

`retryable` describes whether a failure is transient; it is never permission to replay a call. Retry orchestration must separately prove that the operation is safe to repeat after considering idempotency, possible side effects, and the current authorization boundary.

Result payloads are application data, not status envelopes. An assessed-success payload may contain a field named `error`, and an empty payload remains successful. Evidence and usefulness scoring may classify a successful call as empty or unproductive, but must not rewrite its execution outcome. No downstream consumer infers failure from payload keys, localized messages, or process fields outside the declared assessment policy.

## Hot replacement

Directory revisions participate in the runtime fingerprint. A valid Skill or MCP source change creates a new runtime generation for the next turn. The cache constructs the replacement before closing an idle prior generation; construction failure leaves the last valid generation intact.
