import { useCallback, type MutableRefObject } from "react";
import { toast } from "sonner";
import type { WsRequest } from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { generateId } from "../lib/util";
import { DEFAULT_SESSION_TITLE, useStore, type StoreState, type UserProfile } from "../store/sessionStore";
import { frontendMessage } from "../i18n/frontendMessageCatalog";

export interface UseSessionCommandsOptions {
  send: (request: WsRequest) => boolean;
  serverKnownSessionIdsRef: MutableRefObject<Set<string>>;
  status: SocketStatus;
  defaultModelProviderId: string | null;
}

export interface SessionCommandsHandle {
  closeSession: (sessionId: string) => void;
  createSession: () => void;
  renameSession: (sessionId: string, title: string) => boolean;
  updateUserProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
}

export function normalizeSessionTitle(title: string): string | null {
  const nextTitle = title.trim();
  return nextTitle ? nextTitle : null;
}

export function findReusableEmptySessionId({
  sessions,
  sessionOrder,
}: Pick<StoreState, "sessions" | "sessionOrder">): string | undefined {
  return sessionOrder.find((sessionId) => {
    const session = sessions[sessionId];
    if (!session || session.status === "closed" || session.title !== DEFAULT_SESSION_TITLE) return false;
    return (
      session.entryCount === 0 &&
      session.messageCount === 0 &&
      session.messages.length === 0 &&
      session.runs.length === 0 &&
      !session.activeRequestId
    );
  });
}

export function useSessionCommands({
  send,
  serverKnownSessionIdsRef,
  status,
  defaultModelProviderId,
}: UseSessionCommandsOptions): SessionCommandsHandle {
  const registerSession = useStore((state) => state.registerCreatingSession);
  const removeSession = useStore((state) => state.removeSession);
  const renameStoreSession = useStore((state) => state.renameSession);
  const selectSession = useStore((state) => state.selectSession);
  const setUserProfile = useStore((state) => state.setUserProfile);

  const createSession = useCallback((): void => {
    const reusableSessionId = findReusableEmptySessionId(useStore.getState());
    if (reusableSessionId) {
      selectSession(reusableSessionId);
      return;
    }

    if (status !== "open") {
      toast.warning(frontendMessage("session.createOffline"));
      return;
    }

    const sessionId = generateId();
    const ok = send({
      type: "session.create",
      sessionId,
    });
    if (!ok) {
      toast.error(frontendMessage("session.createDisconnected"));
      return;
    }

    registerSession(sessionId, undefined, defaultModelProviderId);
    serverKnownSessionIdsRef.current.add(sessionId);
  }, [defaultModelProviderId, registerSession, selectSession, send, serverKnownSessionIdsRef, status]);

  const closeSession = useCallback(
    (sessionId: string): void => {
      const ok = send({ type: "session.close", sessionId });
      if (!ok) {
        toast.error(frontendMessage("session.deleteDisconnected"));
        return;
      }
      removeSession(sessionId);
    },
    [removeSession, send],
  );

  const renameSession = useCallback(
    (sessionId: string, title: string): boolean => {
      const nextTitle = normalizeSessionTitle(title);
      if (!nextTitle) return false;

      if (status !== "open" || !send({ type: "session.rename", sessionId, title: nextTitle })) {
        toast.error(frontendMessage("session.renameDisconnected"));
        return false;
      }
      renameStoreSession(sessionId, nextTitle);
      return true;
    },
    [renameStoreSession, send, status],
  );

  const updateUserProfile = useCallback(
    (profile: Pick<UserProfile, "name" | "avatarDataUrl">): void => {
      setUserProfile(profile);
      if (status === "open") {
        send({ type: "profile.update", profile });
      }
    },
    [send, setUserProfile, status],
  );

  return {
    closeSession,
    createSession,
    renameSession,
    updateUserProfile,
  };
}
