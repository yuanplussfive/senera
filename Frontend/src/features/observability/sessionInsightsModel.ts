import { type EventEnvelope, type ModelUsageMetadata } from "../../api/eventTypes";
import { shallow } from "zustand/shallow";
import type { RunRecord, TimelineStep } from "../../store/session/types";
import {
  projectRunHistoryDetail,
  projectRunHistoryModelObservations,
} from "../../store/session/runHistoryDetailProjection";
import { createRunRecord } from "../../store/session/sessionRunProjection";
import { readWorkflowStepDurationMs } from "../workflow/workflowPresentationProjection";
import { modelRequests } from "./contextInspectionModel";
import { inspectionSteps } from "./inspectionScopeModel";
import { aggregateAgentModelCosts } from "../../../../Source/AgentSystem/ModelEndpoints/AgentModelPricing";

/** Keep streamed answer/reasoning text out of the observation subscription and its working set. */
export function createInsightRunSelector({ overviewOnly = false }: { overviewOnly?: boolean } = {}) {
  let source: readonly RunRecord[] | undefined;
  let selected: RunRecord[] = [];
  let byId = new Map<string, RunRecord>();
  return (runs: readonly RunRecord[]): RunRecord[] => {
    if (source === runs) return selected;
    source = runs;
    const next = runs.map((run) => {
      const previous = byId.get(run.requestId);
      const steps = overviewOnly ? overviewSteps(run.steps, previous?.steps) : run.steps;
      if (
        previous &&
        previous.steps === steps &&
        previous.contextCompactions === run.contextCompactions &&
        previous.usage === run.usage &&
        previous.status === run.status &&
        previous.startedAt === run.startedAt &&
        previous.endedAt === run.endedAt &&
        previous.input === run.input &&
        previous.hostInput === run.hostInput &&
        previous.modelProvider === run.modelProvider
      )
        return previous;
      return {
        ...createRunRecord({ requestId: run.requestId, startedAt: run.startedAt, input: run.input }),
        status: run.status,
        hostInput: run.hostInput,
        endedAt: run.endedAt,
        steps,
        contextCompactions: run.contextCompactions,
        usage: run.usage,
        modelProvider: run.modelProvider,
      };
    });
    if (next.length === selected.length && next.every((run, index) => run === selected[index])) return selected;
    byId = new Map(next.map((run) => [run.requestId, run]));
    selected = next;
    return selected;
  };
}

/** Analytics respond to measured state, never to streamed feedback, tool output or reasoning text. */
function overviewSteps(steps: readonly TimelineStep[], previous: TimelineStep[] = []): TimelineStep[] {
  const byId = new Map(previous.map((step) => [step.id, step]));
  const next = steps.map((step): TimelineStep => {
    const observation: TimelineStep = {
      id: step.id,
      kind: step.kind,
      title: step.title,
      status: step.status,
      startedAt: step.startedAt,
      endedAt: step.endedAt,
      durationMs: step.durationMs,
      eventSequence: step.eventSequence,
      scope: step.scope,
      callId: step.callId,
      toolName: step.toolName,
      modelName: step.modelName,
      responseModel: step.responseModel,
      modelUsage: step.modelUsage,
      contextSnapshot: step.contextSnapshot,
    };
    const saved = byId.get(step.id);
    return saved && shallow(saved, observation) ? saved : observation;
  });
  return next.length === previous.length && next.every((step, index) => step === previous[index]) ? previous : next;
}

/** Project each downloaded page once, using the live/history authority for identities, timing and metering. */
export function appendInsightHistory(
  history: ReadonlyMap<string, RunRecord>,
  events: readonly EventEnvelope[],
): ReadonlyMap<string, RunRecord> {
  if (events.length === 0) return history;
  const byRun = new Map<string, EventEnvelope[]>();
  for (const event of events) {
    const id = event.scope?.parentRequestId ?? event.requestId;
    if (!id) continue;
    const list = byRun.get(id) ?? [];
    list.push(event);
    byRun.set(id, list);
  }
  const next = new Map(history);
  for (const [requestId, observations] of byRun) {
    const previous = history.get(requestId);
    const observed: RunRecord = previous
      ? {
          ...previous,
          steps: previous.steps.map((step) => ({
            ...step,
            toolBatch: step.toolBatch ? { ...step.toolBatch } : undefined,
          })),
        }
      : createRunRecord({ requestId, startedAt: observations[0]!.timestamp, input: "" });
    projectRunHistoryModelObservations(observed, observations);
    projectRunHistoryDetail(observed, observations);
    next.set(requestId, observed);
  }
  return next;
}

