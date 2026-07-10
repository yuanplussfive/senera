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
    expect(tokenizer.keywords("读取 workspace 文件 并 总结")).toEqual(
      expect.arrayContaining(["workspace"]),
    );
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
    const queries = buildPlannedToolSearchQueries({
      input: "update docs",
      discover: true,
      queries: ["workspace write", "workspace write"],
      needs: [{
        actions: ["write"],
        targets: ["workspace"],
        inputs: ["path"],
        outputs: ["file"],
        evidence: [],
        effects: ["filesystem"],
      }],
    }, (text) => text.split(/\s+/));

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
    const index = new AgentToolSearchIndex(createRegistry([
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
      }),
    ]), createToolSearchConfig());

    const results = index.search({
      query: "read workspace file",
    });

    expect(index.getToolNames()).toEqual(["WorkspaceReadFile", "WeatherTool"]);
    expect(results[0]?.toolName).toBe("WorkspaceReadFile");
    expect(results[0]?.matchedCapabilities[0]?.matchedFacets).toContain("Actions");
    expect(results.map((result) => result.toolName)).not.toContain("WeatherTool");
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
}): RegisteredTool {
  return {
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
      Capabilities: [{
        Id: `${options.name}.capability`,
        Title: options.title,
        Description: options.summary,
        Facets: {
          Actions: options.actions,
          Targets: options.targets,
        },
      }],
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
