import type {
  AgentDelegationRuntimeProfileConfig,
  AgentActionPlannerClientConfig,
  ResolvedAgentModelProviderConfig,
  AgentSystemConfig,
  AgentCliConfig,
  ResolvedAgentActionPlannerConfig,
  ResolvedAgentActionPlannerClientConfig,
  ResolvedAgentArtifactsConfig,
  ResolvedAgentUploadsConfig,
  ResolvedAgentFrontendConfig,
  ResolvedAgentDelegationConfig,
  ResolvedAgentDelegationRuntimeProfileConfig,
  ResolvedAgentPersistenceConfig,
  ResolvedAgentPluginDiscoveryConfig,
  ResolvedAgentPluginRootsConfig,
  ResolvedAgentLoopConfig,
  ResolvedAgentToolExecutionConfig,
  ResolvedAgentToolSearchConfig,
} from "./Types.js";

type ResolvedAgentCliDefaultsConfig = {
  Connection: {
    Url: string;
    TimeoutMs: number;
    SessionId?: string;
  };
  Display: {
    EventDisplayMode: NonNullable<NonNullable<AgentCliConfig["Display"]>["EventDisplayMode"]>;
    DetailMode: NonNullable<NonNullable<AgentCliConfig["Display"]>["DetailMode"]>;
    ShowXml: boolean;
    StreamXml: boolean;
    LivePreview: boolean;
    PreviewMode?: NonNullable<NonNullable<AgentCliConfig["Display"]>["PreviewMode"]>;
    PreviewTokenLimit: number;
  };
};

export interface ResolvedAgentDefaultsConfig {
  PluginRoots: ResolvedAgentPluginRootsConfig;
  PluginDiscovery: ResolvedAgentPluginDiscoveryConfig;
  ModelProviderDefaults: ResolvedAgentModelProviderConfig;
  Cli: ResolvedAgentCliDefaultsConfig;
  ToolExecution: ResolvedAgentToolExecutionConfig;
  AgentLoop: ResolvedAgentLoopConfig;
  AgentDelegation: ResolvedAgentDelegationConfig;
  ToolSearch: ResolvedAgentToolSearchConfig;
  ActionPlanner: ResolvedAgentActionPlannerConfig;
  Artifacts: ResolvedAgentArtifactsConfig;
  Uploads: ResolvedAgentUploadsConfig;
  Frontend: ResolvedAgentFrontendConfig;
  Server: Required<NonNullable<AgentSystemConfig["Server"]>>;
  Persistence: ResolvedAgentPersistenceConfig;
}

