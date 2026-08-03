import type Database from "better-sqlite3";
import { agentSql } from "../Database/AgentSql.js";
import {
  AgentMemoryLearningJobStatuses,
  type AgentMemoryLearningJobStatus,
  type AgentMemoryLearningJobStorageRow,
} from "./AgentMemoryLearningJob.js";

interface EnqueueMemoryLearningJobParameters {
  readonly completedStatus: AgentMemoryLearningJobStatus;
  readonly episodeUri: string;
  readonly nextAttemptAtMs: number;
  readonly pendingStatus: AgentMemoryLearningJobStatus;
  readonly updatedAtMs: number;
}

interface ResetRunningMemoryLearningJobsParameters {
  readonly interruptedError: string;
  readonly nextAttemptAtMs: number;
  readonly retryStatus: AgentMemoryLearningJobStatus;
  readonly runningStatus: AgentMemoryLearningJobStatus;
  readonly updatedAtMs: number;
}

interface RunnableMemoryLearningJobParameters {
  readonly pendingStatus: AgentMemoryLearningJobStatus;
  readonly retryStatus: AgentMemoryLearningJobStatus;
}

interface ListDueMemoryLearningJobsParameters extends RunnableMemoryLearningJobParameters {
  readonly limit: number;
  readonly nowMs: number;
}

interface MarkMemoryLearningJobRunningParameters extends RunnableMemoryLearningJobParameters {
  readonly episodeUri: string;
  readonly runningStatus: AgentMemoryLearningJobStatus;
  readonly updatedAtMs: number;
}

interface MemoryLearningJobIdentityParameters {
  readonly episodeUri: string;
}

interface MarkMemoryLearningJobCompletedParameters extends MemoryLearningJobIdentityParameters {
  readonly completedStatus: AgentMemoryLearningJobStatus;
  readonly nextAttemptAtMs: number;
  readonly updatedAtMs: number;
}

interface MarkMemoryLearningJobFailedParameters extends MemoryLearningJobIdentityParameters {
  readonly lastError: string;
  readonly nextAttemptAtMs: number;
  readonly status: AgentMemoryLearningJobStatus;
  readonly updatedAtMs: number;
}

export interface AgentMemoryLearningJobSqlStatements {
  enqueueMemoryLearningJob(episodeUri: string, nowMs: number): void;
  resetRunningMemoryLearningJobs(nowMs: number): void;
  listDueMemoryLearningJobs(nowMs: number, limit: number): AgentMemoryLearningJobStorageRow[];
  nextMemoryLearningJobAtMs(): number | undefined;
  markMemoryLearningJobRunning(episodeUri: string, nowMs: number): AgentMemoryLearningJobStorageRow | undefined;
  markMemoryLearningJobCompleted(episodeUri: string, nowMs: number): void;
  markMemoryLearningJobFailed(
    episodeUri: string,
    status: AgentMemoryLearningJobStatus,
    nextAttemptAtMs: number,
    lastError: string,
    updatedAtMs: number,
  ): void;
  listMemoryLearningJobs(): AgentMemoryLearningJobStorageRow[];
}

const EnqueueMemoryLearningJobSql = agentSql`
  INSERT INTO memory_learning_jobs (
    episode_uri, status, attempts, next_attempt_at_ms, last_error, updated_at_ms
  ) VALUES (@episodeUri, @pendingStatus, 0, @nextAttemptAtMs, '', @updatedAtMs)
  ON CONFLICT(episode_uri) DO UPDATE SET
    status = CASE
      WHEN memory_learning_jobs.status = @completedStatus THEN @completedStatus
      ELSE @pendingStatus
    END,
    next_attempt_at_ms = CASE
      WHEN memory_learning_jobs.status = @completedStatus THEN memory_learning_jobs.next_attempt_at_ms
      ELSE excluded.next_attempt_at_ms
    END,
    last_error = CASE
      WHEN memory_learning_jobs.status = @completedStatus THEN memory_learning_jobs.last_error
      ELSE ''
    END,
    updated_at_ms = excluded.updated_at_ms
`;

const ResetRunningMemoryLearningJobsSql = agentSql`
  UPDATE memory_learning_jobs
  SET status = @retryStatus,
      next_attempt_at_ms = @nextAttemptAtMs,
      last_error = @interruptedError,
      updated_at_ms = @updatedAtMs
  WHERE status = @runningStatus
`;

const ListDueMemoryLearningJobsSql = agentSql`
  SELECT * FROM memory_learning_jobs
  WHERE status IN (@pendingStatus, @retryStatus) AND next_attempt_at_ms <= @nowMs
  ORDER BY next_attempt_at_ms ASC, updated_at_ms ASC, episode_uri ASC
  LIMIT @limit
`;

