import type { ModelListSnapshotData } from "../../api/eventTypes";
import { readChatModelProviders } from "../../features/chat/modelProvider";
import type { StoreState } from "./types";

/**
 * The configured default is the starting model for a newly created conversation.
 * An active conversation keeps its own local model choice until the user explicitly
 * chooses the default again. This matches the Chat model ownership shown in the UI.
 */
export function applyModelListSnapshotSelection(
  state: StoreState,
  data: ModelListSnapshotData,
): void {
  state.modelProviders = data.models;
  const chatModels = readChatModelProviders(data.models);
  const availableIds = new Set(chatModels.map((model) => model.id));
  const defaultModelId = chatModels.find((model) => model.id === data.defaultModelProviderId)?.id
    ?? chatModels.find((model) => model.isDefault)?.id
    ?? chatModels[0]?.id
    ?? null;

  state.defaultModelProviderId = defaultModelId;
  for (const [sessionId, modelId] of Object.entries(state.selectedModelProviderIdsBySession)) {
    if (!availableIds.has(modelId)) {
      delete state.selectedModelProviderIdsBySession[sessionId];
    }
  }

  syncActiveSessionModelSelectionWithAvailableIds(state, availableIds);
}

export function selectModelForActiveSession(state: StoreState, modelId: string): void {
  state.selectedModelProviderId = modelId;
  if (state.activeSessionId) {
    state.selectedModelProviderIdsBySession[state.activeSessionId] = modelId;
  }
}

export function applyDefaultModelToActiveSession(state: StoreState): boolean {
  const defaultModelId = state.defaultModelProviderId;
  if (!defaultModelId) return false;
  selectModelForActiveSession(state, defaultModelId);
  return true;
}

export function syncActiveSessionModelSelection(state: StoreState): void {
  const availableIds = new Set(readChatModelProviders(state.modelProviders).map((model) => model.id));
  syncActiveSessionModelSelectionWithAvailableIds(state, availableIds);
}

function syncActiveSessionModelSelectionWithAvailableIds(
  state: StoreState,
  availableIds: ReadonlySet<string>,
): void {
  const activeSessionId = state.activeSessionId;
  const fallbackModelId = isAvailable(state.defaultModelProviderId, availableIds)
    ? state.defaultModelProviderId
    : null;

  if (!activeSessionId) {
    state.selectedModelProviderId = isAvailable(state.selectedModelProviderId, availableIds)
      ? state.selectedModelProviderId
      : fallbackModelId;
    return;
  }

  const rememberedModelId = state.selectedModelProviderIdsBySession[activeSessionId];
  const legacySelectedModelId = state.selectedModelProviderId;
  const selectedModelId = isAvailable(rememberedModelId, availableIds)
    ? rememberedModelId
    : isAvailable(legacySelectedModelId, availableIds)
      ? legacySelectedModelId
      : fallbackModelId;

  if (selectedModelId) {
    state.selectedModelProviderIdsBySession[activeSessionId] = selectedModelId;
  } else {
    delete state.selectedModelProviderIdsBySession[activeSessionId];
  }
  state.selectedModelProviderId = selectedModelId;
}

function isAvailable(
  modelId: string | null | undefined,
  availableIds: ReadonlySet<string>,
): modelId is string {
  return typeof modelId === "string" && availableIds.has(modelId);
}
