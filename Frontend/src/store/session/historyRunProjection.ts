import type { ConversationEntryDto, SessionHistoryStepsData, StepTraceDto } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
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
  completedRequestIds?: ReadonlySet<string>,
): ChatMessage | null {
  if (entry.kind === "user.message") {
    // Background completion wake-ups are internal model input. They remain in
    // the durable transcript for context, but must not appear as a user bubble.
    if (entry.metadata?.backgroundTask) return null;
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
    if (!isTerminalAssistantEntry(entry, completedRequestIds)) return null;
    if (!visible || !visible.text) return null;
    const isAsk = visible.kind === "ask_user";
    const isToolPreface = visible.kind === "tool_preface";
    return {
      id: `${entry.requestId}-${isAsk ? "ask" : isToolPreface ? `tool-preface-${entry.id}` : "answer"}`,
      role: "assistant",
      content: visible.text,
      createdAt: entry.timestamp,
      kind: isAsk ? "AssistantAsk" : isToolPreface ? "AssistantToolPreface" : "AssistantFinal",
      requestId: entry.requestId,
      metadata: entry.metadata,
    };
  }

  return null;
}

function isTerminalAssistantEntry(entry: ConversationEntryDto, completedRequestIds?: ReadonlySet<string>): boolean {
  return (
    Boolean(entry.metadata?.run || entry.metadata?.scheduledTask) || completedRequestIds?.has(entry.requestId) === true
  );
}

export function upsertMessageByRequestId(session: SessionRecord, message: ChatMessage): boolean {
  const idIndex = session.messages.findIndex((item) => item.id === message.id);
  if (idIndex >= 0) {
    session.messages[idIndex] = message;
    return false;
  }

  if (!message.requestId || message.kind === "AssistantToolPreface") {
    session.messages.push(message);
    return true;
  }

  const index = session.messages.findIndex(
    (item) =>
      item.requestId === message.requestId && item.role === message.role && (item.kind ?? "") === (message.kind ?? ""),
  );

  if (index >= 0) {
    session.messages[index] = message;
    return false;
  }

  session.messages.push(message);
  return true;
}

export interface HistoryMessageMergeOptions {
  /** Keep the incoming page's order without sorting the full transcript. */
  readonly sort?: boolean;
  /** Older pages are inserted before the current preview/window. */
  readonly placement?: "append" | "prepend";
}

