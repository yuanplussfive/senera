import {
  EventKinds,
  type ActionPlannedData,
  type ActionPlannerStageCompletedData,
  type ActionPlannerStageFailedData,
  type ActionPlannerStageStartedData,
  type InteractionRoutedData,
  type PromptSummaryData,
} from "../../api/eventTypes";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import { upsertStep } from "./sessionProjectorCore";
import {
  friendlyDecisionKind,
  InteractionModeTitle,
  plannerStageTitle,
  readExpectedOutputMode,
  readRouteExpectedOutputMode,
  summarizeActionPlan,
  summarizeInteractionRoute,
  summarizePlannerStage,
} from "./sessionPresentation";
import type { RunRecord } from "./types";

export const runDecisionEventHandlers = {
  [EventKinds.PromptSummary]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as PromptSummaryData;
    upsertStep(run, {
      id: `${run.requestId}-prompt-${env.step ?? 0}`,
      kind: "prompt",
      title: "渲染 Prompt",
      description: `第 ${env.step ?? 0} 步`,
      status: "done",
      startedAt: env.timestamp,
      endedAt: env.timestamp,
      promptChars: data.chars,
      promptLines: data.lines,
      promptTokenCount: data.tokenCount,
    });
  },

  [EventKinds.ActionPlannerStageStarted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ActionPlannerStageStartedData;
    upsertStep(run, {
      id: plannerStageStepId(run.requestId, env.step, data.stage),
      kind: "decision",
      title: plannerStageTitle(data.stage),
      status: "running",
      startedAt: env.timestamp,
      decisionKind: data.stage,
    });
  },

  [EventKinds.ActionPlannerStageCompleted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ActionPlannerStageCompletedData;
    const id = plannerStageStepId(run.requestId, env.step, data.stage);
    upsertStep(run, {
      id,
      kind: "decision",
      title: plannerStageTitle(data.stage, data.selectedAction),
      description: summarizePlannerStage(data),
      status: "done",
      startedAt: run.steps.find((step) => step.id === id)?.startedAt ?? env.timestamp,
      endedAt: env.timestamp,
      decisionKind: data.selectedAction,
      detailJson: data,
    });
  },

  [EventKinds.ActionPlannerStageFailed]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ActionPlannerStageFailedData;
    const id = plannerStageStepId(run.requestId, env.step, data.stage);
    upsertStep(run, {
      id,
      kind: "decision",
      title: plannerStageTitle(data.stage),
      description: data.message,
      status: "failed",
      startedAt: run.steps.find((step) => step.id === id)?.startedAt ?? env.timestamp,
      endedAt: env.timestamp,
      errorMessage: data.message,
      detailJson: data,
    });
  },

  [EventKinds.InteractionRouted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as InteractionRoutedData;
    const expectedOutputMode = readRouteExpectedOutputMode(data);
    run.expectedOutputMode = expectedOutputMode;
    upsertStep(run, {
      id: `${run.requestId}-interaction-route-${env.step ?? 0}`,
      kind: "decision",
      title: `选择路径 · ${InteractionModeTitle[data.mode]}`,
      description: summarizeInteractionRoute(data),
      status: "done",
      startedAt: env.timestamp,
      endedAt: env.timestamp,
      decisionKind: data.mode,
      detailJson: data,
    });
  },

  [EventKinds.ActionPlanned]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ActionPlannedData;
    const planned = data.status === "planned";
    run.expectedOutputMode = planned
      ? readExpectedOutputMode(data)
      : "unknown";
    if (hasPlannerStageForStep(run, env.step)) {
      return;
    }
    upsertStep(run, {
      id: `${run.requestId}-action-plan-${env.step ?? 0}`,
      kind: "decision",
      title: planned
        ? `规划行动 · ${friendlyDecisionKind(data.action ?? "")}`
        : "规划行动 · 回退",
      description: summarizeActionPlan(data),
      status: "done",
      startedAt: env.timestamp,
      endedAt: env.timestamp,
      decisionKind: data.action,
      detailJson: data,
    });
  },
} satisfies RunEventHandlerMap;

function plannerStageStepId(
  requestId: string,
  step: number | undefined,
  stage: ActionPlannerStageStartedData["stage"],
): string {
  return `${requestId}-action-planner-${step ?? 0}-${stage}`;
}

function hasPlannerStageForStep(run: RunRecord, step: number | undefined): boolean {
  const prefix = `${run.requestId}-action-planner-${step ?? 0}-`;
  return run.steps.some((entry) => entry.id.startsWith(prefix));
}
