import {
  EventKinds,
  type PromptSummaryData,
  type TodoSnapshotData,
  type ContinuityRecallSettledData,
} from "../../api/eventTypes";
import {
  readContinuityRecallQueryData,
  readContinuityRecallSettledData,
  readContinuityRulesSnapshotData,
  readContinuitySnapshotData,
  readExecutionEventData,
  readAgendaSnapshotData,
  readWorldSnapshotData,
  readPromptHarnessComposedData,
  readTodoSnapshotEventData,
} from "../../api/goalContinuityEventValidation";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import { upsertStep } from "./sessionProjectorCore";
import type { EventEnvelope } from "../../api/eventTypes";
import type { StoreState } from "./types";

export const runDecisionEventHandlers = {
  [EventKinds.ContinuitySnapshot]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const snapshot = readContinuitySnapshotData(env.data);
    if (!snapshot) return;
    run.continuity = snapshot;
    run.revision += 1;
  },

  [EventKinds.ExecutionCreated]: projectExecutionEvent,
  [EventKinds.ExecutionStepStarted]: projectExecutionEvent,
  [EventKinds.ExecutionStepCompleted]: projectExecutionEvent,
  [EventKinds.ExecutionBlocked]: projectExecutionEvent,
  [EventKinds.ExecutionCompleted]: projectExecutionEvent,

  [EventKinds.ContinuityRulesSnapshot]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run?.continuity) return;
    const data = readContinuityRulesSnapshotData(env.data);
    if (!data) return;
    run.continuity = {
      ...run.continuity,
      rules: data.rules,
      signals: data.signals,
    };
    run.revision += 1;
  },

  [EventKinds.AgendaSnapshot]: (state, env) => {
    const data = readAgendaSnapshotData(env.data);
    if (data) state.agenda = data.snapshot;
  },
  [EventKinds.WorldSnapshot]: (state, env) => {
    const data = readWorldSnapshotData(env.data);
    if (data) state.world = data.snapshot;
  },
  [EventKinds.TodoListWritten]: (state, env) => {
    const data = readTodoSnapshotEventData(env.data);
    if (data) projectTodo(state, data, env);
  },

  [EventKinds.ContinuityRecallQuery]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = readContinuityRecallQueryData(env.data);
    if (!data) return;
    run.recall = {
      ...run.recall,
      original: data.original,
      local: data.local,
    };
    run.revision += 1;
  },

  [EventKinds.ContinuityRecallSettled]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = readContinuityRecallSettledData(env.data);
    if (!data) return;
    run.recall = {
      ...run.recall,
      injectedCount: data.injectedCount,
      matchedByCounts: data.matchedByCounts,
      semanticStatus: data.semanticStatus,
      semanticIndexedCount: data.semanticIndexedCount,
      semanticCompatibleCount: data.semanticCompatibleCount,
      degraded: data.degraded,
      latencyMs: data.totalLatencyMs,
    };
    upsertStep(run, projectRecallStep(run, env, data));
  },

  [EventKinds.PromptHarnessComposed]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = readPromptHarnessComposedData(env.data);
    if (!data) return;
    run.harness = data;
    // Merge the tier breakdown into the existing prompt summary step instead
    // of spawning a second node: one context row, richer description.
    const anchorId = `${run.requestId}-prompt-${env.step ?? 0}`;
    const existing = run.steps.find((step) => step.id === anchorId);
    if (existing) {
      upsertStep(run, {
        ...existing,
        description: frontendMessage("workflow.projection.promptTierSummary", {
          tokens: existing.promptTokenCount ?? 0,
          chars: existing.promptChars ?? 0,
          lines: existing.promptLines ?? 0,
          frozen: data.sections.frozen.tokens,
          stable: data.sections.stable.tokens,
          volatile: data.sections.volatile.tokens,
        }),
        detailJson: data,
      });
    }
    run.revision += 1;
  },

  [EventKinds.PromptSummary]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as PromptSummaryData;
    upsertStep(run, {
      id: `${run.requestId}-prompt-${env.step ?? 0}`,
      kind: "prompt",
      title: frontendMessage("workflow.plan.promptRendered"),
      description: frontendMessage("workflow.projection.promptTokenSummary", {
        count: data.tokenCount,
        chars: data.chars,
        lines: data.lines,
      }),
      status: "done",
      startedAt: env.timestamp,
      endedAt: env.timestamp,
      promptChars: data.chars,
      promptLines: data.lines,
      promptTokenCount: data.tokenCount,
    });
  },
} satisfies RunEventHandlerMap;

function projectRecallStep(
  run: { readonly requestId: string },
  env: { timestamp: string; step?: number },
  data: ContinuityRecallSettledData,
): import("./types").TimelineStep {
  return {
    id: `${run.requestId}-recall-${env.step ?? 0}`,
    kind: "recall",
    title: frontendMessage("workflow.plan.memoryRecall"),
    description: frontendMessage("workflow.projection.memoryRecallSummary", {
      count: data.injectedCount,
    }),
    status: "done",
    startedAt: env.timestamp,
    endedAt: env.timestamp,
    detailJson: data,
    modelName: undefined,
  };
}

function projectExecutionEvent(state: StoreState, env: EventEnvelope): void {
  const data = readExecutionEventData(env.data);
  if (!data) return;
  const run = readCurrentRun(state, env);
  if (!run) return;
  run.execution = data.snapshot;
  run.revision += 1;
}

function projectTodo(state: StoreState, data: { snapshot: TodoSnapshotData }, env: EventEnvelope): void {
  const run = readCurrentRun(state, env);
  if (!run) return;
  run.todos = data.snapshot;
  run.revision += 1;
}
