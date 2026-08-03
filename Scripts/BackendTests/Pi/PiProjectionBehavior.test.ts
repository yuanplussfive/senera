import { describe, expect, test } from "vitest";
import { DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-coding-agent";
import { projectSeneraModelProviderToPi } from "../../../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import {
  AgentPiContextPolicy,
  AgentPiContextPolicyCustomType,
  applyAgentPiContextPolicy,
} from "../../../Source/AgentSystem/Pi/AgentPiContextPolicy.js";
import { AgentHostCapabilityNames } from "../../../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type {
  AgentSystemConfig,
  ResolvedAgentModelProviderConfig,
} from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import { AgentModelEndpointKinds } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelEndpointContract.js";
import {
  AgentPiProxyModelProviderHeader,
  AgentPiProxyProtocol,
  encodePiProxyModelProviderHeaderValue,
  resolveAgentPiProxyBaseUrl,
} from "../../../Source/AgentSystem/PiShared/AgentPiProxyProtocol.js";
import { projectPiModelsResponse } from "../../../Source/AgentSystem/PiProxy/AgentPiOpenAiResponseProjector.js";
import { AgentTokenProjector } from "../../../Source/AgentSystem/Text/AgentTokenProjection.js";
import { AgentPiToolObservationProtocol } from "../../../Source/AgentSystem/Pi/AgentPiToolObservation.js";

