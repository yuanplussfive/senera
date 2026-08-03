import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import {
  assertAgentSessionRepositoryPageSize,
  normalizeAgentSessionRequestIds,
} from "../Session/AgentSessionHistoryPaging.js";
import type {
  AgentSessionCursorPage,
  AgentStepTraceCursor,
  AgentStepTracePageRequest,
  StoredStepTraceRun,
} from "../Session/AgentSessionRepository.js";

interface IndexedStepTrace {
  readonly rowId: number;
  readonly requestId: string;
  readonly turnSequence: number;
  readonly trace: StepTrace;
}

interface IndexedStepTraceRun {
  readonly requestId: string;
  readonly turnSequence: number;
  readonly traces: IndexedStepTrace[];
}

export class InMemorySessionTraceStore {
  private readonly traces = new Map<string, IndexedStepTrace[]>();
  private readonly runs = new Map<string, Map<string, IndexedStepTraceRun>>();
  private readonly runOrder = new Map<string, IndexedStepTraceRun[]>();
  private readonly firstRowByRequest = new Map<string, Map<string, number>>();
  private readonly traceIds = new Map<string, Set<string>>();
  private readonly nextRowId = new Map<string, number>();

  highWaterMark(sessionId: string): number | undefined {
    return (this.traces.get(sessionId)?.length ?? 0) > 0 ? this.nextRowId.get(sessionId) : undefined;
  }

  forkItems(
    sessionId: string,
    requestIds: ReadonlySet<string>,
  ): Array<{ requestId: string; turnSequence: number; trace: StepTrace }> {
    return (this.traces.get(sessionId) ?? [])
      .filter((item) => requestIds.has(item.requestId))
      .map(({ requestId, turnSequence, trace }) => ({
        requestId,
        turnSequence,
        trace: structuredClone(trace),
      }));
  }

  append(
    sessionId: string,
    traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>,
  ): void {
    if (traces.length === 0) return;
    const list = this.traces.get(sessionId) ?? [];
    const ids = this.traceIds.get(sessionId) ?? new Set<string>();
    let rowId = this.nextRowId.get(sessionId) ?? 0;
    for (const trace of traces) {
      const identity = stepTraceIdentity(trace);
      if (ids.has(identity)) continue;
      ids.add(identity);
      rowId += 1;
      const indexed = { ...trace, rowId };
      list.push(indexed);
      this.index(sessionId, indexed);
    }
    this.traces.set(sessionId, list);
    this.traceIds.set(sessionId, ids);
    this.nextRowId.set(sessionId, rowId);
  }

  load(sessionId: string): StoredStepTraceRun[] {
    const byRequest = new Map<string, StoredStepTraceRun>();
    for (const { requestId, turnSequence, trace } of this.traces.get(sessionId) ?? []) {
      const run = byRequest.get(requestId) ?? { requestId, turnSequence, traces: [] };
      run.traces.push(trace);
      byRequest.set(requestId, run);
    }
    return Array.from(byRequest.values())
      .map((run) => ({
        ...run,
        traces: [...run.traces].sort((left, right) => left.step - right.step || left.seq - right.seq),
      }))
      .sort((left, right) => left.turnSequence - right.turnSequence);
  }

