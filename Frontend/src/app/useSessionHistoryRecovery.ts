import { useCallback, useEffect, useRef } from "react";
import type { SocketStatus } from "../api/useAgentSocket";
import type { WsRequest } from "../api/eventTypes";
import { useStore, type SessionRecord } from "../store/sessionStore";

const RECOVERY_POLL_DELAYS_MS = [1500, 2000, 3000, 5000] as const;

/** 后端不回 completed 时的客户端兜底：超时转入失败态（失败态自带重试按钮） */
const HISTORY_LOAD_TIMEOUT_MS = 30_000;

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
  catalogSynced,
  historyLoadedIds,
  historyLoadingIds,
  missingOnServerIds,
  pendingCreatedSessionIds,
  pendingDeletedSessionIds,
  sessionExists,
  sessionInOrder,
  status,
}: {
  activeSessionId?: string | null;
  catalogSynced: boolean;
  historyLoadedIds: Record<string, boolean>;
  historyLoadingIds: Record<string, boolean>;
  missingOnServerIds: Record<string, boolean>;
  pendingCreatedSessionIds: Record<string, boolean>;
  pendingDeletedSessionIds: Record<string, boolean>;
  sessionExists: boolean;
  sessionInOrder: boolean;
  status: SocketStatus;
}): boolean {
  if (
    status !== "open" ||
    !catalogSynced ||
    !activeSessionId ||
    !sessionExists ||
    !sessionInOrder ||
    pendingCreatedSessionIds[activeSessionId] ||
    pendingDeletedSessionIds[activeSessionId]
  ) {
    return false;
  }
  return (
    !missingOnServerIds[activeSessionId] && !historyLoadedIds[activeSessionId] && !historyLoadingIds[activeSessionId]
  );
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
        .map((run) =>
          [
            session.sessionId,
            run.requestId,
            String(run.revision),
            historyLoadingIds[session.sessionId] ? "loading" : "idle",
          ].join("\u0001"),
        ),
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
  const historyTimeoutTimersRef = useRef(new Map<string, number>());
  const sessionsCatalogSynced = useStore((state) => state.catalogSynced.sessions);
  const activeSessionExists = useStore((state) => Boolean(activeSessionId && state.sessions[activeSessionId]));
  const activeSessionInOrder = useStore((state) =>
    Boolean(activeSessionId && state.sessionOrder.includes(activeSessionId)),
  );
  const activeSessionPendingCreation = useStore((state) =>
    Boolean(activeSessionId && state.pendingCreatedSessionIds[activeSessionId]),
  );
  const activeSessionPendingDeletion = useStore((state) =>
    Boolean(activeSessionId && state.pendingDeletedSessionIds[activeSessionId]),
  );
  useEffect(
    () => () => {
      for (const timer of historyTimeoutTimersRef.current.values()) window.clearTimeout(timer);
      historyTimeoutTimersRef.current.clear();
    },
    [],
  );
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
        return ok;
      }
      const existing = historyTimeoutTimersRef.current.get(sessionId);
      if (existing !== undefined) window.clearTimeout(existing);
      historyTimeoutTimersRef.current.set(
        sessionId,
        window.setTimeout(() => {
          historyTimeoutTimersRef.current.delete(sessionId);
          if (useStore.getState().historyLoadingIds[sessionId]) {
            markHistoryLoadFailed(sessionId);
          }
        }, HISTORY_LOAD_TIMEOUT_MS),
      );
      return ok;
    },
    [markHistoryLoadFailed, markHistoryLoading, send],
  );

  useEffect(() => {
    const sessionId = activeSessionId;
    if (!sessionId) return;

    const state = useStore.getState();
    if (
      !shouldRequestActiveSessionHistory({
        activeSessionId: sessionId,
        catalogSynced: sessionsCatalogSynced,
        historyLoadedIds: state.historyLoadedIds,
        historyLoadingIds: state.historyLoadingIds,
        missingOnServerIds: state.missingOnServerIds,
        pendingCreatedSessionIds: state.pendingCreatedSessionIds,
        pendingDeletedSessionIds: state.pendingDeletedSessionIds,
        sessionExists: activeSessionExists,
        sessionInOrder: activeSessionInOrder,
        status,
      })
    ) {
      return;
    }
    requestSessionHistory(sessionId);
  }, [
    activeSessionExists,
    activeSessionId,
    activeSessionInOrder,
    activeSessionPendingCreation,
    activeSessionPendingDeletion,
    requestSessionHistory,
    sessionsCatalogSynced,
    status,
  ]);

  useEffect(() => {
    if (status !== "open" || !sessionsCatalogSynced || !recoveryPollingKey) {
      recoveryPollingAttemptRef.current = 0;
      return;
    }

    const sessionIds = [
      ...new Set(
        recoveryPollingKey
          .split("\u0000")
          .map((entry) => entry.split("\u0001")[0])
          .filter(Boolean),
      ),
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
  }, [recoveryPollingKey, requestSessionHistory, sessionsCatalogSynced, status]);

  return { requestSessionHistory };
}
