import {
  EventKinds,
  type ExecutionResourceOutputData,
  type ExecutionResourceStateData,
  type AssistantMessageCreatedData,
  type ToolCallResultDetailData,
  type ToolCallCompletedData,
  type ToolCallFailedData,
  type ToolCallOutputData,
  type ToolCallProgressData,
  type ToolCallStartedData,
  type ToolCallsPlannedData,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { upsertMessageByRequestId } from "./historyRunProjection";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import { bumpSessionMessageCount, currentRun, ensureSession, upsertStep } from "./sessionProjectorCore";
import { alignRunDisplayTarget, touchRun } from "./sessionRunProjection";
import { summarizeToolPlan, toolPlanTitle, truncate } from "./sessionPresentation";
import { toolBatchFromEvent } from "./timelineProjection";
import { mergeToolResultPresentation, readToolResultPresentation } from "./toolResultPresentation";
import { projectToolOutput, projectToolProgress } from "./toolRuntimeProjection";

export const runToolAndAnswerEventHandlers = {
  [EventKinds.AssistantMessageCreated]: (state, env) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const session = ensureSession(state, sessionId);
    const run = currentRun(session, env.requestId);
    const data = env.data as AssistantMessageCreatedData;
    const content = data.content.trim();
    if (!content) return;
    const messageId = data.messageId?.trim() || `${env.requestId ?? "assistant"}-message-${env.sequence}`;

    upsertMessageByRequestId(session, {
      id: messageId,
      role: "assistant",
      content,
      createdAt: env.timestamp,
      kind: chatMessageKindForAssistantMessage(data.kind),
      requestId: env.requestId,
      metadata: run?.modelProvider ? { run: { modelProvider: run.modelProvider } } : undefined,
    });
    bumpSessionMessageCount(session);

    if (run) {
      projectAssistantMessageRunState(run, data, content);
      const title = assistantStepTitle(data.kind);
      upsertStep(run, {
        id: `${run.requestId}-assistant-message-${messageId}`,
        kind: data.kind === "tool_preface" ? "decision" : "answer",
        title,
        description: truncate(content, data.kind === "tool_preface" ? 80 : 60),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        decisionKind: data.kind,
        toolBatch: data.batchId
          ? {
              id: data.batchId,
              size: data.toolCount,
            }
          : undefined,
        detailJson: data,
      });
      touchRun(run);
    }
    session.updatedAt = env.timestamp;
    state.sessionOrder = [sessionId, ...state.sessionOrder.filter((id) => id !== sessionId)];
  },

  [EventKinds.ToolCallsPlanned]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ToolCallsPlannedData;
    const toolBatch = toolBatchFromEvent(env, undefined, data.toolCount);
    upsertStep(run, {
      id: `${run.requestId}-tool-plan-${toolBatch.id}`,
      kind: "tool",
      title: toolPlanTitle(data),
      description: summarizeToolPlan(data),
      status: "done",
      startedAt: env.timestamp,
      endedAt: env.timestamp,
      toolBatch,
    });
  },

  [EventKinds.ToolCallStarted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ToolCallStartedData;
    upsertStep(run, {
      id: `tool-${data.callId}`,
      kind: "tool",
      title: frontendMessage("workflow.projection.toolCall", { toolName: data.toolName }),
      status: "running",
      startedAt: env.timestamp,
      toolName: data.toolName,
      callId: data.callId,
      toolBatch: toolBatchFromEvent(env, data),
      toolArgs: run.pendingToolArgsByName[data.toolName],
    });
  },

  [EventKinds.ToolCallOutput]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ToolCallOutputData;
    const step = run.steps.find((item) => item.id === `tool-${data.callId}`);
    if (!step) return;
    projectToolOutput(step, data);
    touchRun(run);
  },

  [EventKinds.ToolCallProgress]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ToolCallProgressData;
    const step = run.steps.find((item) => item.id === `tool-${data.callId}`);
    if (!step) return;
    projectToolProgress(step, data);
    touchRun(run);
  },

  [EventKinds.ExecutionResourceOutput]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ExecutionResourceOutputData;
    if (!data.toolCallId) return;
    const step = run.steps.find((item) => item.id === `tool-${data.toolCallId}`);
    if (!step) return;
    projectToolOutput(step, {
      toolName: data.toolName ?? step.toolName ?? "ExecutionResource",
      callId: data.toolCallId,
      stream: data.stream,
      outputSequence: data.cursor,
      text: data.text,
      byteLength: data.byteLength,
      totalBytes: data.totalBytes,
      resourceId: data.resourceId,
    });
    touchRun(run);
  },

  [EventKinds.ExecutionResourceState]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ExecutionResourceStateData;
    if (!data.toolCallId) return;
    const step = run.steps.find((item) => item.id === `tool-${data.toolCallId}`);
    if (!step) return;
    projectToolProgress(step, {
      toolName: data.toolName ?? step.toolName ?? "ExecutionResource",
      callId: data.toolCallId,
      progressSequence: data.cursor,
      message: data.reason ? `${data.state}: ${data.reason}` : data.state,
      resourceId: data.resourceId,
    });
    touchRun(run);
  },

  [EventKinds.ToolCallCompleted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ToolCallCompletedData;
    const step = run.steps.find((item) => item.id === `tool-${data.callId}`);
    if (step) {
      step.status = "done";
      step.endedAt = env.timestamp;
      step.toolPresentation = mergeToolResultPresentation(step.toolPresentation, data.presentation);
      step.toolPreview = step.toolPresentation?.headline;
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
      title: frontendMessage("workflow.projection.toolCallFailed", { toolName: data.toolName }),
      status: "failed",
      startedAt: env.timestamp,
      endedAt: env.timestamp,
      toolName: data.toolName,
      callId: data.callId,
      toolBatch: toolBatchFromEvent(env, data),
      toolErrorMessage: data.message,
    });
  },

  [EventKinds.ToolCallResultDetail]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ToolCallResultDetailData;
    const step = run.steps.find((item) => item.id === `tool-${data.callId}`);
    if (step) {
      step.toolResult = data.value;
      step.toolPresentation = mergeToolResultPresentation(
        step.toolPresentation,
        readToolResultPresentation(data.value),
      );
      step.toolPreview = step.toolPresentation?.headline ?? step.toolPreview;
      touchRun(run);
    }
  },
} satisfies RunEventHandlerMap;

