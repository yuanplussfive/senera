import type { AgentToolSearchRegistryReader } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchIndex.js";
import type { PluginRootKind } from "../../../Source/AgentSystem/Types/PluginManifestTypes.js";
import type {
  ResolvedAgentToolLearningConfig,
  ResolvedAgentToolSearchConfig,
} from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/PluginRuntimeTypes.js";

export function createRegistry(tools: RegisteredTool[]): AgentToolSearchRegistryReader & {
  getTool(name: string): RegisteredTool | undefined;
} {
  return {
    listTools: () => tools,
    getTool: (name: string) => tools.find((tool) => tool.name === name),
  };
}

export function createTool(options: {
  name: string;
  title: string;
  summary: string;
  tags: string[];
  actions: string[];
  targets: string[];
  priority: number;
  rootKind?: PluginRootKind;
}): RegisteredTool {
  return {
    plugin: {
      rootPath: "",
      rootKind: options.rootKind ?? "System",
      manifestPath: "",
      config: {
        fileName: "PluginConfig.toml",
        path: "",
        exists: false,
        source: "default",
        templateExists: false,
        needsUserConfig: false,
        toml: "",
        sections: [],
        runtime: {
          enabled: true,
          tools: {},
        },
        diagnostics: [],
      },
      manifest: {
        Plugin: {
          Name: `${options.name}Plugin`,
          Title: options.title,
          Version: "1.0.0",
          Kind: "Tool",
          Description: options.summary,
        },
        Prompting: {
          Priority: options.priority,
        },
      },
    },
    name: options.name,
    permissions: [],
    handler: { kind: "HostCapability", capability: options.name },
    execution: {
      Boundary: "Local",
      Network: "Deny",
      Workspace: "ReadOnly",
      LocalFallback: "Deny",
    },
    evidenceCapabilities: [],
    search: {
      Summary: options.summary,
      Tags: options.tags,
      UseCases: [options.summary],
      Capabilities: [
        {
          Id: `${options.name}.capability`,
          Title: options.title,
          Description: options.summary,
          Facets: {
            Actions: options.actions,
            Targets: options.targets,
          },
        },
      ],
    },
  };
}

export function createToolSearchConfig(): ResolvedAgentToolSearchConfig {
  return {
    Embedding: {
      Enabled: false,
      Model: "",
      Dimensions: -1,
      BatchSize: 64,
      InputMaxChars: 12000,
      ScoreThreshold: 0,
    },
    Memory: {
      Kind: "memory",
      DatabasePath: "",
      MaxEpisodes: 100,
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
  };
}

export function createToolLearningConfig(
  overrides: Partial<ResolvedAgentToolLearningConfig> = {},
): ResolvedAgentToolLearningConfig {
  const client = {
    ModelProviderId: undefined,
    Provider: "openai-generic" as const,
    BaseUrl: "https://model.example/v1",
    ApiKey: "test-key",
    Model: "test-model",
    Temperature: 0,
    MaxTokens: -1,
  };
  return {
    Enabled: false,
    MaxRepairAttempts: 1,
    Client: client,
    Patterns: {
      MinSupport: 1,
      MaxPromptPatterns: 3,
    },
    ...overrides,
  };
}
