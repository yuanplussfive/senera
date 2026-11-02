import type { StoreState } from "./types";
import { syncActiveSessionThinkingSelection } from "./sessionThinkingSelection";

type AgentSelectionState = Pick<StoreState, "agentDirectory" | "selectedAgentId" | "activeSessionId" | "sessions">;

export function readConversationAgent(state: AgentSelectionState) {
  const id =
    (state.activeSessionId ? state.sessions[state.activeSessionId]?.agentId : undefined) ??
    state.selectedAgentId ??
    state.agentDirectory?.defaultAgentId;
  return state.agentDirectory?.agents.find((agent) => agent.id === id);
}

export function readConversationDefaultModelId(
  state: AgentSelectionState & Pick<StoreState, "defaultModelProviderId">,
): string | null {
  return readConversationAgent(state)?.modelProviderId ?? state.defaultModelProviderId;
}

/** Selecting another identity starts a new conversation; existing histories retain their owner. */
export function selectConversationAgent(state: StoreState, id: string): void {
  const agent = state.agentDirectory?.agents.find((entry) => entry.id === id && entry.enabled);
  if (!agent || state.agentDirectory?.deletingAgentIds.includes(id) || readConversationAgent(state)?.id === id) return;
  state.selectedAgentId = id;
  state.activeSessionId = null;
  state.selectedModelProviderId = agent.modelProviderId ?? state.defaultModelProviderId;
  state.selectedThinkingLevel = null;
  syncActiveSessionThinkingSelection(state);
}
