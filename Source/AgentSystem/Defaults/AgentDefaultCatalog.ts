import fs from "node:fs";
import path from "node:path";
import type {
  AgentDefaultsConfig,
  ResolvedAgentModelProviderEndpointConfig,
} from "../Types/AgentConfigTypes.js";
import type {
  AgentModelRuntimeDefaultsConfig,
  AgentVectorModelsDefaultsConfig,
  ResolvedAgentDefaultsConfig,
} from "./AgentDefaultValueTypes.js";
import { moduleDirPath } from "../Core/AgentPath.js";
import { SeneraMicrosandboxDefaults } from "../Execution/SeneraMicrosandboxDefaults.js";

const DefaultModelProviderEndpoints = JSON.parse(
  fs.readFileSync(
    path.join(moduleDirPath(import.meta.url), "AgentDefaultModelProviderEndpoints.json"),
    "utf8",
  ),
) as ResolvedAgentModelProviderEndpointConfig[];

export const AgentDefaults = {
  PluginRoots: {
    System: ["./System/Plugins"],
    User: ["./Plugins"],
  },
  PluginDiscovery: {
    ManifestFileName: "PluginManifest.json",
    ConfigFileName: "PluginConfig.toml",
  },
  ModelProviderEndpoints: DefaultModelProviderEndpoints,
  ModelRuntime: {
    Kind: "OpenAICompatible",
    Endpoint: "ChatCompletions",
    Model: "mistral-large-latest",
    Capabilities: {
      Chat: true,
      Embedding: false,
      Rerank: false,
      Vision: false,
      ImageOutput: false,
      Reasoning: false,
      ToolCalling: true,
      DeveloperRole: false,
    },
    ContextWindowTokens: -1,
    MaxModelOutputTokens: -1,
    Temperature: 0,
    MaxOutputTokens: -1,
    Stream: true,
    TimeoutSeconds: 480,
    FirstTokenTimeoutSeconds: 240,
    MaxRequestSeconds: -1,
    MaxNetworkRetries: 1,
  },
  ToolExecution: {
    TimeoutSeconds: 120,
    MaxStdoutBytes: 1000000,
    MaxStderrBytes: 1000000,
  },
  SandboxRuntime: {
    BaseDir: ".senera/sandbox-runtime",
    BundleDir: ".senera/sandbox-bundles",
    ImportBundlesOnStartup: true,
    Images: [SeneraMicrosandboxDefaults.image],
  },
  AgentLoop: {
    LoadedTools: "dynamic",
    PiSessionCreateTimeoutSeconds: 20,
    PiSessionCreateTimeoutMs: 20000,
    PiSessions: {
      RootDir: ".senera/pi-sessions",
    },
  },
  ToolSearch: {
    Embedding: {
      Enabled: false,
      Model: "text-embedding-3-large",
      Dimensions: -1,
      BatchSize: 64,
      InputMaxChars: 12000,
      ScoreThreshold: 0,
    },
    Memory: {
      Kind: "sqlite",
      DatabasePath: ".senera/ToolSearchLearning.sqlite",
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
  VectorModels: {
    Embedding: {
      Enabled: true,
      ProviderId: "openai",
      Model: "qwen3-embedding-0.6b",
      TimeoutSeconds: 20,
      MaxNetworkRetries: 1,
      Dimensions: -1,
      BatchSize: 64,
      InputMaxChars: 12000,
    },
    Rerank: {
      Enabled: true,
      ProviderId: "openai",
      Model: "qwen3-reranker-0.6b",
      TimeoutSeconds: 20,
      MaxNetworkRetries: 1,
      EndpointPath: "/rerank",
      CandidateLimit: 32,
      TopK: 16,
    },
  },
  ToolLearning: {
    Enabled: true,
    MaxRepairAttempts: 1,
    Patterns: {
      MinSupport: 2,
      MaxPromptPatterns: 2,
    },
    Client: {
      Provider: "openai-generic",
      Temperature: 0.1,
      MaxTokens: -1,
    },
  },
  MemoryLearning: {
    Promotion: {
      MinSupport: 2,
      MaxClusterSize: 8,
      MinSimilarity: 0.78,
    },
  },
  Presets: {
    Enabled: true,
    RootDir: ".senera/presets",
    StateFile: ".senera/presets-state.json",
  },
  ActionPlanner: {
    Enabled: true,
    MaxRepairAttempts: 1,
    Evidence: {
      StalledStepLag: 2,
    },
    Client: {
      Provider: "openai-generic",
      Temperature: 0.1,
      MaxTokens: -1,
    },
    TurnUnderstandingClient: {
      Provider: "openai-generic",
      Temperature: 0.1,
      MaxTokens: -1,
    },
    PlanningClient: {
      Provider: "openai-generic",
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
      StrictPort: false,
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
  ConfigStore: {
    Enabled: true,
    Kind: "sqlite",
    DatabasePath: ".senera/Config.sqlite",
    MirrorJson: true,
  },
} as const satisfies Omit<
  ResolvedAgentDefaultsConfig,
  "ModelRuntime" | "ToolExecution" | "VectorModels"
> & {
  ModelRuntime: AgentModelRuntimeDefaultsConfig;
  ToolExecution: Required<NonNullable<AgentDefaultsConfig["ToolExecution"]>>;
  SandboxRuntime: Required<NonNullable<AgentDefaultsConfig["SandboxRuntime"]>>;
  VectorModels: AgentVectorModelsDefaultsConfig;
};
