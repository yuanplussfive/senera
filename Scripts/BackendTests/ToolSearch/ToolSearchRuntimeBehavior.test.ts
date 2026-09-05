import { describe, expect, test, vi } from "vitest";
import { AgentToolSearchMemory } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemory.js";
import { InMemoryToolSearchMemoryStore } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryStore.js";
import { projectLearningProjection } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryProjection.js";
import {
  AgentToolMetaToolNames,
  AgentToolSearchRuntime,
} from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchRuntime.js";
import { AgentToolSearchTokenizer } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchTokenizer.js";
import { AgentToolSearchUsageMemory } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchUsageMemory.js";
import {
  buildToolSearchResultProjection,
  readToolNamesFromSearchResult,
} from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchResultProjector.js";
import type { AgentToolSearchResult } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchIndex.js";
import type { AgentToolSearchEpisode } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryTypes.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import type { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import {
  AgentToolFailureSources,
  AgentToolSuccessOutcome,
  createAgentToolFailureOutcome,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import {
  createRegistry,
  createTool,
  createToolLearningConfig,
  createToolSearchConfig,
} from "./ToolSearchTestFixtures.js";

describe("ToolSearch runtime behavior", () => {
  test("loads bootstrap System Tools and discovers explicitly dynamic System Tools", async () => {
    const runtime = new AgentToolSearchRuntime(
      createRegistry([
        createTool({
          name: AgentToolMetaToolNames.Search,
          title: "Tool search",
          summary: "Find tools",
          tags: ["search"],
          actions: ["search"],
          targets: ["tools"],
          priority: 100,
          rootKind: "System",
          loading: "Bootstrap",
        }),
        createTool({
          name: "ShellCommandTool",
          title: "Shell command",
          summary: "Run one shell command",
          tags: ["shell", "command"],
          actions: ["execute"],
          targets: ["process"],
          priority: 90,
          rootKind: "System",
          loading: "Bootstrap",
        }),
        createTool({
          name: "DocumentExtract",
          title: "Document extract",
          summary: "Extract text and structure from a document",
          tags: ["document", "extract"],
          actions: ["extract"],
          targets: ["document"],
          priority: 80,
          rootKind: "System",
          loading: "Dynamic",
        }),
        createTool({
          name: "WeatherTool",
          title: "Weather",
          summary: "Fetch a weather forecast",
          tags: ["weather"],
          actions: ["forecast"],
          targets: ["city"],
          priority: 50,
          rootKind: "User",
          loading: "Dynamic",
          source: {
            id: "web",
            title: "Web",
            description: "Public internet information and current external data.",
          },
        }),
      ]) as unknown as AgentExtensionRegistry,
      createToolSearchConfig(),
      createToolLearningConfig(),
      "E:/workspace",
      createModelProvider(),
      { memoryStore: new InMemoryToolSearchMemoryStore(), availableExecutionTargets: () => ["Local"] },
    );

    expect(
      await runtime.resolvePlannedLoadedTools({
        input: "no matching capability",
        currentLoadedTools: [],
      }),
    ).toEqual([AgentToolMetaToolNames.Search, "ShellCommandTool"]);
    expect(
      await runtime.resolvePlannedLoadedTools({
        input: "run a shell command",
        currentLoadedTools: ["WeatherTool"],
        currentSetPolicy: "replace",
        preferredTools: ["ShellCommandTool"],
      }),
    ).toEqual([AgentToolMetaToolNames.Search, "ShellCommandTool"]);
    expect(
      await runtime.resolvePlannedLoadedTools({
        input: "run a shell command",
        currentLoadedTools: ["WeatherTool"],
        currentSetPolicy: "retain",
        preferredTools: ["ShellCommandTool"],
      }),
    ).toEqual([AgentToolMetaToolNames.Search, "ShellCommandTool", "WeatherTool"]);
    expect(await runtime.resolveInitialLoadedTools("forecast city", ["ShellCommandTool"])).toEqual([
      AgentToolMetaToolNames.Search,
      "ShellCommandTool",
    ]);
    expect(await runtime.resolveInitialLoadedTools("no matching capability", ["WeatherTool"])).toEqual([
      AgentToolMetaToolNames.Search,
      "ShellCommandTool",
      "WeatherTool",
    ]);
    await expect(runtime.search({ query: "extract text from a document" })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ toolName: "DocumentExtract" })]),
    );
    await expect(runtime.search({ query: "run one shell command" })).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ toolName: "ShellCommandTool" })]),
    );

    runtime.close();
  });

  test("recalls an English MCP capability from a Chinese request through embeddings", async () => {
    const config = createToolSearchConfig();
    config.Embedding.Enabled = true;
    config.Embedding.ScoreThreshold = 0.7;
    const embed = vi.fn(async ({ input }: { input: readonly string[] }) => ({
      model: "multilingual-test",
      vectors: input.map((text) => (text.includes("这两天") || text.includes("current public web") ? [1, 0] : [0, 1])),
    }));
    const runtime = new AgentToolSearchRuntime(
      createRegistry([
        createTool({
          name: AgentToolMetaToolNames.Search,
          title: "Tool search",
          summary: "Find tools",
          tags: ["search"],
          actions: ["search"],
          targets: ["tools"],
          priority: 100,
          rootKind: "System",
          loading: "Bootstrap",
        }),
        createTool({
          name: "mcp__web_research__search",
          title: "Web research",
          summary: "Search current public web information and return source-backed results.",
          tags: ["web", "research"],
          actions: ["search"],
          targets: ["public-web"],
          priority: 20,
        }),
        createTool({
          name: "mcp__weather__forecast",
          title: "Weather forecast",
          summary: "Return the weather forecast for a city.",
          tags: ["weather"],
          actions: ["forecast"],
          targets: ["city"],
          priority: 20,
        }),
      ]) as unknown as AgentExtensionRegistry,
      config,
      createToolLearningConfig(),
      "E:/workspace",
      createModelProvider(),
      {
        memoryStore: new InMemoryToolSearchMemoryStore(),
        embedding: {
          model: "multilingual-test",
          client: { embed },
        },
        availableExecutionTargets: () => ["Local"],
      },
    );

    await expect(runtime.search({ query: "这两天 AI 有什么发展" })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ toolName: "mcp__web_research__search" })]),
    );
    runtime.refresh();
    await expect(runtime.search({ query: "这两天 AI 有什么发展" })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ toolName: "mcp__web_research__search" })]),
    );

    expect(embed.mock.calls.map(([request]) => request.input.length)).toEqual([2, 1, 1]);
    runtime.close();
  });

  test("uses the configured vector reranker as the final ordering signal", async () => {
    const rerank = vi.fn(async ({ documents }: { documents: readonly { id: string; text: string }[] }) => ({
      model: "rerank-test",
      results: [...documents].reverse().map((document, index) => ({
        id: document.id,
        index: documents.findIndex((candidate) => candidate.id === document.id),
        score: 1 - index / documents.length,
      })),
    }));
    const runtime = new AgentToolSearchRuntime(
      createRegistry([
        createTool({
          name: "AlphaWorkspaceSearch",
          title: "Alpha workspace search",
          summary: "Search workspace records",
          tags: ["workspace", "search"],
          actions: ["search"],
          targets: ["records"],
          priority: 20,
        }),
        createTool({
          name: "BetaWorkspaceSearch",
          title: "Beta workspace search",
          summary: "Search workspace records",
          tags: ["workspace", "search"],
          actions: ["search"],
          targets: ["records"],
          priority: 20,
        }),
      ]) as unknown as AgentExtensionRegistry,
      createToolSearchConfig(),
      createToolLearningConfig(),
      "E:/workspace",
      createModelProvider(),
      {
        memoryStore: new InMemoryToolSearchMemoryStore(),
        rerank: { client: { rerank } },
        availableExecutionTargets: () => ["Local"],
      },
    );

    const results = await runtime.search({ query: "search workspace records" });

    expect(rerank).toHaveBeenCalledOnce();
    expect(results.map((result) => result.toolName)).toEqual(["BetaWorkspaceSearch", "AlphaWorkspaceSearch"]);
    expect(results[0]?.ranks.rerank).toBe(1);
    runtime.close();
  });

  test("keeps vector retrieval dormant when lexical retrieval already has candidates", async () => {
    const config = createToolSearchConfig();
    config.Embedding.Enabled = true;
    const embed = vi.fn().mockRejectedValue(new Error("embedding endpoint unavailable"));
    const runtime = new AgentToolSearchRuntime(
      createRegistry([
        createTool({
          name: "WorkspaceSearch",
          title: "Workspace search",
          summary: "Search workspace records",
          tags: ["workspace", "search"],
          actions: ["search"],
          targets: ["records"],
          priority: 20,
        }),
      ]) as unknown as AgentExtensionRegistry,
      config,
      createToolLearningConfig(),
      "E:/workspace",
      createModelProvider(),
      {
        memoryStore: new InMemoryToolSearchMemoryStore(),
        embedding: { model: "embedding-test", client: { embed } },
        availableExecutionTargets: () => ["Local"],
      },
    );

    const first = await runtime.search({ query: "search workspace records" });
    const second = await runtime.search({ query: "search workspace records" });

    expect(first.map((result) => result.toolName)).toEqual(["WorkspaceSearch"]);
    expect(second.map((result) => result.toolName)).toEqual(["WorkspaceSearch"]);
    expect(embed).not.toHaveBeenCalled();
    runtime.close();
  });

  test("memory ranks learned keywords and projects reusable tool patterns", () => {
    const memory = createInMemoryToolSearchMemory();
    memory.record(
      toolSearchEpisode({
        learnedKeywords: [
          { toolName: "WorkspaceReadFile", value: "workspace file", source: "toolLearning.trigger", weight: 1 },
        ],
      }),
    );

    const evidence = memory.rank(["workspace", "file"], "project-a", Date.UTC(2026, 0, 1));
    const patterns = memory.patterns({
      queryTokens: ["workspace", "file"],
      projectId: "project-a",
      allowedTools: ["WorkspaceReadFile"],
      minSupport: 1,
      limit: 3,
    });

    expect(evidence[0]).toEqual(
      expect.objectContaining({
        toolName: "WorkspaceReadFile",
        evidence: expect.any(Number),
        signals: [expect.objectContaining({ term: "workspace file" })],
      }),
    );
    expect(patterns).toEqual([
      expect.objectContaining({
        toolName: "WorkspaceReadFile",
        successCount: 1,
        argumentGuidance: expect.stringContaining("path"),
      }),
    ]);
    memory.close();
  });

  test("usage memory enqueues successful learning drafts and clears failed searches", () => {
    const memory = createInMemoryToolSearchMemory();
    const learningRuntime = { enqueue: vi.fn() };
    const usage = new AgentToolSearchUsageMemory(
      memory,
      "project-a",
      createToolLearningConfig({ Enabled: true }),
      learningRuntime,
    );
    usage.rememberSearch("request-success", {
      query: "read package",
      queryTokens: ["read", "package"],
      plannerTags: ["read"],
      candidates: ["WorkspaceReadFile"],
      timestamp: 1,
    });
    usage.recordToolUsage({
      requestId: "request-success",
      userInput: "Read package.json",
      results: [
        toolResult({
          name: "WorkspaceReadFile",
          arguments: { path: "package.json" },
          artifact: artifactWithEvidence(),
        }),
      ],
    });
    usage.rememberSearch("request-failure", {
      query: "read package",
      queryTokens: ["read", "package"],
      plannerTags: [],
      candidates: ["WorkspaceReadFile"],
      timestamp: 2,
    });
    usage.recordToolUsage({
      requestId: "request-failure",
      userInput: "Read package.json",
      results: [
        toolResult({
          name: "WorkspaceReadFile",
          outcome: createAgentToolFailureOutcome(
            { code: AgentExecutionErrorCodes.ToolExecutionError, message: "missing" },
            AgentToolFailureSources.Host,
            "none",
          ),
        }),
      ],
    });

    expect(learningRuntime.enqueue).toHaveBeenCalledTimes(1);
    expect(learningRuntime.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        rawUserTurn: "Read package.json",
        episode: expect.objectContaining({
          query: "read package",
          chosenTools: ["WorkspaceReadFile"],
          outcome: "success",
          finalScore: 1,
        }),
      }),
    );
    expect(memory.learningEpisodes("project-a", 10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requestId: "request-success", state: "observed" }),
        expect.objectContaining({ requestId: "request-failure", state: "skipped" }),
      ]),
    );
    memory.close();
  });

  test("request finalization discards abandoned search-learning state", () => {
    const memory = createInMemoryToolSearchMemory();
    const learningRuntime = { enqueue: vi.fn() };
    const usage = new AgentToolSearchUsageMemory(
      memory,
      "project-a",
      createToolLearningConfig({ Enabled: true }),
      learningRuntime,
    );
    usage.rememberSearch("request-abandoned", {
      query: "read package",
      queryTokens: ["read", "package"],
      plannerTags: [],
      candidates: ["WorkspaceReadFile"],
      timestamp: 1,
    });

    usage.finishRequest("request-abandoned");
    usage.recordToolUsage({
      requestId: "request-abandoned",
      userInput: "Read package.json",
      results: [
        toolResult({
          name: "WorkspaceReadFile",
          arguments: { path: "package.json" },
          artifact: artifactWithEvidence(),
        }),
      ],
    });

    expect(learningRuntime.enqueue).not.toHaveBeenCalled();
    memory.close();
  });

  test("learning projection and result projection keep model-facing evidence structured", () => {
    const tokenizer = new AgentToolSearchTokenizer();
    const episode = toolSearchEpisode({
      learnedKeywords: [
        { toolName: "WorkspaceReadFile", value: "workspace", source: "tag", weight: 0.9 },
        { toolName: "OtherTool", value: "ignored", source: "tag", weight: 1 },
      ],
    });
    const projection = projectLearningProjection(episode, tokenizer);
    const result = buildToolSearchResultProjection({ query: "workspace", includeLoaded: false }, [
      searchResult({
        toolName: "WorkspaceReadFile",
        learningSignals: [
          {
            term: "workspace",
            source: "tag",
            support: 1,
            confidence: 0.66,
            score: 0.4,
          },
        ],
      }),
    ]);

    expect(projection.terms.map((term) => term.toolName)).toEqual(["WorkspaceReadFile"]);
    expect(projection.patterns).toHaveLength(1);
    expect(readToolNamesFromSearchResult(result)).toEqual(["WorkspaceReadFile"]);
    expect(result.tools.item[0]).toEqual(
      expect.objectContaining({
        name: "WorkspaceReadFile",
        matches: expect.objectContaining({
          terms: expect.objectContaining({
            item: ["workspace"],
          }),
        }),
      }),
    );
  });

  test("projects compact candidates without auto-disclosing their contracts", () => {
    const first = createTool({
      name: "WorkspaceReadFile",
      title: "Read file",
      summary: "Read workspace files",
      tags: ["workspace", "read"],
      actions: ["read"],
      targets: ["file"],
      priority: 10,
    });
    const second = createTool({
      name: "WorkspaceSearchFiles",
      title: "Search files",
      summary: "Search workspace file contents",
      tags: ["workspace", "search"],
      actions: ["search"],
      targets: ["file"],
      priority: 10,
    });
    const projection = buildToolSearchResultProjection({ query: "workspace files" }, [
      searchResult({ toolName: first.name, score: 1 }),
      searchResult({ toolName: second.name, score: 0.99 }),
    ]);

    expect(readToolNamesFromSearchResult(projection)).toEqual([first.name, second.name]);
    expect(projection.tools.item[0]).toMatchObject({
      name: first.name,
      rank: 1,
      confidence: 1,
    });
    expect(projection.tools.item[1]).toMatchObject({
      name: second.name,
      rank: 2,
    });
  });

  test("catalog discovery keeps every dynamic tool visible while learning only matched tools", async () => {
    const runtime = new AgentToolSearchRuntime(
      createRegistry([
        createTool({
          name: AgentToolMetaToolNames.Search,
          title: "Tool search",
          summary: "Find tools",
          tags: ["search"],
          actions: ["search"],
          targets: ["tools"],
          priority: 100,
          rootKind: "System",
          loading: "Bootstrap",
        }),
        createTool({
          name: "WeatherTool",
          title: "Weather",
          summary: "Fetch a weather forecast",
          tags: ["weather"],
          actions: ["forecast"],
          targets: ["city"],
          priority: 40,
          loading: "Dynamic",
        }),
        createTool({
          name: "DocumentExtract",
          title: "Document extract",
          summary: "Extract text and structure from a document",
          tags: ["document", "extract"],
          actions: ["extract"],
          targets: ["document"],
          priority: 30,
          loading: "Dynamic",
        }),
      ]) as unknown as AgentExtensionRegistry,
      createToolSearchConfig(),
      createToolLearningConfig(),
      "E:/workspace",
      createModelProvider(),
      { memoryStore: new InMemoryToolSearchMemoryStore(), availableExecutionTargets: () => ["Local"] },
    );

    const results = await runtime.search({ query: "weather", resultMode: "catalog" });
    const projection = buildToolSearchResultProjection({ query: "weather" }, results);

    expect(results.map((result) => result.toolName)).toEqual(["WeatherTool", "DocumentExtract"]);
    expect(projection.tools.item).toHaveLength(2);
    expect(projection.tools.item[0]).toMatchObject({ name: "WeatherTool", confidence: 1 });
    expect(projection.tools.item[1]).toMatchObject({
      name: "DocumentExtract",
      confidence: 0,
    });
    expect(projection.tools.item[1]).not.toHaveProperty("matches");
    expect(readToolNamesFromSearchResult(projection)).toEqual(["WeatherTool"]);

    runtime.close();
  });
});

