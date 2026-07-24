# Tool Execution Runtime

Senera treats model-selected actions and tool execution as separate contracts. Models produce the portable
`FinalAnswer`, `AskUser`, or `CallTools` action through BAML. Provider-native tool calling is an optional adapter,
not a runtime dependency.

## Capability negotiation

Every `ManifestVersion: 2` tool must declare `Handler`, `Execution`, and `Runtime` in `PluginManifest.json`:

```json
{
  "Runtime": {
    "Lifecycle": "OneShot",
    "Capabilities": {
      "Progress": true,
      "OutputStreaming": true,
      "Cancellation": true
    }
  }
}
```

There is no handler-kind fallback or v1 compatibility path. Repository governance rejects manifests that omit
these fields. Runtime code branches on the normalized declarations and handler support matrix rather than tool
names, so manifest behavior has one source of truth.

## MCP resource arguments

MCP file and directory arguments are declared under `Handler.Resources` with RFC 6901 JSON Pointers and access
intents. The generic resource projector resolves every declared value through the execution environment before
the request reaches the MCP server. Canonical workspace containment, symlink traversal, and OPA authorization
therefore apply to arbitrary MCP plugins without a central server/tool-name table.

An intent may be fixed or selected from another scalar argument. Conditional intent is reserved for operations
whose side effect genuinely changes with an argument, such as an edit tool whose `dryRun=true` mode is read-only.
The declaration describes resource semantics; it does not replace execution boundaries, permissions, approval,
or OPA policy.

## MCP task ownership

The plugin SDK accepts the MCP `TaskStore` and `TaskMessageQueue` interfaces directly. Its optional
`FileTaskStore` persists terminal state and results in one atomic file per task, serializes transitions per task,
enforces terminal-state immutability, and stores progress/output events as atomic per-cursor records. Task TTL
cleanup removes state, results, and event records together. A new server process converts orphaned non-terminal
records to structured `TaskOwnerLost` failures; it never claims that an in-process execution closure survived a
restart. One live server process must own a file-store root. Distributed workers require a store with explicit
leases and external job reattachment.

After the client has observed a task ID, a transport close or MCP request timeout becomes a typed detached-task
condition. The host replaces the pooled connection once and reattaches with `tasks/get` and `tasks/result`; it
never repeats `tools/call`. This recovers a persisted terminal result or the store's structured owner-loss
failure without duplicating side effects. When `ResumableEvents` is declared, the server must negotiate
`experimental["senera.task-events"].version = 1`. The SDK persists each event before best-effort live delivery;
the host tracks the last contiguous cursor, buffers out-of-order notifications, and replays missing pages through
`senera/tasks/events` before reading terminal state. A cursor gap fails closed.

## MCP elicitation

Interactive MCP tools negotiate both form and URL elicitation. Form requests are schema-validated and suspend the
owning tool call until the user accepts, declines, or cancels. URL requests never navigate automatically. The host
validates the target through one external-URL policy, shows the exact host and URL, and waits for explicit user
consent before opening it. Remote HTTP is rejected; HTTPS is allowed; HTTP is reserved for loopback callbacks; URLs
with embedded credentials are rejected.

An accepted URL request remains owned by the run until the server sends
`notifications/elicitation/complete`. The client namespaces server-provided elicitation IDs per connection to avoid
cross-server collisions. If a tool returns `UrlElicitationRequiredError`, the host performs each requested external
interaction in order, waits for completion, and retries the original tool call once. It does not ask the model to
poll or repeat a side effect. Task-augmented elicitation stores the user response asynchronously through the MCP
task store, and background store failures are routed to the client error channel.

Web clients open validated targets with opener isolation. Desktop clients pass the URL through a sandboxed preload
bridge; the Electron main process validates it again and delegates to the operating system through
`shell.openExternal`. Renderer-created windows are denied.

## Model observations

The immediate model observation and the durable artifact are separate outputs of one execution. The observation
always retains a bounded, redacted projection of the tool result even when an artifact was recorded. Artifacts add
retrieval, audit, evidence, and workspace history; their existence must never replace the result that the next
model turn needs to continue.

Tools can declare observation budgets and continuation selectors without runtime branches on tool names:

```json
{
  "Observation": {
    "MaxTokens": 6000,
    "IncludeArtifactProjection": false,
    "Continuation": {
      "Kind": "cursor",
      "Handle": "$.resourceId",
      "Cursor": "$.cursor",
      "State": "$.state",
      "TerminalStates": ["completed", "failed", "cancelled"]
    }
  }
}
```

The resulting observation carries the bounded result first, followed by continuation metadata, summaries,
artifact/evidence URIs, and optional artifact projection. Token truncation is explicit and reports the original
and omitted token counts. Artifact redaction rules are applied before the result enters the model transcript.

Evidence that hydrates another artifact may declare `PlannerMemory.ArtifactUri` and
`PlannerMemory.ArtifactRefsSlot`. Planner history then points to the source artifact and the refs already loaded,
not to the trace artifact created by the retrieval call. This prevents recursive “read the read result” chains.

