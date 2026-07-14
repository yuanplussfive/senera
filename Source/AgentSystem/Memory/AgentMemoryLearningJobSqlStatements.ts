import type Database from "better-sqlite3";
import { AgentMemoryLearningJobStatuses, type AgentMemoryLearningJobStorageRow } from "./AgentMemoryLearningJob.js";

const { Pending, Running, Retry, Completed } = AgentMemoryLearningJobStatuses;

export interface AgentMemoryLearningJobSqlStatements {
  enqueueMemoryLearningJobStmt: Database.Statement;
  resetRunningMemoryLearningJobsStmt: Database.Statement<[number, number]>;
  listDueMemoryLearningJobsStmt: Database.Statement<[number, number], AgentMemoryLearningJobStorageRow>;
  nextMemoryLearningJobAtStmt: Database.Statement<[], { next_attempt_at_ms: number | null }>;
  markMemoryLearningJobRunningStmt: Database.Statement<[number, string]>;
  selectMemoryLearningJobStmt: Database.Statement<[string], AgentMemoryLearningJobStorageRow>;
  markMemoryLearningJobCompletedStmt: Database.Statement<[number, number, string]>;
  markMemoryLearningJobFailedStmt: Database.Statement<[string, number, string, number, string]>;
  listMemoryLearningJobsStmt: Database.Statement<[], AgentMemoryLearningJobStorageRow>;
}

export function prepareAgentMemoryLearningJobSqlStatements(db: Database.Database): AgentMemoryLearningJobSqlStatements {
  return {
    enqueueMemoryLearningJobStmt: db.prepare(`
      INSERT INTO memory_learning_jobs (
        episode_uri, status, attempts, next_attempt_at_ms, last_error, updated_at_ms
      ) VALUES (?, '${Pending}', 0, ?, '', ?)
      ON CONFLICT(episode_uri) DO UPDATE SET
        status = CASE
          WHEN memory_learning_jobs.status = '${Completed}' THEN '${Completed}'
          ELSE '${Pending}'
        END,
        next_attempt_at_ms = CASE
          WHEN memory_learning_jobs.status = '${Completed}' THEN memory_learning_jobs.next_attempt_at_ms
          ELSE excluded.next_attempt_at_ms
        END,
        last_error = CASE
          WHEN memory_learning_jobs.status = '${Completed}' THEN memory_learning_jobs.last_error
          ELSE ''
        END,
        updated_at_ms = excluded.updated_at_ms
    `),
    resetRunningMemoryLearningJobsStmt: db.prepare<[number]>(`
      UPDATE memory_learning_jobs
      SET status = '${Retry}', next_attempt_at_ms = ?, last_error = 'interrupted by runtime restart', updated_at_ms = ?
      WHERE status = '${Running}'
    `),
    listDueMemoryLearningJobsStmt: db.prepare<[number, number], AgentMemoryLearningJobStorageRow>(`
      SELECT * FROM memory_learning_jobs
      WHERE status IN ('${Pending}', '${Retry}') AND next_attempt_at_ms <= ?
      ORDER BY next_attempt_at_ms ASC, updated_at_ms ASC, episode_uri ASC
      LIMIT ?
    `),
    nextMemoryLearningJobAtStmt: db.prepare<[], { next_attempt_at_ms: number | null }>(`
      SELECT MIN(next_attempt_at_ms) AS next_attempt_at_ms
      FROM memory_learning_jobs
      WHERE status IN ('${Pending}', '${Retry}')
    `),
    markMemoryLearningJobRunningStmt: db.prepare<[number, string]>(`
      UPDATE memory_learning_jobs
      SET status = '${Running}', attempts = attempts + 1, updated_at_ms = ?
      WHERE episode_uri = ? AND status IN ('${Pending}', '${Retry}')
    `),
    selectMemoryLearningJobStmt: db.prepare<[string], AgentMemoryLearningJobStorageRow>(`
      SELECT * FROM memory_learning_jobs WHERE episode_uri = ?
    `),
    markMemoryLearningJobCompletedStmt: db.prepare<[number, number, string]>(`
      UPDATE memory_learning_jobs
      SET status = '${Completed}', next_attempt_at_ms = ?, last_error = '', updated_at_ms = ?
      WHERE episode_uri = ?
    `),
    markMemoryLearningJobFailedStmt: db.prepare<[string, number, string, number, string]>(`
      UPDATE memory_learning_jobs
      SET status = ?, next_attempt_at_ms = ?, last_error = ?, updated_at_ms = ?
      WHERE episode_uri = ?
    `),
    listMemoryLearningJobsStmt: db.prepare<[], AgentMemoryLearningJobStorageRow>(`
      SELECT * FROM memory_learning_jobs ORDER BY updated_at_ms ASC, episode_uri ASC
    `),
  };
}
