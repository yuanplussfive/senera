import {
  normalizeAgentContinuityScope,
  type AgentContinuityScope,
  type AgentContinuityScopeRef,
} from "./AgentContinuityDomain.js";
import type { AgentContinuityIdentityContext } from "./AgentContinuityIdentityStore.js";

/**
 * Higher entries are more specific when the same profile key exists in more
 * than one active scope. Keeping this beside scope construction prevents
 * prompt projection from carrying a second, implicit precedence table.
 */
export const AgentContinuityPromptScopePriority: readonly AgentContinuityScope[] = [
  "workspace",
  "user",
  "world",
  "account",
  "runtime",
  "session",
];

const PromptScopeOrder = new Map(AgentContinuityPromptScopePriority.map((scope, index) => [scope, index] as const));

/**
 * Projects the logical identities available to one turn. Filesystem paths are
 * deliberately excluded from this boundary.
 */
export function listAgentContinuityPromptScopes(
  identity: AgentContinuityIdentityContext,
  sessionId: string | undefined = identity.sessionId,
): AgentContinuityScopeRef[] {
  return [
    { kind: "workspace", id: identity.workspaceId },
    ...(identity.userId ? [{ kind: "user" as const, id: identity.userId }] : []),
    ...(identity.worldId ? [{ kind: "world" as const, id: identity.worldId }] : []),
    ...(identity.accountId ? [{ kind: "account" as const, id: identity.accountId }] : []),
    { kind: "runtime", id: identity.runtimeId },
    ...(sessionId ? [{ kind: "session" as const, id: sessionId }] : []),
  ];
}

/**
 * Builds the automatic text-recall scope set for one live turn.
 *
 * The live session transcript is already part of the Pi context. Keeping its
 * physical messages and learning rows in the automatic search surface makes
 * the same evidence compete with durable memory and can project it twice.
 * Explicit MemoryRecallTool requests use the full prompt scope set instead.
 */
export function listAgentContinuityAutomaticRecallScopes(
  identity: AgentContinuityIdentityContext,
  sessionId: string | undefined = identity.sessionId,
): AgentContinuityScopeRef[] {
  return listAgentContinuityPromptScopes(identity, sessionId).filter(
    (scope) => scope.kind !== "session" || scope.id !== sessionId,
  );
}

export function agentContinuityScopeKey(scopes: readonly AgentContinuityScopeRef[]): string {
  const unique = new Map(
    scopes.map((scope) => {
      const normalized = normalizeAgentContinuityScope(scope);
      return [JSON.stringify(normalized), normalized] as const;
    }),
  );
  return JSON.stringify(
    [...unique.values()]
      .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id))
      .map((scope) => ({ kind: scope.kind, id: scope.id })),
  );
}

export function compareAgentContinuityScopeSpecificity(
  left: AgentContinuityScopeRef,
  right: AgentContinuityScopeRef,
): number {
  return (PromptScopeOrder.get(left.kind) ?? -1) - (PromptScopeOrder.get(right.kind) ?? -1);
}

/**
 * Returns the precedence of a signal for a rule. Exact scope wins. A session
 * rule may consume the current workspace runtime signal when no session value
 * exists; unrelated scopes remain invisible to the rule.
 */
export function agentContinuitySignalScopePriority(
  ruleScope: AgentContinuityScopeRef,
  signalScope: AgentContinuityScopeRef,
): number {
  if (ruleScope.kind === signalScope.kind && ruleScope.id === signalScope.id) return 3;
  if (
    signalScope.kind === "runtime" &&
    (ruleScope.kind === "workspace" || ruleScope.kind === "world" || ruleScope.kind === "session")
  )
    return 2;
  if (ruleScope.kind === "session" && signalScope.kind === "workspace") return 2;
  return 0;
}
