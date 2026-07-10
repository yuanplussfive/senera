import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { WsRequest } from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { useStore, type UserProfile } from "../store/sessionStore";
import { frontendMessage } from "../i18n/frontendMessageCatalog";

export interface UseSessionCatalogSyncOptions {
  status: SocketStatus;
  send: (request: WsRequest) => boolean;
  onServerSessionsReset: () => void;
}

export interface SessionCatalogSyncHandle {
  refreshSessionCatalog: () => void;
}

export function buildConnectionOpenSyncRequests(userProfile: UserProfile): WsRequest[] {
  const requests: WsRequest[] = [
    { type: "session.list" },
    { type: "config.get" },
    { type: "model.list" },
    { type: "plugin.config.list" },
    { type: "preset.list" },
    { type: "sandbox.status" },
  ];

  if (userProfile.syncState === "pending") {
    const { name, avatarDataUrl } = userProfile;
    requests.push({ type: "profile.update", profile: { name, avatarDataUrl } });
  } else {
    requests.push({ type: "profile.get" });
  }

  return requests;
}

export function buildManualRefreshRequests(): WsRequest[] {
  return [
    { type: "session.list" },
    { type: "config.get" },
    { type: "model.list" },
    { type: "plugin.config.list" },
    { type: "preset.list" },
    { type: "profile.get" },
    { type: "sandbox.status" },
  ];
}

export function useSessionCatalogSync({
  status,
  send,
  onServerSessionsReset,
}: UseSessionCatalogSyncOptions): SessionCatalogSyncHandle {
  const hydrationToastShownRef = useRef(false);

  const refreshSessionCatalog = useCallback((): void => {
    if (status !== "open") return;
    for (const request of buildManualRefreshRequests()) {
      send(request);
    }
  }, [send, status]);

  useEffect(() => {
    if (status !== "open") {
      onServerSessionsReset();
      return;
    }

    onServerSessionsReset();
    const state = useStore.getState();
    for (const request of buildConnectionOpenSyncRequests(state.userProfile)) {
      send(request);
    }

    if (!hydrationToastShownRef.current && state.sessionOrder.length > 0) {
      hydrationToastShownRef.current = true;
      toast.success(frontendMessage("session.hydrated", {
        count: state.sessionOrder.length,
      }), {
        description: frontendMessage("session.hydratingDescription"),
      });
    }
  }, [onServerSessionsReset, send, status]);

  return { refreshSessionCatalog };
}
