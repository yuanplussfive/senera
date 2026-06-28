import {
  EventKinds,
  type ActionPlannedData,
  type ActionPlannerStageCompletedData,
  type ActionPlannerStageFailedData,
  type ActionPlannerStageStartedData,
  type AskUserData,
  type DecisionParsedData,
  type DecisionParsedDetailData,
  type DecisionXmlSummaryData,
  type EventEnvelope,
  type FinalAnswerData,
  type InteractionRoutedData,
  type ModelStartedData,
  type PromptSummaryData,
  type RetryPlannedData,
  type RunFailedData,
  type ToolCallCompletedData,
  type ToolCallFailedData,
  type ToolCallStartedData,
  type ToolCallsPlannedData,
  type ToolResultsDetailData,
} from "../../api/eventTypes";
import {
  friendlyDecisionKind,
  InteractionModeTitle,
  plannerStageTitle,
  summarizeActionPlan,
  summarizeInteractionRoute,
  summarizePlannerStage,
  summarizeToolPlan,
  toolPlanTitle,
  truncate,
} from "./sessionPresentation";
import { currentRun, ensureSession, upsertStep } from "./sessionProjectorCore";
import { touchRun } from "./sessionRunProjection";
import { timelineScopeFromEvent, toolBatchFromEvent } from "./timelineProjection";
import type { StoreState } from "./types";

