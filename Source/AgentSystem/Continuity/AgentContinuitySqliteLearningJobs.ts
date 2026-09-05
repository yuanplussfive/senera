import type Database from "better-sqlite3";
import type {
  AgentContinuityObservation,
  AgentContinuityRule,
  AgentContinuitySignal,
} from "./AgentContinuityDomain.js";
import { jobFromRow, type JobRow } from "./AgentContinuitySqliteRows.js";
import { json, learningStageColumns, uniqueStrings } from "./AgentContinuitySqliteUtils.js";
import type {
  AgentContinuityFactLearningResult,
  AgentContinuityLearningClaim,
  AgentContinuityLearningClaimTransition,
  AgentContinuityLearningJob,
  AgentContinuityLearningStage,
  AgentContinuityRuleDraft,
  AgentContinuityRuleLearningResult,
} from "./AgentContinuitySqliteTypes.js";

export interface AgentContinuityLearningPersistence {
  readonly recordObservation: (input: AgentContinuityObservation) => AgentContinuityObservation;
  readonly recordGraphRelationCandidate: (input: AgentContinuityFactLearningResult["relations"][number]) => void;
  readonly upsertSignal: (signal: AgentContinuitySignal) => void;
  readonly recordRule: (draft: AgentContinuityRuleDraft, now: string) => AgentContinuityRule;
}

export function completeAgentContinuityFactLearning(
  db: Database.Database,
  claim: AgentContinuityLearningClaim,
  input: AgentContinuityFactLearningResult,
  nowMs: number,
  persistence: AgentContinuityLearningPersistence,
): AgentContinuityLearningClaimTransition {
  assertClaimStage(claim, "facts");
  const transaction = db.transaction(() => {
    const transition = db
      .prepare(
        `UPDATE continuity_learning_jobs
         SET fact_status = 'completed', fact_last_error = '', facts_json = ?, needs_rule_pass = ?,
             rule_status = ?, rule_next_attempt_at_ms = ?, rule_last_error = '', updated_at_ms = ?
         WHERE episode_uri = ? AND fact_status = 'running' AND fact_attempts = ?`,
      )
      .run(
        json(uniqueStrings(input.facts)),
        input.needsRulePass ? 1 : 0,
        input.needsRulePass ? "pending" : "skipped",
        nowMs,
        nowMs,
        claim.episodeUri,
        claim.attempt,
      );
    if (transition.changes === 0) return "superseded" as const;
    for (const observation of input.observations) persistence.recordObservation(observation);
    for (const relation of input.relations) persistence.recordGraphRelationCandidate(relation);
    return "committed" as const;
  });
  return transaction();
}

export function completeAgentContinuityRuleLearning(
  db: Database.Database,
  claim: AgentContinuityLearningClaim,
  input: AgentContinuityRuleLearningResult,
  nowMs: number,
  persistence: AgentContinuityLearningPersistence,
): AgentContinuityLearningClaimTransition {
  assertClaimStage(claim, "rules");
  const now = new Date(nowMs).toISOString();
  const transaction = db.transaction(() => {
    const transition = db
      .prepare(
        `UPDATE continuity_learning_jobs
         SET rule_status = 'completed', rule_last_error = '', updated_at_ms = ?
         WHERE episode_uri = ? AND rule_status = 'running' AND rule_attempts = ?`,
      )
      .run(nowMs, claim.episodeUri, claim.attempt);
    if (transition.changes === 0) return "superseded" as const;
    for (const signal of input.signals) persistence.upsertSignal(signal);
    for (const rule of input.rules) persistence.recordRule(rule, now);
    return "committed" as const;
  });
  return transaction();
}

export function enqueueAgentContinuityLearning(db: Database.Database, episodeUri: string, nowMs: number): void {
  db.prepare(
    `INSERT INTO continuity_learning_jobs (
         episode_uri, fact_status, fact_attempts, fact_next_attempt_at_ms, fact_last_error,
         facts_json, needs_rule_pass, rule_status, rule_attempts, rule_next_attempt_at_ms,
         rule_last_error, updated_at_ms
       ) VALUES (?, 'pending', 0, ?, '', '[]', 0, 'skipped', 0, ?, '', ?)
       ON CONFLICT(episode_uri) DO UPDATE SET updated_at_ms = excluded.updated_at_ms`,
  ).run(episodeUri, nowMs, nowMs, nowMs);
}

export function deferAgentContinuityFactJobsForSession(
  db: Database.Database,
  sessionId: string,
  nowMs: number,
  deferredUntilMs: number,
): number {
  if (deferredUntilMs <= nowMs) return 0;
  return db
    .prepare(
      `UPDATE continuity_learning_jobs
       SET fact_next_attempt_at_ms = ?, updated_at_ms = ?
       WHERE fact_status = 'pending'
         AND fact_next_attempt_at_ms > ?
         AND episode_uri IN (SELECT uri FROM memory_episodes WHERE session_id = ?)
         AND fact_next_attempt_at_ms < ?`,
    )
    .run(deferredUntilMs, nowMs, nowMs, sessionId, deferredUntilMs).changes;
}

