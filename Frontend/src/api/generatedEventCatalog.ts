// Generated from Source/AgentSystem/Events/AgentEventCatalog.ts.
// Run `npm run generatefrontendevents` after editing the backend event catalog.

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
  RunStarted: "run.started",
  PromptSummary: "prompt.summary",
  ActionPlannerStageStarted: "action.planner.stage.started",
  ActionPlannerStageCompleted: "action.planner.stage.completed",
  ActionPlannerStageFailed: "action.planner.stage.failed",
  InteractionRouted: "interaction.routed",
  ActionPlanned: "action.planned",
  ModelStarted: "model.started",
  ModelDelta: "model.delta",
  ModelCompleted: "model.completed",
  PiTrace: "pi.trace",
  ToolCallsPlanned: "tool.calls.planned",
  ToolCallStarted: "tool.call.started",
  ToolCallCompleted: "tool.call.completed",
  ToolCallFailed: "tool.call.failed",
  ToolCallResultDetail: "tool.call.result.detail",
  AssistantMessageCreated: "assistant.message.created",
  ApprovalRequested: "approval.requested",
  ApprovalResolved: "approval.resolved",
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
