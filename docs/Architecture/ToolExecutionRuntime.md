# Tool Execution Runtime

Senera separates model actions from executable capabilities. Native models send Tool Calling through Pi's provider adapters; BAML models use the structured planning compiler. Pi coordinates dependencies and tool calls, while the tool runtime validates, authorizes, executes, records, and returns observations for both paths.

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

## Sandbox runtime

Desktop, source, Nano, and Compose deployments use one Docker Worker protocol. Provider selection chooses a registered `runsc` runtime when available and otherwise uses the hardened Docker Engine default; neither path falls back to host execution. The versioned runtime image owns the POSIX toolchain and Linux Terminal Sidecar, including its native PTY dependency, so opening a terminal does not require a host-prepared guest bundle or per-call Sidecar copy.

The complete workspace is mounted at the contract's guest workspace root. Read-only tools receive a read-only mount and writable tools receive a writable mount; `.git`, `.senera`, and ordinary project paths follow the same mount mode. Extra writable mounts and declared rootfs copies remain source-whitelisted by the Worker.

## Inputs and Secrets

External descriptor inputs normalize to typed definitions and explicit bindings. Secret bindings resolve only from encrypted Vault/OAuth sources; ordinary configuration resolves from typed JSON storage; host environment access occurs only for an explicit host binding or the legacy `.mcp.json` compatibility adapter. Defaults and choices remain descriptor data rather than runtime name heuristics. Missing inputs disable only the affected server.

## Validation and scheduling

Input JSON Schema is validated before dispatch and output JSON Schema after a successful response. Native and structured tool batches use the same execution scheduler. Ordinary tools run in parallel by default, while `ToolExecution.MaxConcurrentCallsPerRun` bounds each run without changing permission or sandbox policy. Calls beyond that capacity wait and remain cancellable.

System Tool contracts declare one scheduling mode:

- `Parallel` uses only the per-run capacity and an optional tool-wide `Runtime.MaxConcurrency` limit.
- `ResourceClaims` projects RFC 6901 resource arguments through named capabilities. Independent reads and disjoint writes can run concurrently; overlapping writes serialize.
- `SelfManaged` delegates concurrency and lifecycle ownership to orchestration, interaction, or execution-resource runtimes.

Resource declarations are valid only with `ResourceClaims`, and Host Tools using that mode must declare at least one resource. Missing arguments, unavailable claim capabilities, and empty claim projections are contract or invocation failures; they never become a hidden global-exclusive lease. MCP Tools explicitly use server-scoped resource claims, honoring the standard read-only annotation when available.

## Authorization preflight

The provider registers the complete assistant tool-call batch before Pi invokes its per-call hook. Senera starts one idempotent preflight set for that batch, bounded by `ToolExecution.MaxConcurrentCallsPerRun`; later Pi callbacks await the already-running result for their call ID. This preserves Pi's standard loop while avoiding serialized model audits and allows every approval in the same batch to become pending together.

Authorization has two explicit stages. Tool declarations, access grants, argument schemas, execution targets, AI SDK guardrails, OPA, workspace boundaries, and sandbox policy are deterministic enforcement and always run. The optional BAML risk auditor is advisory: `ToolExecution.SemanticAudit.Mode=approval_sensitive` invokes it only for BAML planning, when the deterministic decision is `allow`, and when `always_ask` can surface a semantic `ask` to the user. Native planning never constructs or calls this auditor. Deterministic `ask` or `deny`, `agent`, `full_access`, and `disabled` therefore do not pay for that model call. `full_access` projects an `ask` to `allow` but preserves every deterministic `deny`; disabling semantic auditing does not weaken deterministic enforcement.

Pi's `tool_execution_start` callback begins before its internal preflight. It is not published as `tool.call.started`. Planned calls enter the UI as pending from `tool.calls.planned`; the executor publishes `tool.call.started` only after authorization and scheduler admission. The Pi collector remains responsible for the artifact-enriched result detail and emits a fallback terminal lifecycle only when execution never reached the executor.

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