  loadPage(
    sessionId: string,
    request: AgentStepTracePageRequest,
  ): AgentSessionCursorPage<StoredStepTraceRun, AgentStepTraceCursor> {
    const pageSize = assertAgentSessionRepositoryPageSize(request.pageSize);
    const orderedRuns = this.runOrder.get(sessionId) ?? [];
    const start = findFirstRunAfter(orderedRuns, request.after);
    const runs: StoredStepTraceRun[] = [];
    for (let index = start; index < orderedRuns.length && runs.length <= pageSize; index += 1) {
      const run = orderedRuns[index];
      if (!run) continue;
      const traces = run.traces
        .filter((item) => item.rowId <= request.throughRowId)
        .map((item) => item.trace)
        .sort((left, right) => left.step - right.step || left.seq - right.seq);
      if (traces.length > 0) runs.push({ requestId: run.requestId, turnSequence: run.turnSequence, traces });
    }
    const items = runs.slice(0, pageSize);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        runs.length > pageSize && last ? { turnSequence: last.turnSequence, requestId: last.requestId } : undefined,
    };
  }

  loadRequestIds(sessionId: string, requestIds: readonly string[], throughRowId: number): string[] {
    const firstRows = this.firstRowByRequest.get(sessionId);
    if (!firstRows) return [];
    return normalizeAgentSessionRequestIds(requestIds).filter(
      (requestId) => (firstRows.get(requestId) ?? Number.POSITIVE_INFINITY) <= throughRowId,
    );
  }

  deleteFromSequence(sessionId: string, anchorSequence: number | undefined): number {
    const list = this.traces.get(sessionId);
    if (!list || anchorSequence === undefined) return 0;
    const kept = list.filter((item) => item.turnSequence < anchorSequence);
    const removed = list.length - kept.length;
    this.install(sessionId, kept);
    return removed;
  }

  deleteSession(sessionId: string): void {
    this.traces.delete(sessionId);
    this.runs.delete(sessionId);
    this.runOrder.delete(sessionId);
    this.firstRowByRequest.delete(sessionId);
    this.traceIds.delete(sessionId);
    this.nextRowId.delete(sessionId);
  }

  private install(sessionId: string, traces: IndexedStepTrace[]): void {
    this.runs.delete(sessionId);
    this.runOrder.delete(sessionId);
    this.firstRowByRequest.delete(sessionId);
    this.traceIds.delete(sessionId);
    this.traces.set(sessionId, traces);
    const ids = new Set<string>();
    for (const trace of traces) {
      ids.add(stepTraceIdentity(trace));
      this.index(sessionId, trace);
    }
    this.traceIds.set(sessionId, ids);
  }

  private index(sessionId: string, trace: IndexedStepTrace): void {
    const runs = this.runs.get(sessionId) ?? new Map<string, IndexedStepTraceRun>();
    const key = `${trace.turnSequence}:${trace.requestId}`;
    const current = runs.get(key);
    if (current) {
      current.traces.push(trace);
    } else {
      const run = { requestId: trace.requestId, turnSequence: trace.turnSequence, traces: [trace] };
      runs.set(key, run);
      const order = this.runOrder.get(sessionId) ?? [];
      order.splice(findRunInsertionIndex(order, run), 0, run);
      this.runOrder.set(sessionId, order);
    }
    this.runs.set(sessionId, runs);

    const firstRows = this.firstRowByRequest.get(sessionId) ?? new Map<string, number>();
    const firstRow = firstRows.get(trace.requestId);
    if (firstRow === undefined || trace.rowId < firstRow) firstRows.set(trace.requestId, trace.rowId);
    this.firstRowByRequest.set(sessionId, firstRows);
  }
}

function stepTraceIdentity(trace: Pick<IndexedStepTrace, "requestId" | "trace">): string {
  return `${trace.requestId}:${trace.trace.step}:${trace.trace.seq}`;
}

function findFirstRunAfter(runs: readonly IndexedStepTraceRun[], cursor: AgentStepTraceCursor | undefined): number {
  if (!cursor) return 0;
  let low = 0;
  let high = runs.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const run = runs[middle];
    if (run && compareRuns(run, cursor) <= 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

function findRunInsertionIndex(
  runs: readonly IndexedStepTraceRun[],
  incoming: Pick<IndexedStepTraceRun, "turnSequence" | "requestId">,
): number {
  let low = 0;
  let high = runs.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const run = runs[middle];
    if (run && compareRuns(run, incoming) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

function compareRuns(
  left: Pick<IndexedStepTraceRun, "turnSequence" | "requestId">,
  right: Pick<IndexedStepTraceRun, "turnSequence" | "requestId">,
): number {
  return left.turnSequence - right.turnSequence || left.requestId.localeCompare(right.requestId);
}
