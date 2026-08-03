import { AgentEventKinds, emitAgentEvent, type AgentEventEnvelope, type AgentEventSink } from "../Events/AgentEvent.js";
import { AgentConversationEntryKinds, type AgentConversationEntry } from "../Conversation/AgentConversation.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import type { AgentModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type {
  AgentSessionCursorPage,
  AgentSessionHistoryView,
  AgentSessionCursorPageRequest,
  AgentStepTraceCursor,
  AgentStepTracePageRequest,
  StoredRunSnapshot,
  StoredStepTraceRun,
} from "./AgentSessionRepository.js";
import type { AgentHistoryStepRun } from "./AgentSessionEventTypes.js";
import { type AgentSessionEventFactory } from "./AgentSessionEventFactory.js";
import { AgentSessionHistoryWaitRecovery } from "./AgentSessionHistoryWaitRecovery.js";
import { AgentXmlParser } from "../Xml/AgentXmlParser.js";
import {
  resolveAgentSessionHistoryReplayPaging,
  type AgentSessionHistoryReplayPaging,
} from "./AgentSessionHistoryPaging.js";

const HistoryXmlParser = new AgentXmlParser();

export interface AgentSessionHistoryReplayOptions {
  store: AgentSessionHistoryReplayStore;
  eventFactory: AgentSessionEventFactory;
  paging?: Partial<AgentSessionHistoryReplayPaging>;
}

export interface AgentSessionHistoryReplayStore {
  captureHistorySnapshot(sessionId: string): AgentSessionHistoryView | undefined;
  loadConversationPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<AgentConversationEntry>;
  loadConversationEntriesForRequests(
    sessionId: string,
    requestIds: readonly string[],
    throughSequence: number,
  ): AgentConversationEntry[];
  loadStepTracePage(
    sessionId: string,
    request: AgentStepTracePageRequest,
  ): AgentSessionCursorPage<StoredStepTraceRun, AgentStepTraceCursor>;
  loadStepTraceRequestIds(sessionId: string, requestIds: readonly string[], throughRowId: number): string[];
  loadRunSnapshotsForRequests(
    sessionId: string,
    requestIds: readonly string[],
    throughRevision: number,
  ): StoredRunSnapshot[];
  loadRunSnapshotPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<StoredRunSnapshot>;
  loadRunEventPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<AgentEventEnvelope>;
}

export class AgentSessionHistoryReplay {
  private readonly paging: AgentSessionHistoryReplayPaging;

  constructor(private readonly options: AgentSessionHistoryReplayOptions) {
    this.paging = resolveAgentSessionHistoryReplayPaging(options.paging);
  }

  async replay(request: { sessionId: string; refresh?: boolean; onEvent?: AgentEventSink }): Promise<void> {
    const snapshot = await this.captureHistorySnapshot(request);
    if (!snapshot) return;

    await this.emitHistoryStarted(request, snapshot);
    await this.emitEntryPages(request, snapshot);
    await this.emitStepRunPages(request, snapshot);
    await this.emitRunEventPages(request, snapshot);
    await this.emitHistoryCompleted(request);
  }

  private buildStepRunsFromSources(
    entryIndex: AgentSessionHistoryEntryIndex,
    traceRuns: readonly StoredStepTraceRun[],
    snapshots: readonly StoredRunSnapshot[],
  ): AgentHistoryStepRun[] {
    const runsByRequest = new Map<string, AgentHistoryStepRun>();

    for (const run of traceRuns) {
      const userEntry = entryIndex.userMessage(run.requestId);
      const assistantEntry = entryIndex.assistantDecision(run.requestId);
      runsByRequest.set(run.requestId, {
        requestId: run.requestId,
        input: userEntry?.content ?? "",
        startedAt: userEntry?.timestamp ?? run.traces[0]?.startedAt ?? "",
        endedAt: assistantEntry?.timestamp,
        status: inferTraceRunStatus(run.traces),
        modelProvider: assistantEntry?.modelProvider ?? userEntry?.modelProvider,
        traces: run.traces,
      });
    }

    for (const snapshot of snapshots) {
      this.mergeSnapshotRun(runsByRequest, snapshot);
    }

    return Array.from(runsByRequest.values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  private async captureHistorySnapshot(request: {
    sessionId: string;
    onEvent?: AgentEventSink;
  }): Promise<AgentSessionHistoryView | undefined> {
    const snapshot = this.options.store.captureHistorySnapshot(request.sessionId);
    if (snapshot) return snapshot;
    await emitAgentEvent(request.onEvent, this.options.eventFactory.notFound(request.sessionId, "session.history"));
    return undefined;
  }

  private async emitHistoryStarted(
    request: { sessionId: string; refresh?: boolean; onEvent?: AgentEventSink },
    snapshot: AgentSessionHistoryView,
  ): Promise<void> {
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionHistoryStarted,
      context: { sessionId: request.sessionId },
      data: {
        sessionId: request.sessionId,
        totalEntries: snapshot.entryCount,
        messageCount: snapshot.messageCount,
        refresh: request.refresh || undefined,
      },
    });
  }