export const AgentDefaults = {
  PluginRoots: {
    System: ["./System/Plugins"],
    User: ["./Plugins"],
  },
  PluginDiscovery: {
    ManifestFileName: "PluginManifest.json",
    ConfigFileName: "PluginConfig.toml",
  },
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
  Cli: {
    Connection: {
      Url: "ws://127.0.0.1:8787",
      TimeoutMs: 180000,
    },
    Display: {
      EventDisplayMode: "activity",
      DetailMode: "none",
      ShowXml: false,
      StreamXml: false,
      LivePreview: true,
      PreviewTokenLimit: 50,
    },
  },
  ToolExecution: {
    Mode: "Process",
    TimeoutMs: 120000,
    MaxStdoutBytes: 1000000,
    MaxStderrBytes: 1000000,
  },
  AgentLoop: {
    MaxSteps: 16,
    MaxRepairAttempts: 2,
    LoadedTools: "dynamic",
  },
  AgentDelegation: {
    RuntimeProfiles: {},
    Templates: {
      ChildSystemPrompt: "ChildAgentSystemPrompt",
      MergeSystemPrompt: "AgentMergeSystemPrompt",
    },
    Merge: {},
  },
  ToolSearch: {
    Dynamic: {
      BootstrapTools: [
        "ToolSearchTool",
        "AskUserTool",
        "ArtifactMemoryReadTool",
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
    Evidence: {
      StalledStepLag: 2,
    },
    Client: {
      Provider: "auto",
      BaseUrl: "",
      ApiKey: "",
      Model: "",
      Temperature: 0.1,
      MaxTokens: -1,
    },
    TaskFrameClient: {
      Provider: "auto",
      BaseUrl: "",
      ApiKey: "",
      Model: "",
      Temperature: 0.1,
      MaxTokens: -1,
    },
    EvidenceClient: {
      Provider: "auto",
      BaseUrl: "",
      ApiKey: "",
      Model: "",
      Temperature: 0.1,
      MaxTokens: -1,
    },
  },
  Artifacts: {
    RootDir: ".senera/artifacts/runs",
    SummaryMaxChars: 2400,
    RawJsonMaxBytes: 1048576,
    TextFileMaxBytes: 262144,
  },
  Uploads: {
    RootDir: ".senera/uploads",
    MaxFileBytes: 52428800,
  },
  Frontend: {
    DevServer: {
      Host: "127.0.0.1",
      Port: 5173,
      StrictPort: true,
    },
    PreviewServer: {
      Host: "127.0.0.1",
      Port: 4173,
      StrictPort: true,
    },
    Client: {
      WebSocketUrl: "",
      ModelLabel: "senera",
      UserName: "you",
      EmptySuggestions: [
        "整理今天的工作优先级",
        "分析一段错误日志",
        "把需求拆成可执行步骤",
      ],
    },
  },
  Server: {
    Host: "127.0.0.1",
    Port: 8787,
    HotReload: true,
    RequestMaxBytes: 1048576,
  },
  Persistence: {
    Kind: "sqlite",
    DatabasePath: ".senera/senera.db",
  },
} as const satisfies ResolvedAgentDefaultsConfig;

export function resolveAgentDefaults(
  config: Pick<AgentSystemConfig, "Defaults"> | undefined,
): ResolvedAgentDefaultsConfig {
  const defaults = config?.Defaults;

  return {
    PluginRoots: {
      System: defaults?.PluginRoots?.System ?? [...AgentDefaults.PluginRoots.System],
      User: defaults?.PluginRoots?.User ?? [...AgentDefaults.PluginRoots.User],
    },
    PluginDiscovery: {
      ...AgentDefaults.PluginDiscovery,
      ...defaults?.PluginDiscovery,
    },
    ModelProviderDefaults: {
      ...AgentDefaults.ModelProviderDefaults,
      ...defaults?.ModelProviderDefaults,
      Headers: {
        ...AgentDefaults.ModelProviderDefaults.Headers,
        ...defaults?.ModelProviderDefaults?.Headers,
      },
    },
    Cli: {
      Connection: {
        ...AgentDefaults.Cli.Connection,
        ...defaults?.Cli?.Connection,
      },
      Display: {
        ...AgentDefaults.Cli.Display,
        ...defaults?.Cli?.Display,
      },
    },
    ToolExecution: {
      ...AgentDefaults.ToolExecution,
      ...defaults?.ToolExecution,
    },
    AgentLoop: {
      ...AgentDefaults.AgentLoop,
      ...defaults?.AgentLoop,
    },
    AgentDelegation: resolveAgentDelegationDefaults(defaults?.AgentDelegation, {
      ...AgentDefaults.AgentLoop,
      ...defaults?.AgentLoop,
    }),
    ToolSearch: {
      Dynamic: {
        ...AgentDefaults.ToolSearch.Dynamic,
        ...defaults?.ToolSearch?.Dynamic,
      },
      Memory: {
        ...AgentDefaults.ToolSearch.Memory,
        ...defaults?.ToolSearch?.Memory,
      },
      Ranking: {
        ...AgentDefaults.ToolSearch.Ranking,
        ...defaults?.ToolSearch?.Ranking,
      },
      Rerank: {
        ...AgentDefaults.ToolSearch.Rerank,
        ...defaults?.ToolSearch?.Rerank,
        FeatureWeights: {
          ...AgentDefaults.ToolSearch.Rerank.FeatureWeights,
          ...defaults?.ToolSearch?.Rerank?.FeatureWeights,
        },
      },
    },
    ActionPlanner: {
      ...AgentDefaults.ActionPlanner,
      ...defaults?.ActionPlanner,
      Evidence: {
        ...AgentDefaults.ActionPlanner.Evidence,
        ...defaults?.ActionPlanner?.Evidence,
      },
      Client: {
        ...AgentDefaults.ActionPlanner.Client,
        ...defaults?.ActionPlanner?.Client,
      },
      TaskFrameClient: {
        ...AgentDefaults.ActionPlanner.TaskFrameClient,
        ...defaults?.ActionPlanner?.TaskFrameClient,
      },
      EvidenceClient: {
        ...AgentDefaults.ActionPlanner.EvidenceClient,
        ...defaults?.ActionPlanner?.EvidenceClient,
      },
    },
    Artifacts: {
      ...AgentDefaults.Artifacts,
      ...defaults?.Artifacts,
    },
    Uploads: {
      ...AgentDefaults.Uploads,
      ...defaults?.Uploads,
    },
    Frontend: {
      DevServer: {
        ...AgentDefaults.Frontend.DevServer,
        ...defaults?.Frontend?.DevServer,
      },
      PreviewServer: {
        ...AgentDefaults.Frontend.PreviewServer,
        ...defaults?.Frontend?.PreviewServer,
      },
      Client: {
        ...AgentDefaults.Frontend.Client,
        ...defaults?.Frontend?.Client,
      },
    },
    Server: {
      ...AgentDefaults.Server,
      ...defaults?.Server,
    },
    Persistence: {
      ...AgentDefaults.Persistence,
      ...defaults?.Persistence,
    },
  };
}

export function resolvePluginRootsConfig(config: AgentSystemConfig): ResolvedAgentPluginRootsConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    System: config.PluginRoots?.System ?? [...defaults.PluginRoots.System],
    User: config.PluginRoots?.User ?? [...defaults.PluginRoots.User],
  };
}

