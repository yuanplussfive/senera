import { useCallback, useState } from "react";
import {
  EventKinds,
  type EventEnvelope,
  type SandboxRuntimeState,
  type SandboxStatusSnapshotData,
} from "../api/eventTypes";

const sandboxRuntimeStates = new Set<SandboxRuntimeState>(["disabled", "unknown", "preparing", "ready", "unavailable"]);

export interface SandboxRuntimeStatusHandle {
  sandboxStatus: SandboxStatusSnapshotData | null;
  ingestSandboxEvent: (env: EventEnvelope) => boolean;
}

export function useSandboxRuntimeStatus(): SandboxRuntimeStatusHandle {
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatusSnapshotData | null>(null);

  const ingestSandboxEvent = useCallback((env: EventEnvelope): boolean => {
    if (env.kind !== EventKinds.SandboxStatusSnapshot) {
      return false;
    }

    if (!isSandboxStatusSnapshotData(env.data)) return true;
    setSandboxStatus(env.data);
    return true;
  }, []);

  return {
    sandboxStatus,
    ingestSandboxEvent,
  };
}

function isSandboxStatusSnapshotData(value: unknown): value is SandboxStatusSnapshotData {
  if (!value || typeof value !== "object") return false;
  return sandboxRuntimeStates.has((value as { state?: unknown }).state as SandboxRuntimeState);
}
