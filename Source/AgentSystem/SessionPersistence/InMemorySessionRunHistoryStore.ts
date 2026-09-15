import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import type { AgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import {
  assertAgentSessionRepositoryPageSize,
  normalizeAgentSessionRequestIds,
} from "../Session/AgentSessionHistoryPaging.js";
import type {
  AgentSessionCursorPage,
  AgentSessionCursorPageRequest,
  StoredRunSnapshot,
} from "../Session/AgentSessionRepository.js";

interface RunSnapshotRevision {
  readonly revision: number;
  readonly historySequence: number;
  readonly deleted: boolean;
  readonly snapshot: StoredRunSnapshot;
}

export interface InMemorySessionForkRunHistory {
  readonly runSnapshots: ReadonlyArray<StoredRunSnapshot>;
  readonly turnPreparations: ReadonlyArray<{ requestId: string; snapshot: AgentTurnPreparationSnapshot }>;
  readonly runEvents: ReadonlyArray<AgentEventEnvelope>;
}

export class InMemorySessionRunHistoryStore {
  private readonly events = new Map<string, AgentEventEnvelope[]>();
  private readonly eventIds = new Map<string, Set<string>>();
  private readonly eventsByRequest = new Map<string, Map<string, AgentEventEnvelope[]>>();
  private readonly snapshots = new Map<string, Map<string, StoredRunSnapshot>>();
  private readonly snapshotHistorySequences = new Map<string, Map<string, number>>();
  private readonly snapshotRequestOrder = new Map<string, string[]>();
  private readonly snapshotRevisions = new Map<string, Map<string, RunSnapshotRevision[]>>();
  private readonly nextSnapshotHistorySequence = new Map<string, number>();
  private readonly nextSnapshotRevision = new Map<string, number>();
  private readonly preparations = new Map<string, Map<string, AgentTurnPreparationSnapshot>>();

  snapshotHighWaterMark(sessionId: string): number | undefined {
    const snapshots = this.snapshots.get(sessionId);
    return snapshots && snapshots.size > 0 ? this.nextSnapshotRevision.get(sessionId) : undefined;
  }

  eventHighWaterMark(sessionId: string): number | undefined {
    const count = this.events.get(sessionId)?.length ?? 0;
    return count > 0 ? count : undefined;
  }

  forkHistory(sessionId: string, requestIds: ReadonlySet<string>): InMemorySessionForkRunHistory {
    return {
      runSnapshots: [...(this.snapshots.get(sessionId)?.values() ?? [])]
        .filter((snapshot) => requestIds.has(snapshot.requestId))
        .map((snapshot) => structuredClone(snapshot))
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
      turnPreparations: [...(this.preparations.get(sessionId)?.entries() ?? [])]
        .filter(([requestId]) => requestIds.has(requestId))
        .map(([requestId, snapshot]) => ({ requestId, snapshot: structuredClone(snapshot) })),
      runEvents: (this.events.get(sessionId) ?? [])
        .filter((event) => event.requestId && requestIds.has(event.requestId))
        .map((event) => structuredClone(event)),
    };
  }

  installForkHistory(sessionId: string, history: InMemorySessionForkRunHistory): void {
    this.appendEvents(
      sessionId,
      history.runEvents.map((event) => structuredClone(event)),
    );
    for (const snapshot of history.runSnapshots) this.upsertSnapshot(structuredClone(snapshot));
    const preparations = new Map(
      history.turnPreparations.map(({ requestId, snapshot }) => [requestId, structuredClone(snapshot)]),
    );
    if (preparations.size > 0) this.preparations.set(sessionId, preparations);
  }

  upsertSnapshot(snapshot: StoredRunSnapshot): void {
    const snapshots = this.snapshots.get(snapshot.sessionId) ?? new Map<string, StoredRunSnapshot>();
    const current = snapshots.get(snapshot.requestId);
    const nextSnapshot = { ...snapshot, startedAt: current?.startedAt ?? snapshot.startedAt };
    snapshots.set(snapshot.requestId, nextSnapshot);
    this.snapshots.set(snapshot.sessionId, snapshots);
    const sequences = this.snapshotHistorySequences.get(snapshot.sessionId) ?? new Map<string, number>();
    let historySequence = sequences.get(snapshot.requestId);
    if (historySequence === undefined) {
      historySequence = this.nextSnapshotHistorySequence.get(snapshot.sessionId) ?? 0;
      this.nextSnapshotHistorySequence.set(snapshot.sessionId, historySequence + 1);
      sequences.set(snapshot.requestId, historySequence);
      const order = this.snapshotRequestOrder.get(snapshot.sessionId) ?? [];
      order[historySequence] = snapshot.requestId;
      this.snapshotRequestOrder.set(snapshot.sessionId, order);
      this.snapshotHistorySequences.set(snapshot.sessionId, sequences);
    }
    this.appendSnapshotRevision(snapshot.sessionId, nextSnapshot, historySequence, false);
  }

  loadSnapshots(sessionId: string): StoredRunSnapshot[] {
    const snapshots = this.snapshots.get(sessionId);
    return snapshots ? Array.from(snapshots.values(), (snapshot) => ({ ...snapshot })) : [];
  }

  loadSnapshotsForRequests(
    sessionId: string,
    requestIds: readonly string[],
    throughRevision: number,
  ): StoredRunSnapshot[] {
    const revisions = this.snapshotRevisions.get(sessionId);
    if (!revisions) return [];
    return normalizeAgentSessionRequestIds(requestIds)
      .flatMap((requestId) => {
        const revision = findSnapshotRevision(revisions.get(requestId), throughRevision);
        return revision && !revision.deleted ? [revision] : [];
      })
      .sort((left, right) => left.historySequence - right.historySequence)
      .map((revision) => ({ ...revision.snapshot }));
  }

  loadSnapshotPage(
    sessionId: string,
    request: AgentSessionCursorPageRequest,
  ): AgentSessionCursorPage<StoredRunSnapshot> {
    const pageSize = assertAgentSessionRepositoryPageSize(request.pageSize);
    const start = (request.after ?? -1) + 1;
    const order = this.snapshotRequestOrder.get(sessionId) ?? [];
    const revisions = this.snapshotRevisions.get(sessionId);
    const rows: RunSnapshotRevision[] = [];
    for (let sequence = start; sequence < order.length && rows.length <= pageSize; sequence += 1) {
      const requestId = order[sequence];
      if (!requestId) continue;
      const revision = findSnapshotRevision(revisions?.get(requestId), request.through);
      if (revision && !revision.deleted && revision.historySequence === sequence) rows.push(revision);
    }
    return {
      items: rows.slice(0, pageSize).map((revision) => ({ ...revision.snapshot })),
      nextCursor: rows.length > pageSize ? rows[pageSize - 1]?.historySequence : undefined,
    };
  }

  loadRunningSnapshots(): StoredRunSnapshot[] {
    const running: StoredRunSnapshot[] = [];
    for (const snapshots of this.snapshots.values()) {
      for (const snapshot of snapshots.values()) {
        if (snapshot.status === "running") running.push({ ...snapshot });
      }
    }
    return running;
  }

  deleteSnapshotsFrom(sessionId: string, requestId: string, requestIdsFromAnchor: ReadonlySet<string>): number {
    const snapshots = this.snapshots.get(sessionId);
    if (!snapshots) return 0;
    const snapshotOrder = [...snapshots.keys()];
    const anchorIndex = snapshotOrder.indexOf(requestId);
    const snapshotIdsFromAnchor = new Set(anchorIndex >= 0 ? snapshotOrder.slice(anchorIndex) : []);
    let removed = 0;
    for (const snapshot of Array.from(snapshots.values())) {
      if (!snapshotIdsFromAnchor.has(snapshot.requestId) && !requestIdsFromAnchor.has(snapshot.requestId)) continue;
      const historySequence = this.snapshotHistorySequences.get(sessionId)?.get(snapshot.requestId);
      if (historySequence !== undefined) {
        this.appendSnapshotRevision(sessionId, snapshot, historySequence, true);
        this.snapshotHistorySequences.get(sessionId)?.delete(snapshot.requestId);
      }
      snapshots.delete(snapshot.requestId);
      removed += 1;
    }
    if (snapshots.size === 0) this.snapshots.delete(sessionId);
    else this.snapshots.set(sessionId, snapshots);
    return removed;
  }

  upsertPreparation(sessionId: string, requestId: string, snapshot: AgentTurnPreparationSnapshot): void {
    const preparations = this.preparations.get(sessionId) ?? new Map<string, AgentTurnPreparationSnapshot>();
    preparations.set(requestId, structuredClone(snapshot));
    this.preparations.set(sessionId, preparations);
  }

  loadPreparation(sessionId: string, requestId: string): AgentTurnPreparationSnapshot | undefined {
    const snapshot = this.preparations.get(sessionId)?.get(requestId);
    return snapshot ? structuredClone(snapshot) : undefined;
  }

  deletePreparations(sessionId: string, requestIds: ReadonlySet<string>): number {
    const preparations = this.preparations.get(sessionId);
    if (!preparations) return 0;
    let removed = 0;
    for (const requestId of requestIds) removed += Number(preparations.delete(requestId));
    if (preparations.size === 0) this.preparations.delete(sessionId);
    return removed;
  }

  appendEvent(sessionId: string, event: AgentEventEnvelope): void {
    this.appendEvents(sessionId, [event]);
  }

  appendEvents(sessionId: string, events: readonly AgentEventEnvelope[]): void {
    if (events.length === 0) return;
    const list = this.events.get(sessionId) ?? [];
    const eventIds = this.eventIds.get(sessionId) ?? new Set<string>();
    const byRequest = this.eventsByRequest.get(sessionId) ?? new Map<string, AgentEventEnvelope[]>();
    for (const event of events) {
      const eventId = resolveStoredEventId(sessionId, event);
      if (eventIds.has(eventId)) continue;
      list.push(event);
      eventIds.add(eventId);
      if (event.requestId) {
        const requestEvents = byRequest.get(event.requestId) ?? [];
        requestEvents.push(event);
        byRequest.set(event.requestId, requestEvents);
      }
    }
    this.events.set(sessionId, list);
    this.eventIds.set(sessionId, eventIds);
    this.eventsByRequest.set(sessionId, byRequest);
  }

  loadEvents(sessionId: string): AgentEventEnvelope[] {
    return [...(this.events.get(sessionId) ?? [])];
  }

  loadEventsForRequest(sessionId: string, requestId: string): AgentEventEnvelope[] {
    return [...(this.eventsByRequest.get(sessionId)?.get(requestId) ?? [])];
  }

  loadEventPage(sessionId: string, request: AgentSessionCursorPageRequest): AgentSessionCursorPage<AgentEventEnvelope> {
    const pageSize = assertAgentSessionRepositoryPageSize(request.pageSize);
    const start = request.after ?? 0;
    const events = this.events.get(sessionId) ?? [];
    const rows = events.slice(start, Math.min(request.through, start + pageSize + 1));
    return {
      items: rows.slice(0, pageSize),
      nextCursor: rows.length > pageSize ? start + pageSize : undefined,
    };
  }

  deleteEvents(sessionId: string, requestIds: ReadonlySet<string>): number {
    const events = this.events.get(sessionId) ?? [];
    const retained = events.filter((event) => !event.requestId || !requestIds.has(event.requestId));
    this.installEvents(sessionId, retained);
    return events.length - retained.length;
  }

  deleteSession(sessionId: string): void {
    this.events.delete(sessionId);
    this.eventIds.delete(sessionId);
    this.eventsByRequest.delete(sessionId);
    this.snapshots.delete(sessionId);
    this.snapshotHistorySequences.delete(sessionId);
    this.snapshotRequestOrder.delete(sessionId);
    this.snapshotRevisions.delete(sessionId);
    this.nextSnapshotHistorySequence.delete(sessionId);
    this.nextSnapshotRevision.delete(sessionId);
    this.preparations.delete(sessionId);
  }

  private appendSnapshotRevision(
    sessionId: string,
    snapshot: StoredRunSnapshot,
    historySequence: number,
    deleted: boolean,
  ): void {
    const revision = (this.nextSnapshotRevision.get(sessionId) ?? 0) + 1;
    this.nextSnapshotRevision.set(sessionId, revision);
    const byRequest = this.snapshotRevisions.get(sessionId) ?? new Map<string, RunSnapshotRevision[]>();
    const revisions = byRequest.get(snapshot.requestId) ?? [];
    revisions.push({ revision, historySequence, deleted, snapshot: structuredClone(snapshot) });
    byRequest.set(snapshot.requestId, revisions);
    this.snapshotRevisions.set(sessionId, byRequest);
  }

  private installEvents(sessionId: string, events: AgentEventEnvelope[]): void {
    this.events.delete(sessionId);
    this.eventIds.delete(sessionId);
    this.eventsByRequest.delete(sessionId);
    this.appendEvents(sessionId, events);
  }
}

function resolveStoredEventId(sessionId: string, event: AgentEventEnvelope): string {
  if (event.eventId && event.eventId.trim().length > 0) return event.eventId;
  return `legacy:${event.sessionId ?? sessionId}:${event.requestId ?? "unknown"}:${event.sequence}`;
}

function findSnapshotRevision(
  revisions: readonly RunSnapshotRevision[] | undefined,
  throughRevision: number,
): RunSnapshotRevision | undefined {
  if (!revisions || revisions.length === 0) return undefined;
  let low = 0;
  let high = revisions.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const revision = revisions[middle];
    if (revision && revision.revision <= throughRevision) low = middle + 1;
    else high = middle;
  }
  return low > 0 ? revisions[low - 1] : undefined;
}
