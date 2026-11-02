import { useEffect, useMemo, useRef } from "react";
import type { SocketStatus } from "../api/useAgentSocket";
import type { WsRequest } from "../api/eventTypes";
import { readActiveRun, useStore, type RunRecord, type SessionRecord } from "../store/sessionStore";

const RunHistoryDetailLoadPolicy = Object.freeze({
  timeoutMs: 30_000,
});

type RunHistoryDetailCandidate = {
  readonly sessionId: string;
  readonly requestId: string;
  readonly state: "loading" | "loaded" | undefined;
};

export interface UseRunHistoryDetailRecoveryOptions {
  readonly activeSessionId: string | null;
  readonly visible: boolean;
  readonly send: (request: WsRequest) => boolean;
  readonly status: SocketStatus;
}

/**
 * The transcript replay intentionally omits completed raw event streams.
 * Restore only the one run currently visible in the workflow surface, so a
 * long conversation cannot monopolize the wire or the main thread on open.
 */
export function useRunHistoryDetailRecovery({
  activeSessionId,
  visible,
  send,
  status,
}: UseRunHistoryDetailRecoveryOptions): void {
  const session = useStore((state) => (activeSessionId ? state.sessions[activeSessionId] : undefined));
  const viewedRunId = useStore((state) => (activeSessionId ? state.viewedRunIdBySession[activeSessionId] : undefined));
  const detailStates = useStore((state) =>
    activeSessionId ? state.runHistoryDetailStates[activeSessionId] : undefined,
  );
  const beginLoad = useStore((state) => state.beginRunHistoryDetailLoad);
  const abandonLoad = useStore((state) => state.abandonRunHistoryDetailLoad);
  const abandonPendingLoads = useStore((state) => state.abandonPendingRunHistoryDetailLoads);
  const timeoutIds = useRef(new Map<string, number>());

  const candidate = useMemo(
    () => selectRunHistoryDetailCandidate(activeSessionId, session, viewedRunId, detailStates),
    [activeSessionId, detailStates, session, viewedRunId],
  );

  useEffect(() => {
    if (status === "open") return;
    for (const timeoutId of timeoutIds.current.values()) window.clearTimeout(timeoutId);
    timeoutIds.current.clear();
    abandonPendingLoads();
  }, [abandonPendingLoads, status]);

  useEffect(
    () => () => {
      for (const [key, timeoutId] of timeoutIds.current) {
        window.clearTimeout(timeoutId);
        const [sessionId, requestId] = key.split("\u0000");
        if (sessionId && requestId) abandonLoad(sessionId, requestId);
      }
      timeoutIds.current.clear();
    },
    [abandonLoad],
  );

  useEffect(() => {
    if (!candidate || candidate.state !== "loaded") return;
    clearDetailTimeout(timeoutIds.current, candidate);
  }, [candidate]);

  useEffect(() => {
    if (!visible || status !== "open" || !candidate || candidate.state) return;
    if (!beginLoad(candidate.sessionId, candidate.requestId)) return;

    const accepted = send({
      type: "session.run_history",
      sessionId: candidate.sessionId,
      requestId: candidate.requestId,
    });
    if (!accepted) {
      abandonLoad(candidate.sessionId, candidate.requestId);
      return;
    }

    const key = detailKey(candidate);
    const timeoutId = window.setTimeout(() => {
      timeoutIds.current.delete(key);
      abandonLoad(candidate.sessionId, candidate.requestId);
    }, RunHistoryDetailLoadPolicy.timeoutMs);
    timeoutIds.current.set(key, timeoutId);
  }, [abandonLoad, beginLoad, candidate, send, status, visible]);
}

export function selectRunHistoryDetailCandidate(
  activeSessionId: string | null,
  session: SessionRecord | undefined,
  viewedRunId: string | undefined,
  detailStates: Record<string, "loading" | "loaded"> | undefined,
): RunHistoryDetailCandidate | undefined {
  if (!activeSessionId || !session) return undefined;
  const selected = selectViewedRun(session, viewedRunId);
  if (!selected || !isTerminalRun(selected)) return undefined;
  return {
    sessionId: activeSessionId,
    requestId: selected.requestId,
    state: detailStates?.[selected.requestId],
  };
}

function selectViewedRun(session: SessionRecord, viewedRunId: string | undefined): RunRecord | undefined {
  if (viewedRunId) return session.runs.find((run) => run.requestId === viewedRunId);
  return readActiveRun(session) ?? session.runs.at(-1);
}

function isTerminalRun(run: RunRecord): boolean {
  return run.status === "completed" || run.status === "failed" || run.status === "cancelled";
}

function detailKey(candidate: Pick<RunHistoryDetailCandidate, "sessionId" | "requestId">): string {
  return `${candidate.sessionId}\u0000${candidate.requestId}`;
}

function clearDetailTimeout(
  timeoutIds: Map<string, number>,
  candidate: Pick<RunHistoryDetailCandidate, "sessionId" | "requestId">,
): void {
  const key = detailKey(candidate);
  const timeoutId = timeoutIds.get(key);
  if (timeoutId === undefined) return;
  window.clearTimeout(timeoutId);
  timeoutIds.delete(key);
}
