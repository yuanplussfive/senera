import type { SessionRecord } from "./types";

/**
 * The session catalog and its conversation history arrive independently over
 * the socket. Keep their UI contract in one place so a fresh app cannot fall
 * through to the empty state (or accept a message) between those snapshots.
 */
export type SessionHydrationState = "catalog_loading" | "history_loading" | "history_failed" | "ready";

export interface SessionHydrationInput {
  catalogSynced: boolean;
  session?: SessionRecord | null;
  historyLoaded: boolean;
  historyLoading: boolean;
  historyFailed: boolean;
}

export function readSessionHydrationState({
  catalogSynced,
  session,
  historyLoaded,
  historyLoading,
  historyFailed,
}: SessionHydrationInput): SessionHydrationState {
  if (!catalogSynced && !session) return "catalog_loading";
  if (!session) return "ready";
  if (historyLoading) return "history_loading";

  const hasServerHistory = session.messageCount > 0 || Boolean(session.activeRequestId);
  const hasLocalMessages = session.messages.length > 0;
  if (hasServerHistory && !hasLocalMessages) {
    if (historyFailed) return "history_failed";
    if (!historyLoaded) return "history_loading";
  }

  return "ready";
}

export function blocksSessionInput(state: SessionHydrationState): boolean {
  return state !== "ready";
}