export function resolvePluginDiscoveryConfig(
  config: AgentSystemConfig,
): ResolvedAgentPluginDiscoveryConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    ...defaults.PluginDiscovery,
    ...config.PluginDiscovery,
  };
}

export function resolveCliConfig(
  config: Pick<AgentSystemConfig, "Cli" | "Defaults"> | undefined,
  override: AgentCliConfig = {},
): AgentCliConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    Connection: {
      ...defaults.Cli.Connection,
      ...config?.Cli?.Connection,
      ...override.Connection,
    },
    Display: {
      ...defaults.Cli.Display,
      ...config?.Cli?.Display,
      ...override.Display,
    },
  };
}

export function resolveModelProviderConfig(config: AgentSystemConfig, id?: string) {
  return resolveModelProviderCatalog(config).resolve(id);
}

export function resolveModelProviderCatalog(config: AgentSystemConfig) {
  const defaults = resolveAgentDefaults(config);
  const shared = config.ModelProviderDefaults;
  const providers = config.ModelProviders.map((provider) => {
    const {
      Headers: sharedHeaders,
      ...sharedConfigured
    } = shared ?? {};
    const {
      Headers,
      ...configured
    } = provider;
    return {
      ...defaults.ModelProviderDefaults,
      ...sharedConfigured,
      ...configured,
      Headers: {
        ...defaults.ModelProviderDefaults.Headers,
        ...(sharedHeaders ?? {}),
        ...(Headers ?? {}),
      },
      ApiKey: provider.ApiKey ?? shared?.ApiKey ?? defaults.ModelProviderDefaults.ApiKey,
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
  const defaults = resolveAgentDefaults(config);
  return {
    ...defaults.AgentLoop,
    ...config.AgentLoop,
  };
}

export function resolveAgentDelegationConfig(
  config: AgentSystemConfig,
): ResolvedAgentDelegationConfig {
  const baseLoop = resolveAgentLoopConfig(config);
  const defaults = resolveAgentDefaults(config).AgentDelegation;
  const configured = config.AgentDelegation;
  const runtimeProfileDefaults = resolveRuntimeProfileDefaults(
    baseLoop,
    defaults.RuntimeProfileDefaults,
    configured?.RuntimeProfileDefaults,
  );
  const profileEntries = Object.entries({
    ...defaults.RuntimeProfiles,
    ...(configured?.RuntimeProfiles ?? {}),
  });

  return {
    RuntimeProfileDefaults: runtimeProfileDefaults,
    RuntimeProfiles: Object.fromEntries(profileEntries.map(([name, profile]) => [
      name,
      resolveRuntimeProfile(name, baseLoop, runtimeProfileDefaults, profile),
    ])),
    Templates: {
      ...defaults.Templates,
      ...configured?.Templates,
    },
    Merge: {
      ...defaults.Merge,
      ...configured?.Merge,
    },
  };
}

export function resolveAgentDelegationRuntimeProfile(
  config: AgentSystemConfig,
  profileName: string,
): ResolvedAgentDelegationRuntimeProfileConfig {
  const delegation = resolveAgentDelegationConfig(config);
  const profile = delegation.RuntimeProfiles[profileName];
  if (profile) {
    return profile;
  }

  if (delegation.RuntimeProfileDefaults) {
    return {
      Name: profileName,
      ...delegation.RuntimeProfileDefaults,
    };
  }

  throw new Error(`子代理 RuntimeProfile 没有配置：${profileName}`);
}

function resolveAgentDelegationDefaults(
  configured: AgentSystemConfig["AgentDelegation"] | undefined,
  baseLoop: ResolvedAgentLoopConfig,
): ResolvedAgentDelegationConfig {
  const runtimeProfileDefaults = resolveRuntimeProfileDefaults(
    baseLoop,
    undefined,
    configured?.RuntimeProfileDefaults,
  );
  const runtimeProfiles = Object.fromEntries(
    Object.entries(configured?.RuntimeProfiles ?? {}).map(([name, profile]) => [
      name,
      resolveRuntimeProfile(name, baseLoop, runtimeProfileDefaults, profile),
    ]),
  );

  return {
    RuntimeProfileDefaults: runtimeProfileDefaults,
    RuntimeProfiles: runtimeProfiles,
    Templates: {
      ...AgentDefaults.AgentDelegation.Templates,
      ...configured?.Templates,
    },
    Merge: {
      ...configured?.Merge,
    },
  };
}

function resolveRuntimeProfileDefaults(
  baseLoop: ResolvedAgentLoopConfig,
  base: Omit<ResolvedAgentDelegationRuntimeProfileConfig, "Name"> | undefined,
  configured: AgentDelegationRuntimeProfileConfig | undefined,
) {
  if (!base && !configured) {
    return undefined;
  }

  return {
    Mode: configured?.Mode ?? base?.Mode ?? "directModel",
    ModelProviderId: readOptionalConfiguredString(
      configured?.ModelProviderId,
      base?.ModelProviderId,
    ),
    AgentLoop: {
      ...baseLoop,
      ...base?.AgentLoop,
      ...configured?.AgentLoop,
    },
  };
}

function resolveRuntimeProfile(
  name: string,
  baseLoop: ResolvedAgentLoopConfig,
  defaults: Omit<ResolvedAgentDelegationRuntimeProfileConfig, "Name"> | undefined,
  configured: AgentDelegationRuntimeProfileConfig,
): ResolvedAgentDelegationRuntimeProfileConfig {
  return {
    Name: name,
    Mode: configured.Mode ?? defaults?.Mode ?? "directModel",
    ModelProviderId: readOptionalConfiguredString(
      configured.ModelProviderId,
      defaults?.ModelProviderId,
    ),
    AgentLoop: {
      ...baseLoop,
      ...defaults?.AgentLoop,
      ...configured.AgentLoop,
    },
  };
}

export function resolveToolExecutionConfig(
  config: AgentSystemConfig,
): ResolvedAgentToolExecutionConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    ...defaults.ToolExecution,
    ...config.ToolExecution,
  };
}

export function resolveToolSearchConfig(config: AgentSystemConfig): ResolvedAgentToolSearchConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    Dynamic: {
      ...defaults.ToolSearch.Dynamic,
      ...config.ToolSearch?.Dynamic,
    },
    Memory: {
      ...defaults.ToolSearch.Memory,
      ...config.ToolSearch?.Memory,
    },
    Ranking: {
      ...defaults.ToolSearch.Ranking,
      ...config.ToolSearch?.Ranking,
    },
    Rerank: {
      ...defaults.ToolSearch.Rerank,
      ...config.ToolSearch?.Rerank,
      FeatureWeights: {
        ...defaults.ToolSearch.Rerank.FeatureWeights,
        ...config.ToolSearch?.Rerank?.FeatureWeights,
      },
    },
  };
}

