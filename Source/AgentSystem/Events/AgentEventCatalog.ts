export const AgentEventLayers = {
  Progress: "progress",
  Snapshot: "snapshot",
  Terminal: "terminal",
  Error: "error",
} as const;

export type AgentEventLayer = (typeof AgentEventLayers)[keyof typeof AgentEventLayers];

export const AgentEventPhases = {
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

export type AgentEventPhase = (typeof AgentEventPhases)[keyof typeof AgentEventPhases];

export const AgentEventKinds = {
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

export type AgentEventKind = (typeof AgentEventKinds)[keyof typeof AgentEventKinds];

export const AgentEventChannels = {
  AgentEvent: "agent.event",
} as const;

export type AgentEventChannel = (typeof AgentEventChannels)[keyof typeof AgentEventChannels];

export const AgentEventSpecTable: {
  [K in AgentEventKind]: {
    layer: AgentEventLayer;
    phase: AgentEventPhase;
  };
} = {
  [AgentEventKinds.SessionCreated]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionClosed]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionBusy]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionNotFound]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionListSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionHistoryStarted]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionHistoryChunk]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionHistorySteps]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionRunHistoryChunk]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionHistoryCompleted]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionTruncated]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionForked]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.RunStarted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.RunActivityChanged]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.RunCancellationProgress]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.PromptSummary]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Prompt,
  },
  [AgentEventKinds.ActionPlannerStageStarted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.ActionPlannerStageCompleted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.ActionPlannerStageFailed]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.InteractionRouted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.ActionPlanned]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.ModelStarted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Model,
  },
  [AgentEventKinds.ModelDelta]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Model,
  },
  [AgentEventKinds.ModelCompleted]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Model,
  },
  [AgentEventKinds.ToolCallsPlanned]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ToolCallStarted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ToolCallOutput]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ToolCallProgress]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ToolCallCompleted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ToolCallFailed]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ToolCallResultDetail]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.AssistantMessageCreated]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.ApprovalRequested]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Approval,
  },
  [AgentEventKinds.ApprovalResolved]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Approval,
  },
  [AgentEventKinds.InteractionInputRequested]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.InteractionInputResolved]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ExecutionResourceCreated]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ExecutionResourceOutput]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ExecutionResourceState]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ExecutionResourceResized]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ExecutionResourceRemoved]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ExecutionResourceSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.SandboxStatusSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Sandbox,
  },
  [AgentEventKinds.RunCompleted]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.RunFailed]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.RunCancelled]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.RequestInvalid]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Request,
  },
  [AgentEventKinds.ConfigReloaded]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Config,
  },
  [AgentEventKinds.ConfigFailed]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Config,
  },
  [AgentEventKinds.ConfigSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Config,
  },
  [AgentEventKinds.ModelListSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Config,
  },
  [AgentEventKinds.ProviderModelsSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Config,
  },
  [AgentEventKinds.ProviderModelsFailed]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Config,
  },
  [AgentEventKinds.PluginConfigSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Config,
  },
  [AgentEventKinds.ProfileSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Config,
  },
  [AgentEventKinds.PresetSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Config,
  },
  [AgentEventKinds.PresetFailed]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Config,
  },
};

export function getAgentEventSpec(kind: AgentEventKind): {
  layer: AgentEventLayer;
  phase: AgentEventPhase;
} {
  return AgentEventSpecTable[kind];
}
