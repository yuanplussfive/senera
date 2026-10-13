import type { AgentToolSearchRegistryReader } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchIndex.js";
import type { ResolvedAgentToolSearchConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { ToolExecutionTarget, ToolLoadingMode } from "../../../Source/AgentSystem/Types/AgentToolContractTypes.js";
import type { AgentInteractionSurface } from "../../../Source/AgentSystem/Interaction/AgentInteractionContext.js";

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
  examples?: string[];
  rootKind?: "System" | "User";
  loading?: ToolLoadingMode;
  executionTargets?: ToolExecutionTarget[];
  interactionSurfaces?: readonly AgentInteractionSurface[];
  aliases?: string[];
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
    ...(options.interactionSurfaces ? { interactionSurfaces: options.interactionSurfaces } : {}),
    name: options.name,
    contract: { digest: `${options.name}.contract` },
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
      Targets: options.executionTargets ?? ["Local"],
      Network: "Deny",
      Workspace: "ReadOnly",
    },
    childGrant: "inherit",
    evidenceCapabilities: [],
    search: {
      Summary: options.summary,
      Tags: options.tags,
      UseCases: [options.summary],
      ...(options.examples ? { Examples: options.examples } : {}),
      Capabilities: [
        {
          Id: `${options.name}.capability`,
          Title: options.title,
          Description: options.summary,
          Facets: {
            Actions: options.actions,
            Targets: options.targets,
            Effects: ["none"],
          },
          ...(options.aliases ? { Aliases: options.aliases } : {}),
          Risk: { SideEffect: "none", Permission: "resources-read" },
        },
      ],
    },
  };
}

export function createToolSearchConfig(): ResolvedAgentToolSearchConfig {
  return {
    Fuzzy: {
      Enabled: true,
      MinScore: 0.25,
    },
    Embedding: {
      Enabled: true,
    },
    Memory: {
      MaxEpisodes: 100,
      HalfLifeDays: 30,
    },
    Tokenize: {
      Stopwords: [],
    },
    Ranking: {
      RrfK: 30,
      ChannelWeights: {
        bm25: 1,
        exact: 0.9,
        example: 1.1,
        fuzzy: 0.7,
        semantic: 0.5,
        structural: 1,
        memory: 0.6,
      },
    },
    Disclosure: {
      TokenBudget: 640,
    },
    Rerank: {
      Enabled: true,
      ScoreScale: 0.018,
      FeatureWeights: {},
    },
  };
}
