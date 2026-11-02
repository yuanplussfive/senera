import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../store/sessionStore";
import type { RunRecord } from "../../store/session/types";
import { LruCache } from "../../lib/LruCache";
import { scheduleIdleTask } from "../../shared/scheduling/scheduleIdleTask";
import { useWorkspaceResourceController } from "../../shared/workspace/WorkspaceResourceProvider";
import { createInsightRunSelector, mergeInsightRuns } from "./sessionInsightsModel";
import { EmptyInsightHistory, loadInsightHistory, type InsightHistoryCheckpoint } from "./sessionInsightsHistory";

const EmptyRuns: RunRecord[] = [];
// Keep only the few recently viewed conversations; raw downloaded events are never retained.
const RecentInsightSessions = 3;

/** The server owns history. The panel keeps cancellable, incremental observation checkpoints. */
export function useSessionInsights({ enabled = true }: { enabled?: boolean } = {}) {
  const sessionId = useStore((state) => state.activeSessionId);
  const selectRuns = useMemo(() => createInsightRunSelector(), []);
  const runs = useStore((state) => selectRuns(sessionId ? (state.sessions[sessionId]?.runs ?? EmptyRuns) : EmptyRuns));
  const controller = useWorkspaceResourceController();
  const baseUrl = controller?.httpBaseUrl;
  const key = JSON.stringify([baseUrl, sessionId]);
  const settled = useMemo(
    () =>
      runs
        .filter((run) => run.status !== "running" && run.status !== "cancelling")
        .map((run) => run.requestId)
        .join("\0"),
    [runs],
  );
  const cache = useRef(new LruCache<string, InsightHistoryCheckpoint>(RecentInsightSessions));
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const [history, setHistory] = useState<{
    key: string;
    checkpoint: InsightHistoryCheckpoint;
    loading: boolean;
    error?: string;
  }>({
    key: "",
    checkpoint: EmptyInsightHistory,
    loading: false,
  });
  useEffect(() => {
    if (!enabled || !baseUrl || !sessionId) return;
    const abort = new AbortController();
    const checkpoint = cache.current.get(key) ?? EmptyInsightHistory;
    setHistory({ key, checkpoint, loading: true });
    const cancel = scheduleIdleTask(
      () => {
        void loadInsightHistory(baseUrl, sessionId, checkpoint, {
          signal: abort.signal,
          onPage: (page) => {
            cache.current.set(key, page);
            startTransition(() => setHistory({ key, checkpoint: page, loading: !page.complete }));
          },
        }).catch((error: unknown) => {
          if (!abort.signal.aborted)
            setHistory((current) => ({
              ...current,
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            }));
        });
      },
      { priority: "user-visible" },
    );
    return () => {
      cancel();
      abort.abort();
    };
  }, [enabled, key, baseUrl, sessionId, settled, revision]);
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, refresh]);
  const observations = history.key === key ? history.checkpoint.runs : EmptyInsightHistory.runs;
  const observedRuns = useMemo(() => mergeInsightRuns(runs, observations), [runs, observations]);
  return {
    runs: observedRuns,
    loading: history.key === key && history.loading,
    error: history.key === key ? history.error : undefined,
    refresh,
  };
}
