import { useCallback, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import type { ChatMessage } from "../store/sessionStore";
import { useStore, type SessionRecord } from "../store/sessionStore";
import { frontendMessage } from "../i18n/frontendMessageCatalog";

export interface UseWorkflowNavigationOptions {
  activeSessionId: string | null;
  hasPersistentWorkflowPanel: boolean;
  setWorkflowDrawerOpen: Dispatch<SetStateAction<boolean>>;
  onSelectAgents?: (childRunId: string) => void;
}

export interface WorkflowNavigationHandle {
  viewMessageWorkflow: (message: ChatMessage) => void;
  viewChildRun: (childRunId: string) => void;
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
  onSelectAgents,
}: UseWorkflowNavigationOptions): WorkflowNavigationHandle {
  const setViewedRun = useStore((state) => state.setViewedRun);
  const revealWorkflow = useCallback(() => {
    if (!hasPersistentWorkflowPanel) setWorkflowDrawerOpen(true);
    else useStore.getState().setRightPanelCollapsed(false);
  }, [hasPersistentWorkflowPanel, setWorkflowDrawerOpen]);

  const viewMessageWorkflow = useCallback(
    (message: ChatMessage): void => {
      const state = useStore.getState();
      const result = findMessageWorkflowRun({
        activeSessionId,
        message,
        sessions: state.sessions,
      });

      if (result.kind === "missing_message_request") {
        toast.error(frontendMessage("workflow.messageRunMissing"));
        return;
      }
      if (result.kind === "run_not_found") {
        toast.info(frontendMessage("workflow.currentSessionOnlyTitle"), {
          description: frontendMessage("workflow.currentSessionOnlyDescription"),
        });
        return;
      }

      setViewedRun(result.sessionId, result.requestId);
      revealWorkflow();
    },
    [activeSessionId, setViewedRun, revealWorkflow],
  );

  const viewChildRun = useCallback(
    (childRunId: string): void => {
      if (!activeSessionId) return;
      const session = useStore.getState().sessions[activeSessionId];
      const run = session?.runs.find((candidate) => candidate.steps.some((step) => step.childRun?.id === childRunId));
      if (!run) return;
      setViewedRun(activeSessionId, run.requestId);
      onSelectAgents?.(childRunId);
      revealWorkflow();
    },
    [activeSessionId, setViewedRun, onSelectAgents, revealWorkflow],
  );

  return { viewMessageWorkflow, viewChildRun };
}
