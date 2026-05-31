import type {
  ResolvedAgentModelProviderConfig,
  AgentSystemConfig,
  ResolvedAgentActionPlannerConfig,
  ResolvedAgentToolSearchConfig,
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
    FirstTokenTimeoutMs: -1,
    MaxRequestMs: -1,
    MaxNetworkRetries: 2,
    Headers: {},
  },
  AgentLoop: {
    MaxSteps: 16,
    MaxRepairAttempts: 2,
    LoadedTools: "dynamic",
  },
  ToolSearch: {
    Dynamic: {
      BootstrapTools: [
        "ToolSearchTool",
        "AskUserTool",
      ],
    },
    Memory: {
      Kind: "sqlite",
      DatabasePath: ".senera/ToolSearch.sqlite",
      MaxEpisodes: 5000,
      HalfLifeDays: 30,
    },
    Ranking: {
      RrfK: 60,
      MmrLambda: 0.72,
      MmrCandidateScoreRatio: 0.92,
      MinScore: 0,
    },
    Rerank: {
      Enabled: true,
      CandidateLimit: 24,
      ScoreScale: 0.018,
      FeatureWeights: {},
    },
  },
  ActionPlanner: {
    Enabled: true,
    MaxRepairAttempts: 1,
    MaxCatalogTools: 48,
    Client: {
      Provider: "auto",
      BaseUrl: "",
      ApiKey: "",
      Model: "",
      Temperature: 0.1,
      MaxTokens: -1,
    },
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
  ToolSearch: ResolvedAgentToolSearchConfig;
  ActionPlanner: ResolvedAgentActionPlannerConfig;
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

export function resolveToolSearchConfig(config: AgentSystemConfig): ResolvedAgentToolSearchConfig {
  return {
    Dynamic: {
      ...AgentDefaults.ToolSearch.Dynamic,
      ...config.ToolSearch?.Dynamic,
    },
    Memory: {
      ...AgentDefaults.ToolSearch.Memory,
      ...config.ToolSearch?.Memory,
    },
    Ranking: {
      ...AgentDefaults.ToolSearch.Ranking,
      ...config.ToolSearch?.Ranking,
    },
    Rerank: {
      ...AgentDefaults.ToolSearch.Rerank,
      ...config.ToolSearch?.Rerank,
      FeatureWeights: {
        ...AgentDefaults.ToolSearch.Rerank.FeatureWeights,
        ...config.ToolSearch?.Rerank?.FeatureWeights,
      },
    },
  };
}

export function resolveActionPlannerConfig(
  config: AgentSystemConfig,
  providerId?: string,
): ResolvedAgentActionPlannerConfig {
  const provider = resolveModelProviderConfig(config, providerId);
  const configured = config.ActionPlanner;
  const client = configured?.Client;

  return {
    ...AgentDefaults.ActionPlanner,
    ...configured,
    Client: {
      Provider: client?.Provider ?? AgentDefaults.ActionPlanner.Client.Provider,
      BaseUrl: client?.BaseUrl ?? provider.BaseUrl,
      ApiKey: client?.ApiKey ?? provider.ApiKey,
      Model: client?.Model ?? provider.Model,
      Temperature: client?.Temperature ?? AgentDefaults.ActionPlanner.Client.Temperature,
      MaxTokens: client?.MaxTokens ?? AgentDefaults.ActionPlanner.Client.MaxTokens,
    },
  };
}

export function resolveServerConfig(config: AgentSystemConfig) {
  return {
    ...AgentDefaults.Server,
    ...config.Server,
  };
}
