import { useCallback, type MutableRefObject } from "react";
import { toast } from "sonner";
import type { UploadAttachmentData, WsRequest } from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { useStore, type ChatMessage } from "../store/sessionStore";
import { generateId } from "../lib/util";

export interface PendingAfterTruncate {
  sessionId: string;
  requestId: string;
  nextInput: string;
  attachments?: UploadAttachmentData[];
  modelProviderId?: string;
}

export interface UseChatCommandsOptions {
  activeSessionId: string | null;
  appendUserMessage: (
    sessionId: string,
    requestId: string,
    input: string,
    attachments?: UploadAttachmentData[],
  ) => void;
  lastSendRef: MutableRefObject<LastSentMessage | null>;
  pendingAfterTruncateRef: MutableRefObject<PendingAfterTruncate[]>;
  registerSession: (sessionId: string) => void;
  send: (request: WsRequest) => boolean;
  serverKnownSessionIdsRef: MutableRefObject<Set<string>>;
  status: SocketStatus;
}

export interface ChatCommandsHandle {
  cancelActiveSession: () => void;
  deleteFromMessage: (message: ChatMessage) => void;
  editUserMessage: (message: ChatMessage, nextContent: string) => void;
  regenerateMessage: (message: ChatMessage) => void;
  sendMessage: (input: string, attachments?: UploadAttachmentData[]) => void;
  sendAfterTruncate: (pending: PendingAfterTruncate) => boolean;
}

export interface LastSentMessage {
  sessionId: string;
  requestId: string;
  input: string;
  attachments?: UploadAttachmentData[];
  modelProviderId?: string;
}

export type SendTargetResolution =
  | { kind: "blocked_history_loading"; sessionId: string }
  | { kind: "ready"; sessionId: string; shouldCreateSession: boolean };

export interface PendingReplayConsumption {
  appendUserMessage: {
    attachments?: UploadAttachmentData[];
    input: string;
    requestId: string;
    sessionId: string;
  };
  lastSentMessage: LastSentMessage;
  messageRequest: Extract<WsRequest, { type: "session.message" }>;
  nextQueue: PendingAfterTruncate[];
}

export function resolveSendTargetSession({
  activeSessionId,
  createSessionId,
  historyLoadingIds,
  missingOnServerIds,
}: {
  activeSessionId: string | null;
  createSessionId: () => string;
  historyLoadingIds: Record<string, boolean>;
  missingOnServerIds: Record<string, boolean>;
}): SendTargetResolution {
  if (activeSessionId && historyLoadingIds[activeSessionId]) {
    return { kind: "blocked_history_loading", sessionId: activeSessionId };
  }
  if (!activeSessionId || missingOnServerIds[activeSessionId]) {
    return { kind: "ready", sessionId: createSessionId(), shouldCreateSession: true };
  }
  return { kind: "ready", sessionId: activeSessionId, shouldCreateSession: false };
}

export function upsertPendingAfterTruncate(
  queue: readonly PendingAfterTruncate[],
  pending: PendingAfterTruncate,
): PendingAfterTruncate[] {
  return [
    ...queue.filter((item) => item.sessionId !== pending.sessionId || item.requestId !== pending.requestId),
    pending,
  ];
}

export function removePendingAfterTruncate(
  queue: readonly PendingAfterTruncate[],
  pending: Pick<PendingAfterTruncate, "requestId" | "sessionId">,
): PendingAfterTruncate[] {
  return queue.filter((item) => item.sessionId !== pending.sessionId || item.requestId !== pending.requestId);
}

export function consumePendingAfterTruncate({
  createRequestId,
  fromRequestId,
  queue,
  sessionId,
}: {
  createRequestId: () => string;
  fromRequestId: string;
  queue: readonly PendingAfterTruncate[];
  sessionId: string;
}): PendingReplayConsumption | null {
  const pending = queue.find((item) => item.sessionId === sessionId && item.requestId === fromRequestId);
  if (!pending) return null;

  const requestId = createRequestId();
  const messageRequest: Extract<WsRequest, { type: "session.message" }> = {
    type: "session.message",
    sessionId: pending.sessionId,
    requestId,
    modelProviderId: pending.modelProviderId,
    input: pending.nextInput,
    attachments: pending.attachments,
  };

  return {
    appendUserMessage: {
      sessionId: pending.sessionId,
      requestId,
      input: pending.nextInput,
      attachments: pending.attachments,
    },
    lastSentMessage: {
      sessionId: pending.sessionId,
      requestId,
      input: pending.nextInput,
      attachments: pending.attachments,
      modelProviderId: pending.modelProviderId,
    },
    messageRequest,
    nextQueue: removePendingAfterTruncate(queue, pending),
  };
}

export function findRegenerateInput({
  activeSessionId,
  message,
}: {
  activeSessionId: string | null;
  message: ChatMessage;
}): {
  attachments?: UploadAttachmentData[];
  kind: "found";
  input: string;
  requestId: string;
} | { kind: "missing_request" } | { kind: "not_found" } {
  if (!activeSessionId || !message.requestId) {
    return { kind: "missing_request" };
  }

  const session = useStore.getState().sessions[activeSessionId];
  const userMessage = session?.messages.find(
    (candidate) => candidate.requestId === message.requestId && candidate.role === "user",
  );
  if (!userMessage) {
    return { kind: "not_found" };
  }

  return {
    kind: "found",
    input: userMessage.content,
    attachments: userMessage.attachments,
    requestId: message.requestId,
  };
}

