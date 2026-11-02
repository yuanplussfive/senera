import { AgentEventKinds, emitAgentEvent, type AgentEventEnvelope, type AgentEventSink } from "../Events/AgentEvent.js";
import { AgentConversationEntryKinds, type AgentConversationEntry } from "../Conversation/AgentConversation.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { StepTrace } from "../Core/AgentStepTrace.js";
import type { AgentModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentToolPresentation } from "../Types/AgentToolPresentationTypes.js";
import type {
  AgentSessionCursorPage,
  AgentSessionHistoryView,
  AgentSessionCursorPageRequest,
  AgentSessionRunEventPageRequest,
  AgentStepTraceCursor,
  AgentStepTracePageRequest,
  StoredRunSnapshot,
  StoredStepTraceRun,
} from "./AgentSessionRepository.js";
import type { AgentHistoryStepRun } from "./AgentSessionEventTypes.js";
import { type AgentSessionEventFactory } from "./AgentSessionEventFactory.js";
import { AgentSessionHistoryWaitRecovery } from "./AgentSessionHistoryWaitRecovery.js";
import { readAgentSessionRecoveryModes } from "./AgentSessionRunRecovery.js";
import { AgentXmlParser } from "../Xml/AgentXmlParser.js";
import { projectAgentRunEventForHistory } from "../Events/AgentRunEventHistoryPolicy.js";
import {
  resolveAgentSessionHistoryReplayPaging,
  type AgentSessionHistoryReplayPaging,
} from "./AgentSessionHistoryPaging.js";
import type { AgentSessionHistoryBoundary, AgentSessionHistoryWindow } from "./AgentSessionHistoryWindow.js";
import { resolveAgentPiSessionLifecycle } from "../Pi/AgentPiSessionLifecycleMetadata.js";

const HistoryXmlParser = new AgentXmlParser();
const DefaultRunEventChunkMaxBytes = 256 * 1024;

export interface AgentSessionHistoryReplayOptions {
  store: AgentSessionHistoryReplayStore;
  eventFactory: AgentSessionEventFactory;
  /**
   * Captures the current declared tool presentation once for a replay. Durable
   * step traces keep their execution-era origin; this only lets a compatible
   * UI contract evolve without rewriting historical execution facts.
   */
  createPresentationResolver?: () => AgentSessionHistoryPresentationResolver;
  paging?: Partial<AgentSessionHistoryReplayPaging>;
  maxRunEventChunkBytes?: number;
  readHistoryBoundary?: (sessionId: string) => Promise<AgentSessionHistoryBoundary | undefined>;
}

export type AgentSessionHistoryPresentationResolver = (trace: Readonly<StepTrace>) => AgentToolPresentation | undefined;

export interface AgentSessionHistoryReplayStore {
  loadHistoryRequestPage: import("./AgentSessionRepository.js").AgentSessionPagedHistoryReader["loadHistoryRequestPage"];
  loadStepTracesForRequests: import("./AgentSessionRepository.js").AgentSessionPagedHistoryReader["loadStepTracesForRequests"];
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
    request: AgentSessionRunEventPageRequest,
  ): AgentSessionCursorPage<AgentEventEnvelope>;
  loadRunEventsForRequest(sessionId: string, requestId: string): AgentEventEnvelope[];
  loadRunEvent(sessionId: string, requestId: string, kind: string): AgentEventEnvelope | undefined;
}

export class AgentSessionHistoryReplay {
  private readonly paging: AgentSessionHistoryReplayPaging;
  private readonly maxRunEventChunkBytes: number;

  constructor(private readonly options: AgentSessionHistoryReplayOptions) {
    this.paging = resolveAgentSessionHistoryReplayPaging(options.paging);
    this.maxRunEventChunkBytes = normalizeRunEventChunkMaxBytes(options.maxRunEventChunkBytes);
  }

