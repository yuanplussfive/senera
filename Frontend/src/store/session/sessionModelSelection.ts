import type { ModelListSnapshotData } from "../../api/eventTypes";
import { readChatModelProviders } from "../../features/chat/modelProvider";
import type { StoreState } from "./types";
import { syncActiveSessionThinkingSelection } from "./sessionThinkingSelection";
import { readConversationDefaultModelId } from "./sessionAgentSelection";

/**
 * Resolve a local choice, then a durable conversation preference, then the Agent's
 * configured default. A previous execution receipt describes history only.
 */
export function applyModelListSnapshotSelection(state: StoreState, data: ModelListSnapshotData): void {
  state.modelProviders = data.models;
  const chatModels = readChatModelProviders(data.models);
  const availableIds = new Set(data.models.map((model) => model.id));
  const defaultModelId =
    chatModels.find((model) => model.id === data.defaultModelProviderId)?.id ??
    chatModels.find((model) => model.isDefault)?.id ??
    null;

  state.defaultModelProviderId = defaultModelId;
  for (const [sessionId, modelId] of Object.entries(state.selectedModelProviderIdsBySession)) {
    if (!availableIds.has(modelId)) {
      delete state.selectedModelProviderIdsBySession[sessionId];
    }
  }

  syncActiveSessionModelSelectionWithAvailableIds(state, availableIds);
  syncActiveSessionThinkingSelection(state);
}

export function selectModelForActiveSession(state: StoreState, modelId: string): void {
  state.selectedModelProviderId = modelId;
  if (state.activeSessionId) {
    state.selectedModelProviderIdsBySession[state.activeSessionId] = modelId;
  }
  syncActiveSessionThinkingSelection(state);
}

export function applyDefaultModelToActiveSession(state: StoreState): boolean {
  const defaultModelId = readConversationDefaultModelId(state);
  if (!defaultModelId) return false;
  const id = state.activeSessionId;
  if (id && !state.sessions[id]?.modelPreference) {
    delete state.selectedModelProviderIdsBySession[id];
    syncActiveSessionModelSelection(state);
  } else {
    // A durable preference must be replaced on the next request; merely hiding
    // it locally would let the server continue using the previous model.
    selectModelForActiveSession(state, defaultModelId);
  }
  return true;
}

export function syncActiveSessionModelSelection(state: StoreState): void {
  const availableIds = new Set(state.modelProviders.map((model) => model.id));
  syncActiveSessionModelSelectionWithAvailableIds(state, availableIds);
}

function syncActiveSessionModelSelectionWithAvailableIds(state: StoreState, availableIds: ReadonlySet<string>): void {
  const activeSessionId = state.activeSessionId;
  const configuredDefault = readConversationDefaultModelId(state);
  const defaultModelId = isAvailable(configuredDefault, availableIds) ? configuredDefault : null;

  if (!activeSessionId) {
    state.selectedModelProviderId = isAvailable(state.selectedModelProviderId, availableIds)
      ? state.selectedModelProviderId
      : defaultModelId;
    syncActiveSessionThinkingSelection(state);
    return;
  }

  const rememberedModelId = state.selectedModelProviderIdsBySession[activeSessionId];
  const session = state.sessions[activeSessionId];
  // Only explicit user choices live in the local map. Inherited defaults must
  // remain derived, otherwise a snapshot would turn them into sticky overrides.
  if (rememberedModelId && rememberedModelId === session?.modelPreference?.modelProviderId) {
    delete state.selectedModelProviderIdsBySession[activeSessionId];
  }
  const sessionModelId = session?.modelPreference?.modelProviderId;
  const selectedModelId = isAvailable(rememberedModelId, availableIds)
    ? rememberedModelId
    : isAvailable(sessionModelId, availableIds)
      ? sessionModelId
      : defaultModelId;

  if (!selectedModelId) {
    delete state.selectedModelProviderIdsBySession[activeSessionId];
  }
  state.selectedModelProviderId = selectedModelId;
  syncActiveSessionThinkingSelection(state);
}

function isAvailable(modelId: string | null | undefined, availableIds: ReadonlySet<string>): modelId is string {
  return typeof modelId === "string" && availableIds.has(modelId);
}
