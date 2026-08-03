// Generated from backend event and transport protocol contracts.
// Run `npm run generate.frontend-events` after editing those contracts.

export const EventLayers = {
  Progress: "progress",
  Snapshot: "snapshot",
  Terminal: "terminal",
  Error: "error",
} as const;
export type EventLayer = (typeof EventLayers)[keyof typeof EventLayers];

export const EventPhases = {
  Request: "request",
  Session: "session",
  Prompt: "prompt",
  Model: "model",
  Decision: "decision",
  Tool: "tool",
  Run: "run",
  Approval: "approval",
  Sandbox: "sandbox",
  Config: "config",
} as const;
export type EventPhase = (typeof EventPhases)[keyof typeof EventPhases];

export const EventKinds = {
  SessionCreated: "session.created",
  SessionSnapshot: "session.snapshot",
  SessionClosed: "session.closed",
  SessionBusy: "session.busy",
  SessionNotFound: "session.not_found",
  SessionListSnapshot: "session.list.snapshot",
  SessionHistoryStarted: "session.history.started",
  SessionHistoryChunk: "session.history.chunk",
  SessionHistorySteps: "session.history.steps",
  SessionRunHistoryChunk: "session.run_history.chunk",
  SessionHistoryCompleted: "session.history.completed",
  SessionTruncated: "session.truncated",
  SessionForked: "session.forked",
  SessionCompacted: "session.compacted",
  SessionRuntimeStatus: "session.runtime_status",
  SessionExported: "session.exported",
  RunStarted: "run.started",
  RunActivityChanged: "run.activity.changed",
  RunCancellationProgress: "run.cancellation.progress",
  PromptSummary: "prompt.summary",
  ModelStarted: "model.started",
  ModelDelta: "model.delta",
  ModelCompleted: "model.completed",
  ToolCallsPlanned: "tool.calls.planned",
  ToolCallStarted: "tool.call.started",
  ToolCallOutput: "tool.call.output",
  ToolCallProgress: "tool.call.progress",
  ToolCallCompleted: "tool.call.completed",
  ToolCallFailed: "tool.call.failed",
  ToolCallResultDetail: "tool.call.result.detail",
  AssistantMessageCreated: "assistant.message.created",
  ApprovalRequested: "approval.requested",
  ApprovalResolved: "approval.resolved",
  InteractionInputRequested: "interaction.input.requested",
  InteractionInputResolved: "interaction.input.resolved",
  ExecutionResourceCreated: "execution.resource.created",
  ExecutionResourceOutput: "execution.resource.output",
  ExecutionResourceResized: "execution.resource.resized",
  ExecutionResourceState: "execution.resource.state",
  ExecutionResourceRemoved: "execution.resource.removed",
  ExecutionResourceSnapshot: "execution.resource.snapshot",
  SandboxStatusSnapshot: "sandbox.status.snapshot",
  RunCompleted: "run.completed",
  RunFailed: "run.failed",
  RunCancelled: "run.cancelled",
  RequestInvalid: "request.invalid",
  ConfigReloaded: "config.reloaded",
  ConfigFailed: "config.failed",
  ConfigSnapshot: "config.snapshot",
  ModelListSnapshot: "model.list.snapshot",
  ProviderModelsSnapshot: "provider.models.snapshot",
  ProviderModelsFailed: "provider.models.failed",
  ProfileSnapshot: "profile.snapshot",
  PresetSnapshot: "preset.snapshot",
  PresetFailed: "preset.failed",
  SystemToolSnapshot: "system_tool.snapshot",
  McpServerSnapshot: "mcp_server.snapshot",
} as const;
export type EventKind = (typeof EventKinds)[keyof typeof EventKinds];

export const EventChannels = {
  AgentEvent: "agent.event",
} as const;
export type EventChannel = (typeof EventChannels)[keyof typeof EventChannels];

