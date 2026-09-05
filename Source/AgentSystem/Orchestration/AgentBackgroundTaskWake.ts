import type { AgentChildRunRecord } from "./AgentChildRunTypes.js";

/** Stable command identity for replaying a terminal detached-run notification. */
export function createAgentBackgroundTaskCompletionRequestId(record: AgentChildRunRecord): string {
  return `background_${record.id}_${record.revision}`;
}

/**
 * Keeps the control envelope machine-readable while treating the child result
 * as data. The parent model can summarize it for the adapter without exposing
 * an implementation-specific callback format to channel integrations.
 */
export function renderAgentBackgroundTaskCompletionInput(record: AgentChildRunRecord): string {
  return [
    "Senera background task update. Review the task state and report it to the user when appropriate.",
    JSON.stringify({
      taskId: record.id,
      task: record.task,
      agent: record.agentName,
      status: record.status,
      completedAt: record.completedAt ?? record.updatedAt,
      ...(record.finalAnswer !== undefined ? { result: record.finalAnswer } : {}),
      ...(record.error !== undefined ? { error: record.error } : {}),
      progress: record.snapshot
        ? {
            lastActivityAt: record.snapshot.lastActivityAt,
            activeTools: record.snapshot.activeTools,
            toolCalls: record.snapshot.toolCalls,
            artifactCount: record.snapshot.artifactUris.length,
          }
        : undefined,
    }),
  ].join("\n");
}
