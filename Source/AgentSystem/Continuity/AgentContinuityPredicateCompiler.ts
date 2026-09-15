import type { AgentContinuityCondition, AgentContinuityScopeRef } from "./AgentContinuityDomain.js";
import type { ParsedAgentContinuityConditionalModel } from "./AgentContinuityLearningSchema.js";
import { resolveAgentContinuityStateIdentity } from "./AgentContinuityRuleContext.js";
import type { AgentContinuityStateIdentity } from "./AgentContinuityStateIdentity.js";

/** Compiles a compact semantic model into the host-owned deterministic condition AST. */
export function compileAgentContinuityRuleCondition(
  model: ParsedAgentContinuityConditionalModel,
  input: {
    readonly scope: AgentContinuityScopeRef;
    readonly statesByUri: ReadonlyMap<string, AgentContinuityStateIdentity>;
  },
): AgentContinuityCondition {
  const conditions: AgentContinuityCondition[] = [
    ...(model.at ? [{ kind: "time_at_or_after" as const, at: normalizeTimestamp(model.at) }] : []),
    ...Object.entries(model.when ?? {}).map(([referenceOrSummary, expected]) => {
      const state = resolveAgentContinuityStateIdentity({
        referenceOrSummary,
        scope: input.scope,
        statesByUri: input.statesByUri,
      });
      return {
        kind: "signal" as const,
        namespace: state.namespace,
        key: state.key,
        label: state.summary,
        operator: "equals" as const,
        value: expected,
      };
    }),
  ];
  if (conditions.length === 1) return conditions[0]!;
  const match = model.match ?? "all";
  if (match === "any") return { kind: "any", children: conditions };
  if (match === "score") return { kind: "score", threshold: model.threshold!, children: conditions };
  return { kind: "all", children: conditions };
}

function normalizeTimestamp(value: string): string {
  const timestamp = Date.parse(value.trim());
  if (!Number.isFinite(timestamp)) throw new Error("Continuity time predicate must use an RFC 3339 timestamp.");
  return new Date(timestamp).toISOString();
}
