import type { AgentChildRunJoinGroup, AgentChildRunRecord } from "./AgentChildRunTypes.js";

/** Stable command identity for replaying a terminal detached-run notification. */
export function createAgentBackgroundTaskCompletionRequestId(record: AgentChildRunRecord): string {
  return `background_${record.id}_${record.revision}`;
}

export function createAgentBackgroundTaskJoinRequestId(
  group: AgentChildRunJoinGroup,
  records?: readonly AgentChildRunRecord[],
): string {
  const revision = records?.map((record) => `${record.id}:${record.revision}:${record.status}`).join("|");
  return `background_join_${encodeURIComponent(group.id)}${revision ? `_${encodeURIComponent(revision)}` : ""}`;
}

/**
 * Keeps the control envelope machine-readable while treating the child result
 * as data. The parent model can summarize it for the adapter without exposing
 * an implementation-specific callback format to channel integrations.
 */
export function renderAgentBackgroundTaskCompletionInput(
  recordOrRecords: AgentChildRunRecord | readonly AgentChildRunRecord[],
): string {
  const records = Array.isArray(recordOrRecords) ? recordOrRecords : [recordOrRecords];
  const payload =
    records.length === 1
      ? projectTask(records[0]!)
      : {
          joinGroup: records[0]?.joinGroup,
          tasks: records.map(projectTask),
        };
  return [
    "Senera background task update. Review the task state and report it to the user when appropriate.",
    JSON.stringify(payload),
  ].join("\n");
}

function projectTask(record: AgentChildRunRecord): Record<string, unknown> {
  return {
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
  };
}
