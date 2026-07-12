import { describe, expect, test, vi } from "vitest";
import type { TurnUnderstanding } from "../../../Source/AgentSystem/BamlClient/baml_client/types.js";
import { AgentToolSearchMemory } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemory.js";
import { projectLearningProjection } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryProjection.js";
import {
  AgentToolSearchRuntime,
  ToolSearchToolName,
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
import type { AgentPluginRegistry } from "../../../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { SeneraExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import {
  createRegistry,
  createTool,
  createToolLearningConfig,
  createToolSearchConfig,
} from "./ToolSearchTestFixtures.js";

describe("ToolSearch runtime behavior", () => {
  test("host handler validates arguments, searches visible tools, and remembers candidates", async () => {
    const runtime = new AgentToolSearchRuntime(
      createRegistry([
        createTool({
          name: "ToolSearchTool",
          title: "Tool search",
          summary: "Find tools",
          tags: ["search"],
          actions: ["search"],
          targets: ["tools"],
          priority: 100,
          rootKind: "System",
        }),
        createTool({
          name: "WorkspaceReadFile",
          title: "Read file",
          summary: "Read workspace files",
          tags: ["workspace", "read"],
          actions: ["read"],
          targets: ["workspace", "file"],
          priority: 10,
          rootKind: "User",
        }),
      ]) as unknown as AgentPluginRegistry,
      createToolSearchConfig(),
      createToolLearningConfig({ Enabled: true }),
      "E:/workspace",
      createModelProvider(),
    );
    const handler = runtime.createHostHandler();

    const invalid = await handler({ query: "" }, hostToolContext({ visibleToolNames: [] }));
    const valid = await handler(
      { query: "read workspace file", includeLoaded: "false" },
      hostToolContext({
        requestId: "request-1",
        visibleToolNames: ["ToolSearchTool"],
      }),
    );

    expect(invalid.response.ok).toBe(false);
    expect(valid.response.ok).toBe(true);
    expect(readToolNamesFromSearchResult(valid.response.result)).toEqual(["WorkspaceReadFile"]);
    expect(
      runtime.afterToolResults({
        requestId: "request-1",
        dynamicTools: true,
        loadedTools: ["ToolSearchTool"],
        execution: {
          value: [
            toolResult({
              name: ToolSearchToolName,
              result: valid.response.result,
            }),
            toolResult({
              name: "WorkspaceReadFile",
              artifact: artifactWithEvidence(),
            }),
          ],
        },
      }),
    ).toEqual(["ToolSearchTool", "WorkspaceReadFile"]);

    runtime.close();
  });

  test("memory ranks learned keywords and projects reusable tool patterns", () => {
    const memory = new AgentToolSearchMemory(createToolSearchConfig(), "E:/workspace");
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
    const memory = new AgentToolSearchMemory(createToolSearchConfig(), "E:/workspace");
    const learningRuntime = { enqueue: vi.fn() };
    const usage = new AgentToolSearchUsageMemory(
      memory,
      "project-a",
      createToolLearningConfig({ Enabled: true }),
      learningRuntime,
    );
    const understanding = {
      rawUserTurn: "Read package.json",
      standaloneRequest: "Read package.json",
      contextMode: "None",
      contextBasis: "",
    } as TurnUnderstanding;

    usage.rememberSearch("request-success", {
      query: "read package",
      queryTokens: ["read", "package"],
      plannerTags: ["read"],
      candidates: ["WorkspaceReadFile"],
      timestamp: 1,
    });
    usage.recordToolUsage(
      "request-success",
      [
        toolResult({
          name: "WorkspaceReadFile",
          arguments: { path: "package.json" },
          artifact: artifactWithEvidence(),
        }),
      ],
      understanding,
    );
    usage.rememberSearch("request-failure", {
      query: "read package",
      queryTokens: ["read", "package"],
      plannerTags: [],
      candidates: ["WorkspaceReadFile"],
      timestamp: 2,
    });
    usage.recordToolUsage("request-failure", [
      toolResult({ name: "WorkspaceReadFile", result: { error: { message: "missing" } } }),
    ]);

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
        learningSignals: {
          item: [expect.objectContaining({ term: "workspace" })],
        },
      }),
    );
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
    pluginName: "WorkspacePlugin",
    summary: "Read workspace files",
    whenToUse: "Inspect files",
    score: 1,
    ranks: {},
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
    process: { exitCode: 0, signal: null, stderr: "" },
    result: { ok: true },
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

function hostToolContext(
  overrides: Pick<AgentHostToolContext, "requestId" | "visibleToolNames">,
): AgentHostToolContext {
  const tool = createTool({
    name: ToolSearchToolName,
    title: "Tool search",
    summary: "Find tools",
    tags: ["search"],
    actions: ["search"],
    targets: ["tools"],
    priority: 100,
  });
  return {
    tool,
    config: toolSearchHostConfig,
    workspaceRoot: "E:/workspace",
    registry: createRegistry([tool]),
    executionEnv: unusedExecutionEnv,
    ...overrides,
  };
}

const toolSearchHostConfig: AgentHostToolContext["config"] = {
  ModelProviderEndpoints: [
    {
      Id: "test-endpoint",
      BaseUrl: "https://model.example/v1",
      ApiKey: "test-key",
    },
  ],
  ModelProviders: [
    {
      Id: "test-model",
      ProviderId: "test-endpoint",
      Endpoint: "ChatCompletions",
      Model: "test-model",
    },
  ],
};

const unusedExecutionEnv = {
  workspaceRoot: "E:/workspace",
  async executeShell() {
    throw new Error("executeShell is not used by ToolSearch tests.");
  },
  spawnProcess() {
    throw new Error("spawnProcess is not used by ToolSearch tests.");
  },
  spawnPersistentProcess() {
    throw new Error("spawnPersistentProcess is not used by ToolSearch tests.");
  },
} as unknown as SeneraExecutionEnv;
