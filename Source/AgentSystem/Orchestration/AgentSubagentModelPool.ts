import { resolveModelProviderCatalog } from "../AgentDefaults.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import type { AgentSystemConfig, ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { AgentChildRunModelSelectionSources, type AgentChildRunModelSelectionSource } from "./AgentChildRunTypes.js";
import { resolveAgentDelegationConfiguration } from "./AgentOrchestrationConfig.js";

export interface AgentSubagentConfiguredModelPool {
  readonly inheritParent: boolean;
  readonly explicitModelProviderIds: readonly string[];
  readonly explicitProviders: readonly ResolvedAgentModelProviderConfig[];
}

export interface AgentSubagentResolvedModelPool extends AgentSubagentConfiguredModelPool {
  readonly inheritedModelProviderId?: string;
  readonly inheritedSelectionSource?: AgentChildRunModelSelectionSource;
  readonly modelProviderIds: readonly string[];
  readonly providers: readonly ResolvedAgentModelProviderConfig[];
  readonly fallbackModelProviderId: string;
}

export interface AgentSubagentRequestedModelSelection {
  readonly modelProviderId?: string;
  readonly source?: AgentChildRunModelSelectionSource;
}

export function resolveAgentSubagentConfiguredModelPool(config: AgentSystemConfig): AgentSubagentConfiguredModelPool {
  const catalog = resolveModelProviderCatalog(config);
  const policy = resolveAgentDelegationConfiguration(config).modelPool;
  const explicitProviders = policy.modelProviderIds.map((modelProviderId) =>
    resolveEligibleModel(catalog, modelProviderId),
  );
  return {
    inheritParent: policy.inheritParent,
    explicitModelProviderIds: explicitProviders.map((provider) => provider.Id),
    explicitProviders,
  };
}

export function resolveAgentSubagentModelPool(
  config: AgentSystemConfig,
  parentModelProviderId: string | undefined,
): AgentSubagentResolvedModelPool {
  const catalog = resolveModelProviderCatalog(config);
  const configured = resolveAgentSubagentConfiguredModelPool(config);
  const inheritedProvider = configured.inheritParent
    ? resolveEligibleModel(catalog, parentModelProviderId ?? catalog.defaultId)
    : undefined;
  const providers = uniqueProviders([
    ...(inheritedProvider ? [inheritedProvider] : []),
    ...configured.explicitProviders,
  ]);
  const fallback = providers[0];
  if (!fallback) {
    throw new AgentLocalizedError("orchestration.modelPoolEmpty");
  }
  return {
    ...configured,
    ...(inheritedProvider ? { inheritedModelProviderId: inheritedProvider.Id } : {}),
    ...(inheritedProvider
      ? {
          inheritedSelectionSource: parentModelProviderId
            ? AgentChildRunModelSelectionSources.Parent
            : AgentChildRunModelSelectionSources.RuntimeDefault,
        }
      : {}),
    modelProviderIds: providers.map((provider) => provider.Id),
    providers,
    fallbackModelProviderId: fallback.Id,
  };
}

export function resolveAgentSubagentRequestedModel(
  pool: AgentSubagentResolvedModelPool,
  requestedModelProviderId: string | undefined,
): AgentSubagentRequestedModelSelection {
  if (!requestedModelProviderId) return {};
  const selected = pool.providers.find((provider) => provider.Id === requestedModelProviderId);
  if (!selected) {
    throw new AgentLocalizedError("orchestration.modelNotAllowed", { modelProviderId: requestedModelProviderId });
  }
  return {
    modelProviderId: selected.Id,
    source: AgentChildRunModelSelectionSources.Request,
  };
}

function resolveEligibleModel(
  catalog: ReturnType<typeof resolveModelProviderCatalog>,
  modelProviderId: string,
): ResolvedAgentModelProviderConfig {
  let provider: ResolvedAgentModelProviderConfig;
  try {
    provider = catalog.resolve(modelProviderId);
  } catch (cause) {
    throw new AgentLocalizedError("orchestration.modelNotFound", { modelProviderId }, { cause });
  }
  if (provider.Capabilities?.Chat !== true) {
    throw new AgentLocalizedError("orchestration.modelChatCapabilityRequired", { modelProviderId: provider.Id });
  }
  return provider;
}

function uniqueProviders(providers: readonly ResolvedAgentModelProviderConfig[]): ResolvedAgentModelProviderConfig[] {
  const seen = new Set<string>();
  return providers.filter((provider) => {
    if (seen.has(provider.Id)) return false;
    seen.add(provider.Id);
    return true;
  });
}
