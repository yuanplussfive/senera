import { AgentEventKinds, type AgentEventKind } from "./AgentEventCatalog.js";

export const AgentEventObservationRetentions = {
  Metadata: "metadata",
  Projection: "projection",
} as const;

export type AgentEventObservationRetention =
  (typeof AgentEventObservationRetentions)[keyof typeof AgentEventObservationRetentions];

export interface AgentEventObservationSpec {
  readonly retention: AgentEventObservationRetention;
  /** RFC 6901 pointers selected from the complete event envelope. */
  readonly projectionPointers: readonly string[];
  /** Optional correlation pointer retained for event-journal filtering. */
  readonly resourceIdPointer?: string;
  /** Optional, declarative lifecycle contract consumed by runtime diagnostics. */
  readonly diagnostic?: AgentEventDiagnosticSpec;
}

interface AgentEventDiagnosticSpecBase {
  readonly source: "activity" | "tool";
  readonly idPointer: string;
  readonly labelPointer: string;
  readonly startedAtPointer: string;
  readonly durationMsPointer: string;
}

export type AgentEventDiagnosticSpec =
  | (AgentEventDiagnosticSpecBase & {
      readonly statePointer: string;
      readonly fixedState?: never;
    })
  | (AgentEventDiagnosticSpecBase & {
      readonly statePointer?: never;
      readonly fixedState: "started" | "completed" | "failed";
    });

const metadata = (): AgentEventObservationSpec => ({
  retention: AgentEventObservationRetentions.Metadata,
  projectionPointers: [],
});

const projection = (...projectionPointers: readonly string[]): AgentEventObservationSpec => ({
  retention: AgentEventObservationRetentions.Projection,
  projectionPointers,
});

const projectionWithResourceId = (
  resourceIdPointer: string,
  ...projectionPointers: readonly string[]
): AgentEventObservationSpec => ({
  retention: AgentEventObservationRetentions.Projection,
  projectionPointers: appendPointers(projectionPointers, [resourceIdPointer]),
  resourceIdPointer,
});

const diagnosticProjection = (
  diagnostic: AgentEventDiagnosticSpec,
  ...projectionPointers: readonly string[]
): AgentEventObservationSpec => ({
  retention: AgentEventObservationRetentions.Projection,
  projectionPointers: appendDiagnosticPointers(diagnostic, projectionPointers),
  diagnostic,
});

function appendDiagnosticPointers(
  diagnostic: AgentEventDiagnosticSpec,
  projectionPointers: readonly string[],
): readonly string[] {
  return appendPointers(projectionPointers, [
    diagnostic.idPointer,
    diagnostic.labelPointer,
    ...(diagnostic.statePointer ? [diagnostic.statePointer] : []),
    diagnostic.startedAtPointer,
    diagnostic.durationMsPointer,
  ]);
}

function appendPointers(projectionPointers: readonly string[], requiredPointers: readonly string[]): readonly string[] {
  const declared = [...projectionPointers];
  for (const pointer of requiredPointers) {
    if (!declared.includes(pointer)) declared.push(pointer);
  }
  return declared;
}

const RunActivityDiagnostic: AgentEventDiagnosticSpec = {
  source: "activity",
  idPointer: "/data/activityId",
  labelPointer: "/data/activity",
  statePointer: "/data/state",
  startedAtPointer: "/data/startedAt",
  durationMsPointer: "/data/durationMs",
};

const ToolCallStartedDiagnostic: AgentEventDiagnosticSpec = {
  source: "tool",
  idPointer: "/data/callId",
  labelPointer: "/data/toolName",
  fixedState: "started",
  startedAtPointer: "/data/startedAt",
  durationMsPointer: "/data/durationMs",
};

const ToolCallCompletedDiagnostic: AgentEventDiagnosticSpec = {
  source: "tool",
  idPointer: "/data/callId",
  labelPointer: "/data/toolName",
  fixedState: "completed",
  startedAtPointer: "/data/startedAt",
  durationMsPointer: "/data/durationMs",
};

const ToolCallFailedDiagnostic: AgentEventDiagnosticSpec = {
  source: "tool",
  idPointer: "/data/callId",
  labelPointer: "/data/toolName",
  fixedState: "failed",
  startedAtPointer: "/data/startedAt",
  durationMsPointer: "/data/durationMs",
};

/**
 * This table is the security boundary for browser-side event diagnostics.
 * New event kinds must explicitly choose metadata-only retention or name the
 * safe fields that the frontend journal may retain.
 */
