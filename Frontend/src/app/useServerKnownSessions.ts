import { useCallback, useRef, type MutableRefObject } from "react";
import { EventKinds, type EventEnvelope } from "../api/eventTypes";

export interface ServerKnownSessionsHandle {
  resetServerKnownSessions: () => void;
  serverKnownSessionIdsRef: MutableRefObject<Set<string>>;
  syncServerKnownSessionFromEvent: (env: EventEnvelope) => boolean;
}

export function applyServerKnownSessionEvent(
  knownSessionIds: Set<string>,
  env: EventEnvelope,
): boolean {
  if (
    (env.kind === EventKinds.SessionCreated || env.kind === EventKinds.SessionSnapshot) &&
    env.sessionId
  ) {
    knownSessionIds.add(env.sessionId);
    return true;
  }

  if (env.kind === EventKinds.SessionClosed && env.sessionId) {
    knownSessionIds.delete(env.sessionId);
    return true;
  }

  return false;
}

export function useServerKnownSessions(): ServerKnownSessionsHandle {
  const serverKnownSessionIdsRef = useRef<Set<string>>(new Set());

  const resetServerKnownSessions = useCallback((): void => {
    serverKnownSessionIdsRef.current = new Set();
  }, []);

  const syncServerKnownSessionFromEvent = useCallback((env: EventEnvelope): boolean => {
    return applyServerKnownSessionEvent(serverKnownSessionIdsRef.current, env);
  }, []);

  return {
    resetServerKnownSessions,
    serverKnownSessionIdsRef,
    syncServerKnownSessionFromEvent,
  };
}
