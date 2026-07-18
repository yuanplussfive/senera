import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { AgentSocketHandle, SocketStatus } from "../api/useAgentSocket";
import type { ApprovalResolutionScope } from "../api/approvalEventTypes";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import type { ChatMessageActions, ChatNavigationActions, ChatRuntimeState } from "../features/chat/ChatPanelContracts";

export interface AppChatPanelBindings {
  chatMessageActions: ChatMessageActions;
  chatNavigationActions: ChatNavigationActions;
  chatRuntime: ChatRuntimeState;
}

export function useAppChatPanelBindings({
  messageHandlers,
  navigationHandlers,
  runtime,
  send,
  status,
}: {
  messageHandlers: Omit<ChatMessageActions, "onResolveApproval">;
  navigationHandlers: {
    onOpenSessionPanel: () => void;
    onOpenWorkflowPanel: () => void;
    onRetryHistory: (sessionId: string) => void;
    showSessionPanelAction: boolean;
    showWorkflowPanelAction: boolean;
  };
  runtime: Pick<ChatRuntimeState, "uploadUrl" | "uploadCsrfToken">;
  send: AgentSocketHandle["send"];
  status: SocketStatus;
}): AppChatPanelBindings {
  const { onCancel, onDeleteFromMessage, onEditUserMessage, onRegenerate, onSend, onViewWorkflow } = messageHandlers;
  const { onOpenSessionPanel, onOpenWorkflowPanel, onRetryHistory, showSessionPanelAction, showWorkflowPanelAction } =
    navigationHandlers;
  const { uploadUrl, uploadCsrfToken } = runtime;

  const handleResolveApproval = useCallback(
    (approvalId: string, approvalStatus: "approved" | "denied", scope?: ApprovalResolutionScope): void => {
      if (status !== "open") {
        toast.error(frontendMessage("approval.resolveOffline"));
        return;
      }
      const ok = send({
        type: "approval.resolve",
        approvalId,
        status: approvalStatus,
        ...(scope ? { scope } : {}),
      });
      if (!ok) {
        toast.error(frontendMessage("approval.resolveDisconnected"));
      }
    },
    [send, status],
  );

  const chatRuntime = useMemo<ChatRuntimeState>(
    () => ({
      socketStatus: status,
      uploadUrl,
      uploadCsrfToken,
    }),
    [status, uploadCsrfToken, uploadUrl],
  );

  const chatMessageActions = useMemo<ChatMessageActions>(
    () => ({
      onCancel,
      onDeleteFromMessage,
      onEditUserMessage,
      onRegenerate,
      onSend,
      onViewWorkflow,
      onResolveApproval: handleResolveApproval,
    }),
    [handleResolveApproval, onCancel, onDeleteFromMessage, onEditUserMessage, onRegenerate, onSend, onViewWorkflow],
  );

  const chatNavigationActions = useMemo<ChatNavigationActions>(
    () => ({
      onOpenSessionPanel: showSessionPanelAction ? onOpenSessionPanel : undefined,
      onOpenWorkflowPanel: showWorkflowPanelAction ? onOpenWorkflowPanel : undefined,
      onRetryHistory,
    }),
    [onOpenSessionPanel, onOpenWorkflowPanel, onRetryHistory, showSessionPanelAction, showWorkflowPanelAction],
  );

  return {
    chatMessageActions,
    chatNavigationActions,
    chatRuntime,
  };
}
