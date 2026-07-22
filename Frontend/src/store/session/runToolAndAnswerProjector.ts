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
    const policy = AssistantMessageProjectionPolicies[data.kind];
    const messageId = data.messageId?.trim() || `${env.requestId ?? "assistant"}-message-${env.sequence}`;

    upsertMessageByRequestId(session, {
      id: messageId,
      role: "assistant",
      content,
      createdAt: env.timestamp,
      kind: policy.chatMessageKind,
      requestId: env.requestId,
      metadata: run?.modelProvider ? { run: { modelProvider: run.modelProvider } } : undefined,
    });
    bumpSessionMessageCount(session);

    if (run) {
      projectAssistantMessageRunState(run, messageId, data, content, policy);
      upsertStep(run, {
        id: `${run.requestId}-assistant-message-${messageId}`,
        kind: policy.stepKind,
        title: frontendMessage(policy.stepTitleKey),
        description: truncate(content, policy.descriptionLength),
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
    resetCompletedAssistantStreamBeforeTool(run);
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

function resetCompletedAssistantStreamBeforeTool(run: NonNullable<ReturnType<typeof currentRun>>): void {
  run.streamingRaw = "";
  run.visibleText = "";
  run.displayText = "";
  run.displayMessageId = undefined;
  run.visibleKind = "unknown";
  run.decisionMode = "none";
  run.plannedDecisionMode = undefined;
}

interface AssistantMessageProjectionPolicy {
  readonly chatMessageKind: "AssistantFinal" | "AssistantAsk" | "AssistantToolPreface";
  readonly stepKind: "decision" | "answer";
  readonly stepTitleKey: Parameters<typeof frontendMessage>[0];
  readonly descriptionLength: number;
  readonly decisionMode: "tool_candidate" | "final_text";
  readonly visibleKind: "tool_calls" | "final_answer" | "ask_user";
}

const AssistantMessageProjectionPolicies = {
  tool_preface: {
    chatMessageKind: "AssistantToolPreface",
    stepKind: "decision",
    stepTitleKey: "workflow.projection.assistantToolPreface",
    descriptionLength: 80,
    decisionMode: "tool_candidate",
    visibleKind: "tool_calls",
  },
  final_answer: {
    chatMessageKind: "AssistantFinal",
    stepKind: "answer",
    stepTitleKey: "workflow.projection.assistantFinalAnswer",
    descriptionLength: 60,
    decisionMode: "final_text",
    visibleKind: "final_answer",
  },
  ask_user: {
    chatMessageKind: "AssistantAsk",
    stepKind: "answer",
    stepTitleKey: "workflow.projection.assistantAskUser",
    descriptionLength: 60,
    decisionMode: "final_text",
    visibleKind: "ask_user",
  },
} as const satisfies Record<AssistantMessageCreatedData["kind"], AssistantMessageProjectionPolicy>;

function projectAssistantMessageRunState(
  run: NonNullable<ReturnType<typeof currentRun>>,
  messageId: string,
  data: AssistantMessageCreatedData,
  content: string,
  policy: AssistantMessageProjectionPolicy,
): void {
  run.xmlPreview = "";
  run.displayMessageId = messageId;
  run.visibleKind = policy.visibleKind;
  run.decisionMode = policy.decisionMode;
  run.plannedDecisionMode = undefined;
  if (data.terminal) {
    run.expectedOutputMode = "final_text";
  }
  run.visibleText = content;
  alignRunDisplayTarget(run);
}
