import { useCallback, type MutableRefObject } from "react";
import { toast } from "sonner";
import type { UploadAttachmentData, WsRequest } from "../api/eventTypes";
import type { ApprovalDecision } from "../api/approvalEventTypes";
import type { InteractionInputAction, InteractionInputContent } from "../api/eventTypes";
import type { SocketStatus } from "../api/useAgentSocket";
import { useStore, type ChatMessage } from "../store/sessionStore";
import { generateId } from "../lib/util";
import { frontendMessage } from "../i18n/frontendMessageCatalog";

export interface RegenerateFromRequest {
  sessionId: string;
  fromRequestId: string;
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
    options?: { createRun?: boolean },
  ) => void;
  lastSendRef: MutableRefObject<LastSentMessage | null>;
  registerSession: (sessionId: string, title?: string, modelProviderId?: string | null) => void;
  send: (request: WsRequest) => boolean;
  serverKnownSessionIdsRef: MutableRefObject<Set<string>>;
  status: SocketStatus;
}

export interface ChatCommandsHandle {
  cancelActiveSession: () => void;
  deleteFromMessage: (message: ChatMessage) => void;
  editUserMessage: (message: ChatMessage, nextContent: string) => void;
  forkFromMessage: (message: ChatMessage) => void;
  regenerateMessage: (message: ChatMessage) => void;
  resolveApproval: (approvalId: string, decision: ApprovalDecision) => void;
  resolveInteractionInput: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
  sendMessage: (input: string, attachments?: UploadAttachmentData[], queueMode?: MessageQueueMode) => boolean;
}

export type MessageQueueMode = Extract<WsRequest, { type: "session.message" }>["queueMode"];

export interface LastSentMessage {
  sessionId: string;
  requestId: string;
  input: string;
  attachments?: UploadAttachmentData[];
  modelProviderId?: string;
  queueMode?: MessageQueueMode;
}

export type SendTargetResolution =
  | { kind: "blocked_history_loading"; sessionId: string }
  | { kind: "ready"; sessionId: string; shouldCreateSession: boolean };

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