  private async emitEntryPages(
    request: { sessionId: string; onEvent?: AgentEventSink },
    snapshot: AgentSessionHistoryView,
  ): Promise<void> {
    if (snapshot.entryHighWaterMark === undefined) return;

    let cursor: number | undefined;
    for (;;) {
      const page = this.options.store.loadConversationPage(request.sessionId, {
        after: cursor,
        through: snapshot.entryHighWaterMark,
        pageSize: this.paging.entryPageSize,
      });
      if (page.items.length > 0) {
        await emitAgentEvent(request.onEvent, {
          kind: AgentEventKinds.SessionHistoryChunk,
          context: { sessionId: request.sessionId },
          data: {
            sessionId: request.sessionId,
            entries: page.items.map((entry) => ({
              entry,
              visible:
                entry.kind === AgentConversationEntryKinds.AssistantDecision
                  ? projectAssistantHistoryVisible(entry.xml)
                  : undefined,
            })),
          },
        });
      }
      if (page.nextCursor === undefined) return;
      assertCursorAdvanced(cursor, page.nextCursor, "conversation entry");
      cursor = page.nextCursor;
    }
  }

  private async emitStepRunPages(
    request: { sessionId: string; onEvent?: AgentEventSink },
    historySnapshot: AgentSessionHistoryView,
  ): Promise<void> {
    if (historySnapshot.stepTraceHighWaterMark !== undefined) {
      let cursor: AgentStepTraceCursor | undefined;
      for (;;) {
        const page = this.options.store.loadStepTracePage(request.sessionId, {
          after: cursor,
          throughRowId: historySnapshot.stepTraceHighWaterMark,
          pageSize: this.paging.stepRunPageSize,
        });
        const requestIds = page.items.map((run) => run.requestId);
        const entryIndex = new AgentSessionHistoryEntryIndex(
          historySnapshot.entryHighWaterMark === undefined
            ? []
            : this.options.store.loadConversationEntriesForRequests(
                request.sessionId,
                requestIds,
                historySnapshot.entryHighWaterMark,
              ),
        );
        const pageSnapshots =
          historySnapshot.runSnapshotHighWaterMark === undefined
            ? []
            : this.options.store.loadRunSnapshotsForRequests(
                request.sessionId,
                requestIds,
                historySnapshot.runSnapshotHighWaterMark,
              );
        await this.emitStepRuns(request, this.buildStepRunsFromSources(entryIndex, page.items, pageSnapshots));
        if (!page.nextCursor) break;
        assertStepTraceCursorAdvanced(cursor, page.nextCursor);
        cursor = page.nextCursor;
      }
    }

    if (historySnapshot.runSnapshotHighWaterMark === undefined) return;
    let cursor: number | undefined;
    for (;;) {
      const page = this.options.store.loadRunSnapshotPage(request.sessionId, {
        after: cursor,
        through: historySnapshot.runSnapshotHighWaterMark,
        pageSize: this.paging.stepRunPageSize,
      });
      const tracedRequestIds =
        historySnapshot.stepTraceHighWaterMark === undefined
          ? new Set<string>()
          : new Set(
              this.options.store.loadStepTraceRequestIds(
                request.sessionId,
                page.items.map((snapshot) => snapshot.requestId),
                historySnapshot.stepTraceHighWaterMark,
              ),
            );
      await this.emitStepRuns(
        request,
        this.buildStepRunsFromSources(
          new AgentSessionHistoryEntryIndex(),
          [],
          page.items.filter((snapshot) => !tracedRequestIds.has(snapshot.requestId)),
        ),
      );
      if (page.nextCursor === undefined) break;
      assertCursorAdvanced(cursor, page.nextCursor, "run snapshot");
      cursor = page.nextCursor;
    }
  }

