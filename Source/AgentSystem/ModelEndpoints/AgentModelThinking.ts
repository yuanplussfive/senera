import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import {
  getSupportedThinkingLevels,
  type Model,
  type ModelThinkingLevel,
  type ThinkingLevelMap,
} from "@earendil-works/pi-ai";
import type { AgentModelCapabilitiesConfig } from "../Types/AgentModelConfigTypes.js";
import type { AgentNativeToolApi } from "./AgentModelEndpointContract.js";

export const AgentModelThinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type AgentModelThinkingLevel = (typeof AgentModelThinkingLevels)[number];

/** Persisted configuration shape. Keep the config boundary aligned with the rest of AgentSystemConfig. */
export interface AgentModelThinkingProfileConfig {
  readonly Id: string;
  readonly Label: string;
  readonly Level: AgentModelThinkingLevel;
}

/** Runtime/list projection shape consumed by the frontend. */
export interface AgentModelThinkingProfile {
  readonly id: string;
  readonly label: string;
  readonly level: AgentModelThinkingLevel;
}

export interface AgentModelThinkingProjection {
  readonly reasoning: boolean;
  readonly thinkingLevelMap?: ThinkingLevelMap;
  readonly levels: readonly ModelThinkingLevel[];
  readonly profiles: readonly AgentModelThinkingProfile[];
  readonly defaultLevel: ModelThinkingLevel;
  readonly source: "configuration" | "pi-catalog" | "provider-default" | "disabled";
}

export interface AgentModelThinkingInput {
  readonly api: AgentNativeToolApi;
  readonly provider?: string;
  readonly model: string;
  readonly capabilities?: AgentModelCapabilitiesConfig;
  readonly declaredCapabilities?: AgentModelCapabilitiesConfig;
  readonly thinkingLevelMap?: ThinkingLevelMap;
  readonly thinkingProfiles?: readonly AgentModelThinkingProfileConfig[];
  readonly defaultThinkingLevel?: AgentModelThinkingLevel;
}

export function clampAgentModelThinkingLevel(
  projection: Pick<AgentModelThinkingProjection, "levels" | "defaultLevel">,
  requested?: ModelThinkingLevel,
): ModelThinkingLevel {
  return requested && projection.levels.includes(requested) ? requested : projection.defaultLevel;
}

/** Pi catalog is the default; configuration only supplies explicit overrides. */
export function resolveAgentModelThinking(input: AgentModelThinkingInput): AgentModelThinkingProjection {
  const catalogModel = findPiCatalogModel(input.api, input.model, input.provider);
  const declaredReasoning = input.declaredCapabilities?.Reasoning;
  const configuredMap = normalizeThinkingLevelMap(input.thinkingLevelMap);
  const map = mergeThinkingMaps(catalogModel?.thinkingLevelMap, configuredMap);
  const hasConfiguredThinking =
    Object.keys(configuredMap ?? {}).length > 0 ||
    (input.thinkingProfiles?.length ?? 0) > 0 ||
    input.defaultThinkingLevel !== undefined;
  const reasoning =
    declaredReasoning ??
    (hasConfiguredThinking ? true : undefined) ??
    catalogModel?.reasoning ??
    input.capabilities?.Reasoning ??
    false;

  if (!reasoning) {
    return {
      reasoning: false,
      levels: ["off"],
      profiles: [],
      defaultLevel: "off",
      source: declaredReasoning === false ? "configuration" : "disabled",
    };
  }

  const levels = getSupportedThinkingLevels(createThinkingModel(input, map));
  const profiles = normalizeThinkingProfiles(input.thinkingProfiles, levels);
  const requestedDefault = input.defaultThinkingLevel ?? profiles[0]?.level ?? "medium";
  const defaultLevel = resolveNearestThinkingLevel(levels, requestedDefault);
  return {
    reasoning: true,
    ...(map ? { thinkingLevelMap: map } : {}),
    levels,
    profiles,
    defaultLevel,
    source: hasConfiguredThinking ? "configuration" : catalogModel ? "pi-catalog" : "provider-default",
  };
}

export function normalizeThinkingProfiles(
  profiles: readonly AgentModelThinkingProfileConfig[] | undefined,
  levels: readonly ModelThinkingLevel[],
): AgentModelThinkingProfile[] {
  if (!profiles) return [];
  const available = new Set(levels);
  const ids = new Set<string>();
  const configuredLevels = new Set<ModelThinkingLevel>();
  return profiles.flatMap((profile) => {
    const id = profile.Id.trim();
    const label = profile.Label.trim();
    // The chat control selects a semantic Pi level, not a profile id. Keep
    // one profile per level so the projected label and selected value remain
    // deterministic even when hand-edited config contains duplicates.
    if (!id || !label || ids.has(id) || configuredLevels.has(profile.Level) || !available.has(profile.Level)) return [];
    ids.add(id);
    configuredLevels.add(profile.Level);
    return [{ id, label, level: profile.Level }];
  });
}