export function resolveActionPlannerConfig(
  config: AgentSystemConfig,
  providerId?: string,
): ResolvedAgentActionPlannerConfig {
  const defaults = resolveAgentDefaults(config);
  const provider = resolveModelProviderConfig(config, providerId);
  const configured = config.ActionPlanner;
  const sharedClientConfig = mergeActionPlannerClientConfig(
    defaults.ActionPlanner.Client,
    configured?.Client,
  );
  const sharedClient = resolveActionPlannerClientConfig({
    config,
    baseProvider: provider,
    configuredClient: sharedClientConfig,
  });

  return {
    ...defaults.ActionPlanner,
    ...configured,
    Evidence: {
      ...defaults.ActionPlanner.Evidence,
      ...configured?.Evidence,
    },
    Client: sharedClient,
    TaskFrameClient: resolveActionPlannerClientConfig({
      config,
      baseProvider: provider,
      configuredClient: mergeActionPlannerClientConfig(
        sharedClientConfig,
        configured?.TaskFrameClient,
      ),
    }),
    EvidenceClient: resolveActionPlannerClientConfig({
      config,
      baseProvider: provider,
      configuredClient: mergeActionPlannerClientConfig(
        sharedClientConfig,
        configured?.EvidenceClient,
      ),
    }),
  };
}

