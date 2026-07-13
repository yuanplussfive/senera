import { useStore } from "../sessionStore";
import type { RunRecord } from "../sessionStore";
import { useShallow } from "zustand/react/shallow";

/**
 * Optimized selector for chat state - prevents unnecessary re-renders
 * by using shallow comparison on the returned object.
 */
export function useChatState(sessionId: string | null) {
  return useStore(
    useShallow((s) => ({
      session: sessionId ? s.sessions[sessionId] : null,
      historyLoading: sessionId ? !!s.historyLoadingIds[sessionId] : false,
      historyFailed: sessionId ? !!s.historyFailedIds[sessionId] : false,
    })),
  );
}

/**
 * Selector for session metadata only (without full run data).
 */
export function useSessionMetadata(sessionId: string | null) {
  return useStore(
    useShallow((s) => {
      const session = sessionId ? s.sessions[sessionId] : null;
      return {
        title: session?.title,
        messageCount: session?.messageCount,
        sessionId: session?.sessionId,
        createdAt: session?.createdAt,
        updatedAt: session?.updatedAt,
      };
    }),
  );
}

/**
 * Selector for the active running request.
 */
export function useActiveRun(sessionId: string | null): RunRecord | null {
  return useStore((s) => {
    const session = sessionId ? s.sessions[sessionId] : null;
    if (!session?.runs || session.runs.length === 0) return null;

    const lastRun = session.runs[session.runs.length - 1];
    return lastRun?.status === "running" ? lastRun : null;
  });
}

/**
 * Selector for model configuration.
 */
export function useModelConfig() {
  return useStore(
    useShallow((s) => ({
      modelProviders: s.modelProviders,
      selectedModelProviderId: s.selectedModelProviderId,
    })),
  );
}

/**
 * Selector for UI state (sidebar, panels, etc).
 */
export function useUIState() {
  return useStore(
    useShallow((s) => ({
      sidebarCollapsed: s.sidebarCollapsed,
      rightPanelCollapsed: s.rightPanelCollapsed,
      motionLevel: s.motionLevel,
    })),
  );
}

/**
 * Selector for session list data.
 */
export function useSessionList() {
  return useStore(
    useShallow((s) => ({
      sessionOrder: s.sessionOrder,
      sessions: s.sessions,
      activeSessionId: s.activeSessionId,
    })),
  );
}
