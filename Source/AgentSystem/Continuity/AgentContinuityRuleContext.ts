import type {
  AgentContinuityCondition,
  AgentContinuityRule,
  AgentContinuityScalar,
  AgentContinuityScopeRef,
  AgentContinuitySignal,
} from "./AgentContinuityDomain.js";
import { listAgentContinuityPromptScopes } from "./AgentContinuityScopes.js";
import type { AgentContinuitySqliteStore } from "./AgentContinuitySqliteStore.js";
import {
  AgentContinuitySemanticStateNamespace,
  createAgentContinuitySemanticStateIdentity,
  createAgentContinuityStateIdentity,
  type AgentContinuityStateIdentity,
} from "./AgentContinuityStateIdentity.js";
import type { AgentContinuityRulePromptInput } from "../ActionPlanner/AgentLearningPromptJson.js";
import type { AgentContinuityIdentityContext } from "./AgentContinuityIdentityStore.js";

export interface AgentContinuityModelingContext {
  readonly stateCatalog: AgentContinuityRulePromptInput["stateCatalog"];
  readonly ruleCatalog: AgentContinuityRulePromptInput["ruleCatalog"];
  readonly statesByUri: ReadonlyMap<string, AgentContinuityStateIdentity>;
}

/** Builds stable, model-visible state and rule cards without exposing storage keys as model-authored identifiers. */
export function collectAgentContinuityModelingContext(input: {
  readonly store: AgentContinuitySqliteStore;
  readonly identity: AgentContinuityIdentityContext;
  readonly sessionId: string;
  readonly now: Date;
}): AgentContinuityModelingContext {
  const scopes = listAgentContinuityPromptScopes(input.identity, input.sessionId);
  const signals = input.store.listSignals(scopes, input.now);
  const rules = input.store.listLiveRules(scopes);
  const identities = collectStateIdentities(rules, signals);
  const signalsByStateUri = new Map(
    signals.map((signal) => [identityForSignal(signal, identities).uri, signal] as const),
  );

  return {
    stateCatalog: Object.fromEntries(
      [...identities.values()]
        .sort((left, right) => left.uri.localeCompare(right.uri))
        .map((identity) => {
          const signal = signalsByStateUri.get(identity.uri);
          const currentValue = signal ? scalarValue(signal.value) : undefined;
          return [
            identity.uri,
            {
              summary: identity.summary,
              scope: identity.scope.kind,
              ...(currentValue !== undefined ? { currentValue } : {}),
              ...(signal?.expiresAt ? { expiresAt: signal.expiresAt } : {}),
            },
          ];
        }),
    ),
    ruleCatalog: Object.fromEntries(rules.map((rule) => [rule.uri, projectRuleCard(rule, identities)])),
    statesByUri: new Map([...identities.values()].map((identity) => [identity.uri, identity])),
  };
}

export function resolveAgentContinuityStateIdentity(input: {
  readonly referenceOrSummary: string;
  readonly scope: AgentContinuityScopeRef;
  readonly statesByUri: ReadonlyMap<string, AgentContinuityStateIdentity>;
}): AgentContinuityStateIdentity {
  const value = input.referenceOrSummary.trim();
  if (value.startsWith("senera://")) {
    const existing = input.statesByUri.get(value);
    if (!existing) throw new Error(`Unknown continuity state reference: ${value}`);
    return existing;
  }
  return createAgentContinuitySemanticStateIdentity(value, input.scope);
}

function collectStateIdentities(
  rules: readonly AgentContinuityRule[],
  signals: readonly AgentContinuitySignal[],
): Map<string, AgentContinuityStateIdentity> {
  const identities = new Map<string, AgentContinuityStateIdentity>();
  for (const rule of rules) collectConditionIdentities(rule.condition, rule.scope, identities);
  for (const signal of signals) {
    const identity = identityForSignal(signal, identities);
    identities.set(identity.uri, identity);
  }
  return identities;
}

function collectConditionIdentities(
  condition: AgentContinuityCondition,
  scope: AgentContinuityScopeRef,
  output: Map<string, AgentContinuityStateIdentity>,
): void {
  switch (condition.kind) {
    case "signal": {
      const identity = createAgentContinuityStateIdentity({
        namespace: condition.namespace,
        key: condition.key,
        summary: condition.label ?? condition.key,
        scope,
      });
      output.set(identity.uri, identity);
      return;
    }
    case "all":
    case "any":
    case "at_least":
    case "score":
      for (const child of condition.children) collectConditionIdentities(child, scope, output);
      return;
    case "not":
      collectConditionIdentities(condition.child, scope, output);
      return;
    case "always":
    case "time_at_or_after":
      return;
  }
}

function identityForSignal(
  signal: AgentContinuitySignal,
  known: ReadonlyMap<string, AgentContinuityStateIdentity>,
): AgentContinuityStateIdentity {
  const provisional = createAgentContinuityStateIdentity({
    namespace: signal.namespace,
    key: signal.key,
    summary:
      signal.namespace === AgentContinuitySemanticStateNamespace ? signal.key : `${signal.namespace}.${signal.key}`,
    scope: signal.scope,
  });
  const existing = known.get(provisional.uri);
  return existing ? { ...existing, scope: signal.scope } : provisional;
}

function projectRuleCard(
  rule: AgentContinuityRule,
  identities: ReadonlyMap<string, AgentContinuityStateIdentity>,
): AgentContinuityRulePromptInput["ruleCatalog"][string] {
  const conditions: AgentContinuityRulePromptInput["ruleCatalog"][string]["conditions"] = {};
  const times: string[] = [];
  collectRuleConditionCards(rule.condition, rule.scope, identities, conditions, times);
  return {
    title: rule.title,
    effect: rule.action.summary,
    status: rule.status,
    ...(times.length > 0 ? { time: times.join("; ") } : {}),
    conditions,
  };
}

function collectRuleConditionCards(
  condition: AgentContinuityCondition,
  scope: AgentContinuityScopeRef,
  identities: ReadonlyMap<string, AgentContinuityStateIdentity>,
  conditions: AgentContinuityRulePromptInput["ruleCatalog"][string]["conditions"],
  times: string[],
): void {
  switch (condition.kind) {
    case "signal": {
      const projected = createAgentContinuityStateIdentity({
        namespace: condition.namespace,
        key: condition.key,
        summary: condition.label ?? condition.key,
        scope,
      });
      const identity = identities.get(projected.uri) ?? projected;
      conditions[identity.uri] = {
        summary: identity.summary,
        operator: condition.operator,
        ...(condition.value !== undefined ? { expected: condition.value } : {}),
      };
      return;
    }
    case "time_at_or_after":
      times.push(condition.at);
      return;
    case "all":
    case "any":
    case "at_least":
    case "score":
      for (const child of condition.children) collectRuleConditionCards(child, scope, identities, conditions, times);
      return;
    case "not":
      collectRuleConditionCards(condition.child, scope, identities, conditions, times);
      return;
    case "always":
      return;
  }
}

function scalarValue(value: unknown): AgentContinuityScalar | undefined {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}
