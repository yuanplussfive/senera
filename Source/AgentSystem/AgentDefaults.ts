import type {
  ResolvedAgentModelProviderConfig,
  AgentSystemConfig,
} from "./Types.js";

export const AgentDefaults = {
  ModelProviderDefaults: {
    Id: "default",
    Kind: "OpenAICompatible",
    Endpoint: "Responses",
    BaseUrl: "https://api.openai.com/v1",
    ApiKey: "",
    ApiVersion: "2023-06-01",
    Model: "gpt-4.1-mini",
    Temperature: 0.2,
    MaxOutputTokens: -1,
    Stream: true,
    TimeoutMs: 120000,
    MaxNetworkRetries: 2,
    Headers: {},
  },
  AgentLoop: {
    MaxSteps: 8,
    MaxRepairAttempts: 2,
    LoadedTools: "all",
  },
  Server: {
    Host: "127.0.0.1",
    Port: 8787,
    HotReload: true,
    RequestMaxBytes: 1048576,
  },
} as const satisfies {
  ModelProviderDefaults: import("./Types.js").ResolvedAgentModelProviderConfig;
  AgentLoop: Required<NonNullable<AgentSystemConfig["AgentLoop"]>>;
  Server: Required<NonNullable<AgentSystemConfig["Server"]>>;
};

export function resolveModelProviderConfig(config: AgentSystemConfig, id?: string) {
  return resolveModelProviderCatalog(config).resolve(id);
}

export function resolveModelProviderCatalog(config: AgentSystemConfig) {
  const providers = config.ModelProviders.map((provider) => ({
    ...AgentDefaults.ModelProviderDefaults,
    ...provider,
  }));

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
    list: () => providers.map((provider) => toModelProviderListItem(provider, defaultId)),
  };
}

function toModelProviderListItem(
  provider: ResolvedAgentModelProviderConfig,
  defaultId: string,
) {
  return {
    id: provider.Id,
    title: provider.Title ?? provider.Model,
    icon: provider.Icon,
    kind: provider.Kind,
    endpoint: provider.Endpoint,
    baseUrl: provider.BaseUrl,
    model: provider.Model,
    isDefault: provider.Id === defaultId,
  };
}

export function resolveAgentLoopConfig(config: AgentSystemConfig) {
  return {
    ...AgentDefaults.AgentLoop,
    ...config.AgentLoop,
  };
}

export function resolveServerConfig(config: AgentSystemConfig) {
  return {
    ...AgentDefaults.Server,
    ...config.Server,
  };
}