function toolSearchEpisode(overrides: Partial<AgentToolSearchEpisode> = {}): AgentToolSearchEpisode {
  return {
    query: "read workspace file",
    queryTokens: ["read", "workspace", "file"],
    plannerTags: ["read"],
    candidates: ["WorkspaceReadFile"],
    chosenTools: ["WorkspaceReadFile"],
    learnedKeywords: [],
    outcome: "success",
    calls: [
      {
        toolName: "WorkspaceReadFile",
        argumentKeys: ["path"],
        evidenceKinds: ["file"],
        status: "success",
        evidenceUris: ["senera://evidence/file"],
        artifactUris: ["senera://artifact/file"],
        hasArtifact: true,
        hasEvidence: true,
        hasWorkspaceChanges: false,
        errorCode: "",
        error: "",
        score: 1,
      },
    ],
    finalScore: 1,
    finalOutcome: {
      toolExecutionSucceeded: true,
      producedEvidence: true,
      producedArtifact: true,
      changedWorkspace: false,
    },
    projectId: "project-a",
    timestamp: Date.UTC(2026, 0, 1),
    ...overrides,
  };
}

function searchResult(overrides: Partial<AgentToolSearchResult> = {}): AgentToolSearchResult {
  return {
    toolName: "WorkspaceReadFile",
    title: "Read file",
    ownerName: "workspace",
    sources: [],
    summary: "Read workspace files",
    whenToUse: "Inspect files",
    parameterSummary: "path: string",
    score: 1,
    ranks: { bm25: 1 },
    matchedTerms: ["workspace"],
    permissions: [],
    matchedCapabilities: [],
    learningSignals: [],
    ...overrides,
  };
}