  async replay(request: {
    sessionId: string;
    refresh?: boolean;
    initialWindow?: boolean;
    before?: string;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    const snapshot = await this.captureHistorySnapshot(request);
    if (!snapshot) return;
    const presentationResolver = this.options.createPresentationResolver?.();

    const piSession = resolveAgentPiSessionLifecycle(snapshot.session.metadata);
    const boundary = piSession.initialized ? await this.options.readHistoryBoundary?.(request.sessionId) : undefined;
    if (boundary) {
      await this.replayWindow(request, presentationResolver, boundary);
      return;
    }

    await this.emitHistoryStarted(request, snapshot);
    if (request.initialWindow) await this.emitRecentPreview(request, snapshot);
    await this.emitEntryPages(request, snapshot);
    await this.emitStepRunPages(request, snapshot, presentationResolver);
    await this.emitRecoverableRunEventPages(request, snapshot);
    await this.emitActiveRunEventPages(request, snapshot);
    await this.emitHistoryCompleted(request);
  }

  private async replayWindow(
    request: { sessionId: string; refresh?: boolean; before?: string; onEvent?: AgentEventSink },
    resolver: AgentSessionHistoryPresentationResolver | undefined,
    boundary: AgentSessionHistoryBoundary,
  ): Promise<void> {
    // Native boundary discovery may yield while a turn commits. Capture the
    // repository high-water marks afterwards so the kept request is included.
    const snapshot = await this.captureHistorySnapshot(request);
    if (!snapshot) return;
    const page = this.options.store.loadHistoryRequestPage(request.sessionId, {
      entryHighWaterMark: snapshot.entryHighWaterMark,
      runSnapshotHighWaterMark: snapshot.runSnapshotHighWaterMark,
      fromRequestId: request.before === undefined ? boundary.firstKeptRequestId : undefined,
      before: request.before,
      pageSize: this.paging.entryPageSize,
    });
    const activeRequestId = snapshot.session.activeRequest?.requestId;
    const requestIds = [...page.requestIds];
    if (activeRequestId && !requestIds.includes(activeRequestId)) requestIds.push(activeRequestId);
    const window: AgentSessionHistoryWindow = {
      boundaryId: boundary.id,
      before: page.before,
      mode: request.before === undefined ? "replace" : "prepend",
      requestIds,
    };
    await this.emitHistoryStarted(request, snapshot, window);
    const entries =
      snapshot.entryHighWaterMark === undefined
        ? []
        : this.options.store.loadConversationEntriesForRequests(
            request.sessionId,
            requestIds,
            snapshot.entryHighWaterMark,
          );
    for (let index = 0; index < entries.length; index += this.paging.entryPageSize) {
      await emitAgentEvent(request.onEvent, {
        kind: AgentEventKinds.SessionHistoryChunk,
        context: { sessionId: request.sessionId },
        data: {
          sessionId: request.sessionId,
          entries: entries.slice(index, index + this.paging.entryPageSize).map((entry) => ({
            entry,
            visible:
              entry.kind === AgentConversationEntryKinds.AssistantDecision
                ? projectAssistantHistoryVisible(entry)
                : undefined,
          })),
        },
      });
      await yieldToEventLoop();
    }
    const traces =
      snapshot.stepTraceHighWaterMark === undefined
        ? []
        : this.options.store.loadStepTracesForRequests(request.sessionId, requestIds, snapshot.stepTraceHighWaterMark);
    const runs =
      snapshot.runSnapshotHighWaterMark === undefined
        ? []
        : this.options.store.loadRunSnapshotsForRequests(
            request.sessionId,
            requestIds,
            snapshot.runSnapshotHighWaterMark,
          );
    await this.emitStepRuns(
      request,
      this.buildStepRunsFromSources(new AgentSessionHistoryEntryIndex(entries), traces, runs, resolver),
      snapshot.runEventHighWaterMark,
    );
    // Keep failed tools and partial results recoverable inside the selected window.
    for (const run of runs) {
      if (!shouldRecoverRunEventFlow(run, activeRequestId)) continue;
      const recovery = new AgentSessionHistoryWaitRecovery();
      const events = this.projectHistoryEvents(
        this.options.store.loadRunEventsForRequest(request.sessionId, run.requestId),
      );
      recovery.observe(events, [run]);
      await this.emitRunEventChunks(request, events);
      await this.emitRunEventChunks(request, recovery.complete());
    }
    await this.emitActiveRunEventPages(request, snapshot);
    await this.emitHistoryCompleted(request);
  }

  /**
   * The ordinary transcript replay already contains the compact, durable
   * trace needed to render a finished turn. Fetch its diagnostic event stream
   * only when a person opens that run, rather than making every tab restore
   * every historical tool payload.
   */
  async replayRunHistory(request: { sessionId: string; requestId: string; onEvent?: AgentEventSink }): Promise<void> {
    const snapshot = await this.captureHistorySnapshot(request, "session.run_history");
    if (!snapshot) return;
    // Older runs can retain events without a run snapshot. The event journal
    // itself is authoritative for whether diagnostic details are available.
    const events = this.projectHistoryEvents(
      this.options.store.loadRunEventsForRequest(request.sessionId, request.requestId),
    );
    await this.emitRunHistoryDetailChunks(request, events);
  }

  private buildStepRunsFromSources(
    entryIndex: AgentSessionHistoryEntryIndex,
    traceRuns: readonly StoredStepTraceRun[],
    snapshots: readonly StoredRunSnapshot[],
    presentationResolver: AgentSessionHistoryPresentationResolver | undefined,
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
        traces: run.traces.map((trace) => this.resolveTracePresentation(trace, presentationResolver)),
      });
    }

    for (const snapshot of snapshots) {
      this.mergeSnapshotRun(runsByRequest, snapshot);
    }

    return Array.from(runsByRequest.values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  private async captureHistorySnapshot(
    request: {
      sessionId: string;
      requestId?: string;
      onEvent?: AgentEventSink;
    },
    operation: "session.history" | "session.run_history" = "session.history",
  ): Promise<AgentSessionHistoryView | undefined> {
    const snapshot = this.options.store.captureHistorySnapshot(request.sessionId);
    if (snapshot) return snapshot;
    await emitAgentEvent(
      request.onEvent,
      this.options.eventFactory.notFound(request.sessionId, operation, request.requestId),
    );
    return undefined;
  }

  private async emitHistoryStarted(
    request: { sessionId: string; refresh?: boolean; onEvent?: AgentEventSink },
    snapshot: AgentSessionHistoryView,
    window?: AgentSessionHistoryWindow,
  ): Promise<void> {
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionHistoryStarted,
      context: { sessionId: request.sessionId },
      data: {
        sessionId: request.sessionId,
        totalEntries: snapshot.entryCount,
        messageCount: snapshot.messageCount,
        refresh: request.refresh || undefined,
        ...(window ? { window } : {}),
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
                  ? projectAssistantHistoryVisible(entry)
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

  /**
   * Send one recent page before the complete replay. The page is deliberately
   * marked as a preview: the normal ascending replay remains authoritative and
   * reconciles the same entries without changing the durable transcript.
   */
  private async emitRecentPreview(
    request: { sessionId: string; onEvent?: AgentEventSink },
    snapshot: AgentSessionHistoryView,
  ): Promise<void> {
    const highWaterMark = snapshot.entryHighWaterMark;
    const pageSize = this.paging.entryPageSize;
    if (highWaterMark === undefined || highWaterMark <= pageSize) return;

    const page = this.options.store.loadConversationPage(request.sessionId, {
      after: Math.max(-1, highWaterMark - pageSize),
      through: highWaterMark,
      pageSize,
    });
    if (page.items.length === 0) return;

    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionHistoryChunk,
      context: { sessionId: request.sessionId },
      data: {
        sessionId: request.sessionId,
        preview: true,
        entries: page.items.map((entry) => ({
          entry,
          visible:
            entry.kind === AgentConversationEntryKinds.AssistantDecision
              ? projectAssistantHistoryVisible(entry)
              : undefined,
        })),
      },
    });
  }

  private async emitStepRunPages(
    request: { sessionId: string; onEvent?: AgentEventSink },
    historySnapshot: AgentSessionHistoryView,
    presentationResolver: AgentSessionHistoryPresentationResolver | undefined,
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
        await this.emitStepRuns(
          request,
          this.buildStepRunsFromSources(entryIndex, page.items, pageSnapshots, presentationResolver),
          historySnapshot.runEventHighWaterMark,
        );
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
          presentationResolver,
        ),
        historySnapshot.runEventHighWaterMark,
      );
      if (page.nextCursor === undefined) break;
      assertCursorAdvanced(cursor, page.nextCursor, "run snapshot");
      cursor = page.nextCursor;
    }
  }

  private async emitStepRuns(
    request: { sessionId: string; onEvent?: AgentEventSink },
    runs: readonly AgentHistoryStepRun[],
    runEventHighWaterMark: number | undefined,
  ): Promise<void> {
    if (runs.length === 0) return;
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionHistorySteps,
      context: { sessionId: request.sessionId },
      data: { sessionId: request.sessionId, runs: [...runs] },
    });
    // Ratings annotate the transcript even when diagnostic details stay lazy.
    // Load only the latest record rather than replaying each run's event log.
    const feedbackEvents: AgentEventEnvelope[] = [];
    for (const run of runs) {
      const feedback = this.options.store.loadRunEvent(
        request.sessionId,
        run.requestId,
        AgentEventKinds.FeedbackRecorded,
      );
      if (feedback) feedbackEvents.push(feedback);
    }
    await this.emitRunEventChunks(request, feedbackEvents);
    await this.emitCompletedThinking(request, runs, runEventHighWaterMark);
  }

  /** Thinking is transcript content; full diagnostic and tool payloads remain lazy. */
  private async emitCompletedThinking(
    request: { sessionId: string; onEvent?: AgentEventSink },
    runs: readonly AgentHistoryStepRun[],
    through: number | undefined,
  ): Promise<void> {
    // Active and interrupted runs already replay their recoverable event flow.
    const requestIds = runs.filter((run) => run.status === "completed").map((run) => run.requestId);
    if (through === undefined || requestIds.length === 0) return;
    let after: number | undefined;
    for (;;) {
      const page = this.options.store.loadRunEventPage(request.sessionId, {
        after,
        through,
        pageSize: this.paging.runEventPageSize,
        requestIds,
        kinds: [AgentEventKinds.ModelThinkingCompleted],
      });
      await this.emitRunEventChunks(request, this.projectHistoryEvents([...page.items]));
      if (page.nextCursor === undefined) return;
      assertCursorAdvanced(after, page.nextCursor, "completed thinking");
      after = page.nextCursor;
    }
  }

  private resolveTracePresentation(
    trace: StepTrace,
    resolver: AgentSessionHistoryPresentationResolver | undefined,
  ): StepTrace {
    if (!resolver || !trace.toolOrigin) return trace;
    const presentation = resolver(trace);
    if (!presentation) return trace;
    return {
      ...trace,
      toolOrigin: {
        ...trace.toolOrigin,
        presentation,
      },
    };
  }

  private async emitActiveRunEventPages(
    request: { sessionId: string; onEvent?: AgentEventSink },
    snapshot: AgentSessionHistoryView,
  ): Promise<void> {
    const activeRequestId = snapshot.session.activeRequest?.requestId;
    if (!activeRequestId) return;
    const recovery = new AgentSessionHistoryWaitRecovery();
    const events = this.projectHistoryEvents(
      this.options.store.loadRunEventsForRequest(request.sessionId, activeRequestId),
    );
    const snapshots =
      snapshot.runSnapshotHighWaterMark === undefined
        ? []
        : this.options.store.loadRunSnapshotsForRequests(
            request.sessionId,
            [activeRequestId],
            snapshot.runSnapshotHighWaterMark,
          );
    recovery.observe(events, snapshots);
    await this.emitRunEventChunks(request, events);
    await this.emitRunEventChunks(request, recovery.complete());
  }

  /**
   * Finished runs already have compact step traces, so replaying every raw
   * event would make a long transcript expensive to open. Failed, cancelled,
   * and orphaned running runs are different: they often terminate before a
   * complete trace can be committed. Restore their bounded event flow with
   * the initial history so the error, prompt summary, approvals, and partial
   * tool activity remain inspectable after a reconnect.
   */
  private async emitRecoverableRunEventPages(
    request: { sessionId: string; onEvent?: AgentEventSink },
    snapshot: AgentSessionHistoryView,
  ): Promise<void> {
    if (snapshot.runSnapshotHighWaterMark === undefined) return;

    const activeRequestId = snapshot.session.activeRequest?.requestId;
    let cursor: number | undefined;
    for (;;) {
      const page = this.options.store.loadRunSnapshotPage(request.sessionId, {
        after: cursor,
        through: snapshot.runSnapshotHighWaterMark,
        pageSize: this.paging.stepRunPageSize,
      });
      const recovery = new AgentSessionHistoryWaitRecovery();
      const events: AgentEventEnvelope[] = [];
      for (const run of page.items) {
        if (!shouldRecoverRunEventFlow(run, activeRequestId)) continue;
        const runEvents = this.projectHistoryEvents(
          this.options.store.loadRunEventsForRequest(request.sessionId, run.requestId),
        );
        if (runEvents.length === 0) continue;
        recovery.observe(runEvents, [run]);
        events.push(...runEvents);
      }
      await this.emitRunEventChunks(request, events);
      await this.emitRunEventChunks(request, recovery.complete());
      if (page.nextCursor === undefined) return;
      assertCursorAdvanced(cursor, page.nextCursor, "recoverable run snapshot");
      cursor = page.nextCursor;
    }
  }

  private projectHistoryEvents(events: readonly AgentEventEnvelope[]): AgentEventEnvelope[] {
    return events.flatMap((event) => {
      const projected = projectAgentRunEventForHistory(event);
      return projected ? [projected] : [];
    });
  }

  private async emitRunEventChunks(
    request: { sessionId: string; onEvent?: AgentEventSink },
    events: readonly AgentEventEnvelope[],
  ): Promise<void> {
    for (const chunk of splitRunEventChunks(
      events,
      this.paging.runEventPageSize,
      this.maxRunEventChunkBytes,
      request.sessionId,
    )) {
      await this.emitRunEventChunk(request, chunk);
      await yieldToEventLoop();
    }
  }

  private async emitRunEventChunk(
    request: { sessionId: string; onEvent?: AgentEventSink },
    events: readonly AgentEventEnvelope[],
  ): Promise<void> {
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionRunHistoryChunk,
      context: { sessionId: request.sessionId },
      data: {
        sessionId: request.sessionId,
        events: [...events],
      },
    });
  }

  private async emitRunHistoryDetailChunks(
    request: { sessionId: string; requestId: string; onEvent?: AgentEventSink },
    events: readonly AgentEventEnvelope[],
  ): Promise<void> {
    const chunks = splitRunEventChunks(
      events,
      this.paging.runEventPageSize,
      this.maxRunEventChunkBytes,
      request.sessionId,
    );
    if (chunks.length === 0) {
      await this.emitRunHistoryDetail(request, [], true);
      return;
    }
    for (const [index, chunk] of chunks.entries()) {
      await this.emitRunHistoryDetail(request, chunk, index === chunks.length - 1);
      await yieldToEventLoop();
    }
  }

  private async emitRunHistoryDetail(
    request: { sessionId: string; requestId: string; onEvent?: AgentEventSink },
    events: readonly AgentEventEnvelope[],
    complete: boolean,
  ): Promise<void> {
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionRunHistoryDetail,
      context: { sessionId: request.sessionId, requestId: request.requestId },
      data: {
        sessionId: request.sessionId,
        requestId: request.requestId,
        events: [...events],
        complete,
      },
    });
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
      existing.startedAt = snapshot.startedAt;
      existing.modelProvider ??= snapshot.modelProvider;

      existing.status = projectSnapshotStatus(snapshot, existing.traces.length > 0);
      existing.recoveryModes = readAgentSessionRecoveryModes(snapshot.status);
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
      recoveryModes: readAgentSessionRecoveryModes(snapshot.status),
      modelProvider: snapshot.modelProvider,
      traces: status === "running" ? [] : [createMissingRunDataTrace(snapshot)],
    });
  }
}

