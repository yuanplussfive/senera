import type { AgentEventEnvelope } from "../AgentEventBase.js";
import type { StepTrace } from "../AgentStepTrace.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentUserProfileRepository } from "../AgentUserProfile.js";
import type { AgentModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentSession } from "./AgentSession.js";

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

export interface AgentSessionRepository extends AgentUserProfileRepository {
  listSessions(): Array<AgentSession & { entryCount: number; messageCount: number }>;
  loadSession(sessionId: string): AgentSession | undefined;
  loadAll(): AgentSession[];
  upsertSession(session: AgentSession): void;
  appendEntry(sessionId: string, entry: AgentConversationEntry, sequence: number): void;
  appendEntries(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
  ): void;
  persistTurnArtifacts(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
    traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>,
  ): void;
  loadStepTraces(sessionId: string): StoredStepTraceRun[];
  deleteStepTracesFrom(sessionId: string, requestId: string): number;
  upsertRunSnapshot(snapshot: StoredRunSnapshot): void;
  loadRunSnapshots(sessionId: string): StoredRunSnapshot[];
  deleteRunSnapshotsFrom(sessionId: string, requestId: string): number;
  renameSession(sessionId: string, title: string): void;
  deleteSession(sessionId: string): boolean;
  loadEntries(sessionId: string): AgentConversationEntry[];
  deleteEntriesFrom(sessionId: string, requestId: string): number;
  appendRunEvent(sessionId: string, event: AgentEventEnvelope): void;
  loadRunEvents(sessionId: string): AgentEventEnvelope[];
  deleteRunEventsFrom(sessionId: string, requestId: string): number;
  close(): void;
}
