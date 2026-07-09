import type {
  ConversationEntryDto,
  SessionHistoryStepsData,
  StepTraceDto,
} from "../../api/eventTypes";
import { friendlyDecisionKind } from "./sessionPresentation";
import { toolBatchForTrace } from "./timelineProjection";
import type { ChatMessage, RunRecord, SessionRecord, TimelineStep } from "./types";

type StepTraceKind = StepTraceDto["kind"];
type StepTraceProjectionContext = {
  requestId: string;
  trace: StepTraceDto;
  startedAt: string;
  endedAt: string;
};
type StepTraceProjector = (context: StepTraceProjectionContext) => TimelineStep;

export type HistoryVisibleEntry = {
  kind: string;
  text: string;
};

export function projectEntryToMessage(
  entry: ConversationEntryDto,
  visible?: HistoryVisibleEntry,
): ChatMessage | null {
  if (entry.kind === "user.message") {
    return {
      id: `${entry.requestId}-user`,
      role: "user",
      content: entry.content,
      createdAt: entry.timestamp,
      requestId: entry.requestId,
      attachments: entry.attachments,
      metadata: entry.metadata,
    };
  }

  if (entry.kind === "assistant.decision") {
    if (!isTerminalAssistantEntry(entry)) return null;
    if (!visible || !visible.text) return null;
    const isAsk = visible.kind === "ask_user";
    return {
      id: `${entry.requestId}-${isAsk ? "ask" : "answer"}`,
      role: "assistant",
      content: visible.text,
      createdAt: entry.timestamp,
      kind: isAsk ? "AssistantAsk" : "AssistantFinal",
      requestId: entry.requestId,
      metadata: entry.metadata,
    };
  }

  return null;
}

function isTerminalAssistantEntry(entry: ConversationEntryDto): boolean {
  return Boolean(entry.metadata?.run);
}

export function upsertMessageByRequestId(
  session: SessionRecord,
  message: ChatMessage,
): void {
  const idIndex = session.messages.findIndex((item) => item.id === message.id);
  if (idIndex >= 0) {
    session.messages[idIndex] = message;
    return;
  }

  if (!message.requestId || message.kind === "AssistantToolPreface") {
    session.messages.push(message);
    return;
  }

  const index = session.messages.findIndex(
    (item) =>
      item.requestId === message.requestId &&
      item.role === message.role &&
      (item.kind ?? "") === (message.kind ?? ""),
  );

  if (index >= 0) {
    session.messages[index] = message;
    return;
  }

  session.messages.push(message);
}

export function mergeHistoryMessages(
  session: SessionRecord,
  messages: readonly ChatMessage[],
): void {
  for (const message of messages) {
    upsertMessageByRequestId(session, message);
  }
  session.messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function mergeHistoryRuns(
  session: SessionRecord,
  runs: readonly RunRecord[],
): void {
  for (const run of runs) {
    const index = session.runs.findIndex((item) => item.requestId === run.requestId);
    if (index >= 0) {
      session.runs[index] = {
        ...run,
        revision: Math.max(session.runs[index].revision + 1, run.revision),
      };
    } else {
      session.runs.push(run);
    }
  }
  session.runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function rebuildRunFromHistory(
  run: SessionHistoryStepsData["runs"][number],
): RunRecord {
  const record: RunRecord = {
    requestId: run.requestId,
    revision: 0,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    input: run.input,
    steps: run.traces.map((trace) => stepTraceToTimelineStep(run.requestId, trace, run.startedAt)),
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    visibleKind: "unknown",
    expectedOutputMode: "unknown",
    decisionMode: "none",
    pendingToolArgsByName: {},
    approvals: [],
    modelProvider: run.modelProvider,
    recoverySource: run.status === "running" ? "history" : undefined,
  };
  record.revision = record.steps.length;
  return record;
}

function stepTraceToTimelineStep(
  requestId: string,
  trace: StepTraceDto,
  fallbackTime: string,
): TimelineStep {
  const startedAt = trace.startedAt ?? fallbackTime;
  const endedAt = trace.endedAt ?? startedAt;
  return stepTraceProjectors[trace.kind]({ requestId, trace, startedAt, endedAt });
}

const toolTraceTitleByStatus = {
  done: (trace: StepTraceDto) => `调用 ${trace.toolName ?? "工具"}`,
  failed: (trace: StepTraceDto) => `调用 ${trace.toolName ?? "工具"} 失败`,
} satisfies Record<StepTraceDto["status"], (trace: StepTraceDto) => string>;

const stepTraceProjectors = {
  tool: ({ requestId, trace, startedAt, endedAt }) => ({
    id: trace.callId ? `tool-${trace.callId}` : `tool-${trace.step}-${trace.seq}`,
    kind: "tool",
    title: toolTraceTitleByStatus[trace.status](trace),
    status: trace.status,
    startedAt,
    endedAt,
    toolName: trace.toolName,
    callId: trace.callId,
    toolBatch: toolBatchForTrace(requestId, trace),
    toolArgs: trace.toolArgs,
    toolPreview: trace.toolPreview,
    toolResult: trace.toolResult,
    toolErrorMessage: trace.toolErrorMessage,
  }),

  answer: ({ trace, startedAt, endedAt }) => ({
    id: `${trace.step}-answer-${trace.seq}`,
    kind: "answer",
    title: trace.title ?? "生成回复",
    status: trace.status,
    startedAt,
    endedAt,
  }),

  retry: ({ trace, startedAt, endedAt }) => ({
    id: `retry-${trace.step}-${trace.seq}`,
    kind: "retry",
    title: "重试",
    status: trace.status,
    startedAt,
    endedAt,
    retryCode: trace.retryCode,
    errorMessage: trace.errorMessage,
  }),

  decision: ({ trace, startedAt, endedAt }) => ({
    id: `decision-${trace.step}-${trace.seq}`,
    kind: "decision",
    title: "确定行动",
    description: trace.decisionKind ? friendlyDecisionKind(trace.decisionKind) : undefined,
    status: trace.status,
    startedAt,
    endedAt,
    decisionKind: trace.decisionKind,
  }),
} satisfies Record<StepTraceKind, StepTraceProjector>;
