import { useEffect, useMemo, useRef } from "react";
import { readStreamingDisplayCadenceMs } from "../../store/session/streamingDisplay";
import { useStore, type RunRecord } from "../../store/sessionStore";

export function useStreamingDisplayTicker(sessionId: string, runs: readonly RunRecord[]): void {
  const advanceStreamingDisplay = useStore((state) => state.advanceStreamingDisplay);
  const motionLevel = useStore((state) => state.motionLevel);
  const pendingRunIds = useMemo(
    () => [...new Set(runs.filter((run) => run.displayText !== run.visibleText).map((run) => run.requestId))],
    [runs],
  );
  const pendingRunIdsRef = useRef<readonly string[]>(pendingRunIds);
  pendingRunIdsRef.current = pendingRunIds;
  const hasPendingRunIds = pendingRunIds.length > 0;

  useEffect(() => {
    if (!sessionId || !hasPendingRunIds) return undefined;

    if (motionLevel === "none") {
      for (const requestId of pendingRunIdsRef.current) {
        advanceStreamingDisplay(sessionId, requestId);
      }
      return undefined;
    }

    let cancelled = false;
    let timeoutId: number | undefined;

    const scheduleNextTick = (): void => {
      timeoutId = window.setTimeout(tick, readStreamingDisplayCadenceMs(motionLevel));
    };

    const tick = (): void => {
      if (cancelled) return;
      const currentPendingRunIds = pendingRunIdsRef.current;
      let stillPending = false;
      for (const requestId of currentPendingRunIds) {
        stillPending = advanceStreamingDisplay(sessionId, requestId) || stillPending;
      }
      if (stillPending) {
        scheduleNextTick();
      }
    };

    scheduleNextTick();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [advanceStreamingDisplay, hasPendingRunIds, motionLevel, sessionId]);
}
