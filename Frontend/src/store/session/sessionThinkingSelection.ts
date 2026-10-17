import type { ModelProviderListItem, ModelThinkingLevel } from "../../api/eventTypes";
import type { StoreState } from "./types";

const Off: ModelThinkingLevel = "off";

export function selectThinkingLevelForActiveSession(state: StoreState, level: ModelThinkingLevel): void {
  const selected = readSelectedModel(state);
  const next = normalizeThinkingLevel(selected, level);
  state.selectedThinkingLevel = next;
  if (state.activeSessionId) {
    (state.selectedThinkingLevelsBySession ??= {})[state.activeSessionId] = next;
  }
}

export function syncActiveSessionThinkingSelection(state: StoreState): void {
  const selected = readSelectedModel(state);
  const sessionId = state.activeSessionId;
  const remembered = sessionId
    ? state.selectedThinkingLevelsBySession?.[sessionId]
    : (state.selectedThinkingLevel ?? undefined);
  const next = normalizeThinkingLevel(selected, remembered);
  state.selectedThinkingLevel = selected ? next : null;
  if (sessionId && selected) {
    (state.selectedThinkingLevelsBySession ??= {})[sessionId] = next;
  }
}

function readSelectedModel(state: StoreState): ModelProviderListItem | undefined {
  const selectedId = state.selectedModelProviderId;
  return (
    state.modelProviders.find((model) => model.id === selectedId) ??
    state.modelProviders.find((model) => model.isDefault)
  );
}

function normalizeThinkingLevel(
  model: ModelProviderListItem | undefined,
  requested?: ModelThinkingLevel,
): ModelThinkingLevel {
  const levels = model?.thinkingLevels?.length ? model.thinkingLevels : [Off];
  if (requested && levels.includes(requested)) return requested;
  if (model?.defaultThinkingLevel && levels.includes(model.defaultThinkingLevel)) return model.defaultThinkingLevel;
  return levels[0] ?? Off;
}
