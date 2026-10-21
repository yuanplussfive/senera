import { useCallback, type MutableRefObject } from "react";
import { toast } from "sonner";
import type { WsRequest } from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { generateId } from "../lib/util";
import {
  DEFAULT_SESSION_TITLE,
  useStore,
  type ConversationProfileUpdate,
  type StoreState,
} from "../store/sessionStore";
import { frontendMessage } from "../i18n/frontendMessageCatalog";

export interface UseSessionCommandsOptions {
  send: (request: WsRequest) => boolean;
  serverKnownSessionIdsRef: MutableRefObject<Set<string>>;
  status: SocketStatus;
}

export interface SessionCommandsHandle {
  closeSession: (sessionId: string) => boolean;
  closeSessions: (sessionIds: readonly string[]) => {
    readonly acceptedSessionIds: readonly string[];
    readonly rejectedSessionIds: readonly string[];
  };
  createSession: () => void;
  renameSession: (sessionId: string, title: string) => boolean;
  updateUserProfile: (profile: ConversationProfileUpdate) => void;
}

export function normalizeSessionTitle(title: string): string | null {
  const nextTitle = title.trim();
  return nextTitle ? nextTitle : null;
}

export function findReusableEmptySessionId({
  sessions,
  sessionOrder,
  pendingDeletedSessionIds,
}: Pick<StoreState, "sessions" | "sessionOrder" | "pendingDeletedSessionIds">): string | undefined {
  return sessionOrder.find((sessionId) => {
    const session = sessions[sessionId];
    if (
      !session ||
      pendingDeletedSessionIds[sessionId] ||
      session.status === "closed" ||
      session.title !== DEFAULT_SESSION_TITLE
    ) {
      return false;
    }
    return (
      session.entryCount === 0 &&
      session.messageCount === 0 &&
      session.messages.length === 0 &&
      session.runs.length === 0 &&
      !session.activeRequestId
    );
  });
}

function readDeletableSessionIds(state: StoreState): readonly string[] {
  return state.sessionOrder.filter((sessionId) => {
    return (
      Boolean(state.sessions[sessionId]) &&
      !state.missingOnServerIds[sessionId] &&
      !state.pendingDeletedSessionIds[sessionId]
    );
  });
}

export function useSessionCommands({
  send,
  serverKnownSessionIdsRef,
  status,
}: UseSessionCommandsOptions): SessionCommandsHandle {
  const registerSession = useStore((state) => state.registerCreatingSession);
  const requestSessionDeletions = useStore((state) => state.requestSessionDeletions);
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

    registerSession(sessionId);
    serverKnownSessionIdsRef.current.add(sessionId);
  }, [registerSession, selectSession, send, serverKnownSessionIdsRef, status]);

  const closeSessions = useCallback(
    (sessionIds: readonly string[]) => {
      const requestedSessionIds = [...new Set(sessionIds.filter(Boolean))];
      if (requestedSessionIds.length === 0) {
        return { acceptedSessionIds: [], rejectedSessionIds: [] };
      }
      const deletableSessionIds = readDeletableSessionIds(useStore.getState());
      const deletesEntireCatalog =
        deletableSessionIds.length > 0 &&
        deletableSessionIds.length === requestedSessionIds.length &&
        deletableSessionIds.every((sessionId) => requestedSessionIds.includes(sessionId));
      const accepted = send({ type: "session.close_many", sessionIds: requestedSessionIds });
      const acceptedSessionIds = accepted ? requestedSessionIds : [];
      const rejectedSessionIds = accepted ? [] : requestedSessionIds;
      if (acceptedSessionIds.length > 0) {
        requestSessionDeletions(acceptedSessionIds);
        if (deletesEntireCatalog) createSession();
      }
      return { acceptedSessionIds, rejectedSessionIds };
    },
    [createSession, requestSessionDeletions, send],
  );
  const closeSession = useCallback(
    (sessionId: string): boolean => closeSessions([sessionId]).acceptedSessionIds.length > 0,
    [closeSessions],
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
    (profile: ConversationProfileUpdate): void => {
      setUserProfile(profile);
      if (status === "open") {
        send({ type: "profile.update", profile });
      }
    },
    [send, setUserProfile, status],
  );

  return {
    closeSession,
    closeSessions,
    createSession,
    renameSession,
    updateUserProfile,
  };
}