const MergedInsightRuns = new WeakMap<RunRecord, WeakMap<RunRecord, RunRecord>>();

/** Reuse unchanged completed turns instead of replaying their history on each live model delta. */
export function mergeInsightRuns(runs: readonly RunRecord[], history: ReadonlyMap<string, RunRecord>): RunRecord[] {
  return runs.map((run) => {
    const observed = history.get(run.requestId);
    if (!observed) return run;
    let cached = MergedInsightRuns.get(run);
    const previous = cached?.get(observed);
    if (previous) return previous;
    cached ??= new WeakMap();
    MergedInsightRuns.set(run, cached);
    const steps = new Map(observed.steps.map((step) => [step.id, step]));
    for (const step of run.steps) {
      const saved = steps.get(step.id);
      steps.set(step.id, {
        ...saved,
        ...step,
        contextSnapshot: step.contextSnapshot ?? saved?.contextSnapshot,
        modelUsage: step.modelUsage ?? saved?.modelUsage,
        toolOrigin: step.toolOrigin ?? saved?.toolOrigin,
        toolArgs: step.toolArgs ?? saved?.toolArgs,
      });
    }
    const merged = {
      ...run,
      usage: run.usage ?? observed.usage,
      contextCompactions: [
        ...new Map(
          [...(observed.contextCompactions ?? []), ...(run.contextCompactions ?? [])].map((event) => [
            event.sequence,
            event,
          ]),
        ).values(),
      ],
      modelProvider: run.modelProvider ?? observed.modelProvider,
      steps: [...steps.values()].sort(
        (a, b) => (a.eventSequence ?? Number.MAX_SAFE_INTEGER) - (b.eventSequence ?? Number.MAX_SAFE_INTEGER),
      ),
    };
    cached.set(observed, merged);
    return merged;
  });
}

export interface InsightRequest {
  run: RunRecord;
  turn: number;
  step: TimelineStep;
}

export function insightRequests(runs: readonly RunRecord[], scopeId?: string): InsightRequest[] {
  return runs.flatMap((run, index) => modelRequests(run, scopeId).map((step) => ({ run, turn: index + 1, step })));
}

/** Unknown fields remain unknown; coverage is reported beside totals instead of treating missing usage as zero. */
export function sumInsightField(
  usages: readonly (ModelUsageMetadata | undefined)[],
  field: "inputTokens" | "outputTokens" | "totalTokens" | "cacheReadTokens" | "cacheWriteTokens",
) {
  const known = usages.flatMap((usage) => (usage?.[field] === undefined ? [] : [usage[field]!]));
  return {
    value: known.length ? known.reduce((sum, value) => sum + value, 0) : undefined,
    known: known.length,
    total: usages.length,
  };
}

export function insightBreakdown(steps: readonly TimelineStep[], kind: "tool" | "model") {
  const groups = new Map<
    string,
    { name: string; count: number; failed: number; duration: number; timed: number; tokens: number; metered: number }
  >();
  for (const step of steps) {
    if (step.kind !== kind || (kind === "tool" && !step.callId)) continue;
    const name = (kind === "tool" ? step.toolName : (step.responseModel ?? step.modelName)) ?? step.title;
    const group = groups.get(name) ?? { name, count: 0, failed: 0, duration: 0, timed: 0, tokens: 0, metered: 0 };
    group.count++;
    if (step.status === "failed") group.failed++;
    const duration = readWorkflowStepDurationMs(step);
    if (duration !== undefined) {
      group.duration += duration;
      group.timed++;
    }
    if (step.modelUsage?.totalTokens !== undefined) {
      group.tokens += step.modelUsage.totalTokens;
      group.metered++;
    }
    groups.set(name, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function insightTotals(runs: readonly RunRecord[], scopeId?: string) {
  const steps = runs.flatMap((run) => inspectionSteps(run, scopeId));
  const models = steps.filter((step) => step.kind === "model");
  const tools = steps.filter((step) => step.kind === "tool" && step.callId);
  // Run usage includes all billed stages. Per-Agent usage is summed from its model requests only.
  const usages = scopeId === undefined ? runs.map((run) => run.usage) : models.map((step) => step.modelUsage);
  const tokens = sumInsightField(usages, "totalTokens");
  const priced = usages.flatMap((usage) => (usage?.cost?.total === undefined ? [] : [usage.cost.total]));
  const charge = usages.length ? aggregateAgentModelCosts(usages.map((usage) => usage?.cost)) : undefined;
  return {
    steps,
    models,
    tools,
    tokens,
    cost: charge?.total,
    charge,
    priced: priced.length,
    usageCount: usages.length,
  };
}
