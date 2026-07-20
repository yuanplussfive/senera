import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentUserProfileRepository } from "../Session/AgentUserProfile.js";
import type { AgentModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentSession } from "./AgentSession.js";
import type { AgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import type { AgentSessionHistoryMutation } from "./AgentSessionHistoryMutation.js";

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

export interface AgentSessionTurnCommit {
  sessionId: string;
  requestId: string;
  session?: AgentSession;
  entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>;
  traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>;
  snapshot: StoredRunSnapshot;
  runEvents: readonly AgentEventEnvelope[];
}

export interface AgentSessionRepository extends AgentUserProfileRepository {
  listSessions(): Array<AgentSession & { entryCount: number; messageCount: number }>;
  loadSession(sessionId: string): AgentSession | undefined;
  loadAll(): AgentSession[];
  listPendingHistoryMutations(): AgentSessionHistoryMutation[];
  loadPendingHistoryMutation(sessionId: string): AgentSessionHistoryMutation | undefined;
  stageHistoryMutation(mutation: AgentSessionHistoryMutation): void;
  commitHistoryMutation(mutationId: string, session: AgentSession): number;
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
  truncateFromRequest(sessionId: string, requestId: string): number;
  loadStepTraces(sessionId: string): StoredStepTraceRun[];
  deleteStepTracesFrom(sessionId: string, requestId: string): number;
  upsertRunSnapshot(snapshot: StoredRunSnapshot): void;
  loadRunSnapshots(sessionId: string): StoredRunSnapshot[];
  deleteRunSnapshotsFrom(sessionId: string, requestId: string): number;
  upsertTurnPreparation(sessionId: string, requestId: string, snapshot: AgentTurnPreparationSnapshot): void;
  loadTurnPreparation(sessionId: string, requestId: string): AgentTurnPreparationSnapshot | undefined;
  deleteTurnPreparationsFrom(sessionId: string, requestId: string): number;
  renameSession(sessionId: string, title: string): void;
  deleteSession(sessionId: string): boolean;
  loadEntries(sessionId: string): AgentConversationEntry[];
  deleteEntriesFrom(sessionId: string, requestId: string): number;
  appendRunEvent(sessionId: string, event: AgentEventEnvelope): void;
  appendRunEvents(sessionId: string, events: readonly AgentEventEnvelope[]): void;
  loadRunEvents(sessionId: string): AgentEventEnvelope[];
  deleteRunEventsFrom(sessionId: string, requestId: string): number;
  close(): void;
}
