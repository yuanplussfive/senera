// Generated from backend event observation contracts.
// Run `npm run generate.frontend-events` after editing those contracts.

import type { EventKind, EventLayer, EventPhase } from "./generatedEventCatalog";

export const EventSpecs = {
  "session.created": {
    layer: "snapshot",
    phase: "session",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/turnCount", "/data/entryCount"],
    },
  },
  "session.snapshot": {
    layer: "snapshot",
    phase: "session",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/turnCount", "/data/entryCount", "/data/activeRequestId", "/data/status"],
    },
  },
  "session.closed": {
    layer: "terminal",
    phase: "session",
    observation: {
      retention: "metadata",
      projectionPointers: [],
    },
  },
  "session.busy": {
    layer: "error",
    phase: "session",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/code"],
    },
  },
  "session.not_found": {
    layer: "error",
    phase: "session",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/code"],
    },
  },
  "session.list.snapshot": {
    layer: "snapshot",
    phase: "session",
    observation: {
      retention: "metadata",
      projectionPointers: [],
    },
  },
  "session.history.started": {
    layer: "snapshot",
    phase: "session",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/refresh"],
    },
  },
  "session.history.chunk": {
    layer: "snapshot",
    phase: "session",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/count", "/data/hasMore"],
    },
  },
  "session.history.steps": {
    layer: "snapshot",
    phase: "session",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/count"],
    },
  },
  "session.run_history.chunk": {
    layer: "snapshot",
    phase: "session",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/count", "/data/hasMore"],
    },
  },
  "session.history.completed": {
    layer: "snapshot",
    phase: "session",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/entryCount", "/data/runCount"],
    },
  },
  "session.truncated": {
    layer: "snapshot",
    phase: "session",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/removedTurnCount"],
    },
  },
  "session.forked": {
    layer: "snapshot",
    phase: "session",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/sourceSessionId", "/data/throughRequestId"],
    },
  },
  "session.compacted": {
    layer: "snapshot",
    phase: "session",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/removedEntryCount", "/data/summaryEntryCount"],
    },
  },
  "session.runtime_status": {
    layer: "snapshot",
    phase: "session",
    observation: {
      retention: "projection",
      projectionPointers: [
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
      ],
    },
  },
  "session.exported": {
    layer: "snapshot",
    phase: "session",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/format", "/data/byteLength"],
    },
  },
  "run.started": {
    layer: "progress",
    phase: "run",
    observation: {
      retention: "metadata",
      projectionPointers: [],
    },
  },
  "run.activity.changed": {
    layer: "progress",
    phase: "run",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/activity",
        "/data/state",
        "/data/durationMs",
        "/data/activityId",
        "/data/parentActivityId",
        "/data/startedAt",
      ],
    },
  },
  "run.cancellation.progress": {
    layer: "progress",
    phase: "run",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/stage", "/data/component", "/data/durationMs"],
    },
  },
  "prompt.summary": {
    layer: "progress",
    phase: "prompt",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/chars", "/data/lines", "/data/tokenCount"],
    },
  },
  "model.started": {
    layer: "progress",
    phase: "model",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/model", "/data/providerId"],
    },
  },
  "model.delta": {
    layer: "progress",
    phase: "model",
    observation: {
      retention: "metadata",
      projectionPointers: [],
    },
  },
  "model.completed": {
    layer: "snapshot",
    phase: "model",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/provider", "/data/usage"],
    },
  },
  "tool.calls.planned": {
    layer: "progress",
    phase: "tool",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/toolCount", "/data/tools", "/data/status", "/data/executionMode", "/data/batchId"],
    },
  },
  "tool.call.started": {
    layer: "progress",
    phase: "tool",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/index",
        "/data/toolName",
        "/data/callId",
        "/data/batchId",
        "/data/startedAt",
        "/data/durationMs",
      ],
    },
  },
  "tool.call.output": {
    layer: "progress",
    phase: "tool",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/toolName",
        "/data/callId",
        "/data/stream",
        "/data/outputSequence",
        "/data/byteLength",
        "/data/totalBytes",
        "/data/resourceId",
      ],
      resourceIdPointer: "/data/resourceId",
    },
  },
  "tool.call.progress": {
    layer: "progress",
    phase: "tool",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/toolName",
        "/data/callId",
        "/data/progressSequence",
        "/data/completed",
        "/data/total",
        "/data/unit",
        "/data/state",
        "/data/terminal",
        "/data/resourceId",
      ],
      resourceIdPointer: "/data/resourceId",
    },
  },
  "tool.call.completed": {
    layer: "progress",
    phase: "tool",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/index",
        "/data/toolName",
        "/data/callId",
        "/data/batchId",
        "/data/startedAt",
        "/data/durationMs",
        "/data/presentation/headline",
      ],
    },
  },
  "tool.call.failed": {
    layer: "error",
    phase: "tool",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/index",
        "/data/toolName",
        "/data/callId",
        "/data/batchId",
        "/data/startedAt",
        "/data/durationMs",
        "/data/code",
      ],
    },
  },
  "tool.call.result.detail": {
    layer: "snapshot",
    phase: "tool",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/detailId", "/data/index", "/data/toolName", "/data/callId", "/data/batchId"],
    },
  },
  "assistant.message.created": {
    layer: "progress",
    phase: "run",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/messageId",
        "/data/kind",
        "/data/terminal",
        "/data/toolCount",
        "/data/batchId",
        "/data/reasonCode",
      ],
    },
  },
  "approval.requested": {
    layer: "progress",
    phase: "approval",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/approvalId", "/data/toolName", "/data/callId", "/data/status"],
    },
  },
  "approval.resolved": {
    layer: "progress",
    phase: "approval",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/approvalId", "/data/toolName", "/data/callId", "/data/decision"],
    },
  },
  "interaction.input.requested": {
    layer: "progress",
    phase: "tool",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/interactionId", "/data/toolName", "/data/callId"],
    },
  },
  "interaction.input.resolved": {
    layer: "progress",
    phase: "tool",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/interactionId", "/data/toolName", "/data/callId", "/data/action"],
    },
  },
  "execution.resource.created": {
    layer: "snapshot",
    phase: "tool",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/kind", "/data/state", "/data/resourceId"],
      resourceIdPointer: "/data/resourceId",
    },
  },
  "execution.resource.output": {
    layer: "progress",
    phase: "tool",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/stream",
        "/data/outputSequence",
        "/data/byteLength",
        "/data/totalBytes",
        "/data/resourceId",
      ],
      resourceIdPointer: "/data/resourceId",
    },
  },
  "execution.resource.state": {
    layer: "snapshot",
    phase: "tool",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/state", "/data/exitCode", "/data/signal", "/data/resourceId"],
      resourceIdPointer: "/data/resourceId",
    },
  },
  "execution.resource.resized": {
    layer: "snapshot",
    phase: "tool",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/columns", "/data/rows", "/data/resourceId"],
      resourceIdPointer: "/data/resourceId",
    },
  },
  "execution.resource.removed": {
    layer: "snapshot",
    phase: "tool",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/reason", "/data/resourceId"],
      resourceIdPointer: "/data/resourceId",
    },
  },
  "execution.resource.snapshot": {
    layer: "snapshot",
    phase: "tool",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/count", "/data/hasMore"],
    },
  },
  "sandbox.status.snapshot": {
    layer: "snapshot",
    phase: "sandbox",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/platform",
        "/data/state",
        "/data/effectiveMode",
        "/data/progress/stage",
        "/data/progress/completed",
        "/data/progress/total",
      ],
    },
  },
  "run.completed": {
    layer: "terminal",
    phase: "run",
    observation: {
      retention: "metadata",
      projectionPointers: [],
    },
  },
  "run.failed": {
    layer: "error",
    phase: "run",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/code"],
    },
  },
  "run.cancelled": {
    layer: "terminal",
    phase: "run",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/reason"],
    },
  },
  "child_run.queued": {
    layer: "progress",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/childRunId",
        "/data/ownerRunId",
        "/data/nodeId",
        "/data/childSessionId",
        "/data/agentName",
        "/data/status",
        "/data/contextMode",
        "/data/modelProviderId",
      ],
    },
  },
  "child_run.started": {
    layer: "progress",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/childRunId",
        "/data/ownerRunId",
        "/data/nodeId",
        "/data/childSessionId",
        "/data/agentName",
        "/data/status",
        "/data/contextMode",
        "/data/modelProviderId",
      ],
    },
  },
  "child_run.awaiting_supervisor": {
    layer: "progress",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/childRunId",
        "/data/ownerRunId",
        "/data/nodeId",
        "/data/childSessionId",
        "/data/agentName",
        "/data/status",
        "/data/contextMode",
        "/data/modelProviderId",
      ],
    },
  },
  "child_run.resumed": {
    layer: "progress",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/childRunId",
        "/data/ownerRunId",
        "/data/nodeId",
        "/data/childSessionId",
        "/data/agentName",
        "/data/status",
        "/data/contextMode",
        "/data/modelProviderId",
      ],
    },
  },
  "child_run.message.created": {
    layer: "progress",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: [
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
      ],
    },
  },
  "child_run.snapshot.updated": {
    layer: "snapshot",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: [
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
      ],
    },
  },
  "child_run.deadline.extended": {
    layer: "progress",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/childRunId",
        "/data/ownerRunId",
        "/data/nodeId",
        "/data/childSessionId",
        "/data/agentName",
        "/data/status",
        "/data/extensionMs",
        "/data/grantedExtensionMs",
        "/data/softDeadlineAt",
      ],
    },
  },
  "child_run.wrapping_up": {
    layer: "progress",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/childRunId",
        "/data/ownerRunId",
        "/data/nodeId",
        "/data/childSessionId",
        "/data/agentName",
        "/data/status",
        "/data/hardDeadlineAt",
      ],
    },
  },
  "child_run.cancelling": {
    layer: "progress",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/childRunId",
        "/data/ownerRunId",
        "/data/nodeId",
        "/data/childSessionId",
        "/data/agentName",
        "/data/status",
        "/data/reason",
      ],
    },
  },
  "child_run.completed": {
    layer: "terminal",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/childRunId",
        "/data/ownerRunId",
        "/data/nodeId",
        "/data/childSessionId",
        "/data/agentName",
        "/data/status",
        "/data/contextMode",
        "/data/modelProviderId",
      ],
    },
  },
  "child_run.partial_completed": {
    layer: "terminal",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/childRunId",
        "/data/ownerRunId",
        "/data/nodeId",
        "/data/childSessionId",
        "/data/agentName",
        "/data/status",
        "/data/contextMode",
        "/data/modelProviderId",
        "/data/error",
      ],
    },
  },
  "child_run.interrupted": {
    layer: "terminal",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/childRunId",
        "/data/ownerRunId",
        "/data/nodeId",
        "/data/childSessionId",
        "/data/agentName",
        "/data/status",
        "/data/contextMode",
        "/data/modelProviderId",
        "/data/error",
      ],
    },
  },
  "child_run.timed_out": {
    layer: "terminal",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/childRunId",
        "/data/ownerRunId",
        "/data/nodeId",
        "/data/childSessionId",
        "/data/agentName",
        "/data/status",
        "/data/contextMode",
        "/data/modelProviderId",
      ],
    },
  },
  "child_run.failed": {
    layer: "error",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/childRunId",
        "/data/ownerRunId",
        "/data/nodeId",
        "/data/childSessionId",
        "/data/agentName",
        "/data/status",
        "/data/contextMode",
        "/data/modelProviderId",
      ],
    },
  },
  "child_run.cancelled": {
    layer: "terminal",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: [
        "/data/childRunId",
        "/data/ownerRunId",
        "/data/nodeId",
        "/data/childSessionId",
        "/data/agentName",
        "/data/status",
        "/data/contextMode",
        "/data/modelProviderId",
      ],
    },
  },
  "workflow.started": {
    layer: "progress",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/workflowId", "/data/status", "/data/definitionDigest", "/data/nodes", "/data/error"],
    },
  },
  "workflow.snapshot.updated": {
    layer: "snapshot",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/workflowId", "/data/status", "/data/definitionDigest", "/data/nodes", "/data/error"],
    },
  },
  "workflow.paused": {
    layer: "snapshot",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/workflowId", "/data/status", "/data/definitionDigest", "/data/nodes", "/data/error"],
    },
  },
  "workflow.cancelling": {
    layer: "progress",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/workflowId", "/data/status", "/data/definitionDigest", "/data/nodes", "/data/error"],
    },
  },
  "workflow.completed": {
    layer: "terminal",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/workflowId", "/data/status", "/data/definitionDigest", "/data/nodes", "/data/error"],
    },
  },
  "workflow.partial_completed": {
    layer: "terminal",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/workflowId", "/data/status", "/data/definitionDigest", "/data/nodes", "/data/error"],
    },
  },
  "workflow.failed": {
    layer: "error",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/workflowId", "/data/status", "/data/definitionDigest", "/data/nodes", "/data/error"],
    },
  },
  "workflow.cancelled": {
    layer: "terminal",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/workflowId", "/data/status", "/data/definitionDigest", "/data/nodes", "/data/error"],
    },
  },
  "scheduled_task.changed": {
    layer: "snapshot",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/taskId", "/data/operation", "/data/enabled", "/data/nextRunAt"],
    },
  },
  "scheduled_task.run.started": {
    layer: "progress",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/taskId", "/data/runId", "/data/sessionId", "/data/status"],
    },
  },
  "scheduled_task.run.completed": {
    layer: "terminal",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/taskId", "/data/runId", "/data/sessionId", "/data/status"],
    },
  },
  "scheduled_task.run.failed": {
    layer: "error",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/taskId", "/data/runId", "/data/sessionId", "/data/status"],
    },
  },
  "scheduler.status.snapshot": {
    layer: "snapshot",
    phase: "orchestration",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/active", "/data/taskCount", "/data/runningTaskIds", "/data/leaseAcquired"],
    },
  },
  "request.invalid": {
    layer: "error",
    phase: "request",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/code"],
    },
  },
  "config.reloaded": {
    layer: "snapshot",
    phase: "config",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/revision", "/data/version"],
    },
  },
  "config.failed": {
    layer: "error",
    phase: "config",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/code"],
    },
  },
  "config.snapshot": {
    layer: "snapshot",
    phase: "config",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/revision", "/data/version"],
    },
  },
  "model.list.snapshot": {
    layer: "snapshot",
    phase: "config",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/count", "/data/revision"],
    },
  },
  "provider.models.snapshot": {
    layer: "snapshot",
    phase: "config",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/providerId", "/data/count", "/data/source"],
    },
  },
  "provider.models.failed": {
    layer: "error",
    phase: "config",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/providerId", "/data/code"],
    },
  },
  "profile.snapshot": {
    layer: "snapshot",
    phase: "config",
    observation: {
      retention: "metadata",
      projectionPointers: [],
    },
  },
  "preset.snapshot": {
    layer: "snapshot",
    phase: "config",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/count", "/data/activePresetName"],
    },
  },
  "preset.failed": {
    layer: "error",
    phase: "config",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/code", "/data/name"],
    },
  },
  "system_tool.snapshot": {
    layer: "snapshot",
    phase: "config",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/extensionCount", "/data/toolCount"],
    },
  },
  "mcp_server.snapshot": {
    layer: "snapshot",
    phase: "config",
    observation: {
      retention: "projection",
      projectionPointers: ["/data/serverCount", "/data/revision"],
    },
  },
} as const satisfies Record<
  EventKind,
  {
    readonly layer: EventLayer;
    readonly phase: EventPhase;
    readonly observation: {
      readonly retention: "metadata" | "projection";
      readonly projectionPointers: readonly string[];
      readonly resourceIdPointer?: string;
    };
  }
>;