export function findRegenerateInput({
  activeSessionId,
  message,
}: {
  activeSessionId: string | null;
  message: ChatMessage;
}):
  | {
      attachments?: UploadAttachmentData[];
      kind: "found";
      input: string;
      requestId: string;
    }
  | { kind: "missing_request" }
  | { kind: "not_found" } {
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
  registerSession,
  send,
  serverKnownSessionIdsRef,
  status,
}: UseChatCommandsOptions): ChatCommandsHandle {
  const regenerateFromRequest = useCallback(
    (request: RegenerateFromRequest): boolean => {
      const requestId = generateId();
      const ok = send({
        type: "session.regenerate",
        sessionId: request.sessionId,
        fromRequestId: request.fromRequestId,
        requestId,
        modelProviderId: request.modelProviderId,
        input: request.nextInput,
        attachments: request.attachments,
      });
      if (!ok) {
        toast.error(frontendMessage("chat.operationDisconnected"));
        return false;
      }

      useStore.getState().truncateFromRequest(request.sessionId, request.fromRequestId);
      lastSendRef.current = {
        sessionId: request.sessionId,
        requestId,
        input: request.nextInput,
        attachments: request.attachments,
        modelProviderId: request.modelProviderId,
      };
      appendUserMessage(request.sessionId, requestId, request.nextInput, request.attachments);
      return true;
    },
    [appendUserMessage, lastSendRef, send],
  );

  const cancelActiveSession = useCallback((): void => {
    if (!activeSessionId) return;
    if (status !== "open") return;
    send({ type: "session.cancel", sessionId: activeSessionId });
    toast.message(frontendMessage("chat.cancelRequested"));
  }, [activeSessionId, send, status]);

  const regenerateMessage = useCallback(
    (message: ChatMessage): void => {
      if (!activeSessionId || status !== "open") return;

      const result = findRegenerateInput({ activeSessionId, message });
      if (result.kind === "missing_request") {
        toast.error(frontendMessage("chat.regenerateMissingRequestId"));
        return;
      }
      if (result.kind === "not_found") {
        toast.error(frontendMessage("chat.regenerateSourceNotFound"));
        return;
      }

      regenerateFromRequest({
        sessionId: activeSessionId,
        fromRequestId: result.requestId,
        nextInput: result.input,
        attachments: result.attachments,
        modelProviderId: useStore.getState().selectedModelProviderId ?? undefined,
      });
    },
    [activeSessionId, regenerateFromRequest, status],
  );

  const forkFromMessage = useCallback(
    (message: ChatMessage): void => {
      if (!activeSessionId || status !== "open") return;
      if (!message.requestId) {
        toast.error(frontendMessage("chat.forkMissingRequestId"));
        return;
      }

      const ok = send({
        type: "session.fork",
        sourceSessionId: activeSessionId,
        sessionId: generateId(),
        throughRequestId: message.requestId,
      });
      if (!ok) {
        toast.error(frontendMessage("chat.forkDisconnected"));
      }
    },
    [activeSessionId, send, status],
  );

  const editUserMessage = useCallback(
    (message: ChatMessage, nextContent: string): void => {
      if (!activeSessionId || status !== "open") return;
      if (!message.requestId) {
        toast.error(frontendMessage("chat.editMissingRequestId"));
        return;
      }
      const trimmed = normalizeEditedMessageContent(nextContent);
      if (!trimmed) {
        toast.error(frontendMessage("chat.contentRequired"));
        return;
      }

      regenerateFromRequest({
        sessionId: activeSessionId,
        fromRequestId: message.requestId,
        nextInput: trimmed,
        attachments: message.attachments,
        modelProviderId: useStore.getState().selectedModelProviderId ?? undefined,
      });
    },
    [activeSessionId, regenerateFromRequest, status],
  );

  const deleteFromMessage = useCallback(
    (message: ChatMessage): void => {
      if (!activeSessionId || status !== "open") return;
      if (!message.requestId) {
        toast.error(frontendMessage("chat.deleteMissingRequestId"));
        return;
      }
      const ok = send({
        type: "session.truncate_from",
        sessionId: activeSessionId,
        requestId: message.requestId,
      });
      if (!ok) {
        toast.error(frontendMessage("chat.deleteDisconnected"));
        return;
      }
      toast.success(frontendMessage("chat.deleted"));
    },
    [activeSessionId, send, status],
  );

  const sendMessage = useCallback(
    (input: string, attachments?: UploadAttachmentData[], queueMode?: MessageQueueMode): boolean => {
      const state = useStore.getState();
      const modelProviderId = state.selectedModelProviderId ?? undefined;
      const target = resolveSendTargetSession({
        activeSessionId,
        createSessionId: generateId,
        historyLoadingIds: state.historyLoadingIds,
        missingOnServerIds: state.missingOnServerIds,
      });

      if (target.kind === "blocked_history_loading") {
        toast.warning(frontendMessage("chat.historyRecovering"));
        return false;
      }

      const targetSessionId = target.sessionId;
      if (activeSessionId && target.shouldCreateSession) {
        serverKnownSessionIdsRef.current.delete(activeSessionId);
      }

      const requestId = generateId();
      const createIfMissing = !serverKnownSessionIdsRef.current.has(targetSessionId);
      const ok = send({
        type: "session.message",
        sessionId: targetSessionId,
        requestId,
        modelProviderId,
        input,
        attachments,
        disposition: createIfMissing ? "create_if_missing" : undefined,
        queueMode,
      });
      if (!ok) {
        toast.error(frontendMessage("chat.sendDisconnected"));
        return false;
      }
      if (target.shouldCreateSession) {
        registerSession(targetSessionId, undefined, modelProviderId);
      }
      serverKnownSessionIdsRef.current.add(targetSessionId);
      appendUserMessage(targetSessionId, requestId, input, attachments, {
        createRun: queueMode === undefined,
      });
      lastSendRef.current = { sessionId: targetSessionId, requestId, input, attachments, modelProviderId, queueMode };
      return true;
    },
    [activeSessionId, appendUserMessage, lastSendRef, registerSession, send, serverKnownSessionIdsRef],
  );

  const resolveApproval = useCallback(
    (approvalId: string, decision: ApprovalDecision): void => {
      if (!activeSessionId || status !== "open") return;
      send({
        type: "approval.resolve",
        approvalId,
        decision,
      });
    },
    [activeSessionId, send, status],
  );

  const resolveInteractionInput = useCallback(
    (interactionId: string, action: InteractionInputAction, content?: InteractionInputContent): void => {
      if (status !== "open") {
        toast.error(frontendMessage("interaction.input.resolveOffline"));
        return;
      }
      useStore.getState().markInteractionInputResolutionPending(interactionId, action);
      const ok = send({ type: "interaction.input.resolve", interactionId, action, content });
      if (!ok) {
        useStore.getState().markInteractionInputResolutionPending(interactionId);
        toast.error(frontendMessage("interaction.input.resolveDisconnected"));
      }
    },
    [send, status],
  );

  return {
    cancelActiveSession,
    deleteFromMessage,
    editUserMessage,
    forkFromMessage,
    regenerateMessage,
    resolveApproval,
    resolveInteractionInput,
    sendMessage,
  };
}