describe("Pi projection behavior", () => {
  test("projects every distinct configured model in the proxy catalog", () => {
    expect(projectPiModelsResponse(["model-a", "model-b", "model-a"]).data.map(({ id }) => id)).toEqual([
      "model-a",
      "model-b",
    ]);
  });

  test.each(AgentModelEndpointKinds)("projects %s providers through the local Pi proxy", (endpoint) => {
    const provider = createProvider({
      Endpoint: endpoint,
      Capabilities: {
        Vision: true,
        Reasoning: true,
        DeveloperRole: false,
      },
      ContextWindowTokens: 128_000,
      MaxModelOutputTokens: 8_192,
    });
    const projected = projectSeneraModelProviderToPi(provider, createConfig());

    expect(projected.providerId).toBe(AgentPiProxyProtocol.providerId);
    expect(projected.apiKey).toBe(AgentPiProxyProtocol.apiKey);
    expect(projected.model).toMatchObject({
      id: "test-model",
      name: "main",
      api: AgentPiProxyProtocol.modelApi,
      provider: AgentPiProxyProtocol.providerId,
      baseUrl: resolveAgentPiProxyBaseUrl(createConfig()),
      input: ["text", "image"],
      reasoning: true,
      contextWindow: 128_000,
      maxTokens: 8_192,
      compat: {
        supportsDeveloperRole: false,
      },
    });
  });

  test("encodes non-ASCII model provider ids before passing them through Pi proxy headers", () => {
    const provider = createProvider({
      Id: "测试2/deepseek-v4-flash",
      Model: "deepseek-v4-flash",
    });
    const projected = projectSeneraModelProviderToPi(
      provider,
      createConfig({
        ModelProviders: [
          {
            Id: "测试2/deepseek-v4-flash",
            ProviderId: "main",
            Endpoint: "ChatCompletions",
            Model: "deepseek-v4-flash",
          },
        ],
      }),
    );

    expect(projected.headers[AgentPiProxyModelProviderHeader]).toBe(
      encodePiProxyModelProviderHeaderValue("测试2/deepseek-v4-flash"),
    );
    expect(isAsciiHeaderValue(projected.headers[AgentPiProxyModelProviderHeader] ?? "")).toBe(true);
  });

  test("uses the resolved context window and bounded output metadata when output limits are unknown", () => {
    const projected = projectSeneraModelProviderToPi(
      createProvider({ ContextWindowTokens: 64_000, MaxModelOutputTokens: -1, MaxOutputTokens: -1 }),
      createConfig(),
    );

    expect(projected.model.contextWindow).toBe(64_000);
    expect(projected.model.maxTokens).toBe(DEFAULT_COMPACTION_SETTINGS.reserveTokens);
  });

  test("injects archived artifact locators without duplicating active tool evidence", () => {
    const policy = new AgentPiContextPolicy("test-model");
    const frame = policy.createFrame({
      requestId: "request-1",
      model: "test-model",
      registeredTools: [
        createRetrievalTool("ArtifactMemoryTool", AgentHostCapabilityNames.ArtifactMemoryRead),
        createRetrievalTool("HiddenMemoryTool", AgentHostCapabilityNames.MemoryRecall),
      ],
      visibleToolNames: ["ArtifactMemoryTool"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const messages = [
      {
        role: "toolResult",
        toolName: "WeatherTool",
        toolCallId: "call-weather",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              type: AgentPiToolObservationProtocol.type,
              artifact_uri: "senera://artifact/weather",
              evidence: [
                {
                  evidence_uri: "senera://evidence/weather-beijing",
                  kind: "weather",
                  label: "Beijing forecast",
                  artifact_uri: "senera://artifact/weather-source",
                  artifact_refs: ["raw", "evidence"],
                  facts: [{ name: "city", value: "Beijing" }],
                },
              ],
            }),
          },
        ],
        isError: false,
        timestamp: Date.parse("2026-01-01T00:00:00.000Z"),
      } satisfies ToolResultMessage,
      {
        role: "user",
        content: [{ type: "text", text: "天气怎么样" }],
        timestamp: Date.parse("2026-01-01T00:00:01.000Z"),
      },
    ] satisfies AgentMessage[];

    const archivedArtifacts = [
      artifactReference("senera://artifact/archived", "ArchivedTool"),
      artifactReference("senera://artifact/weather", "WeatherTool"),
    ];
    const budget = { contextWindowTokens: 4_096, outputReserveTokens: 512 };
    const once = policy.apply(messages, frame, archivedArtifacts, budget);
    const twice = applyAgentPiContextPolicy(once, frame, archivedArtifacts, budget);
    const contextMessages = twice.filter((message) => isContextMessage(message));

    expect(contextMessages).toHaveLength(1);
    expect(twice.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "天气怎么样" }],
    });

    const contextDetails = readContextContent(contextMessages[0]);
    expect(contextDetails.evidence).toEqual([]);
    expect(contextDetails.artifacts).toEqual([
      {
        artifactUri: "senera://artifact/archived",
        toolNames: ["ArchivedTool"],
        refs: ["projection"],
      },
    ]);
    expect(contextDetails.retrievalTools).toEqual([
      {
        toolName: "ArtifactMemoryTool",
        capability: AgentHostCapabilityNames.ArtifactMemoryRead,
      },
    ]);
    expect(contextDetails.stats).toMatchObject({
      archivedArtifacts: 2,
      alreadyVisibleArtifacts: 1,
      includedArtifacts: 1,
      omittedArtifacts: 0,
      retrievalTools: 1,
    });
  });

  test("does not add a parallel context message when every artifact is already visible in Pi", () => {
    const policy = new AgentPiContextPolicy("test-model");
    const frame = policy.createFrame({
      model: "test-model",
      registeredTools: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const messages = [toolResultWithArtifact("senera://artifact/visible")];

    expect(
      policy.apply(messages, frame, [artifactReference("senera://artifact/visible", "VisibleTool")], {
        contextWindowTokens: 1_024,
        outputReserveTokens: 128,
      }),
    ).toEqual(messages);
  });

  test("fits a large archived index into the dynamic remaining context budget", () => {
    const model = "test-model";
    const policy = new AgentPiContextPolicy(model);
    const frame = policy.createFrame({
      model,
      registeredTools: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Find the most recent archived result." }],
        timestamp: Date.parse("2026-01-01T00:00:01.000Z"),
      },
    ];
    const artifacts = Array.from({ length: 200 }, (_, index) =>
      artifactReference(`senera://artifact/archive-${index.toString().padStart(3, "0")}`, `Tool${index}`),
    );
    const budget = { contextWindowTokens: 900, outputReserveTokens: 200 };
    const projected = policy.apply(messages, frame, artifacts, budget);
    const contextMessage = projected.find((message) => isContextMessage(message));
    const context = readContextContent(contextMessage);
    const projectedTokens = projected.reduce(
      (total, message) => total + new AgentTokenProjector(model).countJson(message),
      0,
    );

    expect(projectedTokens).toBeLessThanOrEqual(budget.contextWindowTokens - budget.outputReserveTokens);
    expect(context.artifacts.length).toBeGreaterThan(0);
    expect(context.artifacts.length).toBeLessThan(artifacts.length);
    expect(context.artifacts[0]?.artifactUri).toBe("senera://artifact/archive-199");
    expect(context.stats).toMatchObject({
      archivedArtifacts: artifacts.length,
      alreadyVisibleArtifacts: 0,
      includedArtifacts: context.artifacts.length,
      omittedArtifacts: artifacts.length - context.artifacts.length,
    });
  });
});