export const EventSpecs = {
  "session.created": {
    layer: "snapshot",
    phase: "session",
  },
  "session.snapshot": {
    layer: "snapshot",
    phase: "session",
  },
  "session.closed": {
    layer: "terminal",
    phase: "session",
  },
  "session.busy": {
    layer: "error",
    phase: "session",
  },
  "session.not_found": {
    layer: "error",
    phase: "session",
  },
  "session.list.snapshot": {
    layer: "snapshot",
    phase: "session",
  },
  "session.history.started": {
    layer: "snapshot",
    phase: "session",
  },
  "session.history.chunk": {
    layer: "snapshot",
    phase: "session",
  },
  "session.history.steps": {
    layer: "snapshot",
    phase: "session",
  },
  "session.run_history.chunk": {
    layer: "snapshot",
    phase: "session",
  },
  "session.history.completed": {
    layer: "snapshot",
    phase: "session",
  },
  "session.truncated": {
    layer: "snapshot",
    phase: "session",
  },
  "session.forked": {
    layer: "snapshot",
    phase: "session",
  },
  "session.compacted": {
    layer: "snapshot",
    phase: "session",
  },
  "session.runtime_status": {
    layer: "snapshot",
    phase: "session",
  },
  "session.exported": {
    layer: "snapshot",
    phase: "session",
  },
  "run.started": {
    layer: "progress",
    phase: "run",
  },
  "run.activity.changed": {
    layer: "progress",
    phase: "run",
  },
  "run.cancellation.progress": {
    layer: "progress",
    phase: "run",
  },
  "prompt.summary": {
    layer: "progress",
    phase: "prompt",
  },
  "model.started": {
    layer: "progress",
    phase: "model",
  },
  "model.delta": {
    layer: "progress",
    phase: "model",
  },
  "model.completed": {
    layer: "snapshot",
    phase: "model",
  },
  "tool.calls.planned": {
    layer: "progress",
    phase: "tool",
  },
  "tool.call.started": {
    layer: "progress",
    phase: "tool",
  },
  "tool.call.output": {
    layer: "progress",
    phase: "tool",
  },
  "tool.call.progress": {
    layer: "progress",
    phase: "tool",
  },
  "tool.call.completed": {
    layer: "progress",
    phase: "tool",
  },
  "tool.call.failed": {
    layer: "error",
    phase: "tool",
  },
  "tool.call.result.detail": {
    layer: "snapshot",
    phase: "tool",
  },
  "assistant.message.created": {
    layer: "progress",
    phase: "run",
  },
  "approval.requested": {
    layer: "progress",
    phase: "approval",
  },
  "approval.resolved": {
    layer: "progress",
    phase: "approval",
  },
  "interaction.input.requested": {
    layer: "progress",
    phase: "tool",
  },
  "interaction.input.resolved": {
    layer: "progress",
    phase: "tool",
  },
  "execution.resource.created": {
    layer: "snapshot",
    phase: "tool",
  },
  "execution.resource.output": {
    layer: "progress",
    phase: "tool",
  },
  "execution.resource.state": {
    layer: "snapshot",
    phase: "tool",
  },
  "execution.resource.resized": {
    layer: "snapshot",
    phase: "tool",
  },
  "execution.resource.removed": {
    layer: "snapshot",
    phase: "tool",
  },
  "execution.resource.snapshot": {
    layer: "snapshot",
    phase: "tool",
  },
  "sandbox.status.snapshot": {
    layer: "snapshot",
    phase: "sandbox",
  },
  "run.completed": {
    layer: "terminal",
    phase: "run",
  },
  "run.failed": {
    layer: "error",
    phase: "run",
  },
  "run.cancelled": {
    layer: "terminal",
    phase: "run",
  },
  "request.invalid": {
    layer: "error",
    phase: "request",
  },
  "config.reloaded": {
    layer: "snapshot",
    phase: "config",
  },
  "config.failed": {
    layer: "error",
    phase: "config",
  },
  "config.snapshot": {
    layer: "snapshot",
    phase: "config",
  },
  "model.list.snapshot": {
    layer: "snapshot",
    phase: "config",
  },
  "provider.models.snapshot": {
    layer: "snapshot",
    phase: "config",
  },
  "provider.models.failed": {
    layer: "error",
    phase: "config",
  },
  "profile.snapshot": {
    layer: "snapshot",
    phase: "config",
  },
  "preset.snapshot": {
    layer: "snapshot",
    phase: "config",
  },
  "preset.failed": {
    layer: "error",
    phase: "config",
  },
  "system_tool.snapshot": {
    layer: "snapshot",
    phase: "config",
  },
  "mcp_server.snapshot": {
    layer: "snapshot",
    phase: "config",
  },
} as const satisfies Record<EventKind, { readonly layer: EventLayer; readonly phase: EventPhase }>;

export const AuthenticationSessionStates = {
  Disabled: "disabled",
  Anonymous: "anonymous",
  Authenticated: "authenticated",
} as const;
export type AuthenticationSessionState = (typeof AuthenticationSessionStates)[keyof typeof AuthenticationSessionStates];

export const ConfigSecretContract = {
  RedactedPlaceholder: "__senera_redacted_secret__",
} as const;

export const WebSocketCloseCodes = {
  AuthenticationRequired: 4401,
  AccessForbidden: 4403,
} as const;
export type WebSocketCloseCode = (typeof WebSocketCloseCodes)[keyof typeof WebSocketCloseCodes];

export const WebSocketCloseReasons = {
  AuthenticationRequired: "authentication_required",
  AccessForbidden: "access_forbidden",
} as const;
