import type {
  AgentModelCapabilitiesConfig,
  AgentModelProviderConfig,
  AgentModelProviderEndpointConfig,
  AgentSystemConfig,
  AgentModelRuntimeDefaultsConfig,
  ResolvedAgentModelProviderEndpointConfig,
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";
import { resolveAgentDefaults } from "./AgentDefaultResolver.js";
import { optionalDisabledOrSecondsToMilliseconds, optionalSecondsToMilliseconds } from "./AgentTimeDefaults.js";
import { resolveAgentNativeToolRoute } from "../ModelEndpoints/AgentModelEndpointContract.js";
import { resolveAgentModelThinking } from "../ModelEndpoints/AgentModelThinking.js";

export function resolveModelProviderConfig(config: AgentSystemConfig, id?: string): ResolvedAgentModelProviderConfig {
  return resolveModelProviderCatalog(config).resolve(id);
}

/**
 * Applies the shared model-runtime defaults to one persisted model declaration.
 * This intentionally deep-merges capabilities: a model may override only the
 * capability flags it needs without discarding the rest of the runtime policy.
 */
export function resolveModelProviderRuntimeDefaults(
  defaults: AgentModelRuntimeDefaultsConfig,
  provider: AgentModelProviderConfig,
): AgentModelRuntimeDefaultsConfig & AgentModelProviderConfig {
  return {
    ...defaults,
    ...provider,
    Capabilities: resolveModelCapabilities(defaults, provider.Capabilities),
    ToolPlanningMode: provider.ToolPlanningMode ?? defaults.ToolPlanningMode,
  };
}

export function resolveModelProviderEndpointConfig(config: AgentSystemConfig, id: string) {
  return resolveModelProviderEndpointCatalog(config).resolve(id);
}

export function resolveModelProviderEndpointConfigs(
  config: AgentSystemConfig,
): ResolvedAgentModelProviderEndpointConfig[] {
  const defaults = resolveAgentDefaults(config);
  const endpointsById = new Map<string, ResolvedAgentModelProviderEndpointConfig>();
  for (const endpoint of defaults.ModelProviderEndpoints) {
    endpointsById.set(endpoint.Id, cloneResolvedEndpoint(endpoint));
  }

  const configuredIds = new Set<string>();
  for (const endpoint of config.ModelProviderEndpoints ?? []) {
    if (configuredIds.has(endpoint.Id)) {
      throw new Error(`供应商端点配置重复：ModelProviderEndpoints[].Id=${endpoint.Id}`);
    }
    configuredIds.add(endpoint.Id);
    endpointsById.set(endpoint.Id, resolveEndpointFields(endpoint, endpointsById.get(endpoint.Id)));
  }
  return [...endpointsById.values()];
}

export function resolveStandaloneModelProviderEndpointConfig(
  endpoint: AgentModelProviderEndpointConfig,
): ResolvedAgentModelProviderEndpointConfig {
  return resolveEndpointFields(endpoint);
}

export function resolveModelProviderEndpointCatalog(config: AgentSystemConfig) {
  const resolvedEndpoints = resolveModelProviderEndpointConfigs(config);
  const endpointsById = new Map(resolvedEndpoints.map((endpoint) => [endpoint.Id, endpoint]));
  const providerIds = new Set(resolvedEndpoints.map((endpoint) => endpoint.ProviderId));
  const endpoints = resolvedEndpoints.filter((endpoint) => endpoint.Enabled);

  return {
    endpoints,
    resolveKnown: (providerId: string) => {
      const endpoint = endpointsById.get(providerId);
      if (!endpoint) {
        throw new Error(`供应商端点配置不存在：ProviderId=${providerId}`);
      }
      return endpoint;
    },
    resolve: (providerId: string) => {
      const endpoint = endpoints.find((item) => item.Id === providerId);
      if (!endpoint) {
        throw new Error(`供应商端点配置不存在：ProviderId=${providerId}`);
      }
      return endpoint;
    },
    /** Ordered failover pool for one provider: lowest `Priority` first, then
     * configuration order (stable sort), disabled endpoints excluded. */
    poolOf: (providerId: string) => {
      const pool = endpoints
        .filter((endpoint) => endpoint.ProviderId === providerId)
        .sort((a, b) => a.Priority - b.Priority);
      if (pool.length === 0 && !providerIds.has(providerId)) {
        throw new Error(`供应商端点配置不存在：ProviderId=${providerId}`);
      }
      return pool;
    },
  };
}

export function resolveModelProviderCatalog(config: AgentSystemConfig) {
  const defaults = resolveAgentDefaults(config);
  const endpointCatalog = resolveModelProviderEndpointCatalog(config);
  const configuredModelIds = new Set(config.ModelProviders.map((provider) => provider.Id));
  const resolveConfiguredModelId = createModelProviderIdAliasResolver(config, configuredModelIds);
  const providers: ResolvedAgentModelProviderConfig[] = config.ModelProviders.flatMap((provider) => {
    const pool = endpointCatalog.poolOf(provider.ProviderId);
    // A model whose entire physical endpoint pool is disabled is intentionally
    // omitted from the active catalog. This keeps endpoint disablement
    // explicit without treating it as an unknown ProviderId or selecting a
    // different provider implicitly.
    if (pool.length === 0) return [];
    const endpoint = pool[0]!;
    const runtime = resolveModelProviderRuntimeDefaults(defaults.ModelRuntime, provider);
    const retryDelays = resolveModelRetryDelays(defaults.ModelRuntime, {
      RetryBaseDelaySeconds: runtime.RetryBaseDelaySeconds,
      RetryMaxDelaySeconds: runtime.RetryMaxDelaySeconds,
      RetryAfterMaxDelaySeconds: runtime.RetryAfterMaxDelaySeconds,
    });
    return [
      {
        ...endpoint,
        ...runtime,
        DeclaredCapabilities: provider.Capabilities ? { ...provider.Capabilities } : undefined,
        TimeoutMs: optionalSecondsToMilliseconds(runtime.TimeoutSeconds) ?? defaults.ModelRuntime.TimeoutMs,
        FirstTokenTimeoutMs:
          optionalDisabledOrSecondsToMilliseconds(runtime.FirstTokenTimeoutSeconds) ??
          defaults.ModelRuntime.FirstTokenTimeoutMs,
        MaxRequestMs:
          optionalDisabledOrSecondsToMilliseconds(runtime.MaxRequestSeconds) ?? defaults.ModelRuntime.MaxRequestMs,
        ...retryDelays,
        Icon: provider.Icon ?? endpoint.Icon,
        // Keep the logical provider identity stable across its physical
        // endpoint pool. The endpoint id is routing metadata only.
        ProviderId: provider.ProviderId,
        Kind: endpoint.Kind,
        BaseUrl: endpoint.BaseUrl,
        ApiKey: endpoint.ApiKey,
        ApiVersion: endpoint.ApiVersion,
        Headers: { ...endpoint.Headers },
        EndpointPool: pool.map(cloneResolvedEndpoint),
      },
    ];
  });

  const ids = new Set<string>();
  for (const provider of providers) {
    if (ids.has(provider.Id)) {
      throw new Error(`模型配置重复：ModelProviders[].Id=${provider.Id}`);
    }
    ids.add(provider.Id);
  }

  const configuredDefaultId =
    config.DefaultModelProviderId === undefined ? undefined : resolveConfiguredModelId(config.DefaultModelProviderId);
  if (configuredDefaultId !== undefined && !configuredModelIds.has(configuredDefaultId)) {
    throw new Error(`默认模型配置不存在：DefaultModelProviderId=${config.DefaultModelProviderId}`);
  }
  const defaultId = providers.find((provider) => provider.Id === configuredDefaultId)?.Id ?? providers[0]?.Id;
  const defaultProvider = providers.find((provider) => provider.Id === defaultId);
  if (!defaultProvider) {
    throw new Error(`默认模型配置不存在：DefaultModelProviderId=${defaultId}`);
  }

  return {
    defaultId,
    providers,
    resolve: (providerId?: string) => {
      const requestedId = providerId?.trim();
      const resolvedId = requestedId ? resolveConfiguredModelId(requestedId) : defaultId;
      const provider = providers.find((item) => item.Id === resolvedId);
      if (!provider) {
        throw new Error(`模型配置不存在：${resolvedId}`);
      }
      return provider;
    },
    list: () => providers.map((provider) => toModelProviderListItem(provider, defaultId, defaults.ModelRuntime)),
  };
}

function createModelProviderIdAliasResolver(
  config: AgentSystemConfig,
  modelIds: ReadonlySet<string>,
): (modelId: string) => string {
  const aliases = config.ModelProviderIdAliases ?? {};

  const resolve = (modelId: string): string => {
    if (modelIds.has(modelId)) {
      return modelId;
    }

    const visited = new Set<string>();
    let current = modelId;
    while (!modelIds.has(current)) {
      if (visited.has(current)) {
        throw new Error(`模型 ID 兼容别名存在循环：ModelProviderIdAliases.${modelId}`);
      }
      visited.add(current);
      const next = aliases[current];
      if (!next) {
        throw new Error(`模型配置不存在：${modelId}`);
      }
      current = next;
    }
    return current;
  };

  for (const alias of Object.keys(aliases)) {
    resolve(alias);
  }
  return resolve;
}

function resolveModelRetryDelays(
  defaults: Pick<
    ReturnType<typeof resolveAgentDefaults>["ModelRuntime"],
    "RetryBaseDelayMs" | "RetryMaxDelayMs" | "RetryAfterMaxDelayMs"
  >,
  config: Pick<
    AgentModelProviderConfig,
    "RetryBaseDelaySeconds" | "RetryMaxDelaySeconds" | "RetryAfterMaxDelaySeconds"
  >,
) {
  const retryDelays = {
    RetryBaseDelayMs: optionalSecondsToMilliseconds(config.RetryBaseDelaySeconds) ?? defaults.RetryBaseDelayMs,
    RetryMaxDelayMs: optionalSecondsToMilliseconds(config.RetryMaxDelaySeconds) ?? defaults.RetryMaxDelayMs,
    RetryAfterMaxDelayMs:
      optionalSecondsToMilliseconds(config.RetryAfterMaxDelaySeconds) ?? defaults.RetryAfterMaxDelayMs,
  };
  if (retryDelays.RetryBaseDelayMs > retryDelays.RetryMaxDelayMs) {
    throw new Error("模型网络重试基础等待时间不能大于最大等待时间。");
  }
  return retryDelays;
}

function resolveEndpointFields(
  endpoint: AgentModelProviderEndpointConfig,
  baseline?: ResolvedAgentModelProviderEndpointConfig,
): ResolvedAgentModelProviderEndpointConfig {
  return {
    Id: endpoint.Id,
    Icon: endpoint.Icon ?? baseline?.Icon ?? "",
    Enabled: endpoint.Enabled ?? baseline?.Enabled ?? true,
    Kind: endpoint.Kind ?? baseline?.Kind ?? "OpenAICompatible",
    DefaultEndpoint: endpoint.DefaultEndpoint ?? baseline?.DefaultEndpoint ?? "ChatCompletions",
    BaseUrl: endpoint.BaseUrl ?? baseline?.BaseUrl ?? "",
    ApiKey: endpoint.ApiKey ?? baseline?.ApiKey ?? "",
    ApiVersion: endpoint.ApiVersion ?? baseline?.ApiVersion ?? "2023-06-01",
    Headers: { ...(endpoint.Headers ?? baseline?.Headers ?? {}) },
    ProviderId: endpoint.ProviderId ?? baseline?.ProviderId ?? endpoint.Id,
    Priority: endpoint.Priority ?? baseline?.Priority ?? 0,
  };
}

function cloneResolvedEndpoint(
  endpoint: ResolvedAgentModelProviderEndpointConfig,
): ResolvedAgentModelProviderEndpointConfig {
  return {
    ...endpoint,
    Headers: { ...endpoint.Headers },
  };
}

function toModelProviderListItem(
  provider: ResolvedAgentModelProviderConfig,
  defaultId: string,
  runtimeDefaults: AgentModelRuntimeDefaultsConfig,
) {
  const thinking = resolveAgentModelThinking({
    api: resolveAgentNativeToolRoute(provider.Endpoint, provider.BaseUrl).api,
    provider: provider.ProviderId,
    model: provider.Model,
    capabilities: provider.Capabilities,
    declaredCapabilities: provider.DeclaredCapabilities,
    thinkingLevelMap: provider.ThinkingLevelMap,
    thinkingProfiles: provider.ThinkingProfiles,
    defaultThinkingLevel: provider.DefaultThinkingLevel,
  });
  return {
    id: provider.Id,
    providerId: provider.ProviderId,
    icon: provider.Icon,
    capabilities: {
      ...resolveModelCapabilities(runtimeDefaults, provider.Capabilities),
      Reasoning: thinking.reasoning,
    },
    kind: provider.Kind,
    endpoint: provider.Endpoint,
    baseUrl: provider.BaseUrl,
    model: provider.Model,
    isDefault: provider.Id === defaultId,
    thinkingLevels: [...thinking.levels],
    thinkingProfiles: [...thinking.profiles],
    defaultThinkingLevel: thinking.defaultLevel,
  };
}

function resolveModelCapabilities(
  base: Pick<AgentModelRuntimeDefaultsConfig, "Capabilities">,
  capabilities: AgentModelCapabilitiesConfig | undefined,
) {
  return {
    ...base.Capabilities,
    ...(capabilities ?? {}),
  };
}
