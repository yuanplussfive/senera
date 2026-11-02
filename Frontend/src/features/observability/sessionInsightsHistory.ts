import { readSessionInsightsPage } from "../../api/sessionInsightsClient";
import type { RunRecord } from "../../store/session/types";
import { scheduleIdleTask } from "../../shared/scheduling/scheduleIdleTask";
import { appendInsightHistory } from "./sessionInsightsModel";

export interface InsightHistoryCheckpoint {
  readonly runs: ReadonlyMap<string, RunRecord>;
  /** Last scanned event, including events which have no analytics projection. */
  readonly cursor?: number;
  readonly through?: number;
  readonly complete: boolean;
}

export const EmptyInsightHistory: InsightHistoryCheckpoint = { runs: new Map(), complete: false };

/** Resume interrupted pages within their original snapshot, then catch up on events written while away. */
export async function loadInsightHistory(
  baseUrl: string,
  sessionId: string,
  checkpoint: InsightHistoryCheckpoint,
  { signal, onPage }: { signal: AbortSignal; onPage: (checkpoint: InsightHistoryCheckpoint) => void },
): Promise<void> {
  let current = checkpoint;
  let catchUp = !checkpoint.complete && checkpoint.through !== undefined;
  for (;;) {
    signal.throwIfAborted();
    const page = await readSessionInsightsPage(baseUrl, sessionId, {
      after: current.cursor,
      through: current.complete ? undefined : current.through,
      signal,
    });
    signal.throwIfAborted();
    if (current.cursor !== undefined && page.through < current.cursor) {
      // The server's retained stream was shortened; its old cursor is no longer valid.
      current = EmptyInsightHistory;
      catchUp = false;
      continue;
    }
    if (page.nextCursor !== undefined && page.nextCursor <= (current.cursor ?? -1))
      throw new Error("Invalid insights cursor");
    const previous = current;
    current = await new Promise<InsightHistoryCheckpoint>((resolve, reject) => {
      const onAbort = () => {
        cancel();
        reject(signal.reason);
      };
      // Network/JSON parsing and projection get separate turns on the UI thread.
      const cancel = scheduleIdleTask(
        () => {
          signal.removeEventListener("abort", onAbort);
          try {
            signal.throwIfAborted();
            resolve({
              runs: appendInsightHistory(previous.runs, page.events),
              cursor: page.nextCursor ?? page.through,
              through: page.through,
              complete: page.nextCursor === undefined,
            });
          } catch (error) {
            reject(error);
          }
        },
        { priority: "user-visible" },
      );
      signal.addEventListener("abort", onAbort, { once: true });
    });
    signal.throwIfAborted();
    onPage(current);
    if (current.complete) {
      if (!catchUp) return;
      catchUp = false;
    }
  }
}
