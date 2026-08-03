import { useCallback } from "react";
import { toast } from "sonner";
import { EventKinds, type EventEnvelope } from "../api/eventTypes";
import { useStore } from "../store/sessionStore";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { resolveBackendMessage } from "../i18n/backendMessage";

export type SocketErrorToastVariant = "error" | "warning";

export interface SocketErrorToast {
  description?: string;
  title: string;
  variant: SocketErrorToastVariant;
}

export interface SocketErrorToastState {
  historyLoadingIds: Record<string, boolean>;
  sessions: Record<string, { runs: ReadonlyArray<{ requestId: string }> } | undefined>;
}

export interface SocketErrorToastsHandle {
  notifySocketError: (env: EventEnvelope) => boolean;
}

export function resolveSocketErrorToast(env: EventEnvelope, state: SocketErrorToastState): SocketErrorToast | null {
  if (env.kind === EventKinds.RunFailed) {
    const session = env.sessionId ? state.sessions[env.sessionId] : null;
    const hasMatchingRun = session?.runs.some((run) => run.requestId === env.requestId) ?? false;
    const isHistoryLoadFailure = Boolean(env.sessionId && state.historyLoadingIds[env.sessionId] && !hasMatchingRun);

    return {
      variant: "error",
      title: isHistoryLoadFailure ? frontendMessage("socket.historySyncFailed") : frontendMessage("socket.runFailed"),
      description: resolveBackendMessage(env.data) ?? "",
    };
  }

  if (env.kind === EventKinds.SessionBusy) {
    return {
      variant: "warning",
      title: frontendMessage("socket.sessionBusy"),
    };
  }

  if (env.kind === EventKinds.ToolCallFailed) {
    return {
      variant: "error",
      title: frontendMessage("socket.toolCallFailed", {
        toolName: readDataString(env.data, "toolName") ?? "",
      }),
      description: resolveBackendMessage(env.data),
    };
  }

  if (env.kind === EventKinds.RequestInvalid) {
    const message = resolveBackendMessage(env.data) ?? "";
    if (readDataString(env.data, "code") === "approval_not_pending") {
      return {
        variant: "warning",
        title: frontendMessage("socket.approvalExpired"),
        description: message,
      };
    }

    return {
      variant: "error",
      title: frontendMessage("socket.requestInvalid"),
      description: message,
    };
  }

  return null;
}

export function showSocketErrorToast(env: EventEnvelope, state: SocketErrorToastState): boolean {
  const toastConfig = resolveSocketErrorToast(env, state);
  if (!toastConfig) return false;

  if (toastConfig.variant === "warning") {
    toast.warning(toastConfig.title, { description: toastConfig.description });
  } else {
    toast.error(toastConfig.title, { description: toastConfig.description });
  }
  return true;
}

export function useSocketErrorToasts(): SocketErrorToastsHandle {
  const notifySocketError = useCallback((env: EventEnvelope): boolean => {
    return showSocketErrorToast(env, useStore.getState());
  }, []);

  return { notifySocketError };
}

function readDataString(data: unknown, key: string): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