function createProvider(overrides: Partial<ResolvedAgentModelProviderConfig> = {}): ResolvedAgentModelProviderConfig {
  return {
    Id: "main",
    ProviderId: "endpoint-1",
    Kind: "OpenAICompatible",
    Endpoint: "ChatCompletions",
    BaseUrl: "https://model.example/v1",
    ApiKey: "secret",
    ApiVersion: "",
    Model: "test-model",
    ContextWindowTokens: 128_000,
    Temperature: 0,
    MaxOutputTokens: 1_024,
    Stream: true,
    TimeoutMs: 60_000,
    FirstTokenTimeoutMs: 10_000,
    MaxRequestMs: 120_000,
    MaxNetworkRetries: 0,
    RetryBaseDelayMs: 250,
    RetryMaxDelayMs: 10_000,
    RetryAfterMaxDelayMs: 60_000,
    Headers: {},
    ...overrides,
  };
}

function createConfig(overrides: Partial<AgentSystemConfig> = {}): AgentSystemConfig {
  return {
    Server: {
      Host: "127.0.0.1",
      Port: 8787,
    },
    ModelProviders: [
      {
        Id: "main",
        ProviderId: "endpoint-1",
        Endpoint: "ChatCompletions",
        Model: "test-model",
      },
    ],
    ...overrides,
  };
}

function createRetrievalTool(name: string, capability: string): RegisteredTool {
  return {
    owner: {
      kind: "system",
      name: `${name}-owner`,
      title: name,
      description: `${name} description`,
      rootPath: process.cwd(),
      revision: "test",
      trusted: true,
      requiresApproval: false,
    },
    loading: "Dynamic",
    name,
    permissions: [],
    sources: [],
    handler: { kind: "HostCapability", capability },
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
  };
}

function isContextMessage(message: AgentMessage): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    "customType" in message &&
    message.customType === AgentPiContextPolicyCustomType
  );
}

function readContextContent(message: AgentMessage | undefined): {
  evidence: unknown[];
  artifacts: Array<{ artifactUri: string; toolNames: string[]; refs: string[] }>;
  retrievalTools: Array<{ toolName: string; capability: string }>;
  stats: {
    archivedArtifacts: number;
    alreadyVisibleArtifacts: number;
    includedArtifacts: number;
    omittedArtifacts: number;
    retrievalTools: number;
  };
} {
  if (message?.role !== "custom" || typeof message.content !== "string") {
    throw new Error("Expected a serialized Pi context policy message.");
  }
  return JSON.parse(message.content) as ReturnType<typeof readContextContent>;
}

function artifactReference(artifactUri: string, toolName: string) {
  return {
    artifactUri,
    toolNames: [toolName],
    callIds: [],
    evidenceUris: [],
    refs: ["projection"],
  };
}

function toolResultWithArtifact(artifactUri: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: "call-visible",
    toolName: "VisibleTool",
    content: [
      {
        type: "text",
        text: JSON.stringify({ type: AgentPiToolObservationProtocol.type, artifact_uri: artifactUri }),
      },
    ],
    isError: false,
    timestamp: Date.now(),
  };
}

function isAsciiHeaderValue(value: string): boolean {
  return [...value].every((character) => character.charCodeAt(0) <= 0x7f);
}
