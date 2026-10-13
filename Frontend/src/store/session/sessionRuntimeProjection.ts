import type { SessionRuntimeStatusData } from "../../api/eventTypes";
import type { SessionRuntimeSnapshot } from "./types";

/**
 * Runtime status is a point-in-time query rather than a durable transcript
 * event. Keep the last useful value on the session projection so a transient
 * unavailable response, journal rotation, or post-compaction unknown value
 * does not erase the last known context window usage.
 */
export function mergeSessionRuntimeSnapshot(
  previous: SessionRuntimeSnapshot | undefined,
  data: SessionRuntimeStatusData,
  observedAt: string,
): SessionRuntimeSnapshot {
  const incoming = data.runtime;
  if (!incoming) {
    return previous
      ? { ...previous, available: data.available, observedAt }
      : { available: data.available, observedAt };
  }

  const previousRuntime = previous?.runtime;
  const contextUsage = mergeContextUsage(previousRuntime?.contextUsage, incoming.contextUsage);
  return {
    available: data.available,
    observedAt,
    runtime: {
      ...previousRuntime,
      ...incoming,
      ...(contextUsage ? { contextUsage } : {}),
    },
  };
}

function mergeContextUsage(
  previous: NonNullable<NonNullable<SessionRuntimeSnapshot["runtime"]>["contextUsage"]> | undefined,
  incoming: NonNullable<NonNullable<SessionRuntimeSnapshot["runtime"]>["contextUsage"]> | undefined,
): NonNullable<NonNullable<SessionRuntimeSnapshot["runtime"]>["contextUsage"]> | undefined {
  if (!incoming) return previous;
  if (!previous) return incoming;

  const incomingIsUnknown = incoming.tokens === null && incoming.percent === null;
  if (incomingIsUnknown && incoming.contextWindow === previous.contextWindow && previous.tokens !== null) {
    return previous;
  }
  return incoming;
}
