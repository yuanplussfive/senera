import { describe, expect, test } from "vitest";
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
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/PluginRuntimeTypes.js";
import { AgentModelEndpointKinds } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelEndpointContract.js";
import {
  AgentPiProxyProtocol,
  resolveAgentPiProxyBaseUrl,
} from "../../../Source/AgentSystem/PiProxy/AgentPiProxyContract.js";
import {
  AgentPiProxyModelProviderHeader,
  encodePiProxyModelProviderHeaderValue,
} from "../../../Source/AgentSystem/PiProxy/AgentPiProxyRuntimeContext.js";

describe("Pi projection behavior", () => {
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

  test("injects a single hidden runtime context message with current tool evidence and retrieval tools", () => {
    const policy = new AgentPiContextPolicy("test-model");
    const frame = policy.createFrame({
      requestId: "request-1",
      model: "test-model",
      conversationEntries: [],
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
              type: "senera.tool_observation.v1",
              artifact_uri: "senera://artifact/weather",
              evidence: [
                {
                  evidence_uri: "senera://evidence/weather-beijing",
                  kind: "weather",
                  label: "Beijing forecast",
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

    const once = policy.apply(messages, frame);
    const twice = applyAgentPiContextPolicy(once, frame);
    const contextMessages = twice.filter((message) => isContextMessage(message));

    expect(contextMessages).toHaveLength(1);
    expect(twice.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "天气怎么样" }],
    });

    const details = readContextDetails(contextMessages[0]);
    expect(details).toBeDefined();
    const contextDetails = details as {
      evidence: Array<{ evidenceUri: string; toolName?: string; facts: Array<{ name: string; value: string }> }>;
      retrievalTools: Array<{ toolName: string; summary?: string }>;
      stats: { currentToolEvidence: number; retrievalTools: number };
    };
    expect(contextDetails.evidence).toEqual([
      expect.objectContaining({
        evidenceUri: "senera://evidence/weather-beijing",
        toolName: "WeatherTool",
        facts: [{ name: "city", value: "Beijing" }],
      }),
    ]);
    expect(contextDetails.retrievalTools).toEqual([
      expect.objectContaining({
        toolName: "ArtifactMemoryTool",
        summary: "ArtifactMemoryTool description",
      }),
    ]);
    expect(contextDetails.stats).toMatchObject({
      currentToolEvidence: 1,
      retrievalTools: 1,
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
        runtime: { enabled: true, tools: {} },
        diagnostics: [],
      },
      manifest: {
        Plugin: {
          Name: `${name}Plugin`,
          Title: name,
          Version: "1.0.0",
          Kind: "Tool",
          Description: `${name} description`,
        },
      },
    },
    name,
    permissions: [],
    handler: { kind: "HostCapability", capability },
    execution: {
      Boundary: "Local",
      Network: "Deny",
      Workspace: "ReadOnly",
      LocalFallback: "Deny",
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

function readContextDetails(message: AgentMessage | undefined): unknown {
  return typeof message === "object" && message !== null && "details" in message ? message.details : undefined;
}

function isAsciiHeaderValue(value: string): boolean {
  return [...value].every((character) => character.charCodeAt(0) <= 0x7f);
}
