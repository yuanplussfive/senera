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
  RunStarted: "run.started",
  RunActivityChanged: "run.activity.changed",
  RunCancellationProgress: "run.cancellation.progress",
  PromptSummary: "prompt.summary",
  ActionPlannerStageStarted: "action.planner.stage.started",
  ActionPlannerStageCompleted: "action.planner.stage.completed",
  ActionPlannerStageFailed: "action.planner.stage.failed",
  InteractionRouted: "interaction.routed",
  ActionPlanned: "action.planned",
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
  PluginConfigSnapshot: "plugin.config.snapshot",
  ProfileSnapshot: "profile.snapshot",
  PresetSnapshot: "preset.snapshot",
  PresetFailed: "preset.failed",
} as const;
export type EventKind = (typeof EventKinds)[keyof typeof EventKinds];

export const AuthenticationSessionStates = {
  Disabled: "disabled",
  Anonymous: "anonymous",
  Authenticated: "authenticated",
} as const;
export type AuthenticationSessionState = (typeof AuthenticationSessionStates)[keyof typeof AuthenticationSessionStates];

export const WebSocketCloseCodes = {
  AuthenticationRequired: 4401,
  AccessForbidden: 4403,
} as const;
export type WebSocketCloseCode = (typeof WebSocketCloseCodes)[keyof typeof WebSocketCloseCodes];

export const WebSocketCloseReasons = {
  AuthenticationRequired: "authentication_required",
  AccessForbidden: "access_forbidden",
} as const;
