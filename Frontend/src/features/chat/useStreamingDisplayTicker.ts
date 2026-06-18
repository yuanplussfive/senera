import { useEffect, useMemo } from "react";
import { readStreamingDisplayCadenceMs } from "../../store/session/streamingDisplay";
import { useStore, type RunRecord } from "../../store/sessionStore";

export function useStreamingDisplayTicker(
  sessionId: string,
  runs: readonly RunRecord[],
): void {
  const advanceStreamingDisplay = useStore((state) => state.advanceStreamingDisplay);
  const motionLevel = useStore((state) => state.motionLevel);
  const pendingRunIds = useMemo(
    () => runs
      .filter((run) => run.displayText !== run.visibleText)
      .map((run) => run.requestId),
    [runs],
  );
  const pendingRunKey = useMemo(() => JSON.stringify(pendingRunIds), [pendingRunIds]);

  useEffect(() => {
    if (!sessionId || pendingRunIds.length === 0) return undefined;

    if (motionLevel === "none") {
      for (const requestId of pendingRunIds) {
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
      let stillPending = false;
      for (const requestId of pendingRunIds) {
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
  }, [advanceStreamingDisplay, motionLevel, pendingRunKey, sessionId]);
}

export function readStreamingDisplayActivityRevision(
  runs: readonly RunRecord[],
  currentRun?: RunRecord,
): number {
  const pendingRun = [...runs]
    .reverse()
    .find((run) => run.displayText !== run.visibleText);
  return pendingRun?.revision ?? currentRun?.revision ?? 0;
}
