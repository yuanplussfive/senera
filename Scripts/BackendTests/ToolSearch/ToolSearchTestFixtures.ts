import type { AgentToolSearchRegistryReader } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchIndex.js";
import type {
  ResolvedAgentToolLearningConfig,
  ResolvedAgentToolSearchConfig,
} from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { ToolLoadingMode } from "../../../Source/AgentSystem/Types/AgentToolContractTypes.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";

export function createRegistry(tools: RegisteredTool[]): AgentToolSearchRegistryReader & {
  getTool(name: string): RegisteredTool | undefined;
  listDiscoverySources(): Array<{ id: string; title: string; description: string }>;
  listSkills(): [];
} {
  return {
    listTools: () => tools,
    getTool: (name: string) => tools.find((tool) => tool.name === name),
    listSkills: () => [],
    listDiscoverySources: () => {
      const sources = new Map<string, { id: string; title: string; description: string }>();
      for (const tool of tools) {
        for (const source of tool.sources) {
          const registered = sources.get(source.Id);
          if (!registered) {
            sources.set(source.Id, {
              id: source.Id,
              title: source.Title,
              description: source.Description,
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
  rootKind?: "System" | "User";
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
    owner: {
      kind: options.rootKind === "System" ? "system" : "mcp",
      name: `${options.name}-owner`,
      title: options.title,
      description: options.summary,
      rootPath: process.cwd(),
      revision: "test",
      priority: options.priority,
      trusted: options.rootKind === "System",
      requiresApproval: false,
    },
    loading: options.loading ?? "Dynamic",
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
    runtime: {
      Lifecycle: "Immediate",
      ProtocolVersion: 2,
      ResultAssessment: "ProcessExit",
      Capabilities: { Cancellation: true },
    },
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
      ScoreThreshold: 0,
    },
    Memory: {
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
