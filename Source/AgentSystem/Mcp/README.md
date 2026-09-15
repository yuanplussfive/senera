# MCP client module

The MCP client module adapts SDK transports and capabilities to Senera tool execution. It does not own tool policy, Agent loop behavior, or WebSocket projection.

## Responsibilities

- `AgentMcpToolClient` is the stable public facade and connection composition root. It opens HTTP/stdio transports, lists tools, starts calls, reattaches tasks, and closes the SDK client.
- `AgentMcpToolClientContracts` owns public call options, task projections, and stable MCP client errors.
- `AgentMcpToolClientRequestPolicy` owns timeout, abort, deadline, progress, and connection-failure precedence.
- `AgentMcpElicitationController` serializes an active interaction owner, handles form/URL elicitation, and settles elicitation tasks.
- `AgentMcpCallNotificationController` owns output/progress tokens, live task-event ordering, replay cursors, and task-event capability checks.
- `AgentMcpTaskController` owns task stream consumption, detach detection, reattachment polling, cancellation, and terminal result retrieval.

## Boundary rules

- Controllers depend on contracts and SDK types, never on `AgentMcpToolClient`; the facade wires controllers in one direction.
- A resumable event cursor advances only through contiguous events. Replay gaps or non-advancing pages fail explicitly and cannot be skipped or guessed.
- Output/progress token registration is scoped to one call and must be removed in `finally`, including URL-elicitation retries.
- Elicitation-enabled calls require an explicit interaction owner and run under the elicitation lease. No controller may infer an owner from payload fields or ambient Session state.
- Task cancellation and connection failure precedence remain request-policy concerns; callers receive stable typed errors rather than SDK-specific first-match handling.

## Result handling

`AgentMcpToolResultAdapter` only interprets MCP-defined `CallToolResult` content blocks. Text, resource links, and embedded text are projected into the model-safe result. Binary image, audio, and embedded-blob blocks cross the host-owned `AgentResourcePublisher` boundary first; the default publisher is the upload store, so bytes are written below the configured `.senera/uploads` root with a random `upl_...` identity, integrity metadata, quota enforcement, and retention. The model and frontend receive only the resulting canonical `senera://resource/<id>` reference, never a provider-local name or base64 payload. The original MCP envelope is retained as a redacted, durable-only `rawResponse` with those binary blocks replaced by the canonical reference. `structuredContent` remains opaque plugin JSON; its field names are never used to infer media or domain semantics. An optional `outputSchema` validates that JSON but does not drive conversion.

All successful MCP and host-tool results then pass through the shared Artifact recorder. The recorder keeps the redacted raw result and adds bounded generic provenance for the result. Plugins use standard MCP content blocks; there is no second Senera-specific asset metadata channel that can create a competing resource identity.
