import { useStore } from "../sessionStore";
import type { RunRecord } from "../sessionStore";
import { useShallow } from "zustand/react/shallow";
import { useMemo } from "react";
import type { EventSourceChannel } from "../../api/eventTypes";
import type { SessionRecord, StoreState } from "../sessionStore";
import { DEFAULT_SESSION_TITLE } from "../session/defaults";
import { readActiveRun } from "../session/sessionProjectorCore";
import { readSessionHydrationState } from "../session/sessionHydration";

export type { SessionHydrationState } from "../session/sessionHydration";

/**
 * Optimized selector for chat state - prevents unnecessary re-renders
 * by using shallow comparison on the returned object.
 */
export function useChatState(sessionId: string | null) {
  return useStore(
    useShallow((s) => ({
      session: sessionId ? s.sessions[sessionId] : null,
      historyLoaded: sessionId ? !!s.historyLoadedIds[sessionId] : false,
      historyLoading: sessionId ? !!s.historyLoadingIds[sessionId] : false,
      historyFailed: sessionId ? !!s.historyFailedIds[sessionId] : false,
      historyHydrating: sessionId ? !!s.historyHydration?.[sessionId] : false,
      catalogSynced: s.catalogSynced.sessions,
      hydrationState: readSessionHydrationState({
        catalogSynced: s.catalogSynced.sessions,
        session: sessionId ? s.sessions[sessionId] : null,
        historyLoaded: sessionId ? !!s.historyLoadedIds[sessionId] : false,
        historyLoading: sessionId ? !!s.historyLoadingIds[sessionId] : false,
        historyFailed: sessionId ? !!s.historyFailedIds[sessionId] : false,
      }),
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

    return readActiveRun(session) ?? null;
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
export interface SessionListEntry {
  readonly sessionId: string;
  readonly title: string;
  readonly platform: EventSourceChannel;
  readonly accent: "idle" | "running" | "failed";
  readonly updatedAt: string;
}

/** Subscribe the sidebar to its visible fields, independently of message and reasoning deltas. */
export function createSessionListSelector(): (state: StoreState) => readonly SessionListEntry[] {
  let previous: readonly SessionListEntry[] = [];
  let previousInputs: Pick<StoreState, "sessions" | "sessionOrder" | "historyLoadingIds" | "missingOnServerIds">;
  let sources = new Map<string, { session: SessionRecord; loading: boolean; entry: SessionListEntry }>();
  return (state) => {
    if (
      previousInputs?.sessions === state.sessions &&
      previousInputs.sessionOrder === state.sessionOrder &&
      previousInputs.historyLoadingIds === state.historyLoadingIds &&
      previousInputs.missingOnServerIds === state.missingOnServerIds
    ) {
      return previous;
    }
    previousInputs = {
      sessions: state.sessions,
      sessionOrder: state.sessionOrder,
      historyLoadingIds: state.historyLoadingIds,
      missingOnServerIds: state.missingOnServerIds,
    };
    const nextSources = new Map<string, { session: SessionRecord; loading: boolean; entry: SessionListEntry }>();
    const next: SessionListEntry[] = [];
    for (const id of state.sessionOrder) {
      const session = state.sessions[id];
      if (!session || state.missingOnServerIds[id]) continue;
      const loading = Boolean(state.historyLoadingIds[id]);
      const cached = sources.get(id);
      if (cached?.session === session && cached.loading === loading) {
        next.push(cached.entry);
        nextSources.set(id, cached);
        continue;
      }
      const activeRun = readActiveRun(session);
      const entry: SessionListEntry = {
        sessionId: id,
        title: session.title.trim() || DEFAULT_SESSION_TITLE,
        platform: session.channel?.platform ?? "console",
        accent: loading || activeRun ? "running" : session.runs.at(-1)?.status === "failed" ? "failed" : "idle",
        updatedAt: session.updatedAt,
      };
      const retained =
        cached &&
        cached.entry.title === entry.title &&
        cached.entry.platform === entry.platform &&
        cached.entry.updatedAt === entry.updatedAt &&
        cached.entry.accent === entry.accent
          ? cached.entry
          : entry;
      next.push(retained);
      nextSources.set(id, { session, loading, entry: retained });
    }
    sources = nextSources;
    if (next.length === previous.length && next.every((entry, index) => entry === previous[index])) return previous;
    previous = next;
    return next;
  };
}

export function useSessionList(): readonly SessionListEntry[] {
  return useStore(useMemo(createSessionListSelector, []));
}
