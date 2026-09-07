import crypto from "node:crypto";
import { uniqueStrings } from "../Core/AgentCollections.js";
import { normalizeAgentContinuityScope, type AgentContinuityScopeRef } from "./AgentContinuityDomain.js";
import type { AgentContinuityLearningStage } from "./AgentContinuitySqliteTypes.js";

export { uniqueStrings };

export function normalizeScopes(scopes: readonly AgentContinuityScopeRef[]): AgentContinuityScopeRef[] {
  return [
    ...new Map(
      scopes.map((scope) => {
        const normalized = normalizeAgentContinuityScope(scope);
        return [`${normalized.kind}:${normalized.id}`, normalized] as const;
      }),
    ).values(),
  ];
}

export function createId(prefix: string, values: readonly string[]): string {
  const hash = crypto.createHash("sha256");
  for (const value of values) {
    hash.update(value);
    hash.update("\0");
  }
  return `${prefix}_${hash.digest("hex").slice(0, 24)}`;
}

export function json(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJson(value: string): unknown {
  return JSON.parse(value);
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function stringArray(value: string): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? uniqueStrings(parsed.filter((item): item is string => typeof item === "string")) : [];
}

export function normalizeTimestamp(value: string, label: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid timestamp.`);
  return new Date(timestamp).toISOString();
}

export function learningStageColumns(stage: AgentContinuityLearningStage): {
  readonly status: "fact_status" | "rule_status";
  readonly attempts: "fact_attempts" | "rule_attempts";
  readonly nextAttemptAtMs: "fact_next_attempt_at_ms" | "rule_next_attempt_at_ms";
  readonly lastError: "fact_last_error" | "rule_last_error";
} {
  return stage === "facts"
    ? {
        status: "fact_status",
        attempts: "fact_attempts",
        nextAttemptAtMs: "fact_next_attempt_at_ms",
        lastError: "fact_last_error",
      }
    : {
        status: "rule_status",
        attempts: "rule_attempts",
        nextAttemptAtMs: "rule_next_attempt_at_ms",
        lastError: "rule_last_error",
      };
}
