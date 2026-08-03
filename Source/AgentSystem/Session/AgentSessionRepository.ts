import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentUserProfileRepository } from "../Session/AgentUserProfile.js";
import type { AgentModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentSession } from "./AgentSession.js";
import type { AgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import type { AgentSessionHistoryMutation } from "./AgentSessionHistoryMutation.js";
import type { AgentSessionForkMutation } from "./AgentSessionForkMutation.js";
import type {
  AgentSessionCommandAdmission,
  AgentSessionCommandDescriptor,
  AgentSessionCommandRecord,
} from "./AgentSessionCommand.js";

export interface StoredStepTraceRun {
  requestId: string;
  turnSequence: number;
  traces: StepTrace[];
}

export type StoredRunSnapshotStatus = "running" | "completed" | "failed" | "cancelled";

export interface StoredRunSnapshot {
  sessionId: string;
  requestId: string;
  input: string;
  status: StoredRunSnapshotStatus;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  errorMessage?: string;
  modelProvider?: AgentModelProviderMetadata;
}

export interface AgentSessionForkSnapshot {
  session: AgentSession;
  entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>;
  traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>;
  runSnapshots: readonly StoredRunSnapshot[];
  turnPreparations: ReadonlyArray<{
    requestId: string;
    snapshot: AgentTurnPreparationSnapshot;
  }>;
  runEvents: readonly AgentEventEnvelope[];
}

export type AgentSessionForkHistory = Omit<AgentSessionForkSnapshot, "session">;

export interface AgentSessionTurnCommit {
  sessionId: string;
  requestId: string;
  session?: AgentSession;
  entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>;
  traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>;
  snapshot: StoredRunSnapshot;
  runEvents: readonly AgentEventEnvelope[];
  commandId?: string;
}

export interface AgentSessionHistoryView {
  readonly session: AgentSession;
  readonly entryCount: number;
  readonly messageCount: number;
  readonly entryHighWaterMark?: number;
  readonly stepTraceHighWaterMark?: number;
  readonly runSnapshotHighWaterMark?: number;
  readonly runEventHighWaterMark?: number;
}

export interface AgentSessionCursorPageRequest {
  readonly after?: number;
  readonly through: number;
  readonly pageSize: number;
}

export interface AgentSessionCursorPage<T, TCursor = number> {
  readonly items: readonly T[];
  readonly nextCursor?: TCursor;
}

export interface AgentStepTraceCursor {
  readonly turnSequence: number;
  readonly requestId: string;
}

export interface AgentStepTracePageRequest {
  readonly after?: AgentStepTraceCursor;
  readonly throughRowId: number;
  readonly pageSize: number;
}

export type AgentSessionCatalogItem = AgentSession & {
  readonly entryCount: number;
  readonly messageCount: number;
};

export interface AgentSessionMetadataReader {
  listSessionMetadata(): AgentSession[];
  hasSession(sessionId: string): boolean;
  loadSession(sessionId: string): AgentSession | undefined;
}

export interface AgentSessionCatalogReader {
  listSessions(): AgentSessionCatalogItem[];
  loadFirstUserMessage(sessionId: string): AgentConversationEntry | undefined;
}

export interface AgentSessionPagedHistoryReader {
  captureHistorySnapshot(sessionId: string): AgentSessionHistoryView | undefined;
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
  loadEntryPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<AgentConversationEntry>;
  loadEntriesForRequests(
    sessionId: string,
    requestIds: readonly string[],
    throughSequence: number,
  ): AgentConversationEntry[];
  loadRunEventPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<AgentEventEnvelope>;
}

export interface AgentSessionFullHistoryReader {
  loadStepTraces(sessionId: string): StoredStepTraceRun[];
  loadRunSnapshots(sessionId: string): StoredRunSnapshot[];
  loadEntries(sessionId: string): AgentConversationEntry[];
  loadRunEvents(sessionId: string): AgentEventEnvelope[];
}

export interface AgentSessionRepository
  extends
    AgentUserProfileRepository,
    AgentSessionMetadataReader,
    AgentSessionCatalogReader,
    AgentSessionPagedHistoryReader,
    AgentSessionFullHistoryReader {
  listPendingHistoryMutations(): AgentSessionHistoryMutation[];
  loadPendingHistoryMutation(sessionId: string): AgentSessionHistoryMutation | undefined;
  stageHistoryMutation(mutation: AgentSessionHistoryMutation): void;
  commitHistoryMutation(mutationId: string, session: AgentSession): number;
  listPendingForkMutations(): AgentSessionForkMutation[];
  loadPendingForkMutation(targetSessionId: string): AgentSessionForkMutation | undefined;
  stageForkMutation(mutation: AgentSessionForkMutation): void;
  commitForkMutation(mutationId: string, snapshot: AgentSessionForkSnapshot): void;
  abortForkMutation(targetSessionId: string, mutationId: string): boolean;
  hasRequest(sessionId: string, requestId: string): boolean;
  loadRequestIdsFrom(sessionId: string, requestId: string): string[];
  loadForkHistoryThroughRequest(sessionId: string, requestId: string): AgentSessionForkHistory | undefined;
  createFork(snapshot: AgentSessionForkSnapshot): void;
  upsertSession(session: AgentSession): void;
  appendEntry(sessionId: string, entry: AgentConversationEntry, sequence: number): void;
  appendEntries(sessionId: string, entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>): void;
  persistTurnArtifacts(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
    traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>,
  ): void;
  persistTurnCommit(commit: AgentSessionTurnCommit): void;
  beginRun(command: AgentSessionCommandDescriptor, commit: AgentSessionTurnCommit): AgentSessionCommandAdmission;
  loadCommand(sessionId: string, commandId: string): AgentSessionCommandRecord | undefined;
  truncateFromRequest(sessionId: string, requestId: string): number;
  deleteStepTracesFrom(sessionId: string, requestId: string): number;
  upsertRunSnapshot(snapshot: StoredRunSnapshot): void;
  loadRunningRunSnapshots(): StoredRunSnapshot[];
  deleteRunSnapshotsFrom(sessionId: string, requestId: string): number;
  upsertTurnPreparation(sessionId: string, requestId: string, snapshot: AgentTurnPreparationSnapshot): void;
  loadTurnPreparation(sessionId: string, requestId: string): AgentTurnPreparationSnapshot | undefined;
  deleteTurnPreparationsFrom(sessionId: string, requestId: string): number;
  renameSession(sessionId: string, title: string): void;
  deleteSession(sessionId: string): boolean;
  deleteEntriesFrom(sessionId: string, requestId: string): number;
  appendRunEvent(sessionId: string, event: AgentEventEnvelope): void;
  appendRunEvents(sessionId: string, events: readonly AgentEventEnvelope[]): void;
  loadRunEventsForRequest(sessionId: string, requestId: string): AgentEventEnvelope[];
  deleteRunEventsFrom(sessionId: string, requestId: string): number;
  close(): void;
}
