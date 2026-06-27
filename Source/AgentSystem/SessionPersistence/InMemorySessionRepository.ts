import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "../AgentConversation.js";
import type { AgentEventEnvelope } from "../AgentEventBase.js";
import {
  createAgentUserProfile,
  createDefaultAgentUserProfile,
  type AgentUserProfile,
  type AgentUserProfileInput,
} from "../AgentUserProfile.js";
import type {
  AgentSessionRepository,
  StoredRunSnapshot,
  StoredStepTraceRun,
} from "../AgentSqliteSessionRepository.js";
import type { AgentSession } from "../AgentSession.js";
import type { StepTrace } from "../AgentStepTrace.js";

export class InMemorySessionRepository implements AgentSessionRepository {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly entries = new Map<string, AgentConversationEntry[]>();
  private readonly stepTraces = new Map<
    string,
    Array<{ requestId: string; turnSequence: number; trace: StepTrace }>
  >();
  private readonly runEvents = new Map<string, AgentEventEnvelope[]>();
  private readonly runSnapshots = new Map<string, Map<string, StoredRunSnapshot>>();
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

  loadEntries(sessionId: string): AgentConversationEntry[] {
    return [...(this.entries.get(sessionId) ?? [])];
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

  appendEntries(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
  ): void {
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

  renameSession(_sessionId: string, _title: string): void {}

  deleteSession(sessionId: string): boolean {
    const had = this.sessions.delete(sessionId);
    this.entries.delete(sessionId);
    this.stepTraces.delete(sessionId);
    this.runEvents.delete(sessionId);
    this.runSnapshots.delete(sessionId);
    return had;
  }

  appendRunEvent(sessionId: string, event: AgentEventEnvelope): void {
    const list = this.runEvents.get(sessionId) ?? [];
    list.push(event);
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
    const retained = events.filter((event) =>
      !event.requestId || !removedRequestIds.has(event.requestId));
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
