import { describe, expect, test, vi } from "vitest";
import { VerificationScenarioSource } from "../../VerificationScenarioSource.js";
import {
  AgentToolMetaToolNames,
  AgentToolSearchRuntime,
} from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchRuntime.js";
import {
  buildToolSearchResultProjection,
  readToolNamesFromSearchResult,
} from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchResultProjector.js";
import type { AgentToolSearchResult } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchIndex.js";
import type { AgentToolSearchDiscovery } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchTypes.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import type { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentModelTokenEstimator } from "../../../Source/AgentSystem/Text/AgentTextBudget.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import { AgentToolSuccessOutcome } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import { createRegistry, createTool, createToolSearchConfig } from "./ToolSearchTestFixtures.js";

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
      "E:/workspace",
      createModelProvider(),
      { scenarioSource: new VerificationScenarioSource(), availableExecutionTargets: () => ["Local"] },
    );

    expect(
      await runtime.resolvePlannedLoadedTools({
        input: "no matching capability",
        currentLoadedTools: [],
      }),
    ).toEqual([AgentToolMetaToolNames.Search, "ShellCommandTool"]);
    expect(
      await runtime.resolvePlannedLoadedTools({
        input: "no matching capability",
        currentLoadedTools: [],
        requiredToolNames: ["DocumentExtract"],
        discover: false,
      }),
    ).toEqual([AgentToolMetaToolNames.Search, "ShellCommandTool", "DocumentExtract"]);
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

    await runtime.close();
  });

  test("recalls an English MCP capability from a Chinese request through embeddings", async () => {
    const config = createToolSearchConfig();
    config.Embedding.Enabled = true;
    const embed = vi.fn(async ({ input }: { input: readonly string[]; role: "query" | "document" }) => ({
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
      "E:/workspace",
      createModelProvider(),
      {
        scenarioSource: new VerificationScenarioSource(),
        embedding: {
          model: "multilingual-test",
          client: { embed },
        },
        availableExecutionTargets: () => ["Local"],
      },
    );

    const firstDiscovery = await runtime.discover({ query: "这两天 AI 有什么发展" });
    expect(firstDiscovery.match).toEqual([]);
    expect(firstDiscovery.maybe).toEqual(
      expect.arrayContaining([expect.objectContaining({ toolName: "mcp__web_research__search" })]),
    );
    const documentInputsAfterFirstSearch = embed.mock.calls
      .map(([request]) => request)
      .filter((request) => request.role === "document")
      .flatMap((request) => request.input);
    expect(documentInputsAfterFirstSearch.length).toBeGreaterThan(0);
    runtime.refresh();
    const refreshedDiscovery = await runtime.discover({ query: "这两天 AI 有什么发展" });
    expect(refreshedDiscovery.match).toEqual([]);
    expect(refreshedDiscovery.maybe).toEqual(
      expect.arrayContaining([expect.objectContaining({ toolName: "mcp__web_research__search" })]),
    );

    const documentInputs = embed.mock.calls
      .map(([request]) => request)
      .filter((request) => request.role === "document")
      .flatMap((request) => request.input);
    const queryInputs = embed.mock.calls
      .map(([request]) => request)
      .filter((request) => request.role === "query")
      .flatMap((request) => request.input);
    expect(documentInputs).toHaveLength(documentInputsAfterFirstSearch.length);
    expect(queryInputs).toEqual(["这两天 AI 有什么发展", "这两天 AI 有什么发展"]);
    await runtime.close();
  });

  test("keeps a multi-term lexical intent anchor while an unmatched modifier is semantically disambiguated", async () => {
    const config = createToolSearchConfig();
    config.Embedding.Enabled = true;
    const embed = vi.fn().mockResolvedValue({
      model: "embedding-test",
      vectors: [[1, 0]],
    });
    const runtime = new AgentToolSearchRuntime(
      createRegistry([
        createTool({
          name: "DocumentExtract",
          title: "Document extraction",
          summary: "Extract text and structure from a document.",
          tags: ["document", "extract", "text"],
          actions: ["extract", "inspect"],
          targets: ["document"],
          priority: 20,
        }),
      ]) as unknown as AgentExtensionRegistry,
      config,
      "E:/workspace",
      createModelProvider(),
      {
        scenarioSource: new VerificationScenarioSource(),
        embedding: { model: "embedding-test", client: { embed } },
        availableExecutionTargets: () => ["Local"],
      },
    );

    const discovery = await runtime.discover({ query: "extract document text from a PDF" });

    expect(discovery.match.map((result) => result.toolName)).toEqual(["DocumentExtract"]);
    expect(discovery.maybe).toEqual([]);
    expect(embed).toHaveBeenCalledTimes(2);
    await runtime.close();
  });

  test("projects compact discovery tiers without auto-disclosing contracts", () => {
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
    const projection = buildToolSearchResultProjection(
      {
        match: [
          searchResult({
            toolName: first.name,
            title: first.owner.title,
            summary: first.search?.Summary ?? "",
            score: 1,
          }),
        ],
        maybe: [
          searchResult({
            toolName: second.name,
            title: second.owner.title,
            summary: second.search?.Summary ?? "",
            score: 0.99,
          }),
        ],
        omitted: [
          searchResult({
            toolName: "WorkspaceListFiles",
            title: "List files",
            sources: [
              {
                id: "workspace",
                title: "Workspace",
                description: "Files and source code in the current workspace.",
              },
            ],
          }),
        ],
      },
      projectionOptions(),
    );

    expect(readToolNamesFromSearchResult(projection)).toEqual([first.name]);
    expect(projection).toEqual({
      match: [[first.name, first.search?.Summary]],
      maybe: [[second.name, second.search?.Summary]],
      more: [["workspace", "Workspace", 1]],
    });
    expect(JSON.stringify(projection)).not.toContain("parameterSummary");
    expect(JSON.stringify(projection)).not.toContain("whenToUse");
    expect(JSON.stringify(projection)).not.toContain("summary");
  });

  test("keeps names for relevant possibilities and folds only the weak tail by source", () => {
    const make = (toolName: string, score: number, sourceId = "shared") =>
      searchResult({
        toolName,
        score,
        ranks: { bm25: 1 },
        matchedTerms: [toolName],
        sources: [{ id: sourceId, title: sourceId, description: sourceId }],
      });
    const projection = buildToolSearchResultProjection(
      {
        match: Array.from({ length: 2 }, (_, index) => make(`Match${index}`, 1 - index * 0.01)),
        maybe: Array.from({ length: 4 }, (_, index) => make(`Maybe${index}`, 0.5 - index * 0.001)),
        omitted: Array.from({ length: 4 }, (_, index) =>
          make(`Fold${index}`, 0.05 - index * 0.001, index % 2 === 0 ? "alpha" : "beta"),
        ),
      },
      projectionOptions(),
    );

    expect(projection.match).toHaveLength(2);
    expect(projection.maybe).toHaveLength(4);
    expect(projection.more).toEqual([
      ["alpha", "alpha", 2],
      ["beta", "beta", 2],
    ]);
  });

  test("reserves a source roll-up when verbose possibilities exceed the active token budget", () => {
    const source = { id: "mcp:large", title: "Large MCP", description: "Large MCP package" };
    const possibilities = Array.from({ length: 24 }, (_, index) =>
      searchResult({
        toolName: `LargeCapability${index + 1}`,
        summary:
          "Operate a distinct capability from the large package with enough producer-authored detail to make discovery projection expensive.",
        sources: [source],
      }),
    );
    const options = { model: "gpt-4o", tokenBudget: 160 };
    const projection = buildToolSearchResultProjection(
      {
        match: [],
        maybe: possibilities,
        omitted: [],
      },
      options,
    );
    const namedCount = projection.maybe?.length ?? 0;

    expect(namedCount).toBeGreaterThan(0);
    expect(namedCount).toBeLessThan(possibilities.length);
    expect(projection.more).toEqual([[source.id, source.title, possibilities.length - namedCount]]);
    expect(
      new AgentModelTokenEstimator({ model: options.model }).inspect(
        JSON.stringify({ type: "senera.tool_discovery.v5", ...projection }),
        options.tokenBudget,
      ).withinLimit,
    ).toBe(true);
  });

  test("omits empty optional discovery tiers", () => {
    const projection = buildToolSearchResultProjection(
      {
        match: Array.from({ length: 3 }, (_, index) =>
          searchResult({ toolName: `Tool${index}`, score: 1 - index * 0.01 }),
        ),
        maybe: [],
        omitted: [],
      },
      projectionOptions(),
    );

    expect(projection.match).toHaveLength(3);
    expect(projection.maybe).toBeUndefined();
    expect(projection.more).toBeUndefined();
  });

  test("rejects conflicting source metadata before projecting more", () => {
    const sourceA = { id: "shared", title: "Workspace", description: "Workspace files" };
    const sourceB = { id: "shared", title: "Other", description: "Other capabilities" };

    expect(() =>
      buildToolSearchResultProjection(
        {
          match: [],
          maybe: [],
          omitted: [
            searchResult({ toolName: "First", sources: [sourceA] }),
            searchResult({ toolName: "Second", sources: [sourceB] }),
          ],
        },
        projectionOptions(),
      ),
    ).toThrow("Tool discovery source shared has conflicting metadata.");
  });

  test("does not let verbose match descriptions consume the uncertain-tier budget", () => {
    const projection = buildToolSearchResultProjection(
      {
        match: [searchResult({ toolName: "VerboseMatch", summary: "x".repeat(20_000) })],
        maybe: [searchResult({ toolName: "PossibleTool", summary: "Inspect files" })],
        omitted: [],
      },
      { model: "gpt-4o", tokenBudget: 32 },
    );

    expect(projection.match).toHaveLength(1);
    expect(projection.maybe).toEqual([["PossibleTool", "Inspect files"]]);
  });

  test("uses substantially fewer model tokens than an expanded discovery projection", () => {
    const discovery = {
      match: [
        searchResult({
          toolName: "WorkspaceReadFile",
          title: "Read workspace file",
          summary: "Read text or structured data from a workspace file.",
          whenToUse: "Use when a task needs the contents of a known workspace path.",
          parameterSummary: "path: string; encoding?: utf8 | base64",
          permissions: ["workspace.read"],
          state: {
            exposure: "visible",
            contract: "confirmed",
            reuse: "arguments",
            reusableArguments: { path: "package.json" },
          },
        }),
      ],
      maybe: [
        searchResult({
          toolName: "WorkspaceSearchFiles",
          title: "Search workspace files",
          summary: "Find matching text across workspace files.",
          whenToUse: "Use when the file path is unknown and content search is appropriate.",
          parameterSummary: "query: string; path?: string",
        }),
      ],
      omitted: [
        searchResult({
          toolName: "WorkspaceListFiles",
          title: "List workspace files",
          sources: [{ id: "workspace", title: "Workspace", description: "Current project files." }],
        }),
        searchResult({
          toolName: "WorkspaceApplyPatch",
          title: "Apply workspace patch",
          sources: [{ id: "workspace", title: "Workspace", description: "Current project files." }],
        }),
      ],
    } satisfies AgentToolSearchDiscovery;
    const compact = {
      type: "senera.tool_discovery.v5",
      ...buildToolSearchResultProjection(discovery, projectionOptions()),
    };
    const expanded = projectExpandedDiscoveryBaseline(discovery);
    const estimator = new AgentModelTokenEstimator({ model: "gpt-4o" });
    const compactTokens = estimator.estimate(JSON.stringify(compact)).tokenCount;
    const expandedTokens = estimator.estimate(JSON.stringify(expanded)).tokenCount;

    expect(compactTokens).toBeLessThan(expandedTokens);
    expect(compactTokens * 2).toBeLessThan(expandedTokens);
  });

  test("getReusableEvidence admits proposal-mode tools the automatic policy would filter", async () => {
    const tool = createTool({
      name: "ProposalCapability",
      title: "Proposal capability",
      summary: "A dynamic capability with non-read effects",
      tags: ["proposal"],
      actions: ["execute"],
      targets: ["external"],
      priority: 50,
      loading: "Dynamic",
    });
    tool.execution = { ...tool.execution, Network: "Allow" };
    tool.contract = { digest: "proposal-contract-v1" };
    const runtime = new AgentToolSearchRuntime(
      createRegistry([tool]) as unknown as AgentExtensionRegistry,
      createToolSearchConfig(),
      "E:/workspace",
      createModelProvider(),
      { scenarioSource: new VerificationScenarioSource(), availableExecutionTargets: () => ["Local"] },
    );

    runtime.afterToolResults({
      requestId: "request-evidence",
      userInput: "propose an external change",
      sessionId: "session-evidence",
      logicalCacheScope: "logical-evidence",
      loadedTools: ["ProposalCapability"],
      execution: {
        value: [
          toolResult({
            name: "ProposalCapability",
            arguments: { target: "external" },
            artifact: artifactWithEvidence(),
          }),
        ],
      },
    });

    expect(
      runtime.getReusableCapability({
        sessionId: "session-evidence",
        logicalCacheScope: "logical-evidence",
        toolName: "ProposalCapability",
      }),
    ).toBeUndefined();
    expect(
      runtime.getReusableEvidence({
        sessionId: "session-evidence",
        logicalCacheScope: "logical-evidence",
        toolName: "ProposalCapability",
      }),
    ).toMatchObject({
      toolName: "ProposalCapability",
      contractDigest: "proposal-contract-v1",
      arguments: { target: "external" },
    });
    expect(
      runtime.getReusableEvidence({
        sessionId: "session-other",
        logicalCacheScope: "logical-evidence",
        toolName: "ProposalCapability",
      }),
    ).toBeUndefined();
    await runtime.close();
  });
});

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
    scenarioSignals: [],
    ...overrides,
  };
}

function projectionOptions() {
  return { model: "gpt-4o", tokenBudget: 640 };
}

function projectExpandedDiscoveryBaseline(discovery: AgentToolSearchDiscovery): object {
  const entries = [...discovery.match, ...discovery.maybe, ...discovery.omitted];
  return {
    type: "senera.tool_discovery.expanded_baseline",
    tools: {
      item: entries.map((result, index) => ({
        name: result.toolName,
        title: result.title,
        summary: result.summary,
        whenToUse: result.whenToUse,
        parameters: result.parameterSummary,
        permissions: result.permissions,
        rank: index + 1,
        score: result.score,
        semanticScore: result.semanticScore,
        ranks: result.ranks,
        matches: {
          terms: result.matchedTerms,
          capabilities: result.matchedCapabilities,
          scenarios: result.scenarioSignals,
        },
        sources: result.sources,
        state: result.state,
      })),
    },
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
