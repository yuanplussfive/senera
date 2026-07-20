import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { AgentSocketHandle, SocketStatus } from "../api/useAgentSocket";
import type { ApprovalDecision } from "../api/approvalEventTypes";
import type { InteractionInputAction, InteractionInputContent } from "../api/eventTypes";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import type { ChatMessageActions, ChatNavigationActions, ChatRuntimeState } from "../features/chat/ChatPanelContracts";
import { useStore } from "../store/sessionStore";

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
  runtime: Pick<ChatRuntimeState, "sandboxStatus" | "uploadUrl" | "uploadCsrfToken">;
  send: AgentSocketHandle["send"];
  status: SocketStatus;
}): AppChatPanelBindings {
  const { onCancel, onDeleteFromMessage, onEditUserMessage, onForkFromMessage, onRegenerate, onSend, onViewWorkflow } =
    messageHandlers;
  const { onOpenSessionPanel, onOpenWorkflowPanel, onRetryHistory, showSessionPanelAction, showWorkflowPanelAction } =
    navigationHandlers;
  const { sandboxStatus, uploadUrl, uploadCsrfToken } = runtime;
  const markApprovalResolutionPending = useStore((state) => state.markApprovalResolutionPending);
  const markInteractionInputResolutionPending = useStore((state) => state.markInteractionInputResolutionPending);

  const handleResolveApproval = useCallback(
    (approvalId: string, decision: ApprovalDecision): void => {
      if (status !== "open") {
        toast.error(frontendMessage("approval.resolveOffline"));
        return;
      }
      markApprovalResolutionPending(approvalId, decision);
      const ok = send({
        type: "approval.resolve",
        approvalId,
        decision,
      });
      if (!ok) {
        markApprovalResolutionPending(approvalId);
        toast.error(frontendMessage("approval.resolveDisconnected"));
      }
    },
    [markApprovalResolutionPending, send, status],
  );

  const handleResolveInteractionInput = useCallback(
    (interactionId: string, action: InteractionInputAction, content?: InteractionInputContent): void => {
      if (status !== "open") {
        toast.error(frontendMessage("interaction.input.resolveOffline"));
        return;
      }
      markInteractionInputResolutionPending(interactionId, action);
      const ok = send({ type: "interaction.input.resolve", interactionId, action, content });
      if (!ok) {
        markInteractionInputResolutionPending(interactionId);
        toast.error(frontendMessage("interaction.input.resolveDisconnected"));
      }
    },
    [markInteractionInputResolutionPending, send, status],
  );

  const chatRuntime = useMemo<ChatRuntimeState>(
    () => ({
      socketStatus: status,
      sandboxStatus,
      uploadUrl,
      uploadCsrfToken,
    }),
    [sandboxStatus, status, uploadCsrfToken, uploadUrl],
  );

  const chatMessageActions = useMemo<ChatMessageActions>(
    () => ({
      onCancel,
      onDeleteFromMessage,
      onEditUserMessage,
      onForkFromMessage,
      onRegenerate,
      onSend,
      onViewWorkflow,
      onResolveApproval: handleResolveApproval,
      onResolveInteractionInput: handleResolveInteractionInput,
    }),
    [
      handleResolveApproval,
      handleResolveInteractionInput,
      onCancel,
      onDeleteFromMessage,
      onEditUserMessage,
      onForkFromMessage,
      onRegenerate,
      onSend,
      onViewWorkflow,
    ],
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
