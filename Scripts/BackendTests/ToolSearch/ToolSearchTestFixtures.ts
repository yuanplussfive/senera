import type { AgentToolSearchRegistryReader } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchIndex.js";
import type { PluginRootKind } from "../../../Source/AgentSystem/Types/PluginManifestTypes.js";
import type {
  ResolvedAgentToolLearningConfig,
  ResolvedAgentToolSearchConfig,
} from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/PluginRuntimeTypes.js";
import type { ToolLoadingMode } from "../../../Source/AgentSystem/Types/PluginManifestTypes.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";

export function createRegistry(tools: RegisteredTool[]): AgentToolSearchRegistryReader & {
  getTool(name: string): RegisteredTool | undefined;
  listDiscoverySources(): Array<{ id: string; title: string; description: string; pluginNames: string[] }>;
} {
  return {
    listTools: () => tools,
    getTool: (name: string) => tools.find((tool) => tool.name === name),
    listDiscoverySources: () => {
      const sources = new Map<string, { id: string; title: string; description: string; pluginNames: string[] }>();
      for (const tool of tools) {
        for (const source of tool.sources) {
          const registered = sources.get(source.Id);
          if (registered) {
            if (!registered.pluginNames.includes(tool.plugin.manifest.Plugin.Name)) {
              registered.pluginNames.push(tool.plugin.manifest.Plugin.Name);
            }
          } else {
            sources.set(source.Id, {
              id: source.Id,
              title: source.Title,
              description: source.Description,
              pluginNames: [tool.plugin.manifest.Plugin.Name],
            });
          }
        }
      }
      return [...sources.values()].sort((left, right) => left.id.localeCompare(right.id));
    },
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
  loading?: ToolLoadingMode;
  source?: {
    id: string;
    title: string;
    description: string;
  };
}): RegisteredTool {
  const source = options.source ?? {
    id: "workspace",
    title: "Workspace",
    description: "Files and source code in the current workspace.",
  };
  return {
    loading: options.loading ?? "Dynamic",
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
        ManifestVersion: 2,
        Plugin: {
          Name: `${options.name}Plugin`,
          Title: options.title,
          Version: "1.0.0",
          Kind: "Tool",
          Description: options.summary,
        },
        Discovery: {
          Sources: [{ Id: source.id, Title: source.title, Description: source.description }],
        },
        Prompting: {
          Priority: options.priority,
        },
      },
    },
    name: options.name,
    permissions: [],
    sources: [
      {
        Id: source.id,
        Title: source.title,
        Description: source.description,
      },
    ],
    handler: { kind: "HostCapability", capability: options.name },
    runtime: { Lifecycle: "Immediate", ProtocolVersion: 2, Capabilities: { Cancellation: true } },
    execution: {
      Targets: ["Local"],
      Network: "Deny",
      Workspace: "ReadOnly",
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
      DatabasePath: "",
      MaxEpisodes: 100,
      HalfLifeDays: 30,
    },
    Ranking: {
      RrfK: 60,
      MmrLambda: 0.72,
      MmrCandidateScoreRatio: 0.92,
      MinScore: 0,
      MaxResults: 6,
      MemoryExpansion: {
        Mode: "fallback",
        MinConfidence: 0.8,
        MinEvidence: 3,
        MaxResults: 2,
      },
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
    ModelProvider: createModelProvider(),
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
