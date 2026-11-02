import { EventKinds, type EventEnvelope, type AssistantMessageCreatedData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { upsertMessageByRequestId } from "./historyRunProjection";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import { bumpSessionMessageCount, currentRun, ensureSession, upsertStep } from "./sessionProjectorCore";
import { alignRunDisplayTarget, isRunTerminal, touchRun } from "./sessionRunProjection";
import { truncate } from "./sessionPresentation";
import { projectToolCallEvent, toolCallEventHandlers } from "./toolCallProjection";
import type { StoreState } from "./types";

const toolCallRunEventHandlers: RunEventHandlerMap = Object.fromEntries(
  Object.keys(toolCallEventHandlers).map((kind) => [
    kind,
    (state: StoreState, env: EventEnvelope) => {
      const run = readCurrentRun(state, env);
      if (!run) return;
      const historical = isHistoricalRunEvent(state, env);
      const startsCall = env.kind === EventKinds.ToolCallsPlanned || env.kind === EventKinds.ToolCallStarted;
      if (startsCall && isRunTerminal(run) && !historical) return;
      if (env.kind === EventKinds.ToolCallStarted && !historical) resetCompletedAssistantStreamBeforeTool(run);
      projectToolCallEvent(run, env);
    },
  ]),
);

export const runToolAndAnswerEventHandlers = {
  ...toolCallRunEventHandlers,
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

    const inserted = upsertMessageByRequestId(session, {
      id: messageId,
      role: "assistant",
      content,
      createdAt: env.timestamp,
      kind: policy.chatMessageKind,
      requestId: env.requestId,
      metadata: run?.modelProvider ? { run: { modelProvider: run.modelProvider } } : undefined,
    });
    if (inserted) bumpSessionMessageCount(session);

    if (run) {
      projectAssistantMessageRunState(run, messageId, data, content, policy);
      upsertStep(run, {
        id: `${run.requestId}-assistant-message-${messageId}`,
        kind: policy.stepKind,
        agentStep: env.step,
        modelMessageIndex: data.modelMessageIndex,
        modelContentIndex: data.modelContentIndex,
        title: frontendMessage(policy.stepTitleKey),
        description: truncate(content, policy.descriptionLength),
        status: "done",
        startedAt: env.timestamp,
        eventSequence: env.sequence,
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
    // A completed run must not override the user's manually arranged sidebar order.
  },
} satisfies RunEventHandlerMap;

function isHistoricalRunEvent(state: StoreState, env: EventEnvelope): boolean {
  const sessionId = env.sessionId;
  const requestId = env.requestId;
  return Boolean(sessionId && requestId && state.historyEventRunIds[sessionId]?.[requestId]);
}

function resetCompletedAssistantStreamBeforeTool(run: NonNullable<ReturnType<typeof currentRun>>): void {
  run.outputState = "pending";
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
  run.outputState = data.kind === "tool_preface" ? "pending" : data.terminal ? "committed" : "available";
  if (data.terminal) {
    run.expectedOutputMode = "final_text";
  }
  run.visibleText = content;
  alignRunDisplayTarget(run);
}