export function normalizeEditedMessageContent(content: string): string | null {
  const trimmed = content.trim();
  return trimmed ? trimmed : null;
}

export function useChatCommands({
  activeSessionId,
  appendUserMessage,
  lastSendRef,
  pendingAfterTruncateRef,
  registerSession,
  send,
  serverKnownSessionIdsRef,
  status,
}: UseChatCommandsOptions): ChatCommandsHandle {
  const sendAfterTruncate = useCallback((pending: PendingAfterTruncate): boolean => {
    pendingAfterTruncateRef.current = upsertPendingAfterTruncate(pendingAfterTruncateRef.current, pending);

    const ok = send({
      type: "session.truncate_from",
      sessionId: pending.sessionId,
      requestId: pending.requestId,
    });
    if (!ok) {
      pendingAfterTruncateRef.current = removePendingAfterTruncate(pendingAfterTruncateRef.current, pending);
      toast.error("操作失败，连接可能已断开");
    }
    return ok;
  }, [pendingAfterTruncateRef, send]);

  const cancelActiveSession = useCallback((): void => {
    if (!activeSessionId) return;
    if (status !== "open") return;
    send({ type: "session.cancel", sessionId: activeSessionId });
    toast("已发送中断请求…");
  }, [activeSessionId, send, status]);

  const regenerateMessage = useCallback((message: ChatMessage): void => {
    if (!activeSessionId || status !== "open") return;

    const result = findRegenerateInput({ activeSessionId, message });
    if (result.kind === "missing_request") {
      toast.error("无法重新回答：缺少 requestId");
      return;
    }
    if (result.kind === "not_found") {
      toast.error("找不到对应的用户消息");
      return;
    }

    sendAfterTruncate({
      sessionId: activeSessionId,
      requestId: result.requestId,
      nextInput: result.input,
      attachments: result.attachments,
      modelProviderId: useStore.getState().selectedModelProviderId ?? undefined,
    });
  }, [activeSessionId, sendAfterTruncate, status]);

  const editUserMessage = useCallback((message: ChatMessage, nextContent: string): void => {
    if (!activeSessionId || status !== "open") return;
    if (!message.requestId) {
      toast.error("无法编辑：缺少 requestId");
      return;
    }
    const trimmed = normalizeEditedMessageContent(nextContent);
    if (!trimmed) {
      toast.error("内容不能为空");
      return;
    }

    sendAfterTruncate({
      sessionId: activeSessionId,
      requestId: message.requestId,
      nextInput: trimmed,
      attachments: message.attachments,
      modelProviderId: useStore.getState().selectedModelProviderId ?? undefined,
    });
  }, [activeSessionId, sendAfterTruncate, status]);

  const deleteFromMessage = useCallback((message: ChatMessage): void => {
    if (!activeSessionId || status !== "open") return;
    if (!message.requestId) {
      toast.error("无法删除：缺少 requestId");
      return;
    }
    const ok = send({
      type: "session.truncate_from",
      sessionId: activeSessionId,
      requestId: message.requestId,
    });
    if (!ok) {
      toast.error("删除失败，连接可能已断开");
      return;
    }
    toast.success("已删除");
  }, [activeSessionId, send, status]);

  const sendMessage = useCallback((input: string, attachments?: UploadAttachmentData[]): void => {
    const state = useStore.getState();
    const modelProviderId = state.selectedModelProviderId ?? undefined;
    const target = resolveSendTargetSession({
      activeSessionId,
      createSessionId: generateId,
      historyLoadingIds: state.historyLoadingIds,
      missingOnServerIds: state.missingOnServerIds,
    });

    if (target.kind === "blocked_history_loading") {
      toast.warning("正在恢复历史，请稍后再发送");
      return;
    }

    const targetSessionId = target.sessionId;
    if (activeSessionId && target.shouldCreateSession) {
      serverKnownSessionIdsRef.current.delete(activeSessionId);
    }

    if (target.shouldCreateSession) {
      const ok = send({ type: "session.create", sessionId: targetSessionId });
      if (!ok) {
        toast.error("创建会话失败，连接可能已断开");
        return;
      }
      registerSession(targetSessionId);
      serverKnownSessionIdsRef.current.add(targetSessionId);
    }

    const requestId = generateId();
    if (!serverKnownSessionIdsRef.current.has(targetSessionId)) {
      const ok = send({ type: "session.create", sessionId: targetSessionId });
      if (!ok) {
        toast.error("创建会话失败，连接可能已断开");
        return;
      }
      serverKnownSessionIdsRef.current.add(targetSessionId);
    }

    appendUserMessage(targetSessionId, requestId, input, attachments);
    lastSendRef.current = { sessionId: targetSessionId, requestId, input, attachments, modelProviderId };
    const ok = send({
      type: "session.message",
      sessionId: targetSessionId,
      requestId,
      modelProviderId,
      input,
      attachments,
    });
    if (!ok) {
      toast.error("发送失败，连接可能已断开");
    }
  }, [
    activeSessionId,
    appendUserMessage,
    lastSendRef,
    registerSession,
    send,
    serverKnownSessionIdsRef,
  ]);

  return {
    cancelActiveSession,
    deleteFromMessage,
    editUserMessage,
    regenerateMessage,
    sendMessage,
    sendAfterTruncate,
  };
}
