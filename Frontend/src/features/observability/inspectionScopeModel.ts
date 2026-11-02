import type { RunRecord, TimelineStep, TimelineStepScope } from "../../store/session/types";

/** Names describe an Agent; the execution scope identifies it. */
export function inspectionScopeId(scope: TimelineStepScope | undefined): string {
  return scope?.parentRequestId
    ? JSON.stringify([
        scope.parentSessionId,
        scope.parentRequestId,
        scope.workflowName,
        scope.role,
        scope.jobId,
        scope.childRunId,
      ])
    : "main";
}

export function inspectionSteps(run: RunRecord | undefined, scopeId?: string): TimelineStep[] {
  return run?.steps.filter((step) => scopeId === undefined || inspectionScopeId(step.scope) === scopeId) ?? [];
}

export function inspectionScopes(run: RunRecord | undefined) {
  const scopes = new Map<
    string,
    { id: string; scope: TimelineStepScope | undefined; requests: number; tools: number }
  >();
  for (const step of run?.steps ?? []) {
    const id = inspectionScopeId(step.scope);
    const entry = scopes.get(id) ?? { id, scope: step.scope, requests: 0, tools: 0 };
    if (step.kind === "model") entry.requests += 1;
    if (step.kind === "tool") entry.tools += 1;
    scopes.set(id, entry);
  }
  return [...scopes.values()];
}

/** An incomplete per-Agent meter stays unknown instead of borrowing the whole turn's total. */
export function inspectionUsage(run: RunRecord, scopeId?: string) {
  if (scopeId === undefined) return { tokens: run.usage?.totalTokens, cost: run.usage?.cost?.total };
  const models = inspectionSteps(run, scopeId).filter((step) => step.kind === "model");
  if (models.length === 0) return {};
  const usages = models.map((step) => step.modelUsage);
  const currencies = new Set(usages.map((usage) => usage?.cost?.currency));
  return {
    tokens: sumKnown(usages.map((usage) => usage?.totalTokens)),
    cost: currencies.size === 1 ? sumKnown(usages.map((usage) => usage?.cost?.total)) : undefined,
  };
}

function sumKnown(values: readonly (number | undefined)[]): number | undefined {
  let total = 0;
  for (const value of values) {
    if (value === undefined) return undefined;
    total += value;
  }
  return total;
}
