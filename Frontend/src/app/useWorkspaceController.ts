import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  EventKinds,
  type EventEnvelope,
  type WorkspaceSnapshotData,
  type WorkspaceSwitchFailedData,
  type WsRequest,
} from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { generateId } from "../lib/util";
import { resolveBackendMessage, type BackendLocalizedMessage } from "../i18n/backendMessage";
import { frontendMessage } from "../i18n/frontendMessageCatalog";

export type WorkspaceSwitchPhase = "idle" | "switching" | "succeeded" | "failed";
export interface WorkspaceSwitchError {
  message: string;
  localizedMessage?: BackendLocalizedMessage;
}
export interface WorkspaceControllerHandle {
  connected: boolean;
  snapshot: WorkspaceSnapshotData | null;
  phase: WorkspaceSwitchPhase;
  target: string | null;
  error: WorkspaceSwitchError | null;
  unavailable: string | null;
  refresh: () => void;
  switchWorkspace: (root: string) => boolean;
  ingestWorkspaceEvent: (event: EventEnvelope) => boolean;
  resetError: () => void;
}

/** Completion is correlated to the opening request, never inferred from a directory string or reconnect. */
export function useWorkspaceController({
  sendRef,
  statusRef,
  status,
  onWorkspaceReady,
}: {
  sendRef: MutableRefObject<((request: WsRequest) => boolean) | null>;
  statusRef: MutableRefObject<SocketStatus>;
  status: SocketStatus;
  onWorkspaceReady?: (snapshot: WorkspaceSnapshotData, switched: boolean) => void;
}): WorkspaceControllerHandle {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshotData | null>(null);
  const [phase, setPhase] = useState<WorkspaceSwitchPhase>("idle");
  const [target, setTarget] = useState<string | null>(null);
  const [error, setError] = useState<WorkspaceSwitchError | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const pendingRequestRef = useRef<Extract<WsRequest, { type: "workspace.switch" }> | null>(null);
  const readyRef = useRef(onWorkspaceReady);
  readyRef.current = onWorkspaceReady;

  const refresh = useCallback(() => {
    if (statusRef.current === "open") sendRef.current?.({ type: "workspace.get" });
  }, [sendRef, statusRef]);
  useEffect(() => {
    if (status !== "open") return;
    if (pendingRequestRef.current) sendRef.current?.(pendingRequestRef.current);
    else refresh();
  }, [refresh, sendRef, status]);

  const switchWorkspace = useCallback(
    (root: string): boolean => {
      if (pendingRef.current) return false;
      if (statusRef.current !== "open") {
        setError({ message: frontendMessage("workspace.requestNotSent") });
        setPhase("failed");
        return false;
      }
      const requestId = generateId();
      pendingRef.current = requestId;
      pendingRequestRef.current = { type: "workspace.switch", requestId, workspaceRoot: root };
      setTarget(root);
      setError(null);
      setPhase("switching");
      if (sendRef.current?.(pendingRequestRef.current)) return true;
      pendingRef.current = null;
      pendingRequestRef.current = null;
      setPhase("failed");
      setTarget(null);
      setError({ message: frontendMessage("workspace.requestNotSent") });
      return false;
    },
    [sendRef, statusRef],
  );

  const ingestWorkspaceEvent = useCallback((event: EventEnvelope): boolean => {
    if (event.kind === EventKinds.WorkspaceSnapshot) {
      if (pendingRef.current) return true;
      const value = event.data as WorkspaceSnapshotData;
      setSnapshot(value);
      setUnavailable(null);
      readyRef.current?.(value, false);
      return true;
    }
    if (event.kind === EventKinds.WorkspaceSwitched) {
      const value = event.data as WorkspaceSnapshotData & { requestId: string };
      if (value.requestId !== pendingRef.current) return true;
      pendingRef.current = null;
      pendingRequestRef.current = null;
      setSnapshot(value);
      setPhase("succeeded");
      setTarget(null);
      readyRef.current?.(value, true);
      return true;
    }
    if (event.kind === EventKinds.WorkspaceSwitchStarted) return true;
    if (event.kind === EventKinds.WorkspaceSwitchFailed) {
      const value = event.data as WorkspaceSwitchFailedData;
      if (value.requestId !== pendingRef.current) return true;
      pendingRef.current = null;
      pendingRequestRef.current = null;
      setPhase("failed");
      setTarget(null);
      setError({ message: resolveBackendMessage(value) ?? value.message, localizedMessage: value.localizedMessage });
      return true;
    }
    if (event.kind === EventKinds.RequestInvalid) {
      const value = event.data as { message: string; details?: { requestType?: string; requestId?: string } };
      if (value.details?.requestType === "workspace.get") {
        setUnavailable(resolveBackendMessage(value) ?? value.message);
        return true;
      }
      if (value.details?.requestType === "workspace.switch" && value.details.requestId === pendingRef.current) {
        pendingRef.current = null;
        pendingRequestRef.current = null;
        setPhase("failed");
        setTarget(null);
        setError({ message: resolveBackendMessage(value) ?? value.message });
        return true;
      }
    }
    return false;
  }, []);
  const resetError = useCallback(() => {
    setError(null);
    setPhase("idle");
  }, []);
  return useMemo(
    () => ({
      connected: status === "open",
      snapshot,
      phase,
      target,
      error,
      unavailable,
      refresh,
      switchWorkspace,
      ingestWorkspaceEvent,
      resetError,
    }),
    [status, snapshot, phase, target, error, unavailable, refresh, switchWorkspace, ingestWorkspaceEvent, resetError],
  );
}
