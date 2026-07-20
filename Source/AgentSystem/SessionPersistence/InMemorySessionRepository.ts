import { AgentConversationEntryKinds, type AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import {
  createAgentUserProfile,
  createDefaultAgentUserProfile,
  type AgentUserProfile,
  type AgentUserProfileInput,
} from "../Session/AgentUserProfile.js";
import type {
  AgentSessionRepository,
  AgentSessionForkSnapshot,
  AgentSessionTurnCommit,
  StoredRunSnapshot,
  StoredStepTraceRun,
} from "../Session/AgentSessionRepository.js";
import type { AgentSession } from "../Session/AgentSession.js";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import type { AgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import type { AgentSessionHistoryMutation } from "../Session/AgentSessionHistoryMutation.js";

export class InMemorySessionRepository implements AgentSessionRepository {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly entries = new Map<string, AgentConversationEntry[]>();
  private readonly stepTraces = new Map<string, Array<{ requestId: string; turnSequence: number; trace: StepTrace }>>();
  private readonly runEvents = new Map<string, AgentEventEnvelope[]>();
  private readonly runSnapshots = new Map<string, Map<string, StoredRunSnapshot>>();
  private readonly turnPreparations = new Map<string, Map<string, AgentTurnPreparationSnapshot>>();
  private readonly historyMutations = new Map<string, AgentSessionHistoryMutation>();
  private userProfile = createDefaultAgentUserProfile();

  listSessions(): Array<AgentSession & { entryCount: number; messageCount: number }> {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((s) => {
        const list = this.entries.get(s.id) ?? [];
        return {
          ...s,
          conversation: [],
          entryCount: list.length,
          messageCount: list.filter(
            (e) =>
              e.kind === AgentConversationEntryKinds.UserMessage ||
              e.kind === AgentConversationEntryKinds.AssistantDecision,
          ).length,
        };
      });
  }

  loadSession(sessionId: string): AgentSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return { ...session, conversation: [...(this.entries.get(sessionId) ?? [])] };
  }

  loadAll(): AgentSession[] {
    return Array.from(this.sessions.values()).map((s) => ({
      ...s,
      conversation: [...(this.entries.get(s.id) ?? [])],
    }));
  }

  listPendingHistoryMutations(): AgentSessionHistoryMutation[] {
    return [...this.historyMutations.values()]
      .map((mutation) => structuredClone(mutation))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  loadPendingHistoryMutation(sessionId: string): AgentSessionHistoryMutation | undefined {
    const mutation = this.historyMutations.get(sessionId);
    return mutation ? structuredClone(mutation) : undefined;
  }

  stageHistoryMutation(mutation: AgentSessionHistoryMutation): void {
    if (this.historyMutations.has(mutation.sessionId)) {
      throw new Error(`Session already has a pending history mutation: ${mutation.sessionId}`);
    }
    this.historyMutations.set(mutation.sessionId, structuredClone(mutation));
  }

  commitHistoryMutation(mutationId: string, session: AgentSession): number {
    const mutation = this.historyMutations.get(session.id);
    if (!mutation || mutation.mutationId !== mutationId) {
      throw new Error(`Pending session history mutation does not match: ${session.id}`);
    }

    this.deleteStepTracesFrom(session.id, mutation.fromRequestId);
    this.deleteRunEventsFrom(session.id, mutation.fromRequestId);
    this.deleteRunSnapshotsFrom(session.id, mutation.fromRequestId);
    this.deleteTurnPreparationsFrom(session.id, mutation.fromRequestId);
    const removed = this.deleteEntriesFrom(session.id, mutation.fromRequestId);
    this.upsertSession(session);
    this.historyMutations.delete(session.id);
    return removed;
  }

  loadEntries(sessionId: string): AgentConversationEntry[] {
    return [...(this.entries.get(sessionId) ?? [])];
  }

  createFork(snapshot: AgentSessionForkSnapshot): void {
    const sessionId = snapshot.session.id;
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session fork target already exists: ${sessionId}`);
    }

    const session = structuredClone({ ...snapshot.session, conversation: [] });
    const entries = snapshot.entries.map(({ entry }) => structuredClone(entry));
    const traces = snapshot.traces.map((item) => structuredClone(item));
    const events = snapshot.runEvents.map((event) => structuredClone(event));
    const runSnapshots = new Map(
      snapshot.runSnapshots.map((runSnapshot) => [runSnapshot.requestId, structuredClone(runSnapshot)]),
    );
    const turnPreparations = new Map(
      snapshot.turnPreparations.map(({ requestId, snapshot: preparation }) => [
        requestId,
        structuredClone(preparation),
      ]),
    );

    this.sessions.set(sessionId, session);
    this.entries.set(sessionId, entries);
    if (traces.length > 0) this.stepTraces.set(sessionId, traces);
    if (events.length > 0) this.runEvents.set(sessionId, events);
    if (runSnapshots.size > 0) this.runSnapshots.set(sessionId, runSnapshots);
    if (turnPreparations.size > 0) this.turnPreparations.set(sessionId, turnPreparations);
  }

  upsertSession(session: AgentSession): void {
    this.sessions.set(session.id, { ...session, conversation: [] });
  }

  appendEntry(sessionId: string, entry: AgentConversationEntry): void {
    const list = this.entries.get(sessionId) ?? [];
    if (list.some((e) => e.id === entry.id)) return;
    list.push(entry);
    this.entries.set(sessionId, list);
  }

  appendEntries(sessionId: string, entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>): void {
    for (const { entry } of entries) this.appendEntry(sessionId, entry);
  }

  persistTurnArtifacts(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
    traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>,
  ): void {
    for (const { entry } of entries) this.appendEntry(sessionId, entry);
    if (traces.length > 0) {
      const list = this.stepTraces.get(sessionId) ?? [];
      list.push(...traces);
      this.stepTraces.set(sessionId, list);
    }
  }

  persistTurnCommit(commit: AgentSessionTurnCommit): void {
    if (commit.session) this.upsertSession(commit.session);
    this.persistTurnArtifacts(commit.sessionId, commit.entries, commit.traces);
    this.upsertRunSnapshot(commit.snapshot);
    this.appendRunEvents(commit.sessionId, commit.runEvents);
  }

  truncateFromRequest(sessionId: string, requestId: string): number {
    this.deleteStepTracesFrom(sessionId, requestId);
    this.deleteRunEventsFrom(sessionId, requestId);
    this.deleteRunSnapshotsFrom(sessionId, requestId);
    this.deleteTurnPreparationsFrom(sessionId, requestId);
    return this.deleteEntriesFrom(sessionId, requestId);
  }

  loadStepTraces(sessionId: string): StoredStepTraceRun[] {
    const list = this.stepTraces.get(sessionId) ?? [];
    const byRequest = new Map<string, StoredStepTraceRun>();
    for (const { requestId, turnSequence, trace } of list) {
      let run = byRequest.get(requestId);
      if (!run) {
        run = { requestId, turnSequence, traces: [] };
        byRequest.set(requestId, run);
      }
      run.traces.push(trace);
    }
    return Array.from(byRequest.values())
      .map((run) => ({
        ...run,
        traces: [...run.traces].sort((a, b) => a.step - b.step || a.seq - b.seq),
      }))
      .sort((a, b) => a.turnSequence - b.turnSequence);
  }

  deleteStepTracesFrom(sessionId: string, requestId: string): number {
    const list = this.stepTraces.get(sessionId);
    if (!list) return 0;
    const entries = this.entries.get(sessionId) ?? [];
    const anchorSequence = entries.findIndex((entry) => entry.requestId === requestId);
    if (anchorSequence < 0) return 0;
    const kept = list.filter((item) => item.turnSequence < anchorSequence);
    const removed = list.length - kept.length;
    this.stepTraces.set(sessionId, kept);
    return removed;
  }

  upsertRunSnapshot(snapshot: StoredRunSnapshot): void {
    const snapshots = this.runSnapshots.get(snapshot.sessionId) ?? new Map<string, StoredRunSnapshot>();
    snapshots.set(snapshot.requestId, { ...snapshot });
    this.runSnapshots.set(snapshot.sessionId, snapshots);
  }

  loadRunSnapshots(sessionId: string): StoredRunSnapshot[] {
    const snapshots = this.runSnapshots.get(sessionId);
    if (!snapshots) return [];
    return Array.from(snapshots.values())
      .map((snapshot) => ({ ...snapshot }))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  deleteRunSnapshotsFrom(sessionId: string, requestId: string): number {
    const snapshots = this.runSnapshots.get(sessionId);
    if (!snapshots) return 0;
    const anchorSnapshot = snapshots.get(requestId);
    const entries = this.entries.get(sessionId) ?? [];
    const anchorSequence = entries.findIndex((entry) => entry.requestId === requestId);
    const requestIdsFromAnchor = new Set(
      anchorSequence >= 0 ? entries.slice(anchorSequence).map((entry) => entry.requestId) : [],
    );

    let removed = 0;
    for (const snapshot of Array.from(snapshots.values())) {
      const shouldDelete =
        (anchorSnapshot && snapshot.startedAt >= anchorSnapshot.startedAt) ||
        requestIdsFromAnchor.has(snapshot.requestId);
      if (shouldDelete) {
        snapshots.delete(snapshot.requestId);
        removed += 1;
      }
    }
    if (snapshots.size === 0) {
      this.runSnapshots.delete(sessionId);
    } else {
      this.runSnapshots.set(sessionId, snapshots);
    }
    return removed;
  }

  upsertTurnPreparation(sessionId: string, requestId: string, snapshot: AgentTurnPreparationSnapshot): void {
    const preparations = this.turnPreparations.get(sessionId) ?? new Map<string, AgentTurnPreparationSnapshot>();
    preparations.set(requestId, structuredClone(snapshot));
    this.turnPreparations.set(sessionId, preparations);
  }

  loadTurnPreparation(sessionId: string, requestId: string): AgentTurnPreparationSnapshot | undefined {
    const snapshot = this.turnPreparations.get(sessionId)?.get(requestId);
    return snapshot ? structuredClone(snapshot) : undefined;
  }

  deleteTurnPreparationsFrom(sessionId: string, requestId: string): number {
    const preparations = this.turnPreparations.get(sessionId);
    if (!preparations) return 0;
    const entries = this.entries.get(sessionId) ?? [];
    const anchor = entries.findIndex((entry) => entry.requestId === requestId);
    if (anchor < 0) return 0;
    const removedRequestIds = new Set(entries.slice(anchor).map((entry) => entry.requestId));
    let removed = 0;
    for (const removedRequestId of removedRequestIds) {
      removed += Number(preparations.delete(removedRequestId));
    }
    if (preparations.size === 0) this.turnPreparations.delete(sessionId);
    return removed;
  }

  renameSession(_sessionId: string, _title: string): void {}

  deleteSession(sessionId: string): boolean {
    const had = this.sessions.delete(sessionId);
    this.entries.delete(sessionId);
    this.stepTraces.delete(sessionId);
    this.runEvents.delete(sessionId);
    this.runSnapshots.delete(sessionId);
    this.turnPreparations.delete(sessionId);
    this.historyMutations.delete(sessionId);
    return had;
  }

  appendRunEvent(sessionId: string, event: AgentEventEnvelope): void {
    this.appendRunEvents(sessionId, [event]);
  }

  appendRunEvents(sessionId: string, events: readonly AgentEventEnvelope[]): void {
    if (events.length === 0) return;
    const list = this.runEvents.get(sessionId) ?? [];
    const eventIds = new Set(list.flatMap((event) => (event.eventId ? [event.eventId] : [])));
    for (const event of events) {
      if (event.eventId && eventIds.has(event.eventId)) continue;
      list.push(event);
      if (event.eventId) eventIds.add(event.eventId);
    }
    this.runEvents.set(sessionId, list);
  }

  loadRunEvents(sessionId: string): AgentEventEnvelope[] {
    return [...(this.runEvents.get(sessionId) ?? [])];
  }

  deleteRunEventsFrom(sessionId: string, requestId: string): number {
    const entries = this.entries.get(sessionId) ?? [];
    const idx = entries.findIndex((entry) => entry.requestId === requestId);
    if (idx < 0) return 0;

    const removedRequestIds = new Set(entries.slice(idx).map((entry) => entry.requestId));
    const events = this.runEvents.get(sessionId) ?? [];
    const retained = events.filter((event) => !event.requestId || !removedRequestIds.has(event.requestId));
    this.runEvents.set(sessionId, retained);
    return events.length - retained.length;
  }

  deleteEntriesFrom(sessionId: string, requestId: string): number {
    const list = this.entries.get(sessionId);
    if (!list) return 0;
    const idx = list.findIndex((e) => e.requestId === requestId);
    if (idx < 0) return 0;
    const removed = list.length - idx;
    this.entries.set(sessionId, list.slice(0, idx));
    return removed;
  }

  loadUserProfile(): AgentUserProfile {
    return this.userProfile;
  }

  saveUserProfile(profile: AgentUserProfileInput): AgentUserProfile {
    this.userProfile = createAgentUserProfile(profile);
    return this.userProfile;
  }

  close(): void {}
}
