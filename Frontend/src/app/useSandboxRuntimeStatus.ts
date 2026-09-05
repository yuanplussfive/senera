import { useCallback, useState } from "react";
import { EventKinds, type EventEnvelope, type SandboxStatusSnapshotData } from "../api/eventTypes";

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

    setSandboxStatus(env.data as SandboxStatusSnapshotData);
    return true;
  }, []);

  return {
    sandboxStatus,
    ingestSandboxEvent,
  };
}
