import assert from "node:assert/strict";
import { AgentConversationEntryKinds } from "../Source/AgentSystem/Conversation/AgentConversation.js";
import { AgentConversationProjector } from "../Source/AgentSystem/Conversation/AgentConversationProjector.js";
import type { AgentOpenAiTranscriptMessage } from "../Source/AgentSystem/Conversation/AgentOpenAiTranscript.js";
import { AgentPiOpenAiTranscriptProjector } from "../Source/AgentSystem/Pi/AgentPiOpenAiTranscriptProjector.js";
import { AgentPiOpenAiPlanningProjector } from "../Source/AgentSystem/PiProxy/AgentPiOpenAiPlanningProjector.js";
import {
  entryToRow,
  rowToEntry,
} from "../Source/AgentSystem/SessionPersistence/AgentConversationEntryCodec.js";
import type { ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const conversation = new AgentConversationProjector();

function main(): void {
  verifyOpenAiTranscriptPersistenceRoundTrip();
  verifyPiHistoryUsesCanonicalTranscript();
  verifyPlanningProjectionUsesOpenAiSemantics();
  verifyPlanningProjectionPreservesToolProgressAcrossBatches();

  console.log("Pi OpenAI transcript projection verified.");
}

function verifyOpenAiTranscriptPersistenceRoundTrip(): void {
  const messages = transcriptFixture();
  const entry = conversation.projectOpenAiTranscript(
    "verify-transcript",
    messages,
    "2026-01-01T00:00:00.000Z",
  );

  const restored = rowToEntry(entryToRow("session", entry, 1));

  assert.equal(restored?.kind, AgentConversationEntryKinds.OpenAiTranscript);
  assert.deepEqual(
    restored?.kind === AgentConversationEntryKinds.OpenAiTranscript ? restored.messages : [],
    messages,
  );
}

function verifyPiHistoryUsesCanonicalTranscript(): void {
  const projector = new AgentPiOpenAiTranscriptProjector();
  const projected = projector.project({
    requestId: "current-request",
    userInput: "继续总结",
    conversationEntries: [
      conversation.projectOpenAiTranscript(
        "previous-request",
        transcriptFixture(),
        "2026-01-01T00:00:00.000Z",
      ),
      conversation.projectUserInput(
        "current-request",
        "继续总结",
        "2026-01-01T00:00:02.000Z",
      ),
    ],
    model: modelFixture(),
  });

  assert.equal(projected.input, "继续总结");
  assert.deepEqual(projected.history.map((message) => message.role), [
    "user",
    "assistant",
    "toolResult",
    "assistant",
  ]);
  const assistant = projected.history[1] as { content?: Array<Record<string, unknown>> };
  expectAssistantText(assistant, "我先查天气。");
  assert.equal(assistant.content?.some((part) => part.type === "toolCall"), true);
  const tool = projected.history[2] as { toolCallId?: string; toolName?: string; isError?: boolean };
  assert.equal(tool.toolCallId, "call_weather");
  assert.equal(tool.toolName, "WeatherTool");
  assert.equal(tool.isError, false);
}

function verifyPlanningProjectionUsesOpenAiSemantics(): void {
  const projector = new AgentPiOpenAiPlanningProjector({
    modelProvider,
  });
  const longObservation = JSON.stringify({
    type: "senera.tool_observation.v1",
    status: "success",
    summary: "北京晴，上海多云。",
    artifact_uri: "senera://artifact/weather",
    evidence: [{
      evidence_uri: "senera://evidence/weather/beijing",
    }],
    result: "weather\n".repeat(80_000),
  });

  const projection = projector.project({
    model: "test-model",
    messages: [{
      role: "user",
      content: "查北京和上海天气",
    }, {
      role: "assistant",
      content: "我先查天气。",
      tool_calls: [{
        id: "call_weather",
        type: "function",
        function: {
          name: "WeatherTool",
          arguments: "{\"city\":\"北京\",\"unit\":\"celsius\"}",
        },
      }],
    }, {
      role: "tool",
      tool_call_id: "call_weather",
      content: longObservation,
    }],
    tools: [{
      type: "function",
      function: {
        name: "WeatherTool",
        description: "Get current weather.",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string" },
            unit: { type: "string" },
          },
          required: ["city"],
        },
      },
    }],
  });

  assert.equal(projection.messages.length, 3);
  assert.equal(projection.projection.originalMessageCount, 3);
  assert.equal(projection.projection.truncatedTextFields > 0, true);
  assert.equal(projection.toolTranscript[0]?.callId, "call_weather");
  assert.equal(projection.toolTranscript[0]?.toolName, "WeatherTool");
  assert.equal(projection.toolTranscript[0]?.argumentsJson, "{\"city\":\"北京\",\"unit\":\"celsius\"}");
  assert.equal(projection.toolTranscript[0]?.observation?.status, "success");
  assert.equal(projection.toolTranscript[0]?.observation?.summary, "北京晴，上海多云。");
  assert.equal(projection.toolTranscript[0]?.observation?.artifactUri, "senera://artifact/weather");
  assert.deepEqual(projection.toolTranscript[0]?.observation?.evidenceUris, [
    "senera://evidence/weather/beijing",
  ]);
  assert.equal(projection.toolTranscript[0]?.observation?.content.endsWith("..."), true);
}

