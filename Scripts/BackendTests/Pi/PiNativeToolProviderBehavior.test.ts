import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type ProviderStreams,
  type SimpleStreamOptions,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentModelUsageLedger } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import { AgentPiMutableSessionFrame } from "../../../Source/AgentSystem/Pi/AgentPiCodingAgentSessionFrame.js";
import { projectSeneraModelProviderToPi } from "../../../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import {
  AgentPiNativeToolProvider,
  type AgentPiNativeApiStreams,
} from "../../../Source/AgentSystem/Pi/AgentPiNativeToolProvider.js";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import { AgentPiToolPlanCoordinator } from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";

describe("Pi native tool provider", () => {
  test("uses the declared API while projecting the current tool exposure and shared batch events", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "ChatCompletions",
      MaxModelOutputTokens: 1_024,
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model);
    const events: AgentDomainEvent[] = [];
    const frame = new AgentPiMutableSessionFrame({
      sessionId: "native-tools-session",
      requestId: "native-tools-request",
      step: 1,
      turnState,
      onEvent: (event) => {
        events.push(event);
      },
      skillCatalogFingerprint: "test",
      toolAccessGrant: turnState.context.toolAccessGrant,
      toolExposure: turnState.context.toolExposure,
      selectedPromptTemplates: [],
      tokenBudget: turnState.context.tokenBudget,
      preflight: async () => undefined,
    });
    const requests: Context[] = [];
    let requestCount = 0;
    const streams = nativeApiStreams((model, context) => {
      requests.push(context);
      requestCount += 1;
      return completedStream(
        model,
        requestCount === 1
          ? [
              { type: "text", text: "Finding the artifact." },
              { type: "toolCall", id: "call-search", name: "ToolSearch", arguments: { query: "artifact" } },
            ]
          : [{ type: "text", text: "Artifact reader is now available." }],
      );
    });
    const provider = new AgentPiNativeToolProvider({ projection, modelProvider, frame, apiStreams: streams }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");
    const context: Context = {
      systemPrompt: "<agent_system><native_tool_calling /></agent_system>",
      messages: [{ role: "user", content: "Read an artifact.", timestamp: 1 }],
      tools: [tool("ToolSearch"), tool("ArtifactRead")],
    };

    await provider.streamSimple(model, context).result();
    turnState.settleToolObservationBudget("call-search", { status: "success" });
    turnState.context.toolExposure.expose(["ArtifactRead"]);
    await provider.streamSimple(model, context).result();

    expect(model.api).toBe("openai-completions");
    expect(requests.map((request) => request.tools?.map((entry) => entry.name))).toEqual([
      ["ToolSearch"],
      ["ArtifactRead", "ToolSearch"],
    ]);
    expect(requests[0]?.systemPrompt).toBe("<agent_system><native_tool_calling /></agent_system>");
    expect(requests[0]?.messages).toEqual(context.messages);
    expect(turnState.toolBatchId("call-search")).toEqual(expect.stringMatching(/^toolbatch_/u));
    expect(events.map((event) => event.kind)).toEqual([
      AgentEventKinds.AssistantMessageCreated,
      AgentEventKinds.ToolCallsPlanned,
    ]);
    expect(events[1]?.data).toMatchObject({
      calls: [{ callId: "call-search", toolName: "ToolSearch" }],
    });
    expect(turnState.context.usageLedger.snapshot()).toEqual([
      expect.objectContaining({ stage: "pi.native.tool_calling" }),
      expect.objectContaining({ stage: "pi.native.tool_calling" }),
    ]);
  });

  test("forwards a successful response when provider usage exceeds the planning capacity", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
      ContextWindowTokens: 128,
      MaxModelOutputTokens: 64,
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model, 128, 64);
    const frame = new AgentPiMutableSessionFrame({
      sessionId: "over-capacity-session",
      requestId: "over-capacity-request",
      step: 1,
      turnState,
      skillCatalogFingerprint: "test",
      toolAccessGrant: turnState.context.toolAccessGrant,
      toolExposure: turnState.context.toolExposure,
      selectedPromptTemplates: [],
      tokenBudget: turnState.context.tokenBudget,
      preflight: async () => undefined,
    });
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model) => completedStream(model, [{ type: "text", text: "Completed." }], 96)),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    await expect(
      provider
        .streamSimple(model, {
          messages: [{ role: "user", content: "Complete this.", timestamp: 1 }],
          tools: [tool("ToolSearch")],
        })
        .result(),
    ).resolves.toMatchObject({ stopReason: "stop" });
    expect(turnState.context.tokenBudget.availableTokens()).toBe(0);
  });

  test("rejects an oversized final request before invoking the vendor stream", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
      ContextWindowTokens: 128,
      MaxModelOutputTokens: 64,
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model, 128, 64);
    const frame = new AgentPiMutableSessionFrame({
      sessionId: "oversized-native-session",
      requestId: "oversized-native-request",
      step: 1,
      turnState,
      skillCatalogFingerprint: "test",
      toolAccessGrant: turnState.context.toolAccessGrant,
      toolExposure: turnState.context.toolExposure,
      selectedPromptTemplates: [],
      tokenBudget: turnState.context.tokenBudget,
      preflight: async () => undefined,
    });
    let upstreamCalls = 0;
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model) => {
        upstreamCalls += 1;
        return completedStream(model, [{ type: "text", text: "should not run" }]);
      }),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    const result = await provider
      .streamSimple(model, {
        messages: [{ role: "user", content: "large ".repeat(1_000), timestamp: 1 }],
        tools: [tool("ToolSearch")],
      })
      .result();

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("planning input uses");
    expect(upstreamCalls).toBe(0);
  });

  test("reports an upstream stream error as a provider failure when the caller was not aborted", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model);
    const frame = createFrame(turnState, "provider-failure-session", "provider-failure-request");
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model) => {
        const stream = createAssistantMessageEventStream();
        stream.push({
          type: "start",
          partial: { ...failureMessage(model, "stream_read_error"), content: [], stopReason: "pending" },
        });
        stream.push({ type: "error", reason: "error", error: failureMessage(model, "stream_read_error") });
        return stream;
      }),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    const result = await provider
      .streamSimple(model, {
        messages: [{ role: "user", content: "Continue.", timestamp: 1 }],
        tools: [tool("ToolSearch")],
      })
      .result();

    expect(result).toMatchObject({ stopReason: "error" });
    expect(result.errorMessage).toContain("stream_read_error");
  });

  test("preserves caller cancellation when the upstream reports an error after abort", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model);
    const frame = createFrame(turnState, "provider-cancel-session", "provider-cancel-request");
    const abortController = new AbortController();
    abortController.abort(new Error("User stopped the run."));
    let observedSignal: AbortSignal | undefined;
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model, _context, options) => {
        observedSignal = options?.signal;
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "error", reason: "error", error: failureMessage(model, "stream_read_error") });
        return stream;
      }),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    const result = await provider
      .streamSimple(
        model,
        {
          messages: [{ role: "user", content: "Stop.", timestamp: 1 }],
          tools: [tool("ToolSearch")],
        },
        { signal: abortController.signal },
      )
      .result();

    expect(observedSignal?.aborted).toBe(true);
    expect(result).toMatchObject({ stopReason: "aborted", errorMessage: "User stopped the run." });
  });
});