export function releaseAgentContinuityPendingLearningJobs(db: Database.Database, nowMs: number): number {
  return db
    .prepare(
      `UPDATE continuity_learning_jobs
       SET fact_next_attempt_at_ms = ?, updated_at_ms = ?
       WHERE fact_status = 'pending' AND fact_next_attempt_at_ms > ?`,
    )
    .run(nowMs, nowMs, nowMs).changes;
}

export function recoverAgentContinuityInterruptedLearningJobs(db: Database.Database, nowMs: number): number {
  const transaction = db.transaction(() => {
    const facts = db
      .prepare(
        `UPDATE continuity_learning_jobs
         SET fact_status = 'retry', fact_next_attempt_at_ms = ?, updated_at_ms = ?
         WHERE fact_status = 'running'`,
      )
      .run(nowMs, nowMs);
    const rules = db
      .prepare(
        `UPDATE continuity_learning_jobs
         SET rule_status = 'retry', rule_next_attempt_at_ms = ?, updated_at_ms = ?
         WHERE rule_status = 'running'`,
      )
      .run(nowMs, nowMs);
    return facts.changes + rules.changes;
  });
  return transaction();
}

export function listDueAgentContinuityLearningJobs(
  db: Database.Database,
  nowMs: number,
  limit: number,
): AgentContinuityLearningJob[] {
  return db
    .prepare<[number, number, number, number], JobRow>(
      `SELECT * FROM continuity_learning_jobs
       WHERE (fact_status IN ('pending', 'retry') AND fact_next_attempt_at_ms <= ?)
          OR (rule_status IN ('pending', 'retry') AND rule_next_attempt_at_ms <= ?)
       ORDER BY CASE
         WHEN fact_status IN ('pending', 'retry') AND fact_next_attempt_at_ms <= ?
           THEN fact_next_attempt_at_ms
         ELSE rule_next_attempt_at_ms
       END, episode_uri
       LIMIT ?`,
    )
    .all(nowMs, nowMs, nowMs, limit)
    .map((row) => jobFromRow(row, nowMs));
}

export function claimAgentContinuityLearningJob(
  db: Database.Database,
  episodeUri: string,
  stage: AgentContinuityLearningStage,
  nowMs: number,
): AgentContinuityLearningJob | undefined {
  const columns = learningStageColumns(stage);
  const update = db
    .prepare(
      `UPDATE continuity_learning_jobs
       SET ${columns.status} = 'running', ${columns.attempts} = ${columns.attempts} + 1, updated_at_ms = ?
       WHERE episode_uri = ? AND ${columns.status} IN ('pending', 'retry')
         AND ${columns.nextAttemptAtMs} <= ?`,
    )
    .run(nowMs, episodeUri, nowMs);
  if (update.changes === 0) return undefined;
  const job = db
    .prepare<[string], JobRow>("SELECT * FROM continuity_learning_jobs WHERE episode_uri = ?")
    .get(episodeUri);
  return job ? jobFromRow(job, nowMs, stage) : undefined;
}

export function failAgentContinuityLearningJob(
  db: Database.Database,
  claim: AgentContinuityLearningClaim,
  input: {
    readonly terminal: boolean;
    readonly nextAttemptAtMs: number;
    readonly lastError: string;
    readonly nowMs: number;
  },
): AgentContinuityLearningClaimTransition {
  const columns = learningStageColumns(claim.stage);
  const transition = db
    .prepare(
      `UPDATE continuity_learning_jobs
       SET ${columns.status} = ?, ${columns.nextAttemptAtMs} = ?, ${columns.lastError} = ?, updated_at_ms = ?
       WHERE episode_uri = ? AND ${columns.status} = 'running' AND ${columns.attempts} = ?`,
    )
    .run(
      input.terminal ? "failed" : "retry",
      input.nextAttemptAtMs,
      input.lastError,
      input.nowMs,
      claim.episodeUri,
      claim.attempt,
    );
  return transition.changes === 1 ? "committed" : "superseded";
}

function assertClaimStage(claim: AgentContinuityLearningClaim, expected: AgentContinuityLearningStage): void {
  if (claim.stage !== expected) {
    throw new Error(`Continuity ${expected} persistence received a ${claim.stage} claim.`);
  }
}

export function nextAgentContinuityLearningDueAtMs(db: Database.Database): number | undefined {
  const row = db
    .prepare<[], { due_at_ms: number | null }>(
      `SELECT MIN(due_at_ms) AS due_at_ms FROM (
         SELECT fact_next_attempt_at_ms AS due_at_ms FROM continuity_learning_jobs
         WHERE fact_status IN ('pending', 'retry')
         UNION ALL
         SELECT rule_next_attempt_at_ms AS due_at_ms FROM continuity_learning_jobs
         WHERE rule_status IN ('pending', 'retry')
       )`,
    )
    .get();
  return row?.due_at_ms ?? undefined;
}
