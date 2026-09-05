import crypto from "node:crypto";
import { normalizeAgentContinuityScope, type AgentContinuityScopeRef } from "./AgentContinuityDomain.js";

export const AgentContinuitySemanticStateNamespace = "semantic";

export interface AgentContinuityStateIdentity {
  readonly uri: string;
  readonly namespace: string;
  readonly key: string;
  readonly summary: string;
  readonly scope: AgentContinuityScopeRef;
}

export function createAgentContinuitySemanticStateIdentity(
  summary: string,
  scope: AgentContinuityScopeRef,
): AgentContinuityStateIdentity {
  const normalizedSummary = normalizeStateSummary(summary);
  return createAgentContinuityStateIdentity({
    namespace: AgentContinuitySemanticStateNamespace,
    key: normalizedSummary,
    summary: normalizedSummary,
    scope,
  });
}

export function createAgentContinuityStateIdentity(input: {
  readonly namespace: string;
  readonly key: string;
  readonly summary?: string;
  readonly scope: AgentContinuityScopeRef;
}): AgentContinuityStateIdentity {
  const namespace = input.namespace.trim();
  const key = input.key.trim();
  const summary = normalizeStateSummary(input.summary ?? key);
  const scope = normalizeAgentContinuityScope(input.scope);
  if (!namespace || !key) throw new Error("Continuity state identity requires a namespace and key.");
  const id = crypto
    .createHash("sha256")
    .update(JSON.stringify([scope.kind, scope.id, namespace, key]))
    .digest("hex")
    .slice(0, 24);
  return {
    uri: `senera://continuity-state/state_${id}`,
    namespace,
    key,
    summary,
    scope,
  };
}

export function isAgentContinuityStateUri(value: string): boolean {
  return /^senera:\/\/continuity-state\/state_[a-f0-9]{24}$/u.test(value.trim());
}

function normalizeStateSummary(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized) throw new Error("Continuity state summary cannot be empty.");
  return normalized;
}