type PiThinkingCatalog = Map<string, Map<string, Map<string, Model<AgentNativeToolApi>[]>>>;
let piThinkingCatalog: PiThinkingCatalog | undefined;

function findPiCatalogModel(
  api: AgentNativeToolApi,
  modelId: string,
  providerId?: string,
): Model<AgentNativeToolApi> | undefined {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return undefined;
  const normalizedProvider = providerId?.trim().toLowerCase();
  const byProvider = getPiThinkingCatalog().get(api);
  if (!byProvider) return undefined;
  const candidates = [...byProvider.values()].flatMap((models) => models.get(normalized) ?? []);
  if (candidates.length === 0) return undefined;
  const exactProvider = normalizedProvider ? byProvider.get(normalizedProvider)?.get(normalized)?.[0] : undefined;
  if (exactProvider) return exactProvider;
  return [...candidates].sort((left, right) => thinkingSupportScore(right) - thinkingSupportScore(left))[0];
}

function getPiThinkingCatalog(): PiThinkingCatalog {
  if (piThinkingCatalog) return piThinkingCatalog;
  const catalog: PiThinkingCatalog = new Map();
  for (const provider of getBuiltinProviders()) {
    const models = getBuiltinModels(provider) as readonly Model<AgentNativeToolApi>[];
    for (const model of models) {
      const byProvider = catalog.get(model.api) ?? new Map<string, Map<string, Model<AgentNativeToolApi>[]>>();
      const providerKey = model.provider.trim().toLowerCase();
      const byModel = byProvider.get(providerKey) ?? new Map<string, Model<AgentNativeToolApi>[]>();
      const modelKey = model.id.trim().toLowerCase();
      const candidates = byModel.get(modelKey) ?? [];
      candidates.push(model);
      byModel.set(modelKey, candidates);
      byProvider.set(providerKey, byModel);
      catalog.set(model.api, byProvider);
    }
  }
  piThinkingCatalog = catalog;
  return catalog;
}

function thinkingSupportScore(model: Model<AgentNativeToolApi>): number {
  const levels = getSupportedThinkingLevels(model);
  const offSupport = levels.includes("off") ? 1 : 0;
  return levels.length * 10 + offSupport;
}

function mergeThinkingMaps(
  catalog: ThinkingLevelMap | undefined,
  configured: ThinkingLevelMap | undefined,
): ThinkingLevelMap | undefined {
  const merged = normalizeThinkingLevelMap({ ...(catalog ?? {}), ...(configured ?? {}) });
  return Object.keys(merged ?? {}).length > 0 ? merged : undefined;
}

function normalizeThinkingLevelMap(value: ThinkingLevelMap | undefined): ThinkingLevelMap | undefined {
  if (!value) return undefined;
  const supported = new Set<string>(AgentModelThinkingLevels);
  const entries: Array<[string, string | null]> = [];
  for (const [level, nativeValue] of Object.entries(value)) {
    if (!supported.has(level) || (nativeValue !== null && typeof nativeValue !== "string")) continue;
    if (nativeValue === null) {
      entries.push([level, null]);
      continue;
    }
    const trimmed = nativeValue.trim();
    if (trimmed) entries.push([level, trimmed]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function resolveNearestThinkingLevel(
  levels: readonly ModelThinkingLevel[],
  requested: ModelThinkingLevel,
): ModelThinkingLevel {
  if (levels.includes(requested)) return requested;
  const requestedIndex = AgentModelThinkingLevels.indexOf(requested as AgentModelThinkingLevel);
  const next = levels.find(
    (level) => AgentModelThinkingLevels.indexOf(level as AgentModelThinkingLevel) > requestedIndex,
  );
  return next ?? levels.at(-1) ?? "off";
}

function createThinkingModel(
  input: AgentModelThinkingInput,
  thinkingLevelMap: ThinkingLevelMap | undefined,
): Model<AgentNativeToolApi> {
  return {
    id: input.model,
    name: input.model,
    api: input.api,
    provider: "senera",
    baseUrl: "",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1,
    maxTokens: 1,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
  } as Model<AgentNativeToolApi>;
}