function verifyPlanningProjectionPreservesToolProgressAcrossBatches(): void {
  const projector = new AgentPiOpenAiPlanningProjector({ modelProvider });
  const projection = projector.project({
    model: "test-model",
    messages: [
      {
        role: "user",
        content: "检查项目配置",
      },
      {
        role: "assistant",
        content: "我先读取项目配置。",
        tool_calls: [{
          id: "call_read",
          type: "function",
          function: {
            name: "WorkspaceReadFile",
            arguments: "{\"path\":\"package.json\"}",
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: "call_read",
        content: JSON.stringify({
          type: "senera.tool_observation.v1",
          status: "success",
          summary: "已读取 package.json。",
        }),
      },
      {
        role: "assistant",
        content: "配置已读取，我再核对依赖关系。",
        tool_calls: [{
          id: "call_verify",
          type: "function",
          function: {
            name: "WorkspaceReadFile",
            arguments: "{\"path\":\"package-lock.json\"}",
          },
        }],
      },
    ],
  });

  const messages = projection.messages as Array<{
    role?: string;
    content?: string;
    tool_calls?: Array<{ id?: string }>;
  }>;
  assert.deepEqual(
    messages
      .filter((message) => message.role === "assistant")
      .map((message) => ({ content: message.content, callId: message.tool_calls?.[0]?.id })),
    [
      { content: "我先读取项目配置。", callId: "call_read" },
      { content: "配置已读取，我再核对依赖关系。", callId: "call_verify" },
    ],
  );
}

function expectAssistantText(
  message: { content?: Array<Record<string, unknown>> },
  text: string,
): void {
  assert.equal(
    message.content?.some((part) => part.type === "text" && part.text === text),
    true,
  );
}

function transcriptFixture(): AgentOpenAiTranscriptMessage[] {
  return [{
    role: "user",
    content: "查北京天气",
  }, {
    role: "assistant",
    content: "我先查天气。",
    tool_calls: [{
      id: "call_weather",
      type: "function",
      function: {
        name: "WeatherTool",
        arguments: "{\"city\":\"北京\"}",
      },
    }],
  }, {
    role: "tool",
    tool_call_id: "call_weather",
    content: JSON.stringify({
      type: "senera.tool_observation.v1",
      status: "success",
      summary: "北京晴。",
    }),
  }, {
    role: "assistant",
    content: "北京现在晴。",
  }];
}

function modelFixture() {
  return {
    id: "test-model",
    name: "test-model",
    api: "openai-completions" as const,
    provider: "senera-pi-proxy",
    baseUrl: "http://127.0.0.1:8787/v1",
    reasoning: false,
    input: ["text" as const],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

const modelProvider: ResolvedAgentModelProviderConfig = {
  Id: "test-model",
  ProviderId: "test-endpoint",
  Kind: "OpenAICompatible",
  Endpoint: "ChatCompletions",
  BaseUrl: "https://example.invalid/v1",
  ApiKey: "test-key",
  ApiVersion: "",
  Model: "test-model",
  Temperature: 0,
  MaxOutputTokens: -1,
  Stream: true,
  TimeoutMs: 20_000,
  FirstTokenTimeoutMs: 20_000,
  MaxRequestMs: 20_000,
  MaxNetworkRetries: 1,
  Headers: {},
  Capabilities: {
    ToolCalling: false,
  },
};

main();
