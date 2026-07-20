import { useCallback, type MutableRefObject } from "react";
import { toast } from "sonner";
import { EventKinds, type EventEnvelope, type SessionNotFoundData, type WsRequest } from "../api/eventTypes";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import type { StoreState } from "../store/sessionStore";
import type { LastSentMessage } from "./useChatCommands";

export type SessionNotFoundRecoveryPlan =
  | {
      kind: "mark_missing";
      sessionId: string;
      toast: SessionNotFoundRecoveryToast;
    }
  | {
      kind: "close_missing";
      listRequest: Extract<WsRequest, { type: "session.list" }>;
      sessionId: string;
      toast: SessionNotFoundRecoveryToast;
    }
  | {
      kind: "message_recreate";
      replayRequest: Extract<WsRequest, { type: "session.message" }>;
      sessionId: string;
      toast: SessionNotFoundRecoveryToast;
    };

export interface SessionNotFoundRecoveryToast {
  description: string;
  title: string;
  variant: "info" | "warning";
}

export interface UseSessionNotFoundRecoveryOptions {
  ingest: StoreState["ingest"];
  lastSendRef: MutableRefObject<LastSentMessage | null>;
  sendRef: MutableRefObject<((request: WsRequest) => boolean) | null>;
  serverKnownSessionIdsRef: MutableRefObject<Set<string>>;
}

export interface SessionNotFoundRecoveryHandle {
  handleSessionNotFound: (env: EventEnvelope) => boolean;
}

export function resolveSessionNotFoundRecovery(
  env: EventEnvelope,
  lastSentMessage: LastSentMessage | null,
): SessionNotFoundRecoveryPlan | null {
  if (env.kind !== EventKinds.SessionNotFound || !env.sessionId) return null;

  const sessionId = env.sessionId;
  const operation = readSessionNotFoundOperation(env.data);
  return SessionNotFoundRecoveryPolicies[operation]({ sessionId, lastSentMessage });
}

export function useSessionNotFoundRecovery({
  ingest,
  lastSendRef,
  sendRef,
  serverKnownSessionIdsRef,
}: UseSessionNotFoundRecoveryOptions): SessionNotFoundRecoveryHandle {
  const handleSessionNotFound = useCallback(
    (env: EventEnvelope): boolean => {
      const plan = resolveSessionNotFoundRecovery(env, lastSendRef.current);
      if (!plan) return false;

      serverKnownSessionIdsRef.current.delete(plan.sessionId);

      switch (plan.kind) {
        case "mark_missing":
          ingest(env);
          showSessionNotFoundRecoveryToast(plan.toast);
          return true;
        case "close_missing":
          if (!sendRef.current) return false;
          sendRef.current(plan.listRequest);
          showSessionNotFoundRecoveryToast(plan.toast);
          return true;
        case "message_recreate":
          if (!sendRef.current) return false;
          if (sendRef.current(plan.replayRequest)) {
            serverKnownSessionIdsRef.current.add(plan.sessionId);
            showSessionNotFoundRecoveryToast(plan.toast);
          }
          return true;
      }
    },
    [ingest, lastSendRef, sendRef, serverKnownSessionIdsRef],
  );

  return { handleSessionNotFound };
}

function showSessionNotFoundRecoveryToast(toastConfig: SessionNotFoundRecoveryToast): void {
  if (toastConfig.variant === "warning") {
    toast.warning(toastConfig.title, { description: toastConfig.description });
    return;
  }
  toast.message(toastConfig.title, { description: toastConfig.description });
}

function readSessionNotFoundOperation(data: unknown): SessionNotFoundData["operation"] {
  if (!data || typeof data !== "object") return "session.message";
  const operation = (data as { operation?: unknown }).operation;
  return typeof operation === "string" && SessionNotFoundOperations.has(operation as SessionNotFoundData["operation"])
    ? (operation as SessionNotFoundData["operation"])
    : "session.message";
}

const SessionNotFoundOperations = new Set<SessionNotFoundData["operation"]>([
  "session.message",
  "session.close",
  "session.history",
  "session.fork",
]);

interface SessionNotFoundRecoveryContext {
  sessionId: string;
  lastSentMessage: LastSentMessage | null;
}

const SessionNotFoundRecoveryPolicies = {
  "session.close": ({ sessionId }) => ({
    kind: "close_missing",
    sessionId,
    listRequest: { type: "session.list" },
    toast: {
      variant: "info",
      title: frontendMessage("session.localRemovedTitle"),
      description: frontendMessage("session.localRemovedDescription"),
    },
  }),
  "session.history": ({ sessionId }) => missingSessionPlan(sessionId),
  "session.fork": ({ sessionId }) =>
    missingSessionPlan(sessionId, {
      title: frontendMessage("session.forkSourceMissingTitle"),
      description: frontendMessage("session.forkSourceMissingDescription"),
    }),
  "session.message": ({ sessionId, lastSentMessage }) =>
    lastSentMessage?.sessionId === sessionId
      ? recreateMissingMessagePlan(sessionId, lastSentMessage)
      : missingSessionPlan(sessionId),
} satisfies Record<
  SessionNotFoundData["operation"],
  (context: SessionNotFoundRecoveryContext) => SessionNotFoundRecoveryPlan
>;

function missingSessionPlan(
  sessionId: string,
  message: Pick<SessionNotFoundRecoveryToast, "title" | "description"> = {
    title: frontendMessage("session.missingBackendTitle"),
    description: frontendMessage("session.missingBackendDescription"),
  },
): SessionNotFoundRecoveryPlan {
  return {
    kind: "mark_missing",
    sessionId,
    toast: {
      variant: "warning",
      ...message,
    },
  };
}

function recreateMissingMessagePlan(
  sessionId: string,
  lastSentMessage: LastSentMessage,
): SessionNotFoundRecoveryPlan {
  return {
    kind: "message_recreate",
    sessionId,
    replayRequest: {
      type: "session.message",
      sessionId,
      requestId: lastSentMessage.requestId,
      input: lastSentMessage.input,
      attachments: lastSentMessage.attachments,
      modelProviderId: lastSentMessage.modelProviderId,
      disposition: "create_if_missing",
      queueMode: lastSentMessage.queueMode,
    },
    toast: {
      variant: "info",
      title: frontendMessage("session.recreatedTitle"),
      description: frontendMessage("session.recreatedDescription"),
    },
  };
}