function chatMessageKindForAssistantMessage(kind: AssistantMessageCreatedData["kind"]) {
  const map = {
    tool_preface: "AssistantToolPreface",
    final_answer: "AssistantFinal",
    ask_user: "AssistantAsk",
  } as const satisfies Record<
    AssistantMessageCreatedData["kind"],
    "AssistantToolPreface" | "AssistantFinal" | "AssistantAsk"
  >;
  return map[kind];
}

function assistantStepTitle(kind: AssistantMessageCreatedData["kind"]): string {
  const map = {
    tool_preface: "workflow.projection.assistantToolPreface",
    final_answer: "workflow.projection.assistantFinalAnswer",
    ask_user: "workflow.projection.assistantAskUser",
  } as const satisfies Record<AssistantMessageCreatedData["kind"], Parameters<typeof frontendMessage>[0]>;
  return frontendMessage(map[kind]);
}

function projectAssistantMessageRunState(
  run: NonNullable<ReturnType<typeof currentRun>>,
  data: AssistantMessageCreatedData,
  content: string,
): void {
  run.xmlPreview = "";
  run.visibleKind = visibleKindForAssistantMessage(data.kind);
  run.decisionMode = data.kind === "tool_preface" ? "tool_candidate" : "final_text";
  if (data.terminal) {
    run.expectedOutputMode = "final_text";
  }
  run.visibleText = content;
  alignRunDisplayTarget(run);
}

function visibleKindForAssistantMessage(
  kind: AssistantMessageCreatedData["kind"],
): NonNullable<ReturnType<typeof currentRun>>["visibleKind"] {
  const map = {
    tool_preface: "tool_calls",
    final_answer: "final_answer",
    ask_user: "ask_user",
  } as const satisfies Record<
    AssistantMessageCreatedData["kind"],
    NonNullable<ReturnType<typeof currentRun>>["visibleKind"]
  >;
  return map[kind];
}
