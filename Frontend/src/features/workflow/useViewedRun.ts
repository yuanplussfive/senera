import { useCallback, useEffect, useMemo } from "react";
import { readActiveRun, useStore, type RunRecord, type SessionRecord } from "../../store/sessionStore";

export interface ViewedRun {
  readonly sessionId?: string;
  readonly session: SessionRecord | null;
  readonly runs: readonly RunRecord[];
  /** Run the dock surfaces should render: the pinned history run, else the active/latest run. */
  readonly run: RunRecord | undefined;
  readonly pinnedToHistory: boolean;
  readonly selectRun: (requestId: string) => void;
  readonly followLatest: () => void;
}

/**
 * One run selection shared by every right-dock tab, so pinning a historical
 * run in one tab keeps the others on the same run.
 */
export function useViewedRun(): ViewedRun {
  const activeId = useStore((s) => s.activeSessionId);
  const session = useStore((s) => (activeId ? s.sessions[activeId] : null));
  const viewedRunId = useStore((s) => (activeId ? s.viewedRunIdBySession[activeId] : undefined));
  const setViewedRun = useStore((s) => s.setViewedRun);

  const runs = useMemo(() => session?.runs ?? [], [session?.runs]);
  const latestRun = runs[runs.length - 1];
  const defaultRun = readActiveRun(session ?? undefined) ?? latestRun;
  const selectedRun = useMemo(
    () => (viewedRunId ? runs.find((candidate) => candidate.requestId === viewedRunId) : undefined),
    [runs, viewedRunId],
  );
  const pinnedToHistory = !!selectedRun && selectedRun.requestId !== defaultRun?.requestId;

  useEffect(() => {
    if (!activeId || !viewedRunId) return;
    if (!selectedRun) {
      setViewedRun(activeId, undefined);
      return;
    }
    if (selectedRun.requestId === defaultRun?.requestId) setViewedRun(activeId, undefined);
  }, [activeId, viewedRunId, selectedRun, defaultRun?.requestId, setViewedRun]);

  const selectRun = useCallback(
    (requestId: string): void => {
      if (activeId) setViewedRun(activeId, requestId);
    },
    [activeId, setViewedRun],
  );
  const followLatest = useCallback((): void => {
    if (activeId) setViewedRun(activeId, undefined);
  }, [activeId, setViewedRun]);

  return {
    ...(activeId ? { sessionId: activeId } : {}),
    session,
    runs,
    run: pinnedToHistory ? selectedRun : defaultRun,
    pinnedToHistory,
    selectRun,
    followLatest,
  };
}
