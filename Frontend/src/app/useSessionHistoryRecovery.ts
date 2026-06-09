import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { SocketStatus } from "../api/useAgentSocket";
import type { WsRequest } from "../api/eventTypes";
import { useStore, type SessionRecord } from "../store/sessionStore";

const RECOVERY_POLL_DELAYS_MS = [1500, 2000, 3000, 5000] as const;

export interface UseSessionHistoryRecoveryOptions {
  send: (request: WsRequest) => boolean;
  status: SocketStatus;
  activeSessionId?: string | null;
}

export interface SessionHistoryRecoveryHandle {
  requestSessionHistory: (sessionId: string, options?: { refresh?: boolean }) => boolean;
}

export function shouldRequestActiveSessionHistory({
  activeSessionId,
  historyLoadedIds,
  historyLoadingIds,
  missingOnServerIds,
  status,
}: {
  activeSessionId?: string | null;
  historyLoadedIds: Record<string, boolean>;
  historyLoadingIds: Record<string, boolean>;
  missingOnServerIds: Record<string, boolean>;
  status: SocketStatus;
}): boolean {
  if (status !== "open" || !activeSessionId) return false;
  return !missingOnServerIds[activeSessionId]
    && !historyLoadedIds[activeSessionId]
    && !historyLoadingIds[activeSessionId];
}

export function readRecoveryPollingKey({
  historyLoadingIds,
  sessions,
}: {
  historyLoadingIds: Record<string, boolean>;
  sessions: Record<string, SessionRecord>;
}): string {
  return Object.values(sessions)
    .flatMap((session) =>
      session.runs
        .filter((run) => run.status === "running" && run.recoverySource === "history")
        .map((run) => [
          session.sessionId,
          run.requestId,
          String(run.revision),
          historyLoadingIds[session.sessionId] ? "loading" : "idle",
        ].join("\u0001")),
    )
    .sort()
    .join("\u0000");
}

export function useSessionHistoryRecovery({
  activeSessionId,
  send,
  status,
}: UseSessionHistoryRecoveryOptions): SessionHistoryRecoveryHandle {
  const markHistoryLoading = useStore((state) => state.markHistoryLoading);
  const markHistoryLoadFailed = useStore((state) => state.markHistoryLoadFailed);
  const recoveryPollingAttemptRef = useRef(0);
  const recoveryPollingKey = useStore((state) =>
    readRecoveryPollingKey({
      historyLoadingIds: state.historyLoadingIds,
      sessions: state.sessions,
    }),
  );

  const requestSessionHistory = useCallback(
    (sessionId: string, options: { refresh?: boolean } = {}): boolean => {
      markHistoryLoading(sessionId);
      const ok = send({ type: "session.history", sessionId, refresh: options.refresh || undefined });
      if (!ok) {
        markHistoryLoadFailed(sessionId);
        toast.error("历史同步失败，连接可能已断开");
      }
      return ok;
    },
    [markHistoryLoadFailed, markHistoryLoading, send],
  );

  useEffect(() => {
    const sessionId = activeSessionId;
    if (!sessionId) return;

    const state = useStore.getState();
    if (!shouldRequestActiveSessionHistory({
      activeSessionId: sessionId,
      historyLoadedIds: state.historyLoadedIds,
      historyLoadingIds: state.historyLoadingIds,
      missingOnServerIds: state.missingOnServerIds,
      status,
    })) {
      return;
    }
    requestSessionHistory(sessionId);
  }, [activeSessionId, requestSessionHistory, status]);

  useEffect(() => {
    if (status !== "open" || !recoveryPollingKey) {
      recoveryPollingAttemptRef.current = 0;
      return;
    }

    const sessionIds = [
      ...new Set(recoveryPollingKey.split("\u0000").map((entry) => entry.split("\u0001")[0]).filter(Boolean)),
    ];
    const idleSessionIds = sessionIds.filter((sessionId) => !useStore.getState().historyLoadingIds[sessionId]);
    if (idleSessionIds.length === 0) {
      return;
    }

    const attempt = recoveryPollingAttemptRef.current;
    const delay = RECOVERY_POLL_DELAYS_MS[Math.min(attempt, RECOVERY_POLL_DELAYS_MS.length - 1)];
    const timer = window.setTimeout(() => {
      const state = useStore.getState();
      let requested = false;
      for (const sessionId of idleSessionIds) {
        const session = state.sessions[sessionId];
        const stillNeedsRecovery = session?.runs.some(
          (run) => run.status === "running" && run.recoverySource === "history",
        );
        if (!stillNeedsRecovery || state.historyLoadingIds[sessionId]) continue;
        requestSessionHistory(sessionId, { refresh: true });
        requested = true;
      }
      if (requested) {
        recoveryPollingAttemptRef.current = Math.min(attempt + 1, RECOVERY_POLL_DELAYS_MS.length - 1);
      }
    }, delay);

    return () => window.clearTimeout(timer);
  }, [recoveryPollingKey, requestSessionHistory, status]);

  return { requestSessionHistory };
}
