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
  };
}

export function resolveModelProviderEndpointConfig(config: AgentSystemConfig, id: string) {
  return resolveModelProviderEndpointCatalog(config).resolve(id);
}

export function resolveModelProviderEndpointCatalog(config: AgentSystemConfig) {
  const defaults = resolveAgentDefaults(config);
  const endpointsById = new Map<string, ResolvedAgentModelProviderEndpointConfig>();
  for (const endpoint of defaults.ModelProviderEndpoints) {
    endpointsById.set(endpoint.Id, endpoint);
  }

  const configuredIds = new Set<string>();
  for (const endpoint of config.ModelProviderEndpoints ?? []) {
    if (configuredIds.has(endpoint.Id)) {
      throw new Error(`供应商端点配置重复：ModelProviderEndpoints[].Id=${endpoint.Id}`);
    }
    configuredIds.add(endpoint.Id);
    endpointsById.set(endpoint.Id, resolveConfiguredEndpoint(endpoint));
  }
  const endpoints = [...endpointsById.values()].filter((endpoint) => endpoint.Enabled);

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
  };
}

export function resolveModelProviderCatalog(config: AgentSystemConfig) {
  const defaults = resolveAgentDefaults(config);
  const endpointCatalog = resolveModelProviderEndpointCatalog(config);
  const providers: ResolvedAgentModelProviderConfig[] = config.ModelProviders.flatMap((provider) => {
    const endpoint = endpointCatalog.resolveKnown(provider.ProviderId);
    if (!endpoint.Enabled) return [];
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
        TimeoutMs: optionalSecondsToMilliseconds(runtime.TimeoutSeconds) ?? defaults.ModelRuntime.TimeoutMs,
        FirstTokenTimeoutMs:
          optionalDisabledOrSecondsToMilliseconds(runtime.FirstTokenTimeoutSeconds) ??
          defaults.ModelRuntime.FirstTokenTimeoutMs,
        MaxRequestMs:
          optionalDisabledOrSecondsToMilliseconds(runtime.MaxRequestSeconds) ?? defaults.ModelRuntime.MaxRequestMs,
        ...retryDelays,
        Icon: provider.Icon ?? endpoint.Icon,
        ProviderId: endpoint.Id,
        Kind: endpoint.Kind,
        BaseUrl: endpoint.BaseUrl,
        ApiKey: endpoint.ApiKey,
        ApiVersion: endpoint.ApiVersion,
        Headers: { ...endpoint.Headers },
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

  if (
    config.DefaultModelProviderId !== undefined &&
    !config.ModelProviders.some((provider) => provider.Id === config.DefaultModelProviderId)
  ) {
    throw new Error(`默认模型配置不存在：DefaultModelProviderId=${config.DefaultModelProviderId}`);
  }
  const defaultId = providers.find((provider) => provider.Id === config.DefaultModelProviderId)?.Id ?? providers[0]?.Id;
  const defaultProvider = providers.find((provider) => provider.Id === defaultId);
  if (!defaultProvider) {
    throw new Error(`默认模型配置不存在：DefaultModelProviderId=${defaultId}`);
  }

  return {
    defaultId,
    providers,
    resolve: (providerId?: string) => {
      const resolvedId = providerId?.trim() || defaultId;
      const provider = providers.find((item) => item.Id === resolvedId);
      if (!provider) {
        throw new Error(`模型配置不存在：${resolvedId}`);
      }
      return provider;
    },
    list: () => providers.map((provider) => toModelProviderListItem(provider, defaultId, defaults.ModelRuntime)),
  };
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

function resolveConfiguredEndpoint(
  endpoint: AgentModelProviderEndpointConfig,
): ResolvedAgentModelProviderEndpointConfig {
  return {
    Id: endpoint.Id,
    Icon: endpoint.Icon ?? "",
    Enabled: endpoint.Enabled ?? true,
    Kind: endpoint.Kind ?? "OpenAICompatible",
    BaseUrl: endpoint.BaseUrl ?? "",
    ApiKey: endpoint.ApiKey ?? "",
    ApiVersion: endpoint.ApiVersion ?? "2023-06-01",
    Headers: { ...(endpoint.Headers ?? {}) },
  };
}

function toModelProviderListItem(
  provider: ResolvedAgentModelProviderConfig,
  defaultId: string,
  runtimeDefaults: AgentModelRuntimeDefaultsConfig,
) {
  return {
    id: provider.Id,
    icon: provider.Icon,
    capabilities: resolveModelCapabilities(runtimeDefaults, provider.Capabilities),
    kind: provider.Kind,
    endpoint: provider.Endpoint,
    baseUrl: provider.BaseUrl,
    model: provider.Model,
    isDefault: provider.Id === defaultId,
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
