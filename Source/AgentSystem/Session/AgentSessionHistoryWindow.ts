/** A transcript window contains whole requests, independently of Pi's model context. */
export interface AgentSessionHistoryWindow {
  readonly boundaryId?: string;
  readonly before?: string;
  readonly mode: "replace" | "prepend";
  readonly requestIds: string[];
}

export interface AgentSessionHistoryRequestPageInput {
  readonly entryHighWaterMark?: number;
  readonly runSnapshotHighWaterMark?: number;
  readonly fromRequestId?: string;
  readonly before?: string;
  readonly pageSize: number;
}

export interface AgentSessionHistoryRequestPage {
  readonly requestIds: readonly string[];
  readonly before?: string;
}

export interface AgentSessionHistoryRequestSummary {
  readonly requestId: string;
  readonly startedAt: string;
}

/** Match the transcript's durable start order, including runs without message entries. */
export function selectAgentSessionHistoryRequestPage(
  summaries: readonly AgentSessionHistoryRequestSummary[],
  request: AgentSessionHistoryRequestPageInput,
): AgentSessionHistoryRequestPage {
  const ordered = [...summaries].sort((a, b) =>
    a.startedAt < b.startedAt
      ? -1
      : a.startedAt > b.startedAt
        ? 1
        : a.requestId < b.requestId
          ? -1
          : a.requestId > b.requestId
            ? 1
            : 0,
  );
  const lower = request.fromRequestId ? ordered.findIndex((item) => item.requestId === request.fromRequestId) : 0;
  const upper = request.before ? ordered.findIndex((item) => item.requestId === request.before) : ordered.length;
  // An unresolvable native marker must not hide durable history.
  const start = Math.max(0, lower, upper - request.pageSize);
  const page = ordered.slice(start, Math.max(start, upper));
  return { requestIds: page.map((item) => item.requestId), before: start > 0 ? page[0]?.requestId : undefined };
}

export interface AgentSessionHistoryBoundary {
  readonly id: string;
  readonly firstKeptRequestId: string;
}
