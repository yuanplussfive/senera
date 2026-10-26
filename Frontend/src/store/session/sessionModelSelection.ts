import type { ModelListSnapshotData } from "../../api/eventTypes";
import { readChatModelProviders } from "../../features/chat/modelProvider";
import type { StoreState } from "./types";
import { syncActiveSessionThinkingSelection } from "./sessionThinkingSelection";

/**
 * A conversation owns a model only after an explicit choice: a local selection for that
 * conversation, the conversation's durable server-side preference, or the model supplied
 * when the conversation was created. Every other conversation inherits the configured
 * default, so changing the default in settings immediately changes what an inheriting
 * conversation displays and sends.
 *
 * `selectedModelProviderId` therefore holds an explicit choice or `null` (inherit). The
 * model id reported by the server for a session resolves display history (last run, Pi
 * session) and MUST NOT be stored as an explicit choice.
 */
export function applyModelListSnapshotSelection(state: StoreState, data: ModelListSnapshotData): void {
  state.modelProviders = data.models;
  const chatModels = readChatModelProviders(data.models);
  const availableIds = new Set(chatModels.map((model) => model.id));
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

/**
 * Records an explicit model choice. Without an open conversation it is the pending choice
 * that the next created conversation adopts.
 */
export function selectModelForActiveSession(state: StoreState, modelId: string): void {
  state.selectedModelProviderId = modelId;
  if (state.activeSessionId) {
    state.selectedModelProviderIdsBySession[state.activeSessionId] = modelId;
  }
  syncActiveSessionThinkingSelection(state);
}

/** Drops the explicit choice so the conversation follows the configured default again. */
export function applyDefaultModelToActiveSession(state: StoreState): boolean {
  if (!state.defaultModelProviderId) return false;
  if (state.activeSessionId) {
    delete state.selectedModelProviderIdsBySession[state.activeSessionId];
  } else {
    state.selectedModelProviderId = null;
  }
  syncActiveSessionModelSelection(state);
  return true;
}

export function syncActiveSessionModelSelection(state: StoreState): void {
  const availableIds = new Set(readChatModelProviders(state.modelProviders).map((model) => model.id));
  syncActiveSessionModelSelectionWithAvailableIds(state, availableIds);
}

function syncActiveSessionModelSelectionWithAvailableIds(state: StoreState, availableIds: ReadonlySet<string>): void {
  const activeSessionId = state.activeSessionId;

  if (!activeSessionId) {
    state.selectedModelProviderId = isAvailable(state.selectedModelProviderId, availableIds)
      ? state.selectedModelProviderId
      : null;
    syncActiveSessionThinkingSelection(state);
    return;
  }

  const rememberedModelId = state.selectedModelProviderIdsBySession[activeSessionId];
  const selectedModelId = isAvailable(rememberedModelId, availableIds) ? rememberedModelId : null;

  if (selectedModelId) {
    state.selectedModelProviderIdsBySession[activeSessionId] = selectedModelId;
  } else {
    delete state.selectedModelProviderIdsBySession[activeSessionId];
  }
  state.selectedModelProviderId = selectedModelId;
  syncActiveSessionThinkingSelection(state);
}

function isAvailable(modelId: string | null | undefined, availableIds: ReadonlySet<string>): modelId is string {
  return typeof modelId === "string" && availableIds.has(modelId);
}
