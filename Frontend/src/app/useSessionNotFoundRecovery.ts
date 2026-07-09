import { useCallback, type MutableRefObject } from "react";
import { toast } from "sonner";
import {
  EventKinds,
  type EventEnvelope,
  type SessionNotFoundData,
  type WsRequest,
} from "../api/eventTypes";
import type { StoreState } from "../store/sessionStore";
import type { LastSentMessage } from "./useChatCommands";

export type SessionNotFoundRecoveryPlan =
  | {
      kind: "history_missing";
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
      createRequest: Extract<WsRequest, { type: "session.create" }>;
      kind: "message_recreate";
      replayRequest?: Extract<WsRequest, { type: "session.message" }>;
      sessionId: string;
      toast?: SessionNotFoundRecoveryToast;
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

  if (operation === "session.history") {
    return {
      kind: "history_missing",
      sessionId,
      toast: {
        variant: "warning",
        title: "该本地会话在后端不存在",
        description: "已切换到仍存在历史的会话。旧的本地占位不会再被自动恢复成空会话。",
      },
    };
  }

  if (operation === "session.close") {
    return {
      kind: "close_missing",
      sessionId,
      listRequest: { type: "session.list" },
      toast: {
        variant: "info",
        title: "会话已从本地列表移除",
        description: "后端已不存在该会话。",
      },
    };
  }

  const replayRequest = lastSentMessage && lastSentMessage.sessionId === sessionId
    ? {
        type: "session.message" as const,
        sessionId,
        requestId: lastSentMessage.requestId,
        input: lastSentMessage.input,
        attachments: lastSentMessage.attachments,
        modelProviderId: lastSentMessage.modelProviderId,
        queueMode: lastSentMessage.queueMode,
      }
    : undefined;

  return {
    kind: "message_recreate",
    sessionId,
    createRequest: {
      type: "session.create",
      sessionId,
      modelProviderId: lastSentMessage?.modelProviderId,
    },
    replayRequest,
    toast: replayRequest
      ? {
          variant: "info",
          title: "已自动恢复会话",
          description: "后端不再保留先前上下文，但消息记录在前端完整保留。",
        }
      : undefined,
  };
}

export function useSessionNotFoundRecovery({
  ingest,
  lastSendRef,
  sendRef,
  serverKnownSessionIdsRef,
}: UseSessionNotFoundRecoveryOptions): SessionNotFoundRecoveryHandle {
  const handleSessionNotFound = useCallback((env: EventEnvelope): boolean => {
    const send = sendRef.current;
    if (!send) return false;

    const plan = resolveSessionNotFoundRecovery(env, lastSendRef.current);
    if (!plan) return false;

    serverKnownSessionIdsRef.current.delete(plan.sessionId);

    if (plan.kind === "history_missing") {
      ingest(env);
      showSessionNotFoundRecoveryToast(plan.toast);
      return true;
    }

    if (plan.kind === "close_missing") {
      send(plan.listRequest);
      showSessionNotFoundRecoveryToast(plan.toast);
      return true;
    }

    send(plan.createRequest);
    serverKnownSessionIdsRef.current.add(plan.sessionId);
    if (plan.replayRequest) {
      send(plan.replayRequest);
    }
    if (plan.toast) {
      showSessionNotFoundRecoveryToast(plan.toast);
    }
    return true;
  }, [ingest, lastSendRef, sendRef, serverKnownSessionIdsRef]);

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
  if (operation === "session.close" || operation === "session.history" || operation === "session.message") {
    return operation;
  }
  return "session.message";
}
