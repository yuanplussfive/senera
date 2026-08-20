export const AgentMemoryLearningJobStatuses = {
  Pending: "pending",
  Running: "running",
  Retry: "retry",
  Completed: "completed",
  Failed: "failed",
} as const;

export type AgentMemoryLearningJobStatus =
  (typeof AgentMemoryLearningJobStatuses)[keyof typeof AgentMemoryLearningJobStatuses];

export const AgentMemoryLearningJobStatusValues = Object.values(AgentMemoryLearningJobStatuses);

const RunnableAgentMemoryLearningJobStatuses = new Set<AgentMemoryLearningJobStatus>([
  AgentMemoryLearningJobStatuses.Pending,
  AgentMemoryLearningJobStatuses.Retry,
]);

export interface AgentMemoryLearningJobRecord {
  episodeUri: string;
  status: AgentMemoryLearningJobStatus;
  attempts: number;
  nextAttemptAtMs: number;
  lastError: string;
  updatedAtMs: number;
}

export interface AgentMemoryLearningJobStorageRow {
  episode_uri: string;
  status: string;
  attempts: number;
  next_attempt_at_ms: number;
  last_error: string;
  updated_at_ms: number;
}

export function isRunnableAgentMemoryLearningJobStatus(status: AgentMemoryLearningJobStatus): boolean {
  return RunnableAgentMemoryLearningJobStatuses.has(status);
}

export function failedAgentMemoryLearningJobStatus(terminal: boolean): AgentMemoryLearningJobStatus {
  return terminal ? AgentMemoryLearningJobStatuses.Failed : AgentMemoryLearningJobStatuses.Retry;
}

export function parseAgentMemoryLearningJobStatus(status: string): AgentMemoryLearningJobStatus {
  const parsed = AgentMemoryLearningJobStatusValues.find((candidate) => candidate === status);
  if (!parsed) {
    throw new Error(`Unknown memory learning job status: ${status}`);
  }
  return parsed;
}

export function memoryLearningJobFromStorageRow(row: AgentMemoryLearningJobStorageRow): AgentMemoryLearningJobRecord {
  return {
    episodeUri: row.episode_uri,
    status: parseAgentMemoryLearningJobStatus(row.status),
    attempts: row.attempts,
    nextAttemptAtMs: row.next_attempt_at_ms,
    lastError: row.last_error,
    updatedAtMs: row.updated_at_ms,
  };
}
