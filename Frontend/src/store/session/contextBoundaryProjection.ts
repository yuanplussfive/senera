import { EventKinds, type EventEnvelope, type SessionCompactedData } from "../../api/eventTypes";
import type { RunRecord } from "./types";
import { timelineScopeFromEvent } from "./timelineProjection";
import { touchRun } from "./sessionRunProjection";

/** Used by both live delivery and persisted insight/history replay. */
export function projectContextBoundary(run: RunRecord, event: EventEnvelope): boolean {
  if (event.kind !== EventKinds.SessionCompacted) return false;
  if (run.contextCompactions?.some((boundary) => boundary.sequence === event.sequence)) return false;
  run.contextCompactions = [
    ...(run.contextCompactions ?? []),
    {
      ...(event.data as SessionCompactedData),
      sequence: event.sequence,
      timestamp: event.timestamp,
      step: event.step,
      scope: timelineScopeFromEvent(event),
    },
  ];
  touchRun(run);
  return true;
}
