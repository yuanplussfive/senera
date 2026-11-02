import type { AgentDirectorySnapshot } from "../../../../Source/AgentSystem/Core/AgentDirectoryContract";
import type { StoreState } from "./types";
import { readConversationAgent, readConversationDefaultModelId } from "./sessionAgentSelection";
import { syncActiveSessionModelSelection } from "./sessionModelSelection";

/** HTTP acknowledgements and pushed snapshots share one directory projection. */
export function projectAgentDirectory(state: StoreState, snapshot: AgentDirectorySnapshot): void {
  if (state.agentDirectory && snapshot.revision < state.agentDirectory.revision) return;
  const previousAgent = readConversationAgent(state);
  const previousDefault = readConversationDefaultModelId(state);
  state.agentDirectory = snapshot;
  const agent = snapshot.agents.find((entry) => entry.id === snapshot.defaultAgentId)!;
  state.userProfile.assistant = { name: agent.name, avatarPath: agent.avatarPath, avatarDataUrl: null };
  if (state.selectedAgentId && !snapshot.agents.some((entry) => entry.id === state.selectedAgentId && entry.enabled)) {
    state.selectedAgentId = null;
  }
  if (
    !state.activeSessionId &&
    (previousAgent?.id !== readConversationAgent(state)?.id || state.selectedModelProviderId === previousDefault)
  ) {
    state.selectedModelProviderId = readConversationDefaultModelId(state);
    state.selectedThinkingLevel = null;
  }
  syncActiveSessionModelSelection(state);
}
