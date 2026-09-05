import type Database from "better-sqlite3";
import type { AgentContinuityLearningStage } from "./AgentContinuitySqliteTypes.js";

export interface AgentContinuityLearningInferenceRecord {
  readonly inferenceKey: string;
  readonly stage: AgentContinuityLearningStage;
  readonly contractRevision: string;
  readonly bundleRevision: string;
  readonly providerId: string;
  readonly model: string;
  readonly inputJson: string;
  readonly outputJson: string;
  readonly featureKeys: readonly string[];
  readonly acceptedItemCount: number;
  readonly sourceEpisodeUri: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly useCount: number;
}

export interface AgentContinuityLearningInferenceWrite {
  readonly inferenceKey: string;
  readonly stage: AgentContinuityLearningStage;
  readonly contractRevision: string;
  readonly bundleRevision: string;
  readonly providerId: string;
  readonly model: string;
  readonly inputJson: string;
  readonly outputJson: string;
  readonly featureKeys: readonly string[];
  readonly acceptedItemCount: number;
  readonly sourceEpisodeUri: string;
  readonly observedAtMs: number;
}

interface AgentContinuityLearningInferenceRow {
  inference_key: string;
  stage: AgentContinuityLearningStage;
  contract_revision: string;
  bundle_revision: string;
  provider_id: string;
  model: string;
  input_json: string;
  output_json: string;
  feature_keys_json: string;
  accepted_item_count: number;
  source_episode_uri: string;
  created_at: string;
  last_used_at: string;
  use_count: number;
}

export function readAgentContinuityLearningInference(
  db: Database.Database,
  inferenceKey: string,
  usedAtMs: number,
): AgentContinuityLearningInferenceRecord | undefined {
  const row = db.prepare("SELECT * FROM continuity_learning_inferences WHERE inference_key = ?").get(inferenceKey) as
    AgentContinuityLearningInferenceRow | undefined;
  if (!row) return undefined;
  const usedAt = new Date(usedAtMs).toISOString();
  db.prepare(
    `UPDATE continuity_learning_inferences
        SET last_used_at = ?, last_used_at_ms = ?, use_count = use_count + 1
      WHERE inference_key = ?`,
  ).run(usedAt, usedAtMs, inferenceKey);
  return { ...projectInferenceRow(row), lastUsedAt: usedAt, useCount: row.use_count + 1 };
}

export function listAgentContinuityLearningInferences(
  db: Database.Database,
  stage: AgentContinuityLearningStage,
  contractRevision: string,
  candidateLimit: number,
): AgentContinuityLearningInferenceRecord[] {
  return (
    db
      .prepare(
        `SELECT *
           FROM continuity_learning_inferences
          WHERE stage = ? AND contract_revision = ? AND accepted_item_count > 0
          ORDER BY accepted_item_count DESC, last_used_at_ms DESC, inference_key ASC
          LIMIT ?`,
      )
      .all(stage, contractRevision, candidateLimit) as AgentContinuityLearningInferenceRow[]
  ).map(projectInferenceRow);
}

export function recordAgentContinuityLearningInference(
  db: Database.Database,
  input: AgentContinuityLearningInferenceWrite,
): AgentContinuityLearningInferenceRecord {
  const observedAt = new Date(input.observedAtMs).toISOString();
  const featureKeys = [...new Set(input.featureKeys.map((value) => value.trim()).filter(Boolean))].sort();
  db.prepare(
    `INSERT INTO continuity_learning_inferences (
       inference_key, stage, contract_revision, bundle_revision, provider_id, model,
       input_json, output_json, feature_keys_json, accepted_item_count, source_episode_uri,
       created_at, created_at_ms, last_used_at, last_used_at_ms, use_count
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(inference_key) DO UPDATE SET
       bundle_revision = excluded.bundle_revision,
       output_json = excluded.output_json,
       feature_keys_json = excluded.feature_keys_json,
       accepted_item_count = excluded.accepted_item_count,
       source_episode_uri = excluded.source_episode_uri,
       last_used_at = excluded.last_used_at,
       last_used_at_ms = excluded.last_used_at_ms,
       use_count = continuity_learning_inferences.use_count + 1`,
  ).run(
    input.inferenceKey,
    input.stage,
    input.contractRevision,
    input.bundleRevision,
    input.providerId,
    input.model,
    input.inputJson,
    input.outputJson,
    JSON.stringify(featureKeys),
    input.acceptedItemCount,
    input.sourceEpisodeUri,
    observedAt,
    input.observedAtMs,
    observedAt,
    input.observedAtMs,
  );
  const row = db
    .prepare("SELECT * FROM continuity_learning_inferences WHERE inference_key = ?")
    .get(input.inferenceKey) as AgentContinuityLearningInferenceRow | undefined;
  if (!row) throw new Error(`Continuity learning inference was not persisted: ${input.inferenceKey}`);
  return projectInferenceRow(row);
}

function projectInferenceRow(row: AgentContinuityLearningInferenceRow): AgentContinuityLearningInferenceRecord {
  const featureKeys: unknown = JSON.parse(row.feature_keys_json);
  if (!Array.isArray(featureKeys) || featureKeys.some((value) => typeof value !== "string")) {
    throw new Error(`Continuity learning inference has invalid feature keys: ${row.inference_key}`);
  }
  return {
    inferenceKey: row.inference_key,
    stage: row.stage,
    contractRevision: row.contract_revision,
    bundleRevision: row.bundle_revision,
    providerId: row.provider_id,
    model: row.model,
    inputJson: row.input_json,
    outputJson: row.output_json,
    featureKeys,
    acceptedItemCount: row.accepted_item_count,
    sourceEpisodeUri: row.source_episode_uri,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
  };
}
