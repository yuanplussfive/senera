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
  Orchestration: "orchestration",
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
  SessionCompacted: "session.compacted",
  SessionRuntimeStatus: "session.runtime_status",
  SessionExported: "session.exported",
  RunStarted: "run.started",
  RunActivityChanged: "run.activity.changed",
  RunCancellationProgress: "run.cancellation.progress",
  PromptSummary: "prompt.summary",
  PromptHarnessComposed: "prompt.harness.composed",
  ContinuitySnapshot: "continuity.snapshot",
  ContinuityRulesSnapshot: "continuity.rules.snapshot",
  ContinuityRecallSettled: "continuity.recall.settled",
  ContinuityRecallQuery: "continuity.recall.query",
  AgendaSnapshot: "agenda.snapshot",
  WorldSnapshot: "world.snapshot",
  TodoListWritten: "todo.list.written",
  ExecutionCreated: "execution.created",
  ExecutionStepStarted: "execution.step.started",
  ExecutionStepCompleted: "execution.step.completed",
  ExecutionBlocked: "execution.blocked",
  ExecutionCompleted: "execution.completed",
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
  ChildRunQueued: "child_run.queued",
  ChildRunStarted: "child_run.started",
  ChildRunAwaitingSupervisor: "child_run.awaiting_supervisor",
  ChildRunResumed: "child_run.resumed",
  ChildRunMessageCreated: "child_run.message.created",
  ChildRunSnapshotUpdated: "child_run.snapshot.updated",
  ChildRunDeadlineExtended: "child_run.deadline.extended",
  ChildRunWrappingUp: "child_run.wrapping_up",
  ChildRunCancelling: "child_run.cancelling",
  ChildRunCompleted: "child_run.completed",
  ChildRunPartialCompleted: "child_run.partial_completed",
  ChildRunInterrupted: "child_run.interrupted",
  ChildRunTimedOut: "child_run.timed_out",
  ChildRunFailed: "child_run.failed",
  ChildRunCancelled: "child_run.cancelled",
  WorkflowStarted: "workflow.started",
  WorkflowSnapshotUpdated: "workflow.snapshot.updated",
  WorkflowPaused: "workflow.paused",
  WorkflowCancelling: "workflow.cancelling",
  WorkflowCompleted: "workflow.completed",
  WorkflowPartialCompleted: "workflow.partial_completed",
  WorkflowFailed: "workflow.failed",
  WorkflowCancelled: "workflow.cancelled",
  ScheduledTaskChanged: "scheduled_task.changed",
  ScheduledTaskRunStarted: "scheduled_task.run.started",
  ScheduledTaskRunCompleted: "scheduled_task.run.completed",
  ScheduledTaskRunFailed: "scheduled_task.run.failed",
  SchedulerStatusSnapshot: "scheduler.status.snapshot",
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
  ChannelStatusSnapshot: "channel.status.snapshot",
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
  [AgentEventKinds.SessionCompacted]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionRuntimeStatus]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionExported]: {
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
  [AgentEventKinds.PromptHarnessComposed]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Prompt,
  },
  [AgentEventKinds.ContinuitySnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Prompt,
  },
  [AgentEventKinds.ContinuityRulesSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Prompt,
  },
  [AgentEventKinds.ContinuityRecallSettled]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Prompt,
  },
  [AgentEventKinds.ContinuityRecallQuery]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Prompt,
  },
  [AgentEventKinds.AgendaSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Prompt,
  },
  [AgentEventKinds.WorldSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Prompt,
  },
  [AgentEventKinds.TodoListWritten]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ExecutionCreated]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.ExecutionStepStarted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.ExecutionStepCompleted]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.ExecutionBlocked]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.ExecutionCompleted]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Run,
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
    phase: AgentEventPhases.Model,
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
  [AgentEventKinds.ChildRunQueued]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ChildRunStarted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ChildRunAwaitingSupervisor]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ChildRunResumed]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ChildRunMessageCreated]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ChildRunSnapshotUpdated]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ChildRunDeadlineExtended]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ChildRunWrappingUp]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ChildRunCancelling]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ChildRunCompleted]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ChildRunPartialCompleted]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ChildRunInterrupted]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ChildRunTimedOut]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ChildRunFailed]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ChildRunCancelled]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.WorkflowStarted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.WorkflowSnapshotUpdated]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.WorkflowPaused]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.WorkflowCancelling]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.WorkflowCompleted]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.WorkflowPartialCompleted]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.WorkflowFailed]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.WorkflowCancelled]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ScheduledTaskChanged]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ScheduledTaskRunStarted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ScheduledTaskRunCompleted]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.ScheduledTaskRunFailed]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Orchestration,
  },
  [AgentEventKinds.SchedulerStatusSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Orchestration,
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
  [AgentEventKinds.SystemToolSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Config,
  },
  [AgentEventKinds.McpServerSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Config,
  },
  [AgentEventKinds.ChannelStatusSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Config,
  },
};

export function getAgentEventSpec(kind: AgentEventKind): {
  layer: AgentEventLayer;
  phase: AgentEventPhase;
} {
  return AgentEventSpecTable[kind];
}