function toolResult(overrides: Partial<ExecutedToolCallResult> = {}): ExecutedToolCallResult {
  return {
    callId: "call-1",
    name: "WorkspaceReadFile",
    arguments: {},
    process: { exitCode: 0, signal: null, stdout: "", stderr: "" },
    result: { ok: true },
    outcome: AgentToolSuccessOutcome,
    ...overrides,
  };
}

function artifactWithEvidence(): ExecutedToolCallResult["artifact"] {
  return {
    artifactId: "artifact-1",
    artifactUri: "senera://artifact/file",
    artifactPath: "/tmp/artifact",
    relativePath: "artifact.json",
    manifestPath: "/tmp/manifest.json",
    files: {},
    summary: "file evidence",
    evidence: [
      {
        key: "file",
        evidenceUri: "senera://evidence/file",
        kind: "file",
        locator: "package.json",
        display: "package.json",
        label: "package.json",
        source: "{}",
        confidence: 1,
        modelSlots: [],
        plannerMemory: { facts: [], artifactRefs: [] },
      },
    ],
    delta: [],
  };
}

function createInMemoryToolSearchMemory(): AgentToolSearchMemory {
  return new AgentToolSearchMemory(createToolSearchConfig(), "E:/workspace", new InMemoryToolSearchMemoryStore());
}
