import { describe, expect, test } from "vitest";
import { InMemoryToolSearchMemoryStore } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryStore.js";
import {
  AgentToolMetaToolNames,
  AgentToolSearchRuntime,
} from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchRuntime.js";
import { readToolNamesFromSearchResult } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchResultProjector.js";
import type { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import type { SeneraExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { AgentToolSuccessOutcome } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import {
  createRegistry,
  createTool,
  createToolLearningConfig,
  createToolSearchConfig,
} from "./ToolSearchTestFixtures.js";

describe("ToolSearch meta-tool behavior", () => {
  test("validates search arguments and only changes exposure through explicit load and unload", async () => {
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
          name: "WorkspaceReadFile",
          title: "Read file",
          summary: "Read workspace files",
          tags: ["workspace", "read"],
          actions: ["read"],
          targets: ["workspace", "file"],
          priority: 10,
          rootKind: "User",
        }),
      ]) as unknown as AgentExtensionRegistry,
      createToolSearchConfig(),
      createToolLearningConfig({ Enabled: true }),
      "E:/workspace",
      createModelProvider(),
      { memoryStore: new InMemoryToolSearchMemoryStore(), availableExecutionTargets: () => ["Local"] },
    );
    const handler = runtime.createSearchHostHandler();
    const grant = createAgentToolAccessGrant({
      authorizedToolNames: [AgentToolMetaToolNames.Search, "WorkspaceReadFile"],
      exposedToolNames: [AgentToolMetaToolNames.Search],
    });
    const toolExposure = new AgentToolExposureState(grant);

    const invalid = await handler({ query: "" }, hostToolContext({ visibleToolNames: [] }));
    const valid = await handler(
      { query: "read workspace file", includeLoaded: "false" },
      hostToolContext({
        requestId: "request-1",
        visibleToolNames: [AgentToolMetaToolNames.Search],
        toolExposure,
      }),
    );

    expect(invalid.response.ok).toBe(false);
    expect(valid.response.ok).toBe(true);
    expect(readToolNamesFromSearchResult(valid.response.result)).toEqual(["WorkspaceReadFile"]);
    expect(valid.response.result).toMatchObject({
      tools: {
        item: [
          expect.objectContaining({
            name: "WorkspaceReadFile",
            state: { exposure: "discoverable", contract: "unconfirmed", reuse: "none" },
          }),
        ],
      },
    });
    expect(toolExposure.snapshot()).toMatchObject({
      generation: 0,
      exposedToolNames: [AgentToolMetaToolNames.Search],
      preferredToolNames: [],
    });
    const staleLoad = await runtime.createLoadHostHandler()(
      { tools: ["WorkspaceReadFile"], catalogRevision: "stale-catalog" },
      hostToolContext({
        requestId: "request-1",
        authorizedToolNames: [AgentToolMetaToolNames.Search, "WorkspaceReadFile"],
        visibleToolNames: [AgentToolMetaToolNames.Search],
        toolExposure,
      }),
    );
    expect(staleLoad.response).toMatchObject({
      ok: true,
      result: {
        catalogStatus: "stale",
        added: { item: [] },
        loaded: { item: [AgentToolMetaToolNames.Search] },
      },
    });
    expect(toolExposure.snapshot().exposedToolNames).toEqual([AgentToolMetaToolNames.Search]);
    const load = await runtime.createLoadHostHandler()(
      { tools: ["WorkspaceReadFile"] },
      hostToolContext({
        requestId: "request-1",
        authorizedToolNames: [AgentToolMetaToolNames.Search, "WorkspaceReadFile"],
        visibleToolNames: [AgentToolMetaToolNames.Search],
        toolExposure,
      }),
    );
    expect(load.response.ok).toBe(true);
    expect(toolExposure.snapshot().exposedToolNames).toEqual([AgentToolMetaToolNames.Search, "WorkspaceReadFile"]);
    const describe = await runtime.createDescribeHostHandler()(
      { tools: ["WorkspaceReadFile"] },
      hostToolContext({
        authorizedToolNames: [AgentToolMetaToolNames.Search, "WorkspaceReadFile"],
        visibleToolNames: toolExposure.snapshot().exposedToolNames,
        toolExposure,
      }),
    );
    expect(describe.response.ok).toBe(true);
    expect(describe.response.result).toMatchObject({
      tools: {
        item: [
          expect.objectContaining({
            name: "WorkspaceReadFile",
            loading: "Dynamic",
            usage: expect.objectContaining({ useCases: { item: expect.any(Array) } }),
            contract: expect.objectContaining({ typescript: { lines: { item: expect.any(Array) } } }),
            effects: expect.objectContaining({ executionTargets: { item: ["Local"] } }),
          }),
        ],
      },
    });
    runtime.afterToolResults({
      requestId: "request-1",
      userInput: "read workspace file",
      sessionId: "session-1",
      loadedTools: [...toolExposure.snapshot().exposedToolNames],
      execution: { value: [toolResult({ name: "WorkspaceReadFile", arguments: { path: "package.json" } })] },
    });
    expect(runtime.reusableCapabilities({ sessionId: "session-1", query: "read workspace file" })).toMatchObject([
      expect.objectContaining({
        toolName: "WorkspaceReadFile",
        query: "read workspace file",
        arguments: { path: "package.json" },
      }),
    ]);
    expect(runtime.reusableCapabilities({ sessionId: "session-1", query: "weather forecast" })).toEqual([]);
    const reused = await handler(
      { query: "read workspace file" },
      hostToolContext({
        requestId: "request-2",
        sessionId: "session-1",
        visibleToolNames: toolExposure.snapshot().exposedToolNames,
        authorizedToolNames: [AgentToolMetaToolNames.Search, "WorkspaceReadFile"],
        toolExposure,
      }),
    );
    expect(reused.response).toMatchObject({
      ok: true,
      result: {
        tools: {
          item: [
            expect.objectContaining({
              name: "WorkspaceReadFile",
              state: {
                exposure: "visible",
                contract: "confirmed",
                reuse: "arguments",
                reusableArguments: { path: "package.json" },
              },
            }),
          ],
        },
      },
    });
    const unload = await runtime.createUnloadHostHandler()(
      { tools: ["WorkspaceReadFile", AgentToolMetaToolNames.Search] },
      hostToolContext({
        authorizedToolNames: [AgentToolMetaToolNames.Search, "WorkspaceReadFile"],
        visibleToolNames: toolExposure.snapshot().exposedToolNames,
        toolExposure,
      }),
    );
    expect(unload.response.ok).toBe(true);
    expect(unload.response.result).toMatchObject({
      removed: { item: ["WorkspaceReadFile"] },
      protected: { item: [AgentToolMetaToolNames.Search] },
    });
    expect(toolExposure.snapshot().exposedToolNames).toEqual([AgentToolMetaToolNames.Search]);
    expect(
      runtime.afterToolResults({
        requestId: "request-1",
        userInput: "read workspace file",
        loadedTools: [AgentToolMetaToolNames.Search],
        execution: {
          value: [
            toolResult({
              name: AgentToolMetaToolNames.Search,
              result: valid.response.result,
            }),
            toolResult({
              name: "WorkspaceReadFile",
              artifact: artifactWithEvidence(),
            }),
          ],
        },
      }),
    ).toEqual([AgentToolMetaToolNames.Search]);

    runtime.close();
  });

  test("projects the source catalog into the host contract and validates preferences", async () => {
    const registry = createRegistry([
      createTool({
        name: "TavilySearchTool",
        title: "Web search",
        summary: "Search current public information",
        tags: ["web", "search"],
        actions: ["search"],
        targets: ["web"],
        priority: 10,
        source: {
          id: "web",
          title: "Web",
          description: "Public internet information.",
        },
      }),
    ]) as unknown as AgentExtensionRegistry;
    const runtime = new AgentToolSearchRuntime(
      registry,
      createToolSearchConfig(),
      createToolLearningConfig(),
      "E:/workspace",
      createModelProvider(),
      { memoryStore: new InMemoryToolSearchMemoryStore(), availableExecutionTargets: () => ["Local"] },
    );
    const contract = runtime.createHostContractProjection();
    const schema = contract.projectInvocationSchema?.({} as never, {
      type: "object",
      properties: {
        query: { type: "string" },
        preferredSources: { type: "array", items: { type: "string" } },
      },
    });
    const handler = runtime.createSearchHostHandler();
    const invalid = await handler(
      { query: "current information", preferredSources: ["unknown"] },
      hostToolContext({ visibleToolNames: [] }),
    );
    const valid = await handler(
      { query: "current information", preferredSources: ["web"] },
      hostToolContext({ visibleToolNames: [] }),
    );

    expect(schema).toMatchObject({
      properties: {
        preferredSources: {
          uniqueItems: true,
          items: { enum: ["web"] },
        },
      },
    });
    expect(contract.projectDescription?.({} as never, "Search tools")).toContain("web: Web");
    expect(invalid.response.ok).toBe(false);
    expect(valid.response.ok).toBe(true);
    runtime.close();
  });

  test("returns every authorized dynamic tool while ranking matched tools first", async () => {
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
          name: "CalendarTool",
          title: "Calendar",
          summary: "Read calendar events",
          tags: ["calendar"],
          actions: ["read"],
          targets: ["calendar"],
          priority: 30,
          rootKind: "System",
          loading: "Dynamic",
        }),
        createTool({
          name: "WeatherTool",
          title: "Weather",
          summary: "Read weather forecasts",
          tags: ["weather"],
          actions: ["read"],
          targets: ["weather"],
          priority: 20,
          rootKind: "User",
          loading: "Dynamic",
        }),
        createTool({
          name: "PrivateTool",
          title: "Private",
          summary: "Private capability",
          tags: ["private"],
          actions: ["read"],
          targets: ["private"],
          priority: 10,
          rootKind: "User",
          loading: "Dynamic",
        }),
      ]) as unknown as AgentExtensionRegistry,
      createToolSearchConfig(),
      createToolLearningConfig(),
      "E:/workspace",
      createModelProvider(),
      { memoryStore: new InMemoryToolSearchMemoryStore(), availableExecutionTargets: () => ["Local"] },
    );

    const response = await runtime.createSearchHostHandler()(
      { query: "weather" },
      hostToolContext({
        requestId: "catalog-request",
        visibleToolNames: [AgentToolMetaToolNames.Search],
        authorizedToolNames: [AgentToolMetaToolNames.Search, "CalendarTool", "WeatherTool"],
      }),
    );

    expect(response.response.ok).toBe(true);
    if (!response.response.ok) return;
    const result = response.response.result as {
      tools: { item: Array<{ name: string; confidence?: number }> };
    };
    const items = result.tools.item;
    expect(items.map((item) => item.name)).toEqual(["WeatherTool", "CalendarTool"]);
    expect(items[0]).toMatchObject({ name: "WeatherTool", confidence: 1 });
    expect(items[1]).toMatchObject({ name: "CalendarTool", confidence: 0 });
    expect(items.map((item) => item.name)).not.toContain("PrivateTool");
    expect(readToolNamesFromSearchResult(result)).toEqual(["WeatherTool"]);

    runtime.close();
  });
});

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

function hostToolContext(
  overrides: Pick<AgentHostToolContext, "requestId" | "visibleToolNames"> &
    Partial<Pick<AgentHostToolContext, "authorizedToolNames" | "sessionId">> &
    Partial<Pick<AgentHostToolContext, "toolExposure">>,
): AgentHostToolContext {
  const tool = createTool({
    name: AgentToolMetaToolNames.Search,
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