  private async emitStepRuns(
    request: { sessionId: string; onEvent?: AgentEventSink },
    runs: readonly AgentHistoryStepRun[],
  ): Promise<void> {
    if (runs.length === 0) return;
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionHistorySteps,
      context: { sessionId: request.sessionId },
      data: { sessionId: request.sessionId, runs: [...runs] },
    });
  }

  private async emitRunEventPages(
    request: { sessionId: string; onEvent?: AgentEventSink },
    snapshot: AgentSessionHistoryView,
  ): Promise<void> {
    const recovery = new AgentSessionHistoryWaitRecovery();
    if (snapshot.runEventHighWaterMark !== undefined) {
      let cursor: number | undefined;
      for (;;) {
        const page = this.options.store.loadRunEventPage(request.sessionId, {
          after: cursor,
          through: snapshot.runEventHighWaterMark,
          pageSize: this.paging.runEventPageSize,
        });
        const waitRequestIds = recoverableWaitRequestIds(page.items);
        const pageSnapshots =
          snapshot.runSnapshotHighWaterMark === undefined || waitRequestIds.length === 0
            ? []
            : this.options.store.loadRunSnapshotsForRequests(
                request.sessionId,
                waitRequestIds,
                snapshot.runSnapshotHighWaterMark,
              );
        recovery.observe(page.items, pageSnapshots);
        await this.emitRunEventChunks(request, page.items);
        if (page.nextCursor === undefined) break;
        assertCursorAdvanced(cursor, page.nextCursor, "run event");
        cursor = page.nextCursor;
      }
    }
    await this.emitRunEventChunks(request, recovery.complete());
  }

  private async emitRunEventChunks(
    request: { sessionId: string; onEvent?: AgentEventSink },
    events: readonly AgentEventEnvelope[],
  ): Promise<void> {
    for (let index = 0; index < events.length; index += this.paging.runEventPageSize) {
      const chunk = events.slice(index, index + this.paging.runEventPageSize);
      await emitAgentEvent(request.onEvent, {
        kind: AgentEventKinds.SessionRunHistoryChunk,
        context: { sessionId: request.sessionId },
        data: {
          sessionId: request.sessionId,
          events: chunk,
        },
      });
    }
  }

  private async emitHistoryCompleted(request: {
    sessionId: string;
    refresh?: boolean;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionHistoryCompleted,
      context: { sessionId: request.sessionId },
      data: { sessionId: request.sessionId, refresh: request.refresh || undefined },
    });
  }

  private mergeSnapshotRun(runsByRequest: Map<string, AgentHistoryStepRun>, snapshot: StoredRunSnapshot): void {
    const existing = runsByRequest.get(snapshot.requestId);
    if (existing) {
      existing.input ||= snapshot.input;
      existing.startedAt ||= snapshot.startedAt;
      existing.modelProvider ??= snapshot.modelProvider;

      existing.status = projectSnapshotStatus(snapshot, existing.traces.length > 0);
      existing.endedAt = snapshot.endedAt ?? existing.endedAt;
      if (existing.status === "completed" && existing.traces.length === 0) {
        existing.endedAt = snapshot.endedAt ?? snapshot.updatedAt;
        existing.traces = [createMissingRunDataTrace(snapshot)];
      }
      return;
    }

    const status = projectSnapshotStatus(snapshot, false);
    runsByRequest.set(snapshot.requestId, {
      requestId: snapshot.requestId,
      input: snapshot.input,
      startedAt: snapshot.startedAt,
      endedAt: snapshot.endedAt ?? (status === "failed" ? snapshot.updatedAt : undefined),
      status,
      modelProvider: snapshot.modelProvider,
      traces: status === "running" ? [] : [createMissingRunDataTrace(snapshot)],
    });
  }
}

function inferTraceRunStatus(traces: readonly StepTrace[]): AgentHistoryStepRun["status"] {
  const terminal = traces.at(-1)?.status;
  if (terminal === "failed") return "failed";
  return terminal === "done" ? "completed" : "running";
}