export function mergeHistoryMessages(
  session: SessionRecord,
  messages: readonly ChatMessage[],
  options: HistoryMessageMergeOptions = {},
): void {
  if (messages.length === 0) return;

  const byId = new Map(session.messages.map((message, index) => [message.id, index] as const));
  const byRequestRoleKind = new Map<string, number>();
  const insertedById = new Map<string, number>();
  const insertedByRequestRoleKind = new Map<string, number>();
  const inserted: ChatMessage[] = [];
  session.messages.forEach((message, index) => {
    if (message.requestId && message.kind !== "AssistantToolPreface") {
      byRequestRoleKind.set(messageIdentity(message), index);
    }
  });
  let changed = false;

  for (const message of messages) {
    const existingById = byId.get(message.id);
    if (existingById !== undefined) {
      if (existingById < session.messages.length) session.messages[existingById] = message;
      else inserted[existingById - session.messages.length] = message;
      continue;
    }
    const insertedByMessageId = insertedById.get(message.id);
    if (insertedByMessageId !== undefined) {
      inserted[insertedByMessageId] = message;
      continue;
    }

    if (!message.requestId || message.kind === "AssistantToolPreface") {
      insertedById.set(message.id, inserted.length);
      inserted.push(message);
      continue;
    }

    const identity = messageIdentity(message);
    const insertedByIdentity = insertedByRequestRoleKind.get(identity);
    if (insertedByIdentity !== undefined) {
      inserted[insertedByIdentity] = message;
      continue;
    }
    const existingByIdentity = byRequestRoleKind.get(identity);
    if (existingByIdentity !== undefined) {
      session.messages[existingByIdentity] = message;
      byId.set(message.id, existingByIdentity);
      continue;
    }

    insertedByRequestRoleKind.set(identity, inserted.length);
    insertedById.set(message.id, inserted.length);
    inserted.push(message);
  }

  if (inserted.length > 0) {
    changed = true;
    if (options.placement === "prepend") session.messages.unshift(...inserted);
    else session.messages.push(...inserted);
  }
  if (changed && options.sort !== false) session.messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function mergeHistoryRuns(session: SessionRecord, runs: readonly RunRecord[]): void {
  if (runs.length === 0) return;

  const indexes = new Map(session.runs.map((run, index) => [run.requestId, index] as const));
  let changed = false;
  for (const run of runs) {
    const index = indexes.get(run.requestId);
    if (index !== undefined) {
      session.runs[index] = {
        ...run,
        revision: Math.max(session.runs[index].revision + 1, run.revision),
      };
    } else {
      indexes.set(run.requestId, session.runs.length);
      session.runs.push(run);
      changed = true;
    }
  }
  if (changed) session.runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function messageIdentity(message: ChatMessage): string {
  return `${message.requestId}\u0000${message.role}\u0000${message.kind ?? ""}`;
}

export function rebuildRunFromHistory(run: SessionHistoryStepsData["runs"][number]): RunRecord {
  const record: RunRecord = {
    requestId: run.requestId,
    revision: 0,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    outputState: run.status === "completed" ? "committed" : "pending",
    input: run.input,
    steps: run.traces.map((trace) => stepTraceToTimelineStep(run.requestId, trace, run.startedAt)),
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    visibleKind: "unknown",
    expectedOutputMode: "unknown",
    decisionMode: "none",
    plannedDecisionMode: undefined,
    approvals: [],
    interactionInputs: [],
    modelProvider: run.modelProvider,
    recoverySource: run.status === "running" ? "history" : undefined,
  };
  record.revision = record.steps.length;
  return record;
}

function stepTraceToTimelineStep(requestId: string, trace: StepTraceDto, fallbackTime: string): TimelineStep {
  const startedAt = trace.startedAt ?? fallbackTime;
  const endedAt = trace.endedAt ?? startedAt;
  return stepTraceProjectors[trace.kind]({ requestId, trace, startedAt, endedAt });
}

const toolTraceTitleByStatus = {
  done: (trace: StepTraceDto) =>
    frontendMessage("workflow.projection.toolCall", {
      toolName: trace.toolName ?? frontendMessage("workflow.projection.defaultTool"),
    }),
  failed: (trace: StepTraceDto) =>
    frontendMessage("workflow.projection.toolCallFailed", {
      toolName: trace.toolName ?? frontendMessage("workflow.projection.defaultTool"),
    }),
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
    toolOrigin: trace.toolOrigin,
    callId: trace.callId,
    purpose: trace.purpose,
    toolBatch: toolBatchForTrace(requestId, trace),
    toolArgs: trace.toolArgs,
    toolPreview: trace.toolPreview,
    toolPresentation: trace.toolPresentation,
    toolResult: trace.toolResult,
    toolErrorMessage: trace.toolErrorMessage,
  }),

  answer: ({ trace, startedAt, endedAt }) => ({
    id: `${trace.step}-answer-${trace.seq}`,
    kind: "answer",
    title: trace.title ?? frontendMessage("workflow.projection.assistantFinalAnswer"),
    status: trace.status,
    startedAt,
    endedAt,
    decisionKind: trace.decisionKind,
  }),

  retry: ({ trace, startedAt, endedAt }) => ({
    id: `retry-${trace.step}-${trace.seq}`,
    kind: "retry",
    title: frontendMessage("workflow.projection.historyRetry"),
    status: trace.status,
    startedAt,
    endedAt,
    retryCode: trace.retryCode,
    errorMessage: trace.errorMessage,
  }),

  decision: ({ trace, startedAt, endedAt }) => ({
    id: `decision-${trace.step}-${trace.seq}`,
    kind: "decision",
    title: frontendMessage("workflow.projection.historyDecision"),
    description: trace.decisionKind ? friendlyDecisionKind(trace.decisionKind) : undefined,
    status: trace.status,
    startedAt,
    endedAt,
    decisionKind: trace.decisionKind,
  }),
} satisfies Record<StepTraceKind, StepTraceProjector>;
