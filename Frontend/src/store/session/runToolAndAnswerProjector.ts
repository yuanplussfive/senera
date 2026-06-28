import {
  EventKinds,
  type AskUserData,
  type FinalAnswerData,
  type RetryPlannedData,
  type ToolCallCompletedData,
  type ToolCallFailedData,
  type ToolCallStartedData,
  type ToolCallsPlannedData,
  type ToolResultsDetailData,
} from "../../api/eventTypes";
import { upsertMessageByRequestId } from "./historyRunProjection";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import {
  bumpSessionMessageCount,
  currentRun,
  ensureSession,
  upsertStep,
} from "./sessionProjectorCore";
import { projectTerminalDisplayText, touchRun } from "./sessionRunProjection";
import { summarizeToolPlan, toolPlanTitle, truncate } from "./sessionPresentation";
import { toolBatchFromEvent } from "./timelineProjection";

export const runToolAndAnswerEventHandlers = {
  [EventKinds.ToolCallsPlanned]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ToolCallsPlannedData;
    upsertStep(run, {
      id: `${run.requestId}-tool-plan-${env.step ?? 0}`,
      kind: "tool",
      title: toolPlanTitle(data),
      description: summarizeToolPlan(data),
      status: "done",
      startedAt: env.timestamp,
      endedAt: env.timestamp,
      toolBatch: toolBatchFromEvent(env, undefined, data.toolCount),
    });
  },

  [EventKinds.ToolCallStarted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ToolCallStartedData;
    upsertStep(run, {
      id: `tool-${data.callId}`,
      kind: "tool",
      title: `调用 ${data.toolName}`,
      status: "running",
      startedAt: env.timestamp,
      toolName: data.toolName,
      callId: data.callId,
      toolBatch: toolBatchFromEvent(env, data),
      toolArgs: run.pendingToolArgsByName[data.toolName],
    });
  },

  [EventKinds.ToolCallCompleted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ToolCallCompletedData;
    const step = run.steps.find((item) => item.id === `tool-${data.callId}`);
    if (step) {
      step.status = "done";
      step.endedAt = env.timestamp;
      step.toolPreview = data.preview;
      touchRun(run);
    }
  },

  [EventKinds.ToolCallFailed]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ToolCallFailedData;
    const step = run.steps.find((item) => item.id === `tool-${data.callId}`);
    if (step) {
      step.status = "failed";
      step.endedAt = env.timestamp;
      step.toolErrorMessage = data.message;
      touchRun(run);
      return;
    }
    upsertStep(run, {
      id: `tool-${data.callId}`,
      kind: "tool",
      title: `调用 ${data.toolName} 失败`,
      status: "failed",
      startedAt: env.timestamp,
      endedAt: env.timestamp,
      toolName: data.toolName,
      callId: data.callId,
      toolBatch: toolBatchFromEvent(env, data),
      toolErrorMessage: data.message,
    });
  },

  [EventKinds.ToolResultsDetail]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ToolResultsDetailData;
    if (!Array.isArray(data.value)) return;
    for (const entry of data.value) {
      const callId = (entry as { callId?: string })?.callId;
      if (!callId) continue;
      const step = run.steps.find((item) => item.id === `tool-${callId}`);
      if (step) {
        step.toolResult = entry;
        touchRun(run);
      }
    }
  },

  [EventKinds.RetryPlanned]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as RetryPlannedData;
    upsertStep(run, {
      id: `${run.requestId}-retry-${data.attempt}`,
      kind: "retry",
      title: `重试 · 第 ${data.attempt} 次`,
      description: `${data.code} · ${data.message}`,
      status: data.retryable ? "done" : "failed",
      startedAt: env.timestamp,
      endedAt: env.timestamp,
      retryAttempt: data.attempt,
      retryCode: data.code,
    });
  },

  [EventKinds.FinalAnswer]: (state, env) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const session = ensureSession(state, sessionId);
    const run = currentRun(session, env.requestId);
    const data = env.data as FinalAnswerData;
    upsertMessageByRequestId(session, {
      id: `${env.requestId ?? "final"}-answer`,
      role: "assistant",
      content: data.content,
      createdAt: env.timestamp,
      kind: "FinalAnswer",
      requestId: env.requestId,
      metadata: run?.modelProvider
        ? { run: { modelProvider: run.modelProvider } }
        : undefined,
    });
    bumpSessionMessageCount(session);
    if (run) {
      upsertStep(run, {
        id: `${run.requestId}-answer`,
        kind: "answer",
        title: "生成回复",
        description: truncate(data.content, 60),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
      });
      run.xmlPreview = "";
      run.visibleKind = "final_answer";
      run.decisionMode = "final_text";
      run.expectedOutputMode = "final_text";
      projectTerminalDisplayText(run, data.content, Boolean(state.historyLoadingIds[sessionId]));
    }
    session.updatedAt = env.timestamp;
    state.sessionOrder = [sessionId, ...state.sessionOrder.filter((id) => id !== sessionId)];
  },

  [EventKinds.AskUser]: (state, env) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const session = ensureSession(state, sessionId);
    const run = currentRun(session, env.requestId);
    const data = env.data as AskUserData;
    upsertMessageByRequestId(session, {
      id: `${env.requestId ?? "ask"}-ask`,
      role: "assistant",
      content: data.question,
      createdAt: env.timestamp,
      kind: "AskUser",
      requestId: env.requestId,
      metadata: run?.modelProvider
        ? { run: { modelProvider: run.modelProvider } }
        : undefined,
    });
    bumpSessionMessageCount(session);
    if (run) {
      upsertStep(run, {
        id: `${run.requestId}-answer`,
        kind: "answer",
        title: "向用户提问",
        description: truncate(data.question, 60),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
      });
      run.xmlPreview = "";
      run.visibleKind = "ask_user";
      run.decisionMode = "final_text";
      run.expectedOutputMode = "final_text";
      projectTerminalDisplayText(run, data.question, Boolean(state.historyLoadingIds[sessionId]));
    }
  },
} satisfies RunEventHandlerMap;