export const AgentEventObservationSpecTable = {
  [AgentEventKinds.SessionCreated]: projection("/data/turnCount", "/data/entryCount"),
  [AgentEventKinds.SessionSnapshot]: projection(
    "/data/turnCount",
    "/data/entryCount",
    "/data/activeRequestId",
    "/data/status",
  ),
  [AgentEventKinds.SessionClosed]: metadata(),
  [AgentEventKinds.SessionBusy]: projection("/data/code"),
  [AgentEventKinds.SessionNotFound]: projection("/data/code"),
  [AgentEventKinds.SessionListSnapshot]: metadata(),
  [AgentEventKinds.SessionHistoryStarted]: projection("/data/refresh"),
  [AgentEventKinds.SessionHistoryChunk]: projection("/data/count", "/data/hasMore"),
  [AgentEventKinds.SessionHistorySteps]: projection("/data/count"),
  [AgentEventKinds.SessionRunHistoryChunk]: projection("/data/count", "/data/hasMore"),
  [AgentEventKinds.SessionHistoryCompleted]: projection("/data/entryCount", "/data/runCount"),
  [AgentEventKinds.SessionTruncated]: projection("/data/removedTurnCount"),
  [AgentEventKinds.SessionForked]: projection("/data/sourceSessionId", "/data/throughRequestId"),
  [AgentEventKinds.SessionCompacted]: projection("/data/removedEntryCount", "/data/summaryEntryCount"),
  [AgentEventKinds.SessionRuntimeStatus]: projection(
    "/data/status",
    "/data/piSessionState",
    "/data/runtime/contextUsage",
    "/data/runtime/stats/userMessages",
    "/data/runtime/stats/assistantMessages",
    "/data/runtime/stats/toolCalls",
    "/data/runtime/stats/toolResults",
    "/data/runtime/stats/totalMessages",
    "/data/runtime/stats/tokens",
    "/data/runtime/stats/cost",
  ),
  [AgentEventKinds.SessionExported]: projection("/data/format", "/data/byteLength"),
  [AgentEventKinds.RunStarted]: metadata(),
  [AgentEventKinds.RunActivityChanged]: diagnosticProjection(
    RunActivityDiagnostic,
    "/data/activity",
    "/data/state",
    "/data/durationMs",
    "/data/activityId",
    "/data/parentActivityId",
    "/data/startedAt",
  ),
  [AgentEventKinds.RunCancellationProgress]: projection("/data/stage", "/data/component", "/data/durationMs"),
  [AgentEventKinds.PromptSummary]: projection("/data/chars", "/data/lines", "/data/tokenCount"),
  [AgentEventKinds.PromptHarnessComposed]: projection(
    "/data/profile",
    "/data/sections/frozen/bytes",
    "/data/sections/frozen/tokens",
    "/data/sections/stable/bytes",
    "/data/sections/stable/tokens",
    "/data/sections/volatile/bytes",
    "/data/sections/volatile/tokens",
    "/data/merged/bytes",
    "/data/merged/tokens",
  ),
  [AgentEventKinds.ContinuitySnapshot]: projection(
    "/data/enabled",
    "/data/concepts",
    "/data/graph",
    "/data/graphRelations",
    "/data/residentProfile",
    "/data/factCatalog",
    "/data/selection",
    "/data/preset/enabled",
    "/data/preset/activePresetName",
    "/data/preset/title",
    "/data/preset/corePersona",
    "/data/preset/languageStyle",
    "/data/evidenceCandidates",
    "/data/eventCandidates",
    "/data/rejections",
    "/data/nearMisses",
    "/data/rules",
    "/data/signals",
  ),
  [AgentEventKinds.ContinuityRulesSnapshot]: projection("/data/rules", "/data/signals"),
  [AgentEventKinds.ContinuityRecallSettled]: projection(
    "/data/injectedCount",
    "/data/eventCount",
    "/data/matchedByCounts",
    "/data/directCount",
    "/data/referenceCount",
    "/data/nearMissCount",
    "/data/degraded",
    "/data/semanticStatus",
    "/data/semanticIndexedCount",
    "/data/semanticCompatibleCount",
    "/data/totalLatencyMs",
  ),
  [AgentEventKinds.ContinuityRecallQuery]: projection("/data/original", "/data/local"),
  [AgentEventKinds.AgendaSnapshot]: projection("/data/snapshot"),
  [AgentEventKinds.WorldSnapshot]: projection("/data/snapshot"),
  [AgentEventKinds.TodoListWritten]: projection("/data/snapshot"),
  [AgentEventKinds.ExecutionCreated]: projection("/data/snapshot/active", "/data/execution"),
  [AgentEventKinds.ExecutionStepStarted]: projection("/data/snapshot/active", "/data/execution", "/data/step"),
  [AgentEventKinds.ExecutionStepCompleted]: projection("/data/snapshot/active", "/data/execution", "/data/step"),
  [AgentEventKinds.ExecutionBlocked]: projection("/data/snapshot/active", "/data/execution", "/data/step"),
  [AgentEventKinds.ExecutionCompleted]: projection("/data/snapshot/active", "/data/execution"),
  [AgentEventKinds.ModelStarted]: projection("/data/model", "/data/providerId"),
  [AgentEventKinds.ModelDelta]: metadata(),
  [AgentEventKinds.ModelCompleted]: projection("/data/provider", "/data/usage"),
  [AgentEventKinds.ToolCallsPlanned]: projection(
    "/data/toolCount",
    "/data/tools",
    "/data/status",
    "/data/executionMode",
    "/data/batchId",
  ),
  [AgentEventKinds.ToolCallStarted]: diagnosticProjection(
    ToolCallStartedDiagnostic,
    "/data/index",
    "/data/toolName",
    "/data/callId",
    "/data/arguments",
    "/data/origin/kind",
    "/data/origin/name",
    "/data/origin/capability",
    "/data/origin/server",
    "/data/origin/tool",
    "/data/batchId",
    "/data/startedAt",
  ),
  [AgentEventKinds.ToolCallOutput]: projectionWithResourceId(
    "/data/resourceId",
    "/data/toolName",
    "/data/callId",
    "/data/stream",
    "/data/outputSequence",
    "/data/byteLength",
    "/data/totalBytes",
  ),
  [AgentEventKinds.ToolCallProgress]: projectionWithResourceId(
    "/data/resourceId",
    "/data/toolName",
    "/data/callId",
    "/data/progressSequence",
    "/data/completed",
    "/data/total",
    "/data/unit",
    "/data/state",
    "/data/terminal",
  ),
  [AgentEventKinds.ToolCallCompleted]: diagnosticProjection(
    ToolCallCompletedDiagnostic,
    "/data/index",
    "/data/toolName",
    "/data/callId",
    "/data/batchId",
    "/data/startedAt",
    "/data/durationMs",
    "/data/presentation/headline",
    "/data/origin/kind",
    "/data/origin/name",
    "/data/origin/capability",
    "/data/origin/server",
    "/data/origin/tool",
  ),
  [AgentEventKinds.ToolCallFailed]: diagnosticProjection(
    ToolCallFailedDiagnostic,
    "/data/index",
    "/data/toolName",
    "/data/callId",
    "/data/batchId",
    "/data/startedAt",
    "/data/durationMs",
    "/data/code",
    "/data/origin/kind",
    "/data/origin/name",
    "/data/origin/capability",
    "/data/origin/server",
    "/data/origin/tool",
  ),
  [AgentEventKinds.ToolCallResultDetail]: projection(
    "/data/detailId",
    "/data/index",
    "/data/toolName",
    "/data/callId",
    "/data/batchId",
    "/data/origin/kind",
    "/data/origin/name",
    "/data/origin/capability",
    "/data/origin/server",
    "/data/origin/tool",
  ),
  [AgentEventKinds.AssistantMessageCreated]: projection(
    "/data/messageId",
    "/data/kind",
    "/data/content",
    "/data/terminal",
    "/data/toolCount",
    "/data/reasonCode",
  ),
  [AgentEventKinds.ApprovalRequested]: projection("/data/approvalId", "/data/toolName", "/data/callId", "/data/status"),
  [AgentEventKinds.ApprovalResolved]: projection(
    "/data/approvalId",
    "/data/toolName",
    "/data/callId",
    "/data/decision",
  ),
  [AgentEventKinds.InteractionInputRequested]: projection("/data/interactionId", "/data/toolName", "/data/callId"),
  [AgentEventKinds.InteractionInputResolved]: projection(
    "/data/interactionId",
    "/data/toolName",
    "/data/callId",
    "/data/action",
  ),
  [AgentEventKinds.ExecutionResourceCreated]: projectionWithResourceId("/data/resourceId", "/data/kind", "/data/state"),
  [AgentEventKinds.ExecutionResourceOutput]: projectionWithResourceId(
    "/data/resourceId",
    "/data/stream",
    "/data/outputSequence",
    "/data/byteLength",
    "/data/totalBytes",
  ),
  [AgentEventKinds.ExecutionResourceResized]: projectionWithResourceId(
    "/data/resourceId",
    "/data/columns",
    "/data/rows",
  ),
  [AgentEventKinds.ExecutionResourceState]: projectionWithResourceId(
    "/data/resourceId",
    "/data/state",
    "/data/exitCode",
    "/data/signal",
  ),
  [AgentEventKinds.ExecutionResourceRemoved]: projectionWithResourceId("/data/resourceId", "/data/reason"),
  [AgentEventKinds.ExecutionResourceSnapshot]: projection("/data/count", "/data/hasMore"),
  [AgentEventKinds.SandboxStatusSnapshot]: projection(
    "/data/platform",
    "/data/state",
    "/data/effectiveMode",
    "/data/progress/stage",
    "/data/progress/completed",
    "/data/progress/total",
  ),
  [AgentEventKinds.RunCompleted]: metadata(),
  [AgentEventKinds.RunFailed]: projection("/data/code"),
  [AgentEventKinds.RunCancelled]: projection("/data/reason"),
  [AgentEventKinds.ChildRunQueued]: projection(
    "/data/childRunId",
    "/data/ownerRunId",
    "/data/nodeId",
    "/data/childSessionId",
    "/data/agentName",
    "/data/status",
    "/data/contextMode",
    "/data/modelProviderId",
  ),
  [AgentEventKinds.ChildRunStarted]: projection(
    "/data/childRunId",
    "/data/ownerRunId",
    "/data/nodeId",
    "/data/childSessionId",
    "/data/agentName",
    "/data/status",
    "/data/contextMode",
    "/data/modelProviderId",
  ),
  [AgentEventKinds.ChildRunAwaitingSupervisor]: projection(
    "/data/childRunId",
    "/data/ownerRunId",
    "/data/nodeId",
    "/data/childSessionId",
    "/data/agentName",
    "/data/status",
    "/data/contextMode",
    "/data/modelProviderId",
  ),
  [AgentEventKinds.ChildRunResumed]: projection(
    "/data/childRunId",
    "/data/ownerRunId",
    "/data/nodeId",
    "/data/childSessionId",
    "/data/agentName",
    "/data/status",
    "/data/contextMode",
    "/data/modelProviderId",
  ),
  [AgentEventKinds.ChildRunMessageCreated]: projection(
    "/data/childRunId",
    "/data/ownerRunId",
    "/data/nodeId",
    "/data/childSessionId",
    "/data/agentName",
    "/data/status",
    "/data/messageId",
    "/data/direction",
    "/data/messageKind",
    "/data/content",
  ),
  [AgentEventKinds.ChildRunSnapshotUpdated]: projection(
    "/data/childRunId",
    "/data/ownerRunId",
    "/data/nodeId",
    "/data/childSessionId",
    "/data/agentName",
    "/data/status",
    "/data/checkpointAvailable",
    "/data/snapshot/capturedAt",
    "/data/snapshot/lastActivityAt",
    "/data/snapshot/lastModelOutputAt",
    "/data/snapshot/modelOutputCharacters",
    "/data/snapshot/assistantTurns",
    "/data/snapshot/toolCalls",
    "/data/snapshot/activeTools",
    "/data/snapshot/artifactUris",
    "/data/snapshot/deadline",
  ),
  [AgentEventKinds.ChildRunDeadlineExtended]: projection(
    "/data/childRunId",
    "/data/ownerRunId",
    "/data/nodeId",
    "/data/childSessionId",
    "/data/agentName",
    "/data/status",
    "/data/extensionMs",
    "/data/grantedExtensionMs",
    "/data/softDeadlineAt",
  ),
  [AgentEventKinds.ChildRunWrappingUp]: projection(
    "/data/childRunId",
    "/data/ownerRunId",
    "/data/nodeId",
    "/data/childSessionId",
    "/data/agentName",
    "/data/status",
    "/data/hardDeadlineAt",
  ),
  [AgentEventKinds.ChildRunCancelling]: projection(
    "/data/childRunId",
    "/data/ownerRunId",
    "/data/nodeId",
    "/data/childSessionId",
    "/data/agentName",
    "/data/status",
    "/data/reason",
  ),
  [AgentEventKinds.ChildRunCompleted]: projection(
    "/data/childRunId",
    "/data/ownerRunId",
    "/data/nodeId",
    "/data/childSessionId",
    "/data/agentName",
    "/data/status",
    "/data/contextMode",
    "/data/modelProviderId",
  ),
  [AgentEventKinds.ChildRunPartialCompleted]: projection(
    "/data/childRunId",
    "/data/ownerRunId",
    "/data/nodeId",
    "/data/childSessionId",
    "/data/agentName",
    "/data/status",
    "/data/contextMode",
    "/data/modelProviderId",
    "/data/error",
  ),
  [AgentEventKinds.ChildRunInterrupted]: projection(
    "/data/childRunId",
    "/data/ownerRunId",
    "/data/nodeId",
    "/data/childSessionId",
    "/data/agentName",
    "/data/status",
    "/data/contextMode",
    "/data/modelProviderId",
    "/data/error",
  ),
  [AgentEventKinds.ChildRunTimedOut]: projection(
    "/data/childRunId",
    "/data/ownerRunId",
    "/data/nodeId",
    "/data/childSessionId",
    "/data/agentName",
    "/data/status",
    "/data/contextMode",
    "/data/modelProviderId",
  ),
  [AgentEventKinds.ChildRunFailed]: projection(
    "/data/childRunId",
    "/data/ownerRunId",
    "/data/nodeId",
    "/data/childSessionId",
    "/data/agentName",
    "/data/status",
    "/data/contextMode",
    "/data/modelProviderId",
  ),
  [AgentEventKinds.ChildRunCancelled]: projection(
    "/data/childRunId",
    "/data/ownerRunId",
    "/data/nodeId",
    "/data/childSessionId",
    "/data/agentName",
    "/data/status",
    "/data/contextMode",
    "/data/modelProviderId",
  ),
  [AgentEventKinds.WorkflowStarted]: workflowProjection(),
  [AgentEventKinds.WorkflowSnapshotUpdated]: workflowProjection(),
  [AgentEventKinds.WorkflowPaused]: workflowProjection(),
  [AgentEventKinds.WorkflowCancelling]: workflowProjection(),
  [AgentEventKinds.WorkflowCompleted]: workflowProjection(),
  [AgentEventKinds.WorkflowPartialCompleted]: workflowProjection(),
  [AgentEventKinds.WorkflowFailed]: workflowProjection(),
  [AgentEventKinds.WorkflowCancelled]: workflowProjection(),
  [AgentEventKinds.ScheduledTaskChanged]: projection(
    "/data/taskId",
    "/data/operation",
    "/data/enabled",
    "/data/nextRunAt",
  ),
  [AgentEventKinds.ScheduledTaskRunStarted]: projection(
    "/data/taskId",
    "/data/runId",
    "/data/sessionId",
    "/data/status",
  ),
  [AgentEventKinds.ScheduledTaskRunCompleted]: projection(
    "/data/taskId",
    "/data/runId",
    "/data/sessionId",
    "/data/status",
  ),
  [AgentEventKinds.ScheduledTaskRunFailed]: projection(
    "/data/taskId",
    "/data/runId",
    "/data/sessionId",
    "/data/status",
  ),
  [AgentEventKinds.SchedulerStatusSnapshot]: projection(
    "/data/active",
    "/data/taskCount",
    "/data/runningTaskIds",
    "/data/pendingDeliveryCount",
    "/data/recoveryMode",
  ),
  [AgentEventKinds.RequestInvalid]: projection("/data/code"),
  [AgentEventKinds.ConfigReloaded]: projection("/data/revision", "/data/version"),
  [AgentEventKinds.ConfigFailed]: projection("/data/code"),
  [AgentEventKinds.ConfigSnapshot]: projection("/data/revision", "/data/version"),
  [AgentEventKinds.ModelListSnapshot]: projection("/data/count", "/data/revision"),
  [AgentEventKinds.ProviderModelsSnapshot]: projection("/data/providerId", "/data/count", "/data/source"),
  [AgentEventKinds.ProviderModelsFailed]: projection("/data/providerId", "/data/code"),
  [AgentEventKinds.ProfileSnapshot]: metadata(),
  [AgentEventKinds.PresetSnapshot]: projection("/data/count", "/data/activePresetName"),
  [AgentEventKinds.PresetFailed]: projection("/data/code", "/data/name"),
  [AgentEventKinds.SystemToolSnapshot]: projection("/data/extensionCount", "/data/toolCount"),
  [AgentEventKinds.McpServerSnapshot]: projection("/data/serverCount", "/data/revision"),
  [AgentEventKinds.ChannelStatusSnapshot]: projection("/data/statuses"),
} as const satisfies Record<AgentEventKind, AgentEventObservationSpec>;

function workflowProjection(): AgentEventObservationSpec {
  return projection("/data/workflowId", "/data/status", "/data/definitionDigest", "/data/nodes", "/data/error");
}

export function getAgentEventObservationSpec(kind: AgentEventKind): AgentEventObservationSpec {
  return AgentEventObservationSpecTable[kind];
}
