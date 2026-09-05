import crypto from "node:crypto";
import type {
  AgentContinuityObservation,
  AgentContinuityRule,
  AgentContinuityRuleStatus,
  AgentContinuityScopeRef,
  AgentContinuitySignal,
  AgentContinuityTemporalWindow,
} from "./AgentContinuityDomain.js";
import {
  parseAgentContinuityAction,
  parseAgentContinuityCondition,
  serializeAgentContinuityAction,
  serializeAgentContinuityCondition,
} from "./AgentContinuityDomain.js";
import type {
  AgentContinuityFactHead,
  AgentContinuityFactHistoryEntry,
  AgentContinuityLearningJob,
  AgentContinuityLearningStage,
  AgentContinuityLearningStageStatus,
} from "./AgentContinuitySqliteTypes.js";
import { json, learningStageColumns, objectValue, parseJson, stringArray } from "./AgentContinuitySqliteUtils.js";

export interface ObservationRow {
  id: string;
  uri: string;
  kind: AgentContinuityObservation["kind"];
  summary: string;
  payload_json: string;
  source_refs_json: string;
  watermark: string;
  scope_kind: AgentContinuityScopeRef["kind"];
  scope_id: string;
  authority: AgentContinuityObservation["authority"];
  confidence: number;
  occurred_at: string;
  observed_at: string;
  created_at_ms: number;
}

export interface SignalRow {
  scope_kind: AgentContinuityScopeRef["kind"];
  scope_id: string;
  namespace: string;
  signal_key: string;
  value_json: string;
  value_type: AgentContinuitySignal["valueType"];
  authority: AgentContinuitySignal["authority"];
  confidence: number;
  observed_at: string;
  expires_at: string | null;
  source_refs_json: string;
}

export interface RuleRow {
  id: string;
  uri: string;
  title: string;
  condition_json: string;
  action_json: string;
  scope_kind: AgentContinuityScopeRef["kind"];
  scope_id: string;
  authority: AgentContinuityRule["authority"];
  confidence: number;
  temporal_kind: AgentContinuityTemporalWindow["kind"];
  valid_from: string | null;
  valid_until: string | null;
  time_zone: string;
  source_refs_json: string;
  status: AgentContinuityRuleStatus;
  last_evaluated_at: string | null;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
  semantic_key: string;
  condition_key: string;
  effect_key: string;
  support_count: number;
  support_mass: number;
  maturity: AgentContinuityRule["maturity"];
  superseded_by: string | null;
}

export interface JobRow {
  episode_uri: string;
  fact_status: AgentContinuityLearningStageStatus;
  fact_attempts: number;
  fact_next_attempt_at_ms: number;
  fact_last_error: string;
  facts_json: string;
  needs_rule_pass: number;
  rule_status: AgentContinuityLearningStageStatus | "skipped";
  rule_attempts: number;
  rule_next_attempt_at_ms: number;
  rule_last_error: string;
  updated_at_ms: number;
}

export interface FactHeadRow {
  scope_kind: AgentContinuityScopeRef["kind"];
  scope_id: string;
  fact_key: string;
  observation_uri: string;
  claim: string;
  normalized_claim: string;
  authority: AgentContinuityFactHead["authority"];
  confidence: number;
  valid_from: string;
  valid_until: string | null;
  source_refs_json: string;
  status: AgentContinuityFactHead["status"];
  support_count: number;
  support_mass: number;
  maturity: AgentContinuityFactHead["maturity"];
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FactHistoryRow {
  id: string;
  scope_kind: AgentContinuityScopeRef["kind"];
  scope_id: string;
  fact_key: string;
  observation_uri: string;
  operation: AgentContinuityFactHistoryEntry["operation"];
  claim: string;
  authority: AgentContinuityFactHistoryEntry["authority"];
  confidence: number;
  occurred_at: string;
  superseded_by: string | null;
  source_refs_json: string;
}

export function observationFromRow(row: ObservationRow): AgentContinuityObservation {
  return {
    id: row.id,
    uri: row.uri,
    kind: row.kind,
    summary: row.summary,
    payload: objectValue(parseJson(row.payload_json)),
    sourceRefs: stringArray(row.source_refs_json),
    watermark: row.watermark,
    scope: { kind: row.scope_kind, id: row.scope_id },
    authority: row.authority,
    confidence: row.confidence,
    occurredAt: row.occurred_at,
    observedAt: row.observed_at,
    createdAtMs: row.created_at_ms,
  };
}

export function ruleToRow(rule: AgentContinuityRule): Record<string, unknown> {
  return {
    id: rule.id,
    uri: rule.uri,
    title: rule.title,
    condition_json: serializeAgentContinuityCondition(rule.condition),
    action_json: serializeAgentContinuityAction(rule.action),
    scope_kind: rule.scope.kind,
    scope_id: rule.scope.id,
    authority: rule.authority,
    confidence: rule.confidence,
    temporal_kind: rule.temporal.kind,
    valid_from: rule.temporal.startsAt ?? null,
    valid_until: rule.temporal.endsAt ?? null,
    time_zone: rule.temporal.timeZone,
    source_refs_json: json(rule.sourceRefs),
    status: rule.status,
    created_at: rule.createdAt,
    updated_at: rule.updatedAt,
    semantic_key: rule.semanticKey ?? "",
    condition_key: rule.conditionKey ?? "",
    effect_key: rule.effectKey ?? "",
    support_count: rule.supportCount ?? 1,
    support_mass: rule.supportMass ?? rule.confidence,
    maturity: rule.maturity ?? "active",
    superseded_by: rule.supersededBy ?? null,
  };
}

export function ruleFingerprint(rule: Pick<AgentContinuityRule, "scope" | "condition" | "action">): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        scope: rule.scope,
        condition: JSON.parse(serializeAgentContinuityCondition(rule.condition)),
        action: rule.action,
      }),
    )
    .digest("hex");
}