function createTurnState(model: string, contextWindowTokens = 16_384, outputReserveTokens = 1_024): AgentPiTurnState {
  const toolAccessGrant = createAgentToolAccessGrant({
    authorizedToolNames: ["ToolSearch", "ArtifactRead"],
    exposedToolNames: ["ToolSearch"],
  });
  return new AgentPiTurnState({
    approvalMode: "agent",
    sessionId: "native-tools-session",
    requestId: "native-tools-request",
    step: 1,
    toolAccessGrant,
    toolExposure: new AgentToolExposureState(toolAccessGrant),
    activeSkills: [],
    usageLedger: new AgentModelUsageLedger(),
    toolPlan: new AgentPiToolPlanCoordinator(),
    tokenBudget: new AgentTurnTokenBudget({
      model,
      contextWindowTokens,
      outputReserveTokens,
    }),
  });
}

function createFrame(turnState: AgentPiTurnState, sessionId: string, requestId: string): AgentPiMutableSessionFrame {
  return new AgentPiMutableSessionFrame({
    sessionId,
    requestId,
    step: 1,
    turnState,
    skillCatalogFingerprint: "test",
    toolAccessGrant: turnState.context.toolAccessGrant,
    toolExposure: turnState.context.toolExposure,
    selectedPromptTemplates: [],
    tokenBudget: turnState.context.tokenBudget,
    preflight: async () => undefined,
  });
}

function failureMessage(model: Model<Api>, errorMessage: string): AssistantMessage {
  return {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [],
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage,
    timestamp: Date.now(),
  };
}

function nativeApiStreams(
  stream: (
    model: Model<Api>,
    context: Context,
    options?: StreamOptions | SimpleStreamOptions,
  ) => AssistantMessageEventStream,
): AgentPiNativeApiStreams {
  const providerStreams: ProviderStreams = {
    stream: (model, context, options) => stream(model, context, options),
    streamSimple: (model, context, options) => stream(model, context, options),
  };
  return {
    "openai-responses": providerStreams,
    "openai-completions": providerStreams,
    "anthropic-messages": providerStreams,
    "google-generative-ai": providerStreams,
  };
}

function completedStream(
  model: Model<Api>,
  content: AssistantMessage["content"],
  inputTokens = 6,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content,
    usage: {
      input: inputTokens,
      output: 3,
      cacheRead: 2,
      cacheWrite: 0,
      totalTokens: inputTokens + 5,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
  stream.push({ type: "start", partial: { ...message, content: [], stopReason: "pending" } });
  stream.push({
    type: "done",
    reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
    message,
  });
  stream.end(message);
  return stream;
}

function tool(name: string): NonNullable<Context["tools"]>[number] {
  return {
    name,
    description: `${name} test tool`,
    parameters: { type: "object", properties: {}, additionalProperties: false } as never,
  };
}
