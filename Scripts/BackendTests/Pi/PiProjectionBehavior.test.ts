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
import type { Model, ToolResultMessage } from "@earendil-works/pi-ai";
import { stream as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import type { ResolvedAgentModelProviderConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import {
  AgentModelEndpointKinds,
  AgentNativeToolApiByEndpoint,
  resolveAgentNativeToolRoute,
} from "../../../Source/AgentSystem/ModelEndpoints/AgentModelEndpointContract.js";
import { AgentTokenProjector } from "../../../Source/AgentSystem/Text/AgentTokenProjection.js";
import { compilePiToolObservation } from "../Support/PiToolObservationFixtures.js";

describe("Pi projection behavior", () => {
  test.each(AgentModelEndpointKinds)("projects %s providers through the BAML planning provider", (endpoint) => {
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
    const projected = projectSeneraModelProviderToPi(provider);

    expect(projected.providerId).toBe("senera");
    expect(projected.model).toMatchObject({
      id: "test-model",
      name: "main",
      api: "senera-planning",
      provider: "senera",
      baseUrl: "senera://planning",
      input: ["text", "image"],
      reasoning: true,
      contextWindow: 128_000,
      maxTokens: 8_192,
    });
    expect(projected.model).not.toHaveProperty("headers");
    expect(projected.model).not.toHaveProperty("compat");
  });

  test.each(AgentModelEndpointKinds)("projects %s providers through its declared native Pi API", (endpoint) => {
    const provider = createProvider({
      Endpoint: endpoint,
      ToolPlanningMode: "native",
      Headers: { "x-senera-test": "enabled" },
      Capabilities: {
        ToolCalling: true,
        Vision: true,
        Reasoning: true,
        DeveloperRole: false,
        StreamingUsage: true,
      },
    });

    const projected = projectSeneraModelProviderToPi(provider);

    const route = resolveAgentNativeToolRoute(endpoint, provider.BaseUrl);
    expect(projected).toMatchObject({
      providerId: provider.ProviderId,
      toolPlanningMode: "native",
      model: {
        api: AgentNativeToolApiByEndpoint[endpoint],
        provider: provider.ProviderId,
        baseUrl: route.baseUrl,
        headers: { "x-senera-test": "enabled" },
      },
    });
    expect(projected.model.headers).not.toHaveProperty("Authorization");
    expect(projected.model.headers).not.toHaveProperty("x-api-key");
    expect(projected.model.headers).not.toHaveProperty("x-goog-api-key");
  });

  test.each([
    ["https://chat.senerapi.com/v1", "https://chat.senerapi.com/"],
    ["https://chat.senerapi.com/proxy/v1/", "https://chat.senerapi.com/proxy"],
    ["https://chat.senerapi.com/v11", "https://chat.senerapi.com/v11"],
  ])("normalizes only an exact Claude SDK-owned path suffix in %s", (baseUrl, expected) => {
    expect(resolveAgentNativeToolRoute("ClaudeMessages", baseUrl)).toEqual({
      api: "anthropic-messages",
      baseUrl: expected,
    });
  });

  test("sends Claude native requests to one exact /v1/messages path through the Pi adapter", async () => {
    const projected = projectSeneraModelProviderToPi(
      createProvider({
        Endpoint: "ClaudeMessages",
        BaseUrl: "https://chat.senerapi.com/v1",
        ToolPlanningMode: "native",
        Capabilities: { Chat: true, ToolCalling: true },
      }),
    );
    let requestedUrl = "";
    const fetch: typeof globalThis.fetch = async (input) => {
      requestedUrl = input instanceof Request ? input.url : String(input);
      return new Response(
        JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "test stop" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    };
    const stream = streamAnthropic(
      projected.model as Model<"anthropic-messages">,
      {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Route probe" }],
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey: "test-key", fetch, maxRetries: 0 },
    );

    const result = await stream.result();
    expect(result.stopReason).toBe("error");
    expect(requestedUrl).toBe("https://chat.senerapi.com/v1/messages");
  });

  test("uses the resolved context window and bounded output metadata when output limits are unknown", () => {
    const projected = projectSeneraModelProviderToPi(
      createProvider({ ContextWindowTokens: 64_000, MaxModelOutputTokens: -1, MaxOutputTokens: -1 }),
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
        createRetrievalTool("SemanticMemoryTool", AgentHostCapabilityNames.MemoryRecall),
      ],
      visibleToolNames: ["ArtifactMemoryTool", "SemanticMemoryTool"],
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
            text: JSON.stringify(
              compilePiToolObservation({
                toolName: "WeatherTool",
                callId: "call-weather",
                artifact: {
                  artifactUri: "senera://artifact/weather",
                  evidence: [
                    {
                      evidenceUri: "senera://evidence/weather-beijing",
                      kind: "weather",
                      label: "Beijing forecast",
                      artifactUri: "senera://artifact/weather-source",
                      artifactRefs: ["raw", "evidence"],
                      facts: [{ name: "city", value: "Beijing" }],
                    },
                  ],
                  delta: [],
                },
              }),
            ),
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
    ToolPlanningMode: "baml",
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
    childGrant: "inherit",
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
  const observation = compilePiToolObservation({
    toolName: "VisibleTool",
    callId: "call-visible",
    artifact: { artifactUri, evidence: [], delta: [] },
  });
  return {
    role: "toolResult",
    toolCallId: "call-visible",
    toolName: "VisibleTool",
    content: [
      {
        type: "text",
        text: JSON.stringify(observation),
      },
    ],
    isError: false,
    timestamp: Date.now(),
  };
}