export function applyScopedRunEvent(state: StoreState, env: EventEnvelope): boolean {
  const parentRequestId = env.scope?.parentRequestId;
  if (!parentRequestId) return false;

  const sessionId = env.sessionId;
  if (!sessionId) return true;

  const session = ensureSession(state, sessionId);
  const run = currentRun(session, parentRequestId);
  if (!run) return true;

  const scope = timelineScopeFromEvent(env);

  switch (env.kind) {
    case EventKinds.PromptSummary: {
      const data = env.data as PromptSummaryData;
      upsertStep(run, {
        id: scopedStepId(env, "prompt"),
        kind: "prompt",
        title: scopedStepTitle(env, "渲染 Prompt"),
        description: scopedStepDescription(env, `${data.chars} 字 · ${data.lines} 行`),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        promptChars: data.chars,
        promptLines: data.lines,
        promptTokenCount: data.tokenCount,
        scope,
      });
      return true;
    }

    case EventKinds.ActionPlannerStageStarted: {
      const data = env.data as ActionPlannerStageStartedData;
      upsertStep(run, {
        id: scopedStepId(env, "planner", data.stage),
        kind: "decision",
        title: scopedStepTitle(env, plannerStageTitle(data.stage)),
        status: "running",
        startedAt: env.timestamp,
        decisionKind: data.stage,
        scope,
      });
      return true;
    }

    case EventKinds.ActionPlannerStageCompleted: {
      const data = env.data as ActionPlannerStageCompletedData;
      const id = scopedStepId(env, "planner", data.stage);
      upsertStep(run, {
        id,
        kind: "decision",
        title: scopedStepTitle(env, plannerStageTitle(data.stage, data.selectedAction)),
        description: scopedStepDescription(env, summarizePlannerStage(data)),
        status: "done",
        startedAt: run.steps.find((step) => step.id === id)?.startedAt ?? env.timestamp,
        endedAt: env.timestamp,
        decisionKind: data.selectedAction,
        taskFrame: data.taskFrame,
        evidenceDecision: data.evidenceDecision,
        detailJson: data,
        scope,
      });
      return true;
    }

    case EventKinds.ActionPlannerStageFailed: {
      const data = env.data as ActionPlannerStageFailedData;
      const id = scopedStepId(env, "planner", data.stage);
      upsertStep(run, {
        id,
        kind: "decision",
        title: scopedStepTitle(env, plannerStageTitle(data.stage)),
        description: scopedStepDescription(env, data.message),
        status: "failed",
        startedAt: run.steps.find((step) => step.id === id)?.startedAt ?? env.timestamp,
        endedAt: env.timestamp,
        errorMessage: data.message,
        detailJson: data,
        scope,
      });
      return true;
    }

    case EventKinds.InteractionRouted: {
      const data = env.data as InteractionRoutedData;
      upsertStep(run, {
        id: scopedStepId(env, "interaction-route"),
        kind: "decision",
        title: scopedStepTitle(env, `选择路径 · ${InteractionModeTitle[data.mode]}`),
        description: scopedStepDescription(env, summarizeInteractionRoute(data)),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        decisionKind: data.mode,
        detailJson: data,
        scope,
      });
      return true;
    }

    case EventKinds.ActionPlanned: {
      const data = env.data as ActionPlannedData;
      upsertStep(run, {
        id: scopedStepId(env, "action-plan"),
        kind: "decision",
        title: scopedStepTitle(env, data.status === "planned"
          ? `规划行动 · ${friendlyDecisionKind(data.action ?? "")}`
          : "规划行动 · 回退"),
        description: scopedStepDescription(env, summarizeActionPlan(data)),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        decisionKind: data.action,
        detailJson: data,
        scope,
      });
      return true;
    }

    case EventKinds.ModelStarted: {
      const data = env.data as ModelStartedData;
      const modelName = data.provider?.model ?? data.model;
      upsertStep(run, {
        id: scopedStepId(env, "model"),
        kind: "model",
        title: scopedStepTitle(env, "调用模型"),
        description: scopedStepDescription(env, modelName),
        status: "running",
        startedAt: env.timestamp,
        modelName,
        scope,
      });
      return true;
    }

    case EventKinds.ModelCompleted: {
      const step = run.steps.find((entry) => entry.id === scopedStepId(env, "model"));
      if (step) {
        step.status = "done";
        step.endedAt = env.timestamp;
        touchRun(run);
      }
      return true;
    }

    case EventKinds.DecisionXmlSummary: {
      const data = env.data as DecisionXmlSummaryData;
      upsertStep(run, {
        id: scopedStepId(env, "decision-xml"),
        kind: "decision",
        title: scopedStepTitle(env, "行动决策"),
        description: scopedStepDescription(env, `${data.root ?? "?"} · ${data.chars} 字符${data.sanitized ? " · 已清洗" : ""}`),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        xmlRoot: data.root,
        scope,
      });
      return true;
    }

    case EventKinds.DecisionParsed: {
      const data = env.data as DecisionParsedData;
      upsertStep(run, {
        id: scopedStepId(env, "decision"),
        kind: "decision",
        title: scopedStepTitle(env, "确定行动"),
        description: scopedStepDescription(env, friendlyDecisionKind(data.decisionKind)),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        decisionKind: data.decisionKind,
        xmlRoot: data.root,
        scope,
      });
      return true;
    }

    case EventKinds.DecisionParsedDetail: {
      const data = env.data as DecisionParsedDetailData;
      const step = run.steps.find((entry) => entry.id === scopedStepId(env, "decision"));
      if (step) {
        step.detailJson = data.payload;
        touchRun(run);
      }
      return true;
    }

    case EventKinds.ToolCallsPlanned: {
      const data = env.data as ToolCallsPlannedData;
      upsertStep(run, {
        id: scopedStepId(env, "tool-plan"),
        kind: "tool",
        title: scopedStepTitle(env, toolPlanTitle(data)),
        description: scopedStepDescription(env, summarizeToolPlan(data)),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        toolBatch: toolBatchFromEvent(env, undefined, data.toolCount),
        scope,
      });
      return true;
    }

    case EventKinds.ToolCallStarted: {
      const data = env.data as ToolCallStartedData;
      upsertStep(run, {
        id: scopedStepId(env, "tool", data.callId),
        kind: "tool",
        title: scopedStepTitle(env, `调用 ${data.toolName}`),
        status: "running",
        startedAt: env.timestamp,
        toolName: data.toolName,
        callId: data.callId,
        toolBatch: toolBatchFromEvent(env, data),
        scope,
      });
      return true;
    }

    case EventKinds.ToolCallCompleted: {
      const data = env.data as ToolCallCompletedData;
      const step = run.steps.find((entry) => entry.id === scopedStepId(env, "tool", data.callId));
      if (step) {
        step.status = "done";
        step.endedAt = env.timestamp;
        step.toolPreview = data.preview;
        touchRun(run);
      }
      return true;
    }

    case EventKinds.ToolCallFailed: {
      const data = env.data as ToolCallFailedData;
      const id = scopedStepId(env, "tool", data.callId);
      const step = run.steps.find((entry) => entry.id === id);
      if (step) {
        step.status = "failed";
        step.endedAt = env.timestamp;
        step.toolErrorMessage = data.message;
        touchRun(run);
      } else {
        upsertStep(run, {
          id,
          kind: "tool",
          title: scopedStepTitle(env, `调用 ${data.toolName} 失败`),
          status: "failed",
          startedAt: env.timestamp,
          endedAt: env.timestamp,
          toolName: data.toolName,
          callId: data.callId,
          toolBatch: toolBatchFromEvent(env, data),
          toolErrorMessage: data.message,
          scope,
        });
      }
      return true;
    }

    case EventKinds.ToolResultsDetail: {
      const data = env.data as ToolResultsDetailData;
      if (Array.isArray(data.value)) {
        for (const entry of data.value) {
          const callId = (entry as { callId?: string })?.callId;
          if (!callId) continue;
          const step = run.steps.find((item) => item.id === scopedStepId(env, "tool", callId));
          if (step) {
            step.toolResult = entry;
            touchRun(run);
          }
        }
      }
      return true;
    }

    case EventKinds.RetryPlanned: {
      const data = env.data as RetryPlannedData;
      upsertStep(run, {
        id: scopedStepId(env, "retry", data.attempt),
        kind: "retry",
        title: scopedStepTitle(env, `重试 · 第 ${data.attempt} 次`),
        description: scopedStepDescription(env, `${data.code} · ${data.message}`),
        status: data.retryable ? "done" : "failed",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        retryAttempt: data.attempt,
        retryCode: data.code,
        scope,
      });
      return true;
    }

    case EventKinds.FinalAnswer: {
      const data = env.data as FinalAnswerData;
      upsertStep(run, {
        id: scopedStepId(env, "answer"),
        kind: "answer",
        title: scopedStepTitle(env, "生成回复"),
        description: truncate(data.content, 60),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        scope,
      });
      return true;
    }

    case EventKinds.AskUser: {
      const data = env.data as AskUserData;
      upsertStep(run, {
        id: scopedStepId(env, "ask"),
        kind: "answer",
        title: scopedStepTitle(env, "提出问题"),
        description: truncate(data.question, 60),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        scope,
      });
      return true;
    }

    case EventKinds.RunFailed: {
      const data = env.data as RunFailedData;
      upsertStep(run, {
        id: scopedStepId(env, "error"),
        kind: "error",
        title: scopedStepTitle(env, "运行失败"),
        description: scopedStepDescription(env, data.message),
        status: "failed",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        errorMessage: data.message,
        scope,
      });
      return true;
    }

    case EventKinds.ModelDelta:
    case EventKinds.DecisionXmlProgress:
    case EventKinds.RunStarted:
    case EventKinds.RunCompleted:
    case EventKinds.RunCancelled:
      return true;

    default:
      return true;
  }
}

function scopedStepId(
  env: EventEnvelope,
  slot: string,
  detail?: string | number,
): string {
  return [
    env.scope?.workflowName,
    env.scope?.role,
    env.scope?.jobId,
    env.requestId,
    env.step ?? 0,
    slot,
    detail,
  ]
    .filter((value) => value !== undefined && value !== "")
    .join(":");
}

function scopedStepTitle(env: EventEnvelope, title: string): string {
  const owner = env.scope?.role === "merge"
    ? "合并"
    : env.scope?.agentName;
  return owner ? `${owner} · ${title}` : title;
}

function scopedStepDescription(
  env: EventEnvelope,
  description?: string,
): string | undefined {
  const workflowName = env.scope?.workflowName;
  if (!workflowName) return description;
  return description ? `${workflowName} · ${description}` : workflowName;
}
