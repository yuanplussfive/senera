import { describe, expect, test } from "vitest";
import { InMemoryToolSearchMemoryStore } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryStore.js";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import {
  AgentToolMetaToolNames,
  AgentToolSearchRuntime,
} from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchRuntime.js";
import { readToolNamesFromSearchResult } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchResultProjector.js";
import type { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import type { SeneraExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import {
  AgentToolHostCapabilityRegistry,
  type AgentHostToolContext,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { AgentToolSuccessOutcome } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import { AgentToolRunner } from "../../../Source/AgentSystem/ToolRuntime/AgentToolRunner.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import { AgentChannelKinds } from "../../../Source/AgentSystem/Channels/AgentChannelTypes.js";
import { AgentInteractionSurfaces } from "../../../Source/AgentSystem/Interaction/AgentInteractionContext.js";
import { createModelProvider, createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
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
    const staleConversationArguments = await handler(
      {
        catalogRevision: "",
        query: "read workspace file",
        preferredSources: ["web"],
        includeLoaded: false,
      },
      hostToolContext({ visibleToolNames: [] }),
    );
    const valid = await handler(
      { query: "read workspace file" },
      hostToolContext({
        requestId: "request-1",
        visibleToolNames: [AgentToolMetaToolNames.Search],
        toolExposure,
      }),
    );

    expect(invalid.response.ok).toBe(false);
    expect(staleConversationArguments.response.ok).toBe(false);
    expect(valid.response.ok).toBe(true);
    expect(readToolNamesFromSearchResult(valid.response.result)).toEqual(["WorkspaceReadFile"]);
    expect(valid.response.result).toMatchObject({
      type: "senera.tool_discovery.v5",
      match: [["WorkspaceReadFile", "Read workspace files"]],
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
    expect(staleLoad.response.ok).toBe(true);
    expect(staleLoad.response.result).toMatchObject({
      type: "senera.tool_discovery.v5",
      catalogStatus: "stale",
      catalogRevision: expect.any(String),
      requested: { item: ["WorkspaceReadFile"] },
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
    expect(toolExposure.hasConfirmedContract("WorkspaceReadFile", "WorkspaceReadFile.contract")).toBe(true);
    expect(describe.response.result).toMatchObject({
      type: "senera.tool_description.v2",
      tools: [
        [
          "WorkspaceReadFile",
          "Read file",
          expect.stringMatching(/use: Read workspace files[\s\S]*args:[\s\S]*boundary: targets=Local/),
        ],
      ],
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
    runtime.refresh();
    expect(runtime.reusableCapabilities({ sessionId: "session-1", query: "read workspace file" })).toMatchObject([
      expect.objectContaining({ toolName: "WorkspaceReadFile", arguments: { path: "package.json" } }),
    ]);
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
        type: "senera.tool_discovery.v5",
        match: [
          [
            "WorkspaceReadFile",
            "Read workspace files",
            ["visible", "confirmed", "arguments", { path: "package.json" }],
          ],
        ],
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

    await runtime.close();
  });

  test("rejects obsolete search arguments instead of silently changing their meaning", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-tool-search-replay");
    const searchTool = createTool({
      name: AgentToolMetaToolNames.Search,
      title: "Tool search",
      summary: "Find tools",
      tags: ["search"],
      actions: ["search"],
      targets: ["tools"],
      priority: 100,
      rootKind: "System",
      loading: "Bootstrap",
    });
    searchTool.handler = { kind: "HostCapability", capability: "tool.search" };
    searchTool.contract = {
      digest: "tool-search-contract-v2",
      arguments: {
        tsHintLines: [],
        xmlPreview: "",
        properties: [],
        jsonSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
      },
    };
    const registry = createRegistry([
      searchTool,
      createTool({
        name: "WorkspaceReadFile",
        title: "Read file",
        summary: "Read workspace files",
        tags: ["workspace", "read"],
        actions: ["read"],
        targets: ["workspace", "file"],
        priority: 10,
      }),
    ]);
    const runtime = new AgentToolSearchRuntime(
      registry as unknown as AgentExtensionRegistry,
      createToolSearchConfig(),
      createToolLearningConfig(),
      workspaceRoot,
      createModelProvider(),
      { memoryStore: new InMemoryToolSearchMemoryStore(), availableExecutionTargets: () => ["Local"] },
    );
    const capabilities = new AgentToolHostCapabilityRegistry().register(
      "tool.search",
      runtime.createSearchHostHandler(),
    );
    const runner = new AgentToolRunner(
      {} as AgentSystemConfig,
      workspaceRoot,
      capabilities,
      registry,
      new SeneraLocalExecutionEnv({ workspaceRoot }),
    );

    try {
      const result = await runner.run(searchTool, {
        catalogRevision: "",
        preferredSources: ["web"],
        includeLoaded: false,
        query: "read workspace file",
      });
      expect(result.response.ok).toBe(false);
    } finally {
      await runner.close();
      await runtime.close();
      removeDirectory(workspaceRoot);
    }
  });

  test("returns a direct marker for Bootstrap tools without repeating a dynamic contract", async () => {
    const describe = createTool({
      name: AgentToolMetaToolNames.Describe,
      title: "Tool describe",
      summary: "Describe tools",
      tags: ["tool", "describe"],
      actions: ["describe"],
      targets: ["tools"],
      priority: 100,
      rootKind: "System",
      loading: "Bootstrap",
    });
    const shell = createTool({
      name: "ShellCommandTool",
      title: "Shell command",
      summary: "Run one shell command.",
      tags: ["shell", "command"],
      actions: ["execute"],
      targets: ["process"],
      priority: 90,
      rootKind: "System",
      loading: "Bootstrap",
    });
    shell.contract = {
      digest: "shell-contract",
      arguments: {
        tsHintLines: ["command: string"],
        xmlPreview: "",
        properties: [],
        jsonSchema: { type: "object", properties: { command: { type: "string" } } },
      },
    };
    const dynamic = createTool({
      name: "WeatherTool",
      title: "Weather",
      summary: "Read a weather forecast.",
      tags: ["weather"],
      actions: ["read"],
      targets: ["weather"],
      priority: 10,
      loading: "Dynamic",
    });
    dynamic.contract = {
      digest: "weather-contract",
      arguments: {
        tsHintLines: ["city: string"],
        xmlPreview: "",
        properties: [],
        jsonSchema: { type: "object", properties: { city: { type: "string" } } },
      },
    };
    const runtime = new AgentToolSearchRuntime(
      createRegistry([describe, shell, dynamic]) as unknown as AgentExtensionRegistry,
      createToolSearchConfig(),
      createToolLearningConfig(),
      "E:/workspace",
      createModelProvider({ ToolPlanningMode: "native" }),
      { memoryStore: new InMemoryToolSearchMemoryStore(), availableExecutionTargets: () => ["Local"] },
    );

    const response = await runtime.createDescribeHostHandler()(
      { tools: [shell.name, dynamic.name, "MissingTool"] },
      hostToolContext({
        authorizedToolNames: [describe.name, shell.name, dynamic.name],
        visibleToolNames: [describe.name, shell.name],
      }),
    );

    expect(response.response).toMatchObject({
      ok: true,
      result: {
        type: "senera.tool_description.v2",
        direct: [shell.name],
        rejected: ["MissingTool"],
        tools: [[dynamic.name, dynamic.owner.title, expect.stringMatching(/city\??: string/u)]],
      },
    });
    expect(JSON.stringify(response.response.result)).not.toContain("command: string");
    await runtime.close();
  });

  test("keeps surface-scoped tools out of console discovery and loads them on a channel", async () => {
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
          name: "ChannelLookup",
          title: "Look up channel details",
          summary: "Inspect the current channel",
          tags: ["channel", "inspect"],
          actions: ["read"],
          targets: ["channel"],
          priority: 20,
          interactionSurfaces: [AgentInteractionSurfaces.Channel],
        }),
      ]) as unknown as AgentExtensionRegistry,
      createToolSearchConfig(),
      createToolLearningConfig({ Enabled: true }),
      "E:/workspace",
      createModelProvider(),
      { memoryStore: new InMemoryToolSearchMemoryStore(), availableExecutionTargets: () => ["Local"] },
    );

    const consoleInteraction = { surface: AgentInteractionSurfaces.Console } as const;
    const channelInteraction = { surface: AgentInteractionSurfaces.Channel, platform: AgentChannelKinds.Qq } as const;
    expect(await runtime.resolveInitialLoadedTools("publish", [], consoleInteraction)).toEqual([
      AgentToolMetaToolNames.Search,
    ]);
    expect(await runtime.resolveInitialLoadedTools("publish", [], channelInteraction)).toEqual([
      AgentToolMetaToolNames.Search,
    ]);

    const handler = runtime.createSearchHostHandler();
    const consoleResult = await handler(
      { query: "publish message channel" },
      hostToolContext({ interaction: consoleInteraction, visibleToolNames: [AgentToolMetaToolNames.Search] }),
    );
    expect(readToolNamesFromSearchResult(consoleResult.response.result)).not.toContain("ChannelLookup");

    const channelResult = await handler(
      { query: "inspect channel" },
      hostToolContext({ interaction: channelInteraction, visibleToolNames: [AgentToolMetaToolNames.Search] }),
    );
    expect(readToolNamesFromSearchResult(channelResult.response.result)).toContain("ChannelLookup");

    const grant = createAgentToolAccessGrant({
      authorizedToolNames: [AgentToolMetaToolNames.Search, "ChannelLookup"],
      exposedToolNames: [AgentToolMetaToolNames.Search],
    });
    const exposure = new AgentToolExposureState(grant);
    const rejected = await runtime.createLoadHostHandler()(
      { tools: ["ChannelLookup"] },
      hostToolContext({
        interaction: consoleInteraction,
        authorizedToolNames: grant.authorizedToolNames,
        visibleToolNames: grant.exposedToolNames,
        toolExposure: exposure,
      }),
    );
    expect(rejected.response).toMatchObject({
      ok: true,
      result: { rejected: { item: ["ChannelLookup"] }, loaded: { item: [AgentToolMetaToolNames.Search] } },
    });
    expect(exposure.snapshot().exposedToolNames).toEqual([AgentToolMetaToolNames.Search]);
    await runtime.close();
  });

  test("rejects retired search arguments without a ToolSearch-specific schema adapter", async () => {
    const registry = createRegistry([
      createTool({
        name: "WebSearchTool",
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
    const handler = runtime.createSearchHostHandler();
    const staleConversationArguments = await handler(
      { query: "current information", preferredSources: ["web"] },
      hostToolContext({ visibleToolNames: [] }),
    );
    const valid = await handler({ query: "current information" }, hostToolContext({ visibleToolNames: [] }));

    expect(staleConversationArguments.response.ok).toBe(false);
    expect(valid.response.ok).toBe(true);
    expect(valid.response.result).toMatchObject({
      type: "senera.tool_discovery.v5",
      match: [["WebSearchTool", "Search current public information"]],
    });
    expect(valid.response.result).toHaveProperty("catalogRevision");
    expect(valid.response.result).not.toHaveProperty("query");
    await runtime.close();
  });

  test("returns only authorized candidates and rejects unknown search arguments", async () => {
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
    const result = response.response.result;
    expect(result).toMatchObject({
      type: "senera.tool_discovery.v5",
      match: [["WeatherTool", "Read weather forecasts"]],
    });
    expect(JSON.stringify(result)).not.toContain("PrivateTool");
    expect(readToolNamesFromSearchResult(result)).toEqual(["WeatherTool"]);

    const invalidResponse = await runtime.createSearchHostHandler()(
      { query: "weather", scope: "all" },
      hostToolContext({
        requestId: "catalog-request",
        visibleToolNames: [AgentToolMetaToolNames.Search],
        authorizedToolNames: [AgentToolMetaToolNames.Search, "CalendarTool", "WeatherTool"],
      }),
    );

    expect(invalidResponse.response.ok).toBe(false);

    await runtime.close();
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
    Partial<Pick<AgentHostToolContext, "authorizedToolNames" | "sessionId" | "interaction">> &
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
