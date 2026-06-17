import { useCallback, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import type { ChatMessage } from "../store/sessionStore";
import { useStore, type SessionRecord } from "../store/sessionStore";

export interface UseWorkflowNavigationOptions {
  activeSessionId: string | null;
  hasPersistentWorkflowPanel: boolean;
  setWorkflowDrawerOpen: Dispatch<SetStateAction<boolean>>;
}

export interface WorkflowNavigationHandle {
  viewMessageWorkflow: (message: ChatMessage) => void;
}

export type WorkflowNavigationLookupResult =
  | { kind: "missing_message_request" }
  | { kind: "run_not_found" }
  | { kind: "found"; requestId: string; sessionId: string };

export function findMessageWorkflowRun({
  activeSessionId,
  message,
  sessions,
}: {
  activeSessionId: string | null;
  message: Pick<ChatMessage, "requestId">;
  sessions: Record<string, SessionRecord>;
}): WorkflowNavigationLookupResult {
  if (!activeSessionId || !message.requestId) {
    return { kind: "missing_message_request" };
  }

  const session = sessions[activeSessionId];
  const run = session?.runs.find((candidate) => candidate.requestId === message.requestId);
  if (!run) {
    return { kind: "run_not_found" };
  }

  return { kind: "found", requestId: run.requestId, sessionId: activeSessionId };
}

export function useWorkflowNavigation({
  activeSessionId,
  hasPersistentWorkflowPanel,
  setWorkflowDrawerOpen,
}: UseWorkflowNavigationOptions): WorkflowNavigationHandle {
  const setViewedRun = useStore((state) => state.setViewedRun);

  const viewMessageWorkflow = useCallback((message: ChatMessage): void => {
    const state = useStore.getState();
    const result = findMessageWorkflowRun({
      activeSessionId,
      message,
      sessions: state.sessions,
    });

    if (result.kind === "missing_message_request") {
      toast.error("无法定位该消息的工作流");
      return;
    }
    if (result.kind === "run_not_found") {
      toast.info("该轮工作流仅在当前 session 期间可见", {
        description: "刷新后历史消息的思考过程不再保留——只有原始对话条目可恢复。",
      });
      return;
    }

    setViewedRun(result.sessionId, result.requestId);
    if (!hasPersistentWorkflowPanel) {
      setWorkflowDrawerOpen(true);
      return;
    }
    if (state.rightPanelCollapsed) {
      state.toggleRightPanel();
    }
  }, [activeSessionId, hasPersistentWorkflowPanel, setViewedRun, setWorkflowDrawerOpen]);

  return { viewMessageWorkflow };
}
