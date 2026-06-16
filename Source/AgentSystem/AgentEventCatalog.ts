export const AgentEventLayers = {
  Progress: "progress",
  Snapshot: "snapshot",
  Terminal: "terminal",
  Error: "error",
} as const;

export type AgentEventLayer =
  typeof AgentEventLayers[keyof typeof AgentEventLayers];

export const AgentEventPhases = {
  Request: "request",
  Session: "session",
  Prompt: "prompt",
  Model: "model",
  Decision: "decision",
  Retry: "retry",
  Tool: "tool",
  Run: "run",
  Config: "config",
} as const;

export type AgentEventPhase =
  typeof AgentEventPhases[keyof typeof AgentEventPhases];

export const AgentEventKinds = {
  SessionCreated: "session.created",
  SessionSnapshot: "session.snapshot",
  SessionClosed: "session.closed",
  SessionBusy: "session.busy",
  SessionNotFound: "session.not_found",
  SessionListSnapshot: "session.list.snapshot",
  SessionHistorySnapshot: "session.history.snapshot",
  SessionHistoryStarted: "session.history.started",
  SessionHistoryChunk: "session.history.chunk",
  SessionHistorySteps: "session.history.steps",
  SessionRunHistoryChunk: "session.run_history.chunk",
  SessionHistoryCompleted: "session.history.completed",
  SessionTruncated: "session.truncated",
  RunStarted: "run.started",
  PromptRendered: "prompt.rendered",
  PromptSummary: "prompt.summary",
  ActionPlannerStageStarted: "action.planner.stage.started",
  ActionPlannerStageCompleted: "action.planner.stage.completed",
  ActionPlannerStageFailed: "action.planner.stage.failed",
  ActionPlanned: "action.planned",
  ModelStarted: "model.started",
  ModelStreamOpened: "model.stream.opened",
  ModelDelta: "model.delta",
  ModelCompleted: "model.completed",
  ModelStreamAborted: "model.stream.aborted",
  DecisionXmlProgress: "decision.xml.progress",
  DecisionXmlReady: "decision.xml.ready",
  DecisionXmlLimitReached: "decision.xml.limit_reached",
  DecisionXmlSummary: "decision.xml.summary",
  DecisionXmlDetail: "decision.xml.detail",
  DecisionParsed: "decision.parsed",
  DecisionParsedDetail: "decision.parsed.detail",
  RetryPlanned: "retry.planned",
  RetryDetail: "retry.detail",
  ToolCallsPlanned: "tool.calls.planned",
  ToolCallStarted: "tool.call.started",
  ToolCallCompleted: "tool.call.completed",
  ToolCallFailed: "tool.call.failed",
  ToolResults: "tool.results",
  ToolResultsDetail: "tool.results.detail",
  FinalAnswer: "final.answer",
  AskUser: "ask.user",
  RunCompleted: "run.completed",
  RunFailed: "run.failed",
  RunCancelled: "run.cancelled",
  RequestInvalid: "request.invalid",
  ConfigReloaded: "config.reloaded",
  ConfigFailed: "config.failed",
  ModelListSnapshot: "model.list.snapshot",
  PluginConfigSnapshot: "plugin.config.snapshot",
  ProfileSnapshot: "profile.snapshot",
} as const;

export type AgentEventKind =
  typeof AgentEventKinds[keyof typeof AgentEventKinds];

export const AgentEventChannels = {
  AgentEvent: "agent.event",
} as const;

export type AgentEventChannel =
  typeof AgentEventChannels[keyof typeof AgentEventChannels];

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
  [AgentEventKinds.SessionHistorySnapshot]: {
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
  [AgentEventKinds.RunStarted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.PromptRendered]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Prompt,
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
  [AgentEventKinds.ActionPlanned]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.ModelStarted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Model,
  },
  [AgentEventKinds.ModelStreamOpened]: {
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
  [AgentEventKinds.ModelStreamAborted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Model,
  },
  [AgentEventKinds.DecisionXmlProgress]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.DecisionXmlReady]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.DecisionXmlLimitReached]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.DecisionXmlSummary]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.DecisionXmlDetail]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.DecisionParsed]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.DecisionParsedDetail]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.RetryPlanned]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Retry,
  },
  [AgentEventKinds.RetryDetail]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Retry,
  },
  [AgentEventKinds.ToolCallsPlanned]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ToolCallStarted]: {
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
  [AgentEventKinds.ToolResults]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ToolResultsDetail]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.FinalAnswer]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.AskUser]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Run,
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
  [AgentEventKinds.ModelListSnapshot]: {
    layer: AgentEventLayers.Snapshot,
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
};

export function getAgentEventSpec(kind: AgentEventKind): {
  layer: AgentEventLayer;
  phase: AgentEventPhase;
} {
  return AgentEventSpecTable[kind];
}