export function ruleFromRow(row: RuleRow): AgentContinuityRule {
  return {
    id: row.id,
    uri: row.uri,
    title: row.title,
    condition: parseAgentContinuityCondition(row.condition_json),
    action: parseAgentContinuityAction(row.action_json),
    scope: { kind: row.scope_kind, id: row.scope_id },
    authority: row.authority,
    confidence: row.confidence,
    temporal: {
      kind: row.temporal_kind,
      startsAt: row.valid_from ?? undefined,
      endsAt: row.valid_until ?? undefined,
      timeZone: row.time_zone,
    },
    sourceRefs: stringArray(row.source_refs_json),
    semanticKey: row.semantic_key,
    conditionKey: row.condition_key,
    effectKey: row.effect_key,
    supportCount: row.support_count,
    supportMass: row.support_mass,
    maturity: row.maturity ?? "active",
    ...(row.superseded_by ? { supersededBy: row.superseded_by } : {}),
    status: row.status,
    ...(row.last_evaluated_at ? { lastEvaluatedAt: row.last_evaluated_at } : {}),
    ...(row.last_triggered_at ? { lastTriggeredAt: row.last_triggered_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function signalFromRow(row: SignalRow): AgentContinuitySignal {
  return {
    scope: { kind: row.scope_kind, id: row.scope_id },
    namespace: row.namespace,
    key: row.signal_key,
    value: parseJson(row.value_json),
    valueType: row.value_type,
    authority: row.authority,
    confidence: row.confidence,
    observedAt: row.observed_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    sourceRefs: stringArray(row.source_refs_json),
  };
}

export function factHeadFromRow(row: FactHeadRow): AgentContinuityFactHead {
  return {
    factKey: row.fact_key,
    claim: row.claim,
    observationUri: row.observation_uri,
    scope: { kind: row.scope_kind, id: row.scope_id },
    authority: row.authority,
    confidence: row.confidence,
    validFrom: row.valid_from,
    ...(row.valid_until ? { validUntil: row.valid_until } : {}),
    sourceRefs: stringArray(row.source_refs_json),
    status: row.status,
    supportCount: row.support_count,
    supportMass: row.support_mass,
    maturity: row.maturity,
    supersededBy: row.superseded_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function factHistoryFromRow(row: FactHistoryRow): AgentContinuityFactHistoryEntry {
  return {
    id: row.id,
    factKey: row.fact_key,
    scope: { kind: row.scope_kind, id: row.scope_id },
    observationUri: row.observation_uri,
    operation: row.operation,
    claim: row.claim,
    authority: row.authority,
    confidence: row.confidence,
    occurredAt: row.occurred_at,
    supersededBy: row.superseded_by ?? null,
    sourceRefs: stringArray(row.source_refs_json),
  };
}

export function jobFromRow(
  row: JobRow,
  nowMs: number,
  claimedStage?: AgentContinuityLearningStage,
): AgentContinuityLearningJob {
  const stage = claimedStage ?? dueLearningStage(row, nowMs);
  const columns = learningStageColumns(stage);
  const status = row[columns.status];
  if (status === "skipped") throw new Error("A skipped continuity stage cannot be claimed.");
  return {
    episodeUri: row.episode_uri,
    stage,
    status,
    attempts: row[columns.attempts],
    nextAttemptAtMs: row[columns.nextAttemptAtMs],
    lastError: row[columns.lastError],
    facts: stringArray(row.facts_json),
    needsRulePass: row.needs_rule_pass === 1,
    updatedAtMs: row.updated_at_ms,
  };
}

export function dueLearningStage(row: JobRow, nowMs: number): AgentContinuityLearningStage {
  return (row.fact_status === "pending" || row.fact_status === "retry") && row.fact_next_attempt_at_ms <= nowMs
    ? "facts"
    : "rules";
}
