import { useCallback, useEffect, useMemo, useReducer, useRef, type MutableRefObject } from "react";
import {
  EventKinds,
  type EventEnvelope,
  type WorkspaceSnapshotData,
  type WorkspaceSwitchFailedData,
  type WorkspaceSwitchStartedData,
  type WsRequest,
} from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { resolveBackendMessage, type BackendLocalizedMessage } from "../i18n/backendMessage";

export type WorkspaceSwitchPhase = "idle" | "switching" | "succeeded" | "failed";

export interface WorkspaceSwitchError {
  message: string;
  localizedMessage?: BackendLocalizedMessage;
}

export interface WorkspaceControllerHandle {
  snapshot: WorkspaceSnapshotData | null;
  phase: WorkspaceSwitchPhase;
  target: string | null;
  error: WorkspaceSwitchError | null;
  unavailable: string | null;
  refresh: () => void;
  switchWorkspace: (workspaceRoot: string) => boolean;
  ingestWorkspaceEvent: (env: EventEnvelope) => boolean;
  resetError: () => void;
}

interface WorkspaceControllerState {
  snapshot: WorkspaceSnapshotData | null;
  phase: WorkspaceSwitchPhase;
  target: string | null;
  error: WorkspaceSwitchError | null;
  unavailable: string | null;
}

type WorkspaceControllerAction =
  | { type: "snapshot"; snapshot: WorkspaceSnapshotData }
  | { type: "started"; target: string }
  | { type: "failed"; target: string; error: WorkspaceSwitchError }
  | { type: "unavailable"; message: string }
  | { type: "resetError" };

const WorkspaceSwitchTimeoutMs = 120_000;

const initialState: WorkspaceControllerState = {
  snapshot: null,
  phase: "idle",
  target: null,
  error: null,
  unavailable: null,
};

/**
 * 工作区快照与热切换协调器。切换期间服务端会整栈重建、WebSocket 断开重连，
 * 因此最终结果主要靠重连后的 workspace.get 快照与目标路径比对来判定：
 * 匹配 = 成功，不匹配（服务端回滚原工作区）= 失败；长时间无快照 = 超时失败。
 */
export function useWorkspaceController({
  sendRef,
  statusRef,
  status,
}: {
  sendRef: MutableRefObject<((request: WsRequest) => boolean) | null>;
  statusRef: MutableRefObject<SocketStatus>;
  status: SocketStatus;
}): WorkspaceControllerHandle {
  const [state, dispatch] = useReducer(workspaceControllerReducer, initialState);
  const previousStatusRef = useRef(status);
  const targetRef = useRef<string | null>(null);
  useEffect(() => {
    targetRef.current = state.target;
  }, [state.target]);

  const refresh = useCallback((): void => {
    if (statusRef.current === "open") sendRef.current?.({ type: "workspace.get" });
  }, [sendRef, statusRef]);

  useEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = status;
    if (previous !== "open" && status === "open") refresh();
  }, [refresh, status]);

  useEffect(() => {
    if (state.phase !== "switching") return;
    const timer = window.setTimeout(() => {
      dispatch({
        type: "failed",
        target: state.target ?? "",
        error: { message: frontendMessage("settings.workspace.switchTimeout") },
      });
    }, WorkspaceSwitchTimeoutMs);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.target]);

  const switchWorkspace = useCallback(
    (workspaceRoot: string): boolean => {
      const send = sendRef.current;
      if (statusRef.current !== "open" || !send) return false;
      dispatch({ type: "started", target: workspaceRoot });
      if (!send({ type: "workspace.switch", workspaceRoot })) {
        dispatch({
          type: "failed",
          target: workspaceRoot,
          error: { message: frontendMessage("settings.workspace.switchDisconnected") },
        });
        return false;
      }
      return true;
    },
    [sendRef, statusRef],
  );

  const ingestWorkspaceEvent = useCallback((env: EventEnvelope): boolean => {
    if (env.kind === EventKinds.WorkspaceSnapshot || env.kind === EventKinds.WorkspaceSwitched) {
      dispatch({ type: "snapshot", snapshot: env.data as WorkspaceSnapshotData });
      return true;
    }
    if (env.kind === EventKinds.WorkspaceSwitchStarted) {
      dispatch({ type: "started", target: (env.data as WorkspaceSwitchStartedData).workspaceRoot });
      return true;
    }
    if (env.kind === EventKinds.WorkspaceSwitchFailed) {
      const data = env.data as WorkspaceSwitchFailedData;
      dispatch({
        type: "failed",
        target: data.workspaceRoot,
        error: {
          message: resolveBackendMessage(data) ?? data.message ?? frontendMessage("settings.workspace.switchFailed"),
          localizedMessage: data.localizedMessage,
        },
      });
      return true;
    }
    if (env.kind === EventKinds.RequestInvalid) {
      const data = env.data as {
        message?: string;
        localizedMessage?: BackendLocalizedMessage;
        details?: { requestType?: string };
      };
      const requestType = data.details?.requestType;
      if (requestType === "workspace.get") {
        dispatch({
          type: "unavailable",
          message: resolveBackendMessage(data) ?? data.message ?? frontendMessage("settings.workspace.unavailable"),
        });
        return true;
      }
      if (requestType === "workspace.switch") {
        dispatch({
          type: "failed",
          target: targetRef.current ?? "",
          error: {
            message: resolveBackendMessage(data) ?? data.message ?? frontendMessage("settings.workspace.switchFailed"),
            localizedMessage: data.localizedMessage,
          },
        });
        return true;
      }
    }
    return false;
  }, []);

  const resetError = useCallback((): void => {
    dispatch({ type: "resetError" });
  }, []);

  return useMemo(
    () => ({ ...state, refresh, switchWorkspace, ingestWorkspaceEvent, resetError }),
    [ingestWorkspaceEvent, refresh, resetError, state, switchWorkspace],
  );
}

function workspaceControllerReducer(
  state: WorkspaceControllerState,
  action: WorkspaceControllerAction,
): WorkspaceControllerState {
  if (action.type === "snapshot") {
    if (state.phase === "switching" && state.target) {
      if (action.snapshot.workspaceRoot === state.target) {
        return { snapshot: action.snapshot, phase: "succeeded", target: null, error: null, unavailable: null };
      }
      return {
        snapshot: action.snapshot,
        phase: "failed",
        target: null,
        error: { message: frontendMessage("settings.workspace.switchRolledBack") },
        unavailable: null,
      };
    }
    return { ...state, snapshot: action.snapshot, unavailable: null };
  }
  if (action.type === "started") {
    return { ...state, phase: "switching", target: action.target, error: null, unavailable: null };
  }
  if (action.type === "failed") {
    return { ...state, phase: "failed", target: null, error: action.error };
  }
  if (action.type === "unavailable") {
    return { ...state, unavailable: action.message };
  }
  return { ...state, phase: "idle", target: null, error: null };
}
