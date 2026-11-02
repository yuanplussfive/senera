import type { RunRecord, TimelineStep } from "../../store/session/types";
import { frontendFeatureMessage as t } from "../../i18n/frontendFeatureMessageCatalog";
import { ContextCategories, contextChanges } from "./contextInspectionModel";
import { inspectionScopeId } from "./inspectionScopeModel";
import { insightRequests } from "./sessionInsightsModel";

export interface InsightContextEvent {
  id: string;
  kind: "initial" | "added" | "removed" | "model" | "compaction";
  label: string;
  source?: string;
  turn: number;
  step?: number;
  timestamp: string;
  sequence?: number;
  tokens?: number;
  estimated?: boolean;
  requestId?: string;
}

/** Snapshot differences are labelled as differences; only committed host events claim compaction. */
export function insightContextTimeline(
  runs: readonly RunRecord[],
  scopeId?: string,
  turnNumbers?: ReadonlyMap<string, number>,
): InsightContextEvent[] {
  const previous = new Map<string, TimelineStep>();
  const events: InsightContextEvent[] = [];
  for (const { run, step, turn } of insightRequests(runs, scopeId)) {
    const scope = inspectionScopeId(step.scope);
    const before = previous.get(scope);
    previous.set(scope, step);
    const base = {
      turn: turnNumbers?.get(run.requestId) ?? turn,
      step: step.agentStep,
      timestamp: step.startedAt,
      sequence: step.eventSequence,
      requestId: step.id,
      source: step.scope?.agentName,
    };
    if (before?.modelName && step.modelName && before.modelName !== step.modelName)
      events.push({ ...base, id: `${step.id}:model`, kind: "model", label: `${before.modelName} → ${step.modelName}` });
    const snapshot = step.contextSnapshot;
    if (!snapshot) continue;
    if (!before?.contextSnapshot) {
      events.push({
        ...base,
        id: `${step.id}:initial`,
        kind: "initial",
        label: step.modelName ?? t("insights.events.initial"),
        tokens: snapshot.estimatedTokens,
        estimated: true,
      });
      continue;
    }
    const changes = contextChanges(snapshot, before.contextSnapshot)!;
    for (const category of ContextCategories) {
      const added = [...changes.added]
        .map((index) => snapshot.sections[index]!)
        .filter((section) => section.category === category.id);
      const removed = changes.removedSections.filter((section) => section.category === category.id);
      for (const [kind, sections] of [
        ["added", added],
        ["removed", removed],
      ] as const) {
        if (sections.length === 0) continue;
        events.push({
          ...base,
          id: `${step.id}:${category.id}:${kind}`,
          kind,
          label: t("insights.events.sections", { category: t(category.label), count: sections.length }),
          tokens: sections.reduce((sum, section) => sum + section.tokens, 0) * (kind === "removed" ? -1 : 1),
          estimated: true,
        });
      }
    }
  }
  runs.forEach((run, index) => {
    for (const event of run.contextCompactions ?? []) {
      if (scopeId !== undefined && inspectionScopeId(event.scope) !== scopeId) continue;
      const after = run.steps.find(
        (step) =>
          step.kind === "model" &&
          (step.eventSequence ?? -1) > event.sequence &&
          inspectionScopeId(step.scope) === inspectionScopeId(event.scope),
      );
      events.push({
        id: `compaction:${event.sequence}`,
        kind: "compaction",
        label: t("insights.events.compacted"),
        turn: turnNumbers?.get(run.requestId) ?? index + 1,
        step: event.step,
        timestamp: event.timestamp,
        sequence: event.sequence,
        source: event.scope?.agentName,
        requestId: after?.id,
        tokens: event.estimatedTokensAfter === undefined ? undefined : event.estimatedTokensAfter - event.tokensBefore,
        estimated: event.estimatedTokensAfter === undefined ? undefined : true,
      });
    }
  });
  return events.sort((a, b) => b.turn - a.turn || (b.sequence ?? 0) - (a.sequence ?? 0));
}