## Incremental events

Long-running tools publish ordered events through the existing `AgentEventSink` and WebSocket transport:

- `tool.call.output` carries an output stream, tool-local sequence, text, and byte accounting.
- `tool.call.progress` carries a tool-local sequence and optional completed/total units.
- Existing started, completed, failed, and result-detail events remain the terminal lifecycle contract.

The frontend deduplicates output and progress by tool-local sequence and retains bounded stdout/stderr buffers.
Terminal tool observations remain authoritative for the model; incremental events are an out-of-band user and
observability channel.

## Persistent execution resources

`ShellStartTool` creates a PTY-backed terminal resource and returns immediately with an opaque `resourceId`.
Generic inspect, wait, write, resize, signal, list, and stop-all tools control it without adding provider-specific
action kinds. Pipe-backed process resources use the same broker contract. Terminal metadata records the requested
and effective execution boundary, backend id, supported capabilities, sandbox id, and character-grid dimensions.

Terminal implementations register through `SeneraTerminalBackendRegistry`. The local backend uses ConPTY or a
Unix PTY. The microsandbox backend creates a TTY inside the guest and exposes asynchronous stdin, output, signals,
and lifecycle cleanup through the same session contract. Backend selection is capability-driven; a backend that
does not advertise resize cannot receive a resize call. A sandbox capability or availability failure is a typed
failure for that selected boundary; command failures, non-zero exits, and runtime errors never cause an automatic
host retry.

Shell commands use the structured `{ mode: "shell", dialect, script }` contract. Terminal routing carries the raw
script until the execution boundary is selected, validates the requested dialect against the backend descriptor,
and only then resolves the concrete invocation. Microsandbox resolves `posix-sh` to `/bin/sh -lc`; a Windows local
backend resolves `powershell` to its configured PowerShell invocation. A dialect mismatch is a typed capability
failure; the runtime never translates scripts between dialects or changes the selected execution boundary.

The microsandbox adapter normalizes both public SDK `kind` events and native `eventType` events. PTY-merged
`output` is projected into terminal output; malformed or unknown events fail with `terminal_event_invalid` rather
than leaking an untyped adapter exception. Runtime command errors remain ordinary terminal exits and do not
change execution boundary.

The broker is shared across model-specific runtime generations in the server. A config reload or model switch
therefore does not invalidate a live resource. Standalone runtimes own their broker and close its resources when
the runtime closes. Closing a conversation first settles its active Agent/Pi turn, then closes and removes all
session-owned execution resources, and only then deletes session state. This ordering prevents a terminating turn
from creating a resource after cleanup has already run.

Resource output is stored before event projection. The server publishes resource events through its workspace
event bus, so a reconnected authenticated client continues receiving future events after replaying its cursor.
WebSocket delivery remains best effort: a client that exceeds the configured outbound buffer is disconnected and
recovers through replay instead of consuming unbounded server memory. Buffers, input size, wait duration, active
resource count, idle lifetime, terminal lifetime, sweep cadence, and termination grace are centralized under
`ToolExecution.Resources`.

Ownership uses the workspace plus session identity; request identity is the fallback when no session exists.
This prevents a leaked or guessed resource ID from crossing conversation boundaries. Pipe-process signals target
the process tree, PTY interrupt uses terminal control input, waits are notification-driven, and shutdown escalates
from terminate to kill after the configured grace period. WebSocket controls derive the workspace owner on the
server and accept only the current session identity plus the requested resource operation.

## Shell policy

Shell streams output from both the local and microsandbox backends. Its retained terminal output is bounded using
head-and-tail truncation. Crossing that retention budget stops additional live projection but does not terminate
the process. Other process consumers keep the existing fail-closed overflow behavior unless they explicitly opt
into truncation.

Local one-shot commands, persistent processes, and PTY sessions share `ToolExecution.Environment`. `Inherit`
selects whether the host environment is considered, `IncludeOnly` and `Exclude` filter inherited and requested
values, and `Set` applies authoritative overrides. Microsandbox guests continue to receive only explicitly
projected guest environment values.

The model prompt publishes separate local and sandbox execution targets. Tool callers must choose the declared
shell dialect before producing a script. Sandbox shell tools normally target the Linux `posix-sh` environment;
PowerShell requests require an explicitly selected compatible local backend.

## Patch policy

Workspace patches support local hunks and whole-file replacement. Existing files may include `expectedSha256`,
and every planned source is automatically revalidated immediately before commit. Multi-file writes keep rollback
snapshots and restore earlier file changes if a later operation fails. Individual file writes still use the
execution environment's atomic write implementation and workspace boundary policy.

## External tool transport

Third-party tools use MCP rather than a private plugin-process wire protocol. Plugin manifests bind a tool to an
explicit MCP server and tool name; the runtime validates the declared lifecycle before dispatch. Stdio MCP servers
inherit the same explicit execution-target policy as other persistent processes. Host-native tools use named
capabilities, while interactive shell sessions use the execution-resource broker and its cursor,
ownership, input, resize, signal, and bounded-replay contracts.
