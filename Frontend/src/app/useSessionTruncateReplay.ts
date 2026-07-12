import { useCallback, type MutableRefObject } from "react";
import { toast } from "sonner";
import { EventKinds, type EventEnvelope, type SessionTruncatedData, type WsRequest } from "../api/eventTypes";
import { useStore, type StoreState } from "../store/sessionStore";
import { generateId } from "../lib/util";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import {
  consumePendingAfterTruncate,
  type LastSentMessage,
  type PendingReplayConsumption,
  type PendingAfterTruncate,
} from "./useChatCommands";

export interface UseSessionTruncateReplayOptions {
  appendUserMessage?: StoreState["appendUserMessage"];
  createRequestId?: () => string;
  lastSendRef: MutableRefObject<LastSentMessage | null>;
  pendingAfterTruncateRef: MutableRefObject<PendingAfterTruncate[]>;
  sendRef: MutableRefObject<((request: WsRequest) => boolean) | null>;
}

export interface SessionTruncateReplayHandle {
  replayAfterSessionTruncated: (env: EventEnvelope) => boolean;
}

export interface SessionTruncateReplayExecution {
  appendUserMessage: StoreState["appendUserMessage"];
  lastSendRef: MutableRefObject<LastSentMessage | null>;
  pendingAfterTruncateRef: MutableRefObject<PendingAfterTruncate[]>;
  replay: PendingReplayConsumption;
  send: (request: WsRequest) => boolean;
}

export function useSessionTruncateReplay({
  appendUserMessage = useStore.getState().appendUserMessage,
  createRequestId = generateId,
  lastSendRef,
  pendingAfterTruncateRef,
  sendRef,
}: UseSessionTruncateReplayOptions): SessionTruncateReplayHandle {
  const replayAfterSessionTruncated = useCallback(
    (env: EventEnvelope): boolean => {
      const send = sendRef.current;
      const replay = resolveSessionTruncateReplay({
        createRequestId,
        env,
        pendingAfterTruncate: pendingAfterTruncateRef.current,
      });
      if (!send || !replay) return false;

      if (
        !executeSessionTruncateReplay({
          appendUserMessage,
          lastSendRef,
          pendingAfterTruncateRef,
          replay,
          send,
        })
      ) {
        toast.error(frontendMessage("session.replayDisconnected"));
      }
      return true;
    },
    [appendUserMessage, createRequestId, lastSendRef, pendingAfterTruncateRef, sendRef],
  );

  return { replayAfterSessionTruncated };
}

export function executeSessionTruncateReplay({
  appendUserMessage,
  lastSendRef,
  pendingAfterTruncateRef,
  replay,
  send,
}: SessionTruncateReplayExecution): boolean {
  pendingAfterTruncateRef.current = replay.nextQueue;
  const ok = send(replay.messageRequest);
  if (!ok) return false;

  lastSendRef.current = replay.lastSentMessage;
  appendUserMessage(
    replay.appendUserMessage.sessionId,
    replay.appendUserMessage.requestId,
    replay.appendUserMessage.input,
    replay.appendUserMessage.attachments,
  );
  return true;
}

export function resolveSessionTruncateReplay({
  createRequestId,
  env,
  pendingAfterTruncate,
}: {
  createRequestId: () => string;
  env: EventEnvelope;
  pendingAfterTruncate: readonly PendingAfterTruncate[];
}): ReturnType<typeof consumePendingAfterTruncate> {
  if (env.kind !== EventKinds.SessionTruncated || !env.sessionId) return null;
  const data = env.data as Partial<SessionTruncatedData>;
  if (typeof data.fromRequestId !== "string") return null;

  return consumePendingAfterTruncate({
    createRequestId,
    fromRequestId: data.fromRequestId,
    queue: pendingAfterTruncate,
    sessionId: env.sessionId,
  });
}
