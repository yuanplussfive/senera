import type { SessionManager } from "@earendil-works/pi-coding-agent";

export type AgentPiSessionHistoryReader = Pick<SessionManager, "buildSessionContext">;

/** Pi initializes new sessions with metadata entries; only context messages make history non-empty. */
export function isAgentPiConversationHistoryEmpty(sessionManager: AgentPiSessionHistoryReader): boolean {
  return sessionManager.buildSessionContext().messages.length === 0;
}