const NextMemoryLearningJobAtSql = agentSql`
  SELECT MIN(next_attempt_at_ms) AS next_attempt_at_ms
  FROM memory_learning_jobs
  WHERE status IN (@pendingStatus, @retryStatus)
`;

const MarkMemoryLearningJobRunningSql = agentSql`
  UPDATE memory_learning_jobs
  SET status = @runningStatus, attempts = attempts + 1, updated_at_ms = @updatedAtMs
  WHERE episode_uri = @episodeUri AND status IN (@pendingStatus, @retryStatus)
`;

const SelectMemoryLearningJobSql = agentSql`
  SELECT * FROM memory_learning_jobs WHERE episode_uri = @episodeUri
`;

const MarkMemoryLearningJobCompletedSql = agentSql`
  UPDATE memory_learning_jobs
  SET status = @completedStatus, next_attempt_at_ms = @nextAttemptAtMs, last_error = '', updated_at_ms = @updatedAtMs
  WHERE episode_uri = @episodeUri
`;

const MarkMemoryLearningJobFailedSql = agentSql`
  UPDATE memory_learning_jobs
  SET status = @status, next_attempt_at_ms = @nextAttemptAtMs, last_error = @lastError, updated_at_ms = @updatedAtMs
  WHERE episode_uri = @episodeUri
`;

const ListMemoryLearningJobsSql = agentSql`
  SELECT * FROM memory_learning_jobs ORDER BY updated_at_ms ASC, episode_uri ASC
`;

const RuntimeRestartError = "interrupted by runtime restart";
const { Pending, Running, Retry, Completed } = AgentMemoryLearningJobStatuses;

export function prepareAgentMemoryLearningJobSqlStatements(db: Database.Database): AgentMemoryLearningJobSqlStatements {
  const enqueue = db.prepare<EnqueueMemoryLearningJobParameters>(EnqueueMemoryLearningJobSql);
  const resetRunning = db.prepare<ResetRunningMemoryLearningJobsParameters>(ResetRunningMemoryLearningJobsSql);
  const listDue = db.prepare<ListDueMemoryLearningJobsParameters, AgentMemoryLearningJobStorageRow>(
    ListDueMemoryLearningJobsSql,
  );
  const nextAttempt = db.prepare<RunnableMemoryLearningJobParameters, { next_attempt_at_ms: number | null }>(
    NextMemoryLearningJobAtSql,
  );
  const markRunning = db.prepare<MarkMemoryLearningJobRunningParameters>(MarkMemoryLearningJobRunningSql);
  const select = db.prepare<MemoryLearningJobIdentityParameters, AgentMemoryLearningJobStorageRow>(
    SelectMemoryLearningJobSql,
  );
  const markCompleted = db.prepare<MarkMemoryLearningJobCompletedParameters>(MarkMemoryLearningJobCompletedSql);
  const markFailed = db.prepare<MarkMemoryLearningJobFailedParameters>(MarkMemoryLearningJobFailedSql);
  const list = db.prepare<[], AgentMemoryLearningJobStorageRow>(ListMemoryLearningJobsSql);

  return {
    enqueueMemoryLearningJob: (episodeUri, nowMs) => {
      enqueue.run({
        episodeUri,
        pendingStatus: Pending,
        completedStatus: Completed,
        nextAttemptAtMs: nowMs,
        updatedAtMs: nowMs,
      });
    },
    resetRunningMemoryLearningJobs: (nowMs) => {
      resetRunning.run({
        retryStatus: Retry,
        runningStatus: Running,
        interruptedError: RuntimeRestartError,
        nextAttemptAtMs: nowMs,
        updatedAtMs: nowMs,
      });
    },
    listDueMemoryLearningJobs: (nowMs, limit) =>
      listDue.all({ pendingStatus: Pending, retryStatus: Retry, nowMs, limit }),
    nextMemoryLearningJobAtMs: () =>
      nextAttempt.get({ pendingStatus: Pending, retryStatus: Retry })?.next_attempt_at_ms ?? undefined,
    markMemoryLearningJobRunning: (episodeUri, nowMs) => {
      const updated = markRunning.run({
        episodeUri,
        runningStatus: Running,
        pendingStatus: Pending,
        retryStatus: Retry,
        updatedAtMs: nowMs,
      });
      return updated.changes === 0 ? undefined : select.get({ episodeUri });
    },
    markMemoryLearningJobCompleted: (episodeUri, nowMs) => {
      markCompleted.run({
        episodeUri,
        completedStatus: Completed,
        nextAttemptAtMs: nowMs,
        updatedAtMs: nowMs,
      });
    },
    markMemoryLearningJobFailed: (episodeUri, status, nextAttemptAtMs, lastError, updatedAtMs) => {
      markFailed.run({ episodeUri, status, nextAttemptAtMs, lastError, updatedAtMs });
    },
    listMemoryLearningJobs: () => list.all(),
  };
}