function normalizeRunEventChunkMaxBytes(value: number | undefined): number {
  if (value === undefined) return DefaultRunEventChunkMaxBytes;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("maxRunEventChunkBytes must be a positive safe integer.");
  }
  return value;
}

function serializedRunEventChunkBytes(sessionId: string, events: readonly AgentEventEnvelope[]): number {
  return Buffer.byteLength(JSON.stringify({ sessionId, events }));
}

function splitRunEventChunks(
  events: readonly AgentEventEnvelope[],
  maximumItems: number,
  maximumBytes: number,
  sessionId: string,
): AgentEventEnvelope[][] {
  const chunks: AgentEventEnvelope[][] = [];
  let chunk: AgentEventEnvelope[] = [];
  for (const event of events) {
    const candidate = [...chunk, event];
    const exceedsByteLimit = chunk.length > 0 && serializedRunEventChunkBytes(sessionId, candidate) > maximumBytes;
    if (chunk.length >= maximumItems || exceedsByteLimit) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(event);
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function inferTraceRunStatus(traces: readonly StepTrace[]): AgentHistoryStepRun["status"] {
  const terminal = traces.at(-1)?.status;
  if (terminal === "failed") return "failed";
  return terminal === "done" ? "completed" : "running";
}

function projectSnapshotStatus(snapshot: StoredRunSnapshot, hasTrace: boolean): AgentHistoryStepRun["status"] {
  if (snapshot.status !== "completed") return snapshot.status;
  return hasTrace ? "completed" : "failed";
}

function shouldRecoverRunEventFlow(snapshot: StoredRunSnapshot, activeRequestId: string | undefined): boolean {
  return snapshot.requestId !== activeRequestId && snapshot.status !== "completed";
}

function projectAssistantHistoryVisible(entry: Extract<AgentConversationEntry, { kind: "assistant.decision" }>): {
  kind: "final_answer";
  text: string;
} {
  return {
    kind: "final_answer",
    text: readAssistantAnswer(entry.xml) ?? entry.xml,
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
    historyFallback: "missing_reply",
    title: agentErrorMessage("session.historyMissingReplyTitle"),
    errorMessage: snapshot.errorMessage ?? agentErrorMessage("session.historyMissingReplyError"),
  };
}
