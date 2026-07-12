import type {
  AgentModelCapabilitiesConfig,
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
  const providers: ResolvedAgentModelProviderConfig[] = config.ModelProviders.map((provider) => {
    const endpoint = endpointCatalog.resolve(provider.ProviderId);
    const { Capabilities, TimeoutSeconds, FirstTokenTimeoutSeconds, MaxRequestSeconds, Icon, ...providerRuntime } =
      provider;
    return {
      ...defaults.ModelRuntime,
      ...endpoint,
      ...providerRuntime,
      Capabilities: resolveModelCapabilities(defaults.ModelRuntime, Capabilities),
      TimeoutMs: optionalSecondsToMilliseconds(TimeoutSeconds) ?? defaults.ModelRuntime.TimeoutMs,
      FirstTokenTimeoutMs:
        optionalDisabledOrSecondsToMilliseconds(FirstTokenTimeoutSeconds) ?? defaults.ModelRuntime.FirstTokenTimeoutMs,
      MaxRequestMs: optionalDisabledOrSecondsToMilliseconds(MaxRequestSeconds) ?? defaults.ModelRuntime.MaxRequestMs,
      Icon: Icon ?? endpoint.Icon,
      ProviderId: endpoint.Id,
      Kind: endpoint.Kind,
      BaseUrl: endpoint.BaseUrl,
      ApiKey: endpoint.ApiKey,
      ApiVersion: endpoint.ApiVersion,
      Headers: { ...endpoint.Headers },
    };
  });

  const ids = new Set<string>();
  for (const provider of providers) {
    if (ids.has(provider.Id)) {
      throw new Error(`模型配置重复：ModelProviders[].Id=${provider.Id}`);
    }
    ids.add(provider.Id);
  }

  const defaultId = config.DefaultModelProviderId ?? providers[0]?.Id;
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