function recoverableWaitRequestIds(events: readonly AgentEventEnvelope[]): string[] {
  const requestIds = new Set<string>();
  for (const event of events) {
    if (
      event.requestId &&
      (event.kind === AgentEventKinds.ApprovalRequested || event.kind === AgentEventKinds.InteractionInputRequested)
    ) {
      requestIds.add(event.requestId);
    }
  }
  return [...requestIds];
}

function projectSnapshotStatus(snapshot: StoredRunSnapshot, hasTrace: boolean): AgentHistoryStepRun["status"] {
  if (snapshot.status !== "completed") return snapshot.status;
  return hasTrace ? "completed" : "failed";
}

function projectAssistantHistoryVisible(text: string): { kind: "final_answer"; text: string } {
  return {
    kind: "final_answer",
    text: readAssistantAnswer(text) ?? text,
  };
}

function readAssistantAnswer(xml: string): string | undefined {
  try {
    const parsed = HistoryXmlParser.parse(xml).value;
    return readAnswerValue(parsed);
  } catch {
    return undefined;
  }
}

function readAnswerValue(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    return value.map(readAnswerValue).find((item): item is string => item !== undefined);
  }
  const record = value as Record<string, unknown>;
  const answer = record.answer;
  if (typeof answer === "string") return answer;
  if (answer && typeof answer === "object") {
    const nested = readTextValue(answer);
    if (nested) return nested;
  }
  return Object.values(record)
    .map(readAnswerValue)
    .find((item): item is string => item !== undefined);
}

function readTextValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isPlainRecord(value)) return undefined;
  const text = value["#text"] ?? value["#cdata"];
  return typeof text === "string" ? text : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

class AgentSessionHistoryEntryIndex {
  private readonly users = new Map<string, IndexedUserMessage>();
  private readonly assistants = new Map<string, IndexedAssistantDecision>();

  constructor(entries: readonly AgentConversationEntry[] = []) {
    this.add(entries);
  }

  add(entries: readonly AgentConversationEntry[]): void {
    for (const entry of entries) this.index(entry);
  }

  userMessage(requestId: string): IndexedUserMessage | undefined {
    return this.users.get(requestId);
  }

  assistantDecision(requestId: string): IndexedAssistantDecision | undefined {
    return this.assistants.get(requestId);
  }

  private index(entry: AgentConversationEntry): void {
    if (entry.kind === AgentConversationEntryKinds.UserMessage && !this.users.has(entry.requestId)) {
      this.users.set(entry.requestId, {
        content: entry.content,
        timestamp: entry.timestamp,
        modelProvider: entry.metadata?.run?.modelProvider,
      });
      return;
    }

    if (entry.kind === AgentConversationEntryKinds.AssistantDecision) {
      this.assistants.set(entry.requestId, {
        timestamp: entry.timestamp,
        modelProvider: entry.metadata?.run?.modelProvider,
      });
    }
  }
}

interface IndexedUserMessage {
  readonly content: string;
  readonly timestamp: string;
  readonly modelProvider?: AgentModelProviderMetadata;
}

interface IndexedAssistantDecision {
  readonly timestamp: string;
  readonly modelProvider?: AgentModelProviderMetadata;
}

function assertCursorAdvanced(previous: number | undefined, next: number, kind: string): void {
  if (!Number.isSafeInteger(next) || next <= (previous ?? -1)) {
    throw new Error(`Session history ${kind} cursor did not advance.`);
  }
}

function assertStepTraceCursorAdvanced(previous: AgentStepTraceCursor | undefined, next: AgentStepTraceCursor): void {
  const advanced =
    !previous ||
    next.turnSequence > previous.turnSequence ||
    (next.turnSequence === previous.turnSequence && next.requestId > previous.requestId);
  if (!Number.isSafeInteger(next.turnSequence) || !advanced) {
    throw new Error("Session history step-trace cursor did not advance.");
  }
}

function createMissingRunDataTrace(snapshot: StoredRunSnapshot): StepTrace {
  return {
    step: 0,
    seq: 0,
    kind: "answer",
    status: "failed",
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt ?? snapshot.updatedAt,
    title: agentErrorMessage("session.historyMissingReplyTitle"),
    errorMessage: snapshot.errorMessage ?? agentErrorMessage("session.historyMissingReplyError"),
  };
}
