import { describe, expect, test } from "vitest";
import { AgentToolSearchTokenizer } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchTokenizer.js";
import {
  capabilityFacetEntries,
  capabilityRiskText,
  capabilitySearchText,
  matchToolCapabilities,
} from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchCapabilities.js";
import { buildPlannedToolSearchQueries } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchQueryPlanner.js";
import { AgentToolSearchIndex } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchIndex.js";
import type { ToolSearchDocument } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchTypes.js";
import type { AgentToolSearchRegistryReader } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchIndex.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/PluginRuntimeTypes.js";
import type { ResolvedAgentToolSearchConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("ToolSearch core", () => {
  test("normalizes query text into unique searchable tokens and keywords", () => {
    const tokenizer = new AgentToolSearchTokenizer();

    expect(tokenizer.tokenize("Read READ workspace 文件")).toEqual(
      expect.arrayContaining(["read", "workspace", "文件"]),
    );
    expect(new Set(tokenizer.tokenize("Read READ")).size).toBe(tokenizer.tokenize("Read READ").length);
    expect(tokenizer.keywords("读取 workspace 文件 并 总结")).toEqual(expect.arrayContaining(["workspace"]));
  });

  test("matches capability facets and projects risk text", () => {
    const tokenizer = new AgentToolSearchTokenizer();
    const capability = {
      Id: "workspace.read",
      Title: "Read workspace files",
      Description: "Inspect project files",
      Facets: {
        Actions: ["read", "inspect"],
        Targets: ["workspace", "file"],
      },
      Aliases: ["open file"],
      Risk: {
        SideEffect: "none",
        Permission: "read",
        Notes: ["no writes"],
      },
    };
    const doc = {
      toolName: "WorkspaceReadFile",
      title: "Read file",
      pluginName: "workspace",
      pluginTitle: "Workspace",
      sourceText: "workspace Workspace Files and source code in the current workspace.",
      sourceIds: ["workspace"],
      sources: [
        {
          id: "workspace",
          title: "Workspace",
          description: "Files and source code in the current workspace.",
        },
      ],
      tags: "workspace read",
      summary: "Read files",
      whenToUse: "Inspect workspace files",
      examples: "",
      avoid: "",
      capabilityText: capabilitySearchText(capability, { includeRisk: false }),
      capabilityFacets: "read inspect workspace file",
      capabilityRiskText: capabilityRiskText(capability.Risk),
      params: "path",
      permissions: "workspace.read",
      priority: 10,
      coreText: "WorkspaceReadFile read workspace file",
      id: "workspace-read",
      capabilities: [capability],
    } satisfies ToolSearchDocument;

    expect(capabilityFacetEntries(capability.Facets)).toEqual([
      { name: "Actions", values: ["read", "inspect"] },
      { name: "Targets", values: ["workspace", "file"] },
    ]);
    expect(capabilityRiskText(capability.Risk)).toBe("none read no writes");
    expect(matchToolCapabilities(doc, tokenizer.tokenize("read workspace"), tokenizer)).toEqual([
      {
        id: "workspace.read",
        title: "Read workspace files",
        score: expect.any(Number),
        matchedFacets: ["Actions", "Targets"],
        risk: {
          sideEffect: "none",
          permission: "read",
        },
      },
    ]);
  });

  test("builds planned discovery queries from explicit queries and capability needs", () => {
    const queries = buildPlannedToolSearchQueries(
      {
        input: "update docs",
        discover: true,
        queries: ["workspace write", "workspace write"],
        needs: [
          {
            actions: ["write"],
            targets: ["workspace"],
            inputs: ["path"],
            outputs: ["file"],
            evidence: [],
            effects: ["filesystem"],
          },
        ],
      },
      (text) => text.split(/\s+/),
    );

    expect(queries).toEqual([
      {
        text: "workspace write",
        facets: ["write", "workspace", "path", "file", "filesystem"],
      },
      {
        text: "write workspace path file filesystem",
        facets: ["write", "workspace", "path", "file", "filesystem"],
      },
    ]);
    expect(buildPlannedToolSearchQueries({ input: "hello" }, (text) => text.split(/\s+/))).toEqual([]);
  });

  test("indexes registered tools and ranks by capability without score coupling", () => {
    const index = new AgentToolSearchIndex(
      createRegistry([
        createTool({
          name: "WorkspaceReadFile",
          title: "Read file",
          summary: "Read project files from the workspace",
          tags: ["workspace", "read"],
          actions: ["read"],
          targets: ["workspace", "file"],
          priority: 10,
        }),
        createTool({
          name: "WeatherTool",
          title: "Weather",
          summary: "Fetch weather forecast",
          tags: ["weather"],
          actions: ["forecast"],
          targets: ["weather", "city"],
          priority: 50,
          sourceId: "web",
        }),
      ]),
      createToolSearchConfig(),
    );

    const results = index.search({
      query: "read workspace file",
    });

    expect(index.getToolNames()).toEqual(["WorkspaceReadFile", "WeatherTool"]);
    expect(results[0]?.toolName).toBe("WorkspaceReadFile");
    expect(results[0]?.matchedCapabilities[0]?.matchedFacets).toContain("Actions");
    expect(results.map((result) => result.toolName)).not.toContain("WeatherTool");
  });

  test("uses learned aliases as a bounded fallback instead of polluting lexical candidates", () => {
    const index = new AgentToolSearchIndex(
      createRegistry([
        createTool({
          name: "WorkspaceReadFile",
          title: "Read file",
          summary: "Read project files from the workspace",
          tags: ["workspace", "read"],
          actions: ["read"],
          targets: ["workspace", "file"],
          priority: 10,
        }),
        createTool({
          name: "WeatherTool",
          title: "Weather",
          summary: "Fetch weather forecast",
          tags: ["weather"],
          actions: ["forecast"],
          targets: ["weather", "city"],
          priority: 50,
          sourceId: "web",
        }),
      ]),
      createToolSearchConfig(),
    );
    const learnedWeather = {
      toolName: "WeatherTool",
      evidence: 4,
      confidence: 0.9,
      rankScore: 1,
      signals: [
        {
          term: "meteorology-alias",
          source: "toolLearning.trigger",
          support: 4,
          confidence: 0.9,
          score: 4,
          lastSeenAt: 1,
        },
      ],
    };

    const lexical = index.search({
      query: "read workspace file",
      memoryEvidence: [learnedWeather],
    });
    const learnedFallback = index.search({
      query: "meteorology-alias",
      memoryEvidence: [learnedWeather],
    });
    const weakFallback = index.search({
      query: "weak-alias",
      memoryEvidence: [{ ...learnedWeather, evidence: 2, confidence: 0.79 }],
    });

    expect(lexical.map((result) => result.toolName)).toEqual(["WorkspaceReadFile"]);
    expect(learnedFallback.map((result) => result.toolName)).toEqual(["WeatherTool"]);
    expect(weakFallback).toEqual([]);
  });

  test("caps diversified search output with the configured result budget", () => {
    const config = createToolSearchConfig();
    config.Ranking.MaxResults = 1;
    const index = new AgentToolSearchIndex(
      createRegistry([
        createTool({
          name: "WorkspaceReadFile",
          title: "Read file",
          summary: "Read workspace files",
          tags: ["workspace", "file", "read"],
          actions: ["read"],
          targets: ["workspace", "file"],
          priority: 10,
        }),
        createTool({
          name: "WorkspaceEditFile",
          title: "Edit file",
          summary: "Edit workspace files",
          tags: ["workspace", "file", "edit"],
          actions: ["edit"],
          targets: ["workspace", "file"],
          priority: 20,
        }),
      ]),
      config,
    );

    expect(index.search({ query: "workspace file" })).toHaveLength(1);
  });

  test("uses preferred sources as a soft ranking signal without filtering candidates", () => {
    const index = new AgentToolSearchIndex(
      createRegistry([
        createTool({
          name: "WorkspaceLookup",
          title: "Workspace lookup",
          summary: "Find current project information",
          tags: ["information", "search"],
          actions: ["search"],
          targets: ["information"],
          priority: 10,
          sourceId: "workspace",
        }),
        createTool({
          name: "WebLookup",
          title: "Web lookup",
          summary: "Find current public information",
          tags: ["information", "search"],
          actions: ["search"],
          targets: ["information"],
          priority: 20,
          sourceId: "web",
        }),
      ]),
      createToolSearchConfig(),
    );

    const results = index.search({
      query: "find current information",
      preferredSourceIds: ["web"],
    });

    expect(results.map((result) => result.toolName)).toEqual(["WebLookup", "WorkspaceLookup"]);
    expect(results.every((result) => result.sources.length === 1)).toBe(true);
  });

  test("keeps relevant tools discoverable before execution approval", () => {
    const tool = createTool({
      name: "WorkspaceEditFile",
      title: "Edit file",
      summary: "Apply targeted edits to workspace files",
      tags: ["workspace", "edit"],
      actions: ["edit", "replace"],
      targets: ["workspace", "file"],
      examples: ["update a tool description"],
      sideEffect: "write-workspace",
      priority: 10,
    });
    const index = new AgentToolSearchIndex(createRegistry([tool]), createToolSearchConfig());

    expect(index.search({ query: "tool description" }).map((result) => result.toolName)).toEqual(["WorkspaceEditFile"]);
    expect(index.search({ query: "edit workspace file" }).map((result) => result.toolName)).toEqual([
      "WorkspaceEditFile",
    ]);
    expect(index.search({ query: "use WorkspaceEditFile" }).map((result) => result.toolName)).toEqual([
      "WorkspaceEditFile",
    ]);
  });
});

function createRegistry(tools: RegisteredTool[]): AgentToolSearchRegistryReader {
  return {
    listTools: () => tools,
  };
}

function createTool(options: {
  name: string;
  title: string;
  summary: string;
  tags: string[];
  actions: string[];
  targets: string[];
  priority: number;
  examples?: string[];
  sideEffect?: string;
  sourceId?: string;
}): RegisteredTool {
  const sourceId = options.sourceId ?? "workspace";
  return {
    loading: "Dynamic",
    plugin: {
      rootPath: "",
      rootKind: "System",
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
        Prompting: {
          Priority: options.priority,
        },
      },
    },
    name: options.name,
    permissions: [],
    sources: [
      {
        Id: sourceId,
        Title: sourceId === "web" ? "Web" : "Workspace",
        Description:
          sourceId === "web"
            ? "Public internet information and current external data."
            : "Files and source code in the current workspace.",
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
      Examples: options.examples,
      Capabilities: [
        {
          Id: `${options.name}.capability`,
          Title: options.title,
          Description: options.summary,
          Facets: {
            Actions: options.actions,
            Targets: options.targets,
            Effects: options.sideEffect ? [options.sideEffect] : undefined,
          },
          Risk: options.sideEffect ? { SideEffect: options.sideEffect } : undefined,
        },
      ],
    },
  };
}

function createToolSearchConfig(): ResolvedAgentToolSearchConfig {
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
