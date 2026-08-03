import type Database from "better-sqlite3";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import type { AgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import { parseAgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import {
  entryToRow,
  parseStoredRunEvent,
  rowToEntry,
  rowToRunSnapshot,
  runSnapshotToRow,
  type AgentConversationEntryDecodeIssue,
} from "../SessionPersistence/AgentSessionCodec.js";
import type { AgentSessionSqlStatements } from "../SessionPersistence/AgentSessionSqlStatements.js";
import { rowToAgentSession } from "./AgentSqliteSessionMapper.js";
import { AgentSqliteSessionTraceStore } from "./AgentSqliteSessionTraceStore.js";
import { assertAgentSessionRepositoryPageSize, normalizeAgentSessionRequestIds } from "./AgentSessionHistoryPaging.js";
import type {
  AgentSessionCursorPage,
  AgentSessionCursorPageRequest,
  AgentSessionForkHistory,
  AgentSessionForkSnapshot,
  AgentSessionHistoryView,
  AgentSessionTurnCommit,
  AgentStepTraceCursor,
  AgentStepTracePageRequest,
  StoredRunSnapshot,
  StoredStepTraceRun,
} from "./AgentSessionRepository.js";

export type AgentSqliteSessionEntryDecodeIssueSink = (
  sessionId: string,
  issue: AgentConversationEntryDecodeIssue,
) => void;

export class AgentSqliteSessionHistoryStore {
  private readonly traces: AgentSqliteSessionTraceStore;

  constructor(
    private readonly db: Database.Database,
    private readonly stmts: AgentSessionSqlStatements,
    private readonly onDecodeIssue?: AgentSqliteSessionEntryDecodeIssueSink,
  ) {
    this.traces = new AgentSqliteSessionTraceStore(db, stmts);
  }

  captureSnapshot(sessionId: string): AgentSessionHistoryView | undefined {
    const row = this.stmts.selectSessionHistoryView.get(sessionId);
    if (!row) return undefined;
    return {
      session: { ...rowToAgentSession(row), conversation: [] },
      entryCount: row.entry_count,
      messageCount: row.message_count,
      entryHighWaterMark: row.entry_high_water_mark ?? undefined,
      stepTraceHighWaterMark: row.step_trace_high_water_mark ?? undefined,
      runSnapshotHighWaterMark: row.run_snapshot_high_water_mark ?? undefined,
      runEventHighWaterMark: row.run_event_high_water_mark ?? undefined,
    };
  }

  hasRequest(sessionId: string, requestId: string): boolean {
    const sequence = this.stmts.selectRequestSequenceRange.get(sessionId, requestId)?.first_sequence;
    return sequence !== undefined && sequence !== null;
  }

  loadRequestIdsFrom(sessionId: string, requestId: string): string[] {
    const boundary = this.stmts.selectRequestSequenceRange.get(sessionId, requestId)?.first_sequence;
    if (boundary === undefined || boundary === null) return [];
    return this.stmts.selectRequestIdsFromSequence.all(sessionId, boundary).map((row) => row.request_id);
  }

  loadForkHistoryThroughRequest(sessionId: string, requestId: string): AgentSessionForkHistory | undefined {
    return this.db.transaction(() => {
      const boundary = this.stmts.selectRequestSequenceRange.get(sessionId, requestId)?.last_sequence;
      if (boundary === undefined || boundary === null) return undefined;

      const entries = this.stmts.selectEntriesThroughSequence.all(sessionId, boundary).flatMap((row) => {
        const entry = rowToEntry(row, (issue) => this.onDecodeIssue?.(sessionId, issue));
        return entry ? [{ entry, sequence: row.sequence }] : [];
      });
      const traces = this.stmts.selectStepTracesThroughSequence.all(sessionId, sessionId, boundary).map((row) => ({
        requestId: row.request_id,
        turnSequence: row.turn_sequence,
        trace: parseJsonText(row.data, "Step trace") as StepTrace,
      }));
      const runSnapshots = this.stmts.selectRunSnapshotsThroughSequence
        .all(sessionId, sessionId, boundary)
        .map(rowToRunSnapshot);
      const turnPreparations = this.stmts.selectTurnPreparationsThroughSequence
        .all(sessionId, sessionId, boundary)
        .flatMap((row) => {
          const snapshot = parseTurnPreparation(row.snapshot_json);
          return snapshot ? [{ requestId: row.request_id, snapshot }] : [];
        });
      const runEvents = this.stmts.selectRunEventsThroughSequence
        .all(sessionId, sessionId, boundary)
        .flatMap(rowToStoredRunEvent);
      return { entries, traces, runSnapshots, turnPreparations, runEvents };
    })();
  }

  loadEntries(sessionId: string): AgentConversationEntry[] {
    return this.stmts.selectEntries.all(sessionId).flatMap((row) => {
      const entry = rowToEntry(row, (issue) => this.onDecodeIssue?.(sessionId, issue));
      return entry ? [entry] : [];
    });
  }

  loadFirstUserMessage(sessionId: string): AgentConversationEntry | undefined {
    const row = this.stmts.selectFirstUserEntry.get(sessionId);
    if (!row) return undefined;
    return rowToEntry(row, (issue) => this.onDecodeIssue?.(sessionId, issue));
  }

  loadEntryPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<AgentConversationEntry> {
    const pageSize = assertAgentSessionRepositoryPageSize(request.pageSize);
    const rows = this.stmts.selectEntryPage.all(sessionId, request.after ?? -1, request.through, pageSize + 1);
    const pageRows = rows.slice(0, pageSize);
    return {
      items: pageRows.flatMap((row) => {
        const entry = rowToEntry(row, (issue) => this.onDecodeIssue?.(sessionId, issue));
        return entry ? [entry] : [];
      }),
      nextCursor: rows.length > pageSize ? pageRows.at(-1)?.sequence : undefined,
    };
  }

  loadEntriesForRequests(
    sessionId: string,
    requestIds: readonly string[],
    throughSequence: number,
  ): AgentConversationEntry[] {
    const encodedRequestIds = encodeRequestIdLookup(requestIds);
    if (!encodedRequestIds) return [];
    return this.stmts.selectEntriesForRequests.all(sessionId, throughSequence, encodedRequestIds).flatMap((row) => {
      const entry = rowToEntry(row, (issue) => this.onDecodeIssue?.(sessionId, issue));
      return entry ? [entry] : [];
    });
  }

  appendEntry(sessionId: string, entry: AgentConversationEntry, sequence: number): void {
    this.stmts.appendEntry.run(entryToRow(sessionId, entry, sequence));
  }

  appendEntries(sessionId: string, entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>): void {
    this.traces.appendEntries(sessionId, entries);
  }

  persistTurnArtifacts(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
    traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>,
  ): void {
    this.traces.persistTurnArtifacts(sessionId, entries, traces);
  }

  persistForkHistory(fork: AgentSessionForkSnapshot): void {
    for (const { entry, sequence } of fork.entries) {
      this.appendEntry(fork.session.id, entry, sequence);
    }
    for (const { requestId, turnSequence, trace } of fork.traces) {
      this.appendStepTrace(fork.session.id, requestId, turnSequence, trace);
    }
    for (const runSnapshot of fork.runSnapshots) {
      this.upsertRunSnapshot(runSnapshot);
    }
    const createdAt = new Date().toISOString();
    for (const preparation of fork.turnPreparations) {
      this.persistTurnPreparation(fork.session.id, preparation.requestId, preparation.snapshot, createdAt);
    }
    for (const event of fork.runEvents) {
      this.insertRunEvent(fork.session.id, event, event);
    }
  }

  persistTurnCommitArtifacts(commit: AgentSessionTurnCommit): void {
    for (const { entry, sequence } of commit.entries) {
      this.appendEntry(commit.sessionId, entry, sequence);
    }
    for (const { requestId, turnSequence, trace } of commit.traces) {
      this.appendStepTrace(commit.sessionId, requestId, turnSequence, trace);
    }
    this.upsertRunSnapshot(commit.snapshot);
    for (const event of commit.runEvents) {
      const eventId = resolveStoredEventId(event);
      this.insertRunEvent(commit.sessionId, event, { ...event, eventId });
    }
  }

  loadStepTraces(sessionId: string): StoredStepTraceRun[] {
    return this.traces.loadStepTraces(sessionId);
  }

  loadStepTracePage(
    sessionId: string,
    request: AgentStepTracePageRequest,
  ): AgentSessionCursorPage<StoredStepTraceRun, AgentStepTraceCursor> {
    return this.traces.loadStepTracePage(sessionId, request);
  }

  loadStepTraceRequestIds(sessionId: string, requestIds: readonly string[], throughRowId: number): string[] {
    const encodedRequestIds = encodeRequestIdLookup(requestIds);
    if (!encodedRequestIds) return [];
    return this.stmts.selectStepTraceRequestIds
      .all(sessionId, throughRowId, encodedRequestIds)
      .map((row) => row.request_id);
  }

  deleteStepTracesFrom(sessionId: string, requestId: string): number {
    return this.stmts.deleteStepTracesFrom.run(sessionId, sessionId, requestId).changes;
  }

  upsertRunSnapshot(snapshot: StoredRunSnapshot): void {
    this.stmts.upsertRunSnapshot.run(runSnapshotToRow(snapshot));
  }

  loadRunSnapshots(sessionId: string): StoredRunSnapshot[] {
    return this.stmts.selectRunSnapshots.all(sessionId).map(rowToRunSnapshot);
  }

  loadRunSnapshotsForRequests(
    sessionId: string,
    requestIds: readonly string[],
    throughRevision: number,
  ): StoredRunSnapshot[] {
    const encodedRequestIds = encodeRequestIdLookup(requestIds);
    if (!encodedRequestIds) return [];
    return this.stmts.selectRunSnapshotsForRequests
      .all(sessionId, throughRevision, encodedRequestIds, throughRevision)
      .map(rowToRunSnapshot);
  }

  loadRunSnapshotPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<StoredRunSnapshot> {
    const pageSize = assertAgentSessionRepositoryPageSize(request.pageSize);
    const rows = this.stmts.selectRunSnapshotPage.all(
      sessionId,
      request.after ?? -1,
      request.through,
      request.through,
      pageSize + 1,
    );
    const pageRows = rows.slice(0, pageSize);
    return {
      items: pageRows.map(rowToRunSnapshot),
      nextCursor: rows.length > pageSize ? pageRows.at(-1)?.history_sequence : undefined,
    };
  }

  loadRunningRunSnapshots(): StoredRunSnapshot[] {
    return this.stmts.selectRunningRunSnapshots.all().map(rowToRunSnapshot);
  }

  deleteRunSnapshotsFrom(sessionId: string, requestId: string): number {
    return this.stmts.deleteRunSnapshotsFrom.run(sessionId, sessionId, requestId, sessionId, sessionId, requestId)
      .changes;
  }

  upsertTurnPreparation(sessionId: string, requestId: string, snapshot: AgentTurnPreparationSnapshot): void {
    this.persistTurnPreparation(sessionId, requestId, snapshot, new Date().toISOString());
  }

  loadTurnPreparation(sessionId: string, requestId: string): AgentTurnPreparationSnapshot | undefined {
    const row = this.stmts.selectTurnPreparation.get(sessionId, requestId);
    return row ? parseTurnPreparation(row.snapshot_json) : undefined;
  }

  deleteTurnPreparationsFrom(sessionId: string, requestId: string): number {
    return this.stmts.deleteTurnPreparationsFrom.run(sessionId, sessionId, sessionId, requestId).changes;
  }

  appendRunEvent(sessionId: string, event: AgentEventEnvelope): void {
    this.appendRunEvents(sessionId, [event]);
  }

  appendRunEvents(sessionId: string, events: readonly AgentEventEnvelope[]): void {
    const append = this.db.transaction((batch: readonly AgentEventEnvelope[]) => {
      for (const event of batch) this.insertRunEvent(sessionId, event, event);
    });
    append(events);
  }

  loadRunEvents(sessionId: string): AgentEventEnvelope[] {
    return this.stmts.selectRunEvents.all(sessionId).flatMap(rowToStoredRunEvent);
  }

  loadRunEventsForRequest(sessionId: string, requestId: string): AgentEventEnvelope[] {
    return this.stmts.selectRunEventsForRequest.all(sessionId, requestId).flatMap(rowToStoredRunEvent);
  }

  loadRunEventPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<AgentEventEnvelope> {
    const pageSize = assertAgentSessionRepositoryPageSize(request.pageSize);
    const rows = this.stmts.selectRunEventPage.all(sessionId, request.after ?? 0, request.through, pageSize + 1);
    const pageRows = rows.slice(0, pageSize);
    return {
      items: pageRows.flatMap(rowToStoredRunEvent),
      nextCursor: rows.length > pageSize ? pageRows.at(-1)?.id : undefined,
    };
  }

  deleteRunEventsFrom(sessionId: string, requestId: string): number {
    this.stmts.deleteRunEventOutboxFrom.run(sessionId, sessionId, sessionId, requestId);
    return this.stmts.deleteRunEventsFrom.run(sessionId, sessionId, sessionId, requestId).changes;
  }

  deleteEntriesFrom(sessionId: string, requestId: string): number {
    return this.stmts.deleteFrom.run(sessionId, sessionId, requestId).changes;
  }

  deleteFromRequest(sessionId: string, requestId: string): number {
    this.deleteStepTracesFrom(sessionId, requestId);
    this.deleteRunEventsFrom(sessionId, requestId);
    this.deleteRunSnapshotsFrom(sessionId, requestId);
    this.deleteTurnPreparationsFrom(sessionId, requestId);
    return this.deleteEntriesFrom(sessionId, requestId);
  }

  private appendStepTrace(sessionId: string, requestId: string, turnSequence: number, trace: StepTrace): void {
    this.stmts.appendStepTrace.run({
      session_id: sessionId,
      request_id: requestId,
      turn_sequence: turnSequence,
      step: trace.step,
      seq: trace.seq,
      data: JSON.stringify(trace),
    });
  }

  private persistTurnPreparation(
    sessionId: string,
    requestId: string,
    snapshot: AgentTurnPreparationSnapshot,
    createdAt: string,
  ): void {
    this.stmts.upsertTurnPreparation.run({
      session_id: sessionId,
      request_id: requestId,
      snapshot_json: JSON.stringify(snapshot),
      created_at: createdAt,
    });
  }

  private insertRunEvent(sessionId: string, event: AgentEventEnvelope, storedEvent: AgentEventEnvelope): void {
    if (!event.requestId) return;
    this.stmts.appendRunEvent.run({
      session_id: sessionId,
      request_id: event.requestId,
      kind: event.kind,
      timestamp: event.timestamp,
      event_sequence: event.sequence,
      step: event.step ?? null,
      detail_id: event.detailId ?? null,
      event_id: resolveStoredEventId(event),
      reliability: "durable",
      event_json: JSON.stringify(storedEvent),
    });
  }
}

function parseTurnPreparation(snapshotJson: string): AgentTurnPreparationSnapshot | undefined {
  try {
    return parseAgentTurnPreparationSnapshot(parseJsonText(snapshotJson, "Turn preparation snapshot"));
  } catch {
    return undefined;
  }
}

function resolveStoredEventId(event: AgentEventEnvelope): string {
  if (event.eventId && event.eventId.trim().length > 0) return event.eventId;
  return `legacy:${event.sessionId ?? "global"}:${event.requestId ?? "unknown"}:${event.sequence}`;
}

function encodeRequestIdLookup(requestIds: readonly string[]): string | undefined {
  const normalized = normalizeAgentSessionRequestIds(requestIds);
  return normalized.length > 0 ? JSON.stringify(normalized) : undefined;
}

function rowToStoredRunEvent(row: { event_json: string; event_id: string }): AgentEventEnvelope[] {
  const event = parseStoredRunEvent(row.event_json);
  return event ? [{ ...event, eventId: event.eventId ?? row.event_id }] : [];
}