function resolveActionPlannerClientConfig(options: {
  config: AgentSystemConfig;
  baseProvider: ResolvedAgentModelProviderConfig;
  configuredClient: AgentActionPlannerClientConfig;
}): ResolvedAgentActionPlannerClientConfig {
  const configured = options.configuredClient;
  const modelProviderId = configured.ModelProviderId;
  const provider = modelProviderId
    ? resolveModelProviderConfig(options.config, modelProviderId)
    : options.baseProvider;
  const configuredProvider = configured.Provider;

  return {
    ModelProviderId: modelProviderId,
    Provider: configuredProvider && configuredProvider !== "auto"
      ? configuredProvider
      : actionPlannerClientProviderForEndpoint(provider.Endpoint),
    BaseUrl: readConfiguredString(configured.BaseUrl, provider.BaseUrl),
    ApiKey: readConfiguredString(configured.ApiKey, provider.ApiKey),
    Model: readConfiguredString(configured.Model, provider.Model),
    Temperature: configured.Temperature ?? AgentDefaults.ActionPlanner.Client.Temperature,
    MaxTokens: configured.MaxTokens ?? AgentDefaults.ActionPlanner.Client.MaxTokens,
  };
}

function mergeActionPlannerClientConfig(
  base: AgentActionPlannerClientConfig,
  patch: AgentActionPlannerClientConfig | undefined,
): AgentActionPlannerClientConfig {
  return {
    ...base,
    ...patch,
  };
}

function actionPlannerClientProviderForEndpoint(
  endpoint: ResolvedAgentModelProviderConfig["Endpoint"],
): Exclude<AgentActionPlannerClientConfig["Provider"], "auto" | undefined> {
  return ActionPlannerClientProviderByEndpoint[endpoint];
}

const ActionPlannerClientProviderByEndpoint = {
  Responses: "openai-responses",
  ChatCompletions: "openai-generic",
  ClaudeMessages: "anthropic",
  GoogleGenerateContent: "google-ai",
} as const satisfies Record<
  ResolvedAgentModelProviderConfig["Endpoint"],
  Exclude<AgentActionPlannerClientConfig["Provider"], "auto" | undefined>
>;

export function resolveArtifactsConfig(config: AgentSystemConfig): ResolvedAgentArtifactsConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    ...defaults.Artifacts,
    ...config.Artifacts,
  };
}

export function resolveUploadsConfig(config: AgentSystemConfig): ResolvedAgentUploadsConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    ...defaults.Uploads,
    ...config.Uploads,
  };
}

export function resolveFrontendConfig(config: AgentSystemConfig): ResolvedAgentFrontendConfig {
  const defaults = resolveAgentDefaults(config);
  const configured = config.Frontend;
  const server = resolveServerConfig(config);
  return {
    DevServer: {
      ...defaults.Frontend.DevServer,
      ...configured?.DevServer,
    },
    PreviewServer: {
      ...defaults.Frontend.PreviewServer,
      ...configured?.PreviewServer,
    },
    Client: {
      ...defaults.Frontend.Client,
      ...configured?.Client,
      WebSocketUrl: readConfiguredString(
        configured?.Client?.WebSocketUrl,
        readConfiguredString(defaults.Frontend.Client.WebSocketUrl, buildWebSocketUrl(server)),
      ),
    },
  };
}

export function resolveServerConfig(config: AgentSystemConfig) {
  const defaults = resolveAgentDefaults(config);
  return {
    ...defaults.Server,
    ...config.Server,
  };
}

export function resolvePersistenceConfig(config: AgentSystemConfig): ResolvedAgentPersistenceConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    ...defaults.Persistence,
    ...config.Persistence,
  };
}

function readConfiguredString(value: string | undefined, fallback: string): string {
  return value?.trim() ? value : fallback;
}

function readOptionalConfiguredString(
  value: string | undefined,
  fallback: string | undefined,
): string | undefined {
  return value?.trim() ? value : fallback?.trim() ? fallback : undefined;
}

function buildWebSocketUrl(server: Required<NonNullable<AgentSystemConfig["Server"]>>): string {
  return `ws://${server.Host}:${server.Port}`;
}
