import { useCallback, type MutableRefObject } from "react";
import { toast } from "sonner";
import type { WsRequest } from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { generateId } from "../lib/util";
import { useStore, type UserProfile } from "../store/sessionStore";

export interface UseSessionCommandsOptions {
  send: (request: WsRequest) => boolean;
  serverKnownSessionIdsRef: MutableRefObject<Set<string>>;
  status: SocketStatus;
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
}: UseSessionCommandsOptions): SessionCommandsHandle {
  const clearAllSessions = useStore((state) => state.clearAllSessions);
  const registerSession = useStore((state) => state.registerCreatingSession);
  const removeSession = useStore((state) => state.removeSession);
  const renameStoreSession = useStore((state) => state.renameSession);
  const setUserProfile = useStore((state) => state.setUserProfile);

  const createSession = useCallback((): void => {
    if (status !== "open") {
      toast.warning("后端未连接，无法新建会话");
      return;
    }

    const sessionId = generateId();
    const ok = send({ type: "session.create", sessionId });
    if (!ok) {
      toast.error("新建失败，连接可能已断开");
      return;
    }

    registerSession(sessionId);
    serverKnownSessionIdsRef.current.add(sessionId);
  }, [registerSession, send, serverKnownSessionIdsRef, status]);

  const closeSession = useCallback((sessionId: string): void => {
    const ok = send({ type: "session.close", sessionId });
    if (!ok) {
      toast.error("删除失败，连接可能已断开");
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
      toast.error(`有 ${uniqueIds.length - sentIds.length} 个会话删除请求发送失败`);
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
