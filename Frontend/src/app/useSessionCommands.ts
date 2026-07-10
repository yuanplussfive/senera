import { useCallback, type MutableRefObject } from "react";
import { toast } from "sonner";
import type { WsRequest } from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { generateId } from "../lib/util";
import { useStore, type UserProfile } from "../store/sessionStore";
import { frontendMessage } from "../i18n/frontendMessageCatalog";

export interface UseSessionCommandsOptions {
  send: (request: WsRequest) => boolean;
  serverKnownSessionIdsRef: MutableRefObject<Set<string>>;
  status: SocketStatus;
  selectedModelProviderId: string | null;
}

export interface SessionCommandsHandle {
  closeSession: (sessionId: string) => void;
  closeSessions: (sessionIds: string[]) => void;
  createSession: () => void;
  renameSession: (sessionId: string, title: string) => void;
  updateUserProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
}

export function readUniqueSessionIds(sessionIds: readonly string[]): string[] {
  return [...new Set(sessionIds)].filter(Boolean);
}

export function normalizeSessionTitle(title: string): string | null {
  const nextTitle = title.trim();
  return nextTitle ? nextTitle : null;
}

export function useSessionCommands({
  send,
  serverKnownSessionIdsRef,
  status,
  selectedModelProviderId,
}: UseSessionCommandsOptions): SessionCommandsHandle {
  const clearAllSessions = useStore((state) => state.clearAllSessions);
  const registerSession = useStore((state) => state.registerCreatingSession);
  const removeSession = useStore((state) => state.removeSession);
  const renameStoreSession = useStore((state) => state.renameSession);
  const setUserProfile = useStore((state) => state.setUserProfile);

  const createSession = useCallback((): void => {
    if (status !== "open") {
      toast.warning(frontendMessage("session.createOffline"));
      return;
    }

    const sessionId = generateId();
    const ok = send({
      type: "session.create",
      sessionId,
      modelProviderId: selectedModelProviderId ?? undefined,
    });
    if (!ok) {
      toast.error(frontendMessage("session.createDisconnected"));
      return;
    }

    registerSession(sessionId);
    serverKnownSessionIdsRef.current.add(sessionId);
  }, [registerSession, selectedModelProviderId, send, serverKnownSessionIdsRef, status]);

  const closeSession = useCallback((sessionId: string): void => {
    const ok = send({ type: "session.close", sessionId });
    if (!ok) {
      toast.error(frontendMessage("session.deleteDisconnected"));
      return;
    }
    removeSession(sessionId);
  }, [removeSession, send]);

  const closeSessions = useCallback((sessionIds: string[]): void => {
    const uniqueIds = readUniqueSessionIds(sessionIds);
    if (uniqueIds.length === 0) return;

    const sentIds: string[] = [];
    uniqueIds.forEach((sessionId) => {
      const ok = send({ type: "session.close", sessionId });
      if (ok) {
        sentIds.push(sessionId);
        serverKnownSessionIdsRef.current.delete(sessionId);
      }
    });

    if (sentIds.length > 0) {
      clearAllSessions(sentIds);
    }
    if (sentIds.length < uniqueIds.length) {
      toast.error(frontendMessage("session.bulkDeletePartialFailed", {
        count: uniqueIds.length - sentIds.length,
      }));
    }
  }, [clearAllSessions, send, serverKnownSessionIdsRef]);

  const renameSession = useCallback((sessionId: string, title: string): void => {
    const nextTitle = normalizeSessionTitle(title);
    if (!nextTitle) return;

    renameStoreSession(sessionId, nextTitle);
    send({ type: "session.rename", sessionId, title: nextTitle });
  }, [renameStoreSession, send]);

  const updateUserProfile = useCallback((profile: Pick<UserProfile, "name" | "avatarDataUrl">): void => {
    setUserProfile(profile);
    if (status === "open") {
      send({ type: "profile.update", profile });
    }
  }, [send, setUserProfile, status]);

  return {
    closeSession,
    closeSessions,
    createSession,
    renameSession,
    updateUserProfile,
  };
}
