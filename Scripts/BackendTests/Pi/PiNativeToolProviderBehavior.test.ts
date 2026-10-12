import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
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
import type { AgentNativeToolApiStreams } from "../../../Source/AgentSystem/ModelEndpoints/AgentNativeToolApiStreams.js";
import { AgentPiMutableSessionFrame } from "../../../Source/AgentSystem/Pi/AgentPiCodingAgentSessionFrame.js";
import { AgentPiNativeToolBridgeName } from "../../../Source/AgentSystem/Pi/AgentPiNativeToolBridge.js";
import { projectSeneraModelProviderToPi } from "../../../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import {
  AgentPiNativeToolProvider,
  type AgentPiNativeToolProviderOptions,
} from "../../../Source/AgentSystem/Pi/AgentPiNativeToolProvider.js";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import { AgentPiToolPlanCoordinator } from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";

describe("Pi native tool provider", () => {
  test("forwards Pi's normalized transcript without flattening system sections", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
      MaxModelOutputTokens: 1_024,
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model);
    const frame = createFrame(turnState, "native-transcript-session", "native-transcript-request");
    let forwardedContext: Context | undefined;
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model, context) => {
        forwardedContext = context;
        return completedStream(model, [{ type: "text", text: "ready" }]);
      }),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");
    const systemMessage = {
      role: "system" as const,
      content: "Stable Pi prompt",
      sections: { runtime: "Volatile runtime section" },
      toolsAdded: [tool("ToolSearch")],
      timestamp: 0,
    };

    await provider
      .streamSimple(model, {
        messages: [systemMessage, { role: "user", content: "Continue", timestamp: 1 }],
      })
      .result();

    expect(forwardedContext?.messages[0]).toEqual(systemMessage);
    expect(getCurrentSystemPrompt(forwardedContext?.messages ?? [])).toContain("Volatile runtime section");
  });

  test("prepares an over-capacity context before validating and sending it", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "ChatCompletions",
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model, 2_000, 0);
    const frame = createFrame(turnState, "prepared-context-session", "prepared-context-request");
    let prepared = 0;
    frame.setModelInputPreparer(async (context) => {
      prepared += 1;
      return {
        ...context,
        messages: [{ role: "user", content: "prepared request", timestamp: 2 }],
      };
    });
    const requests: Context[] = [];
    const streams = nativeApiStreams((_model, context) => {
      requests.push(context);
      return completedStream(_model, [{ type: "text", text: "ready" }]);
    });
    const provider = new AgentPiNativeToolProvider({ projection, modelProvider, frame, apiStreams: streams }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    await provider
      .streamSimple(model, {
        systemPrompt: "system",
        messages: [{ role: "user", content: "x".repeat(10_000), timestamp: 1 }],
        tools: [tool("ToolSearch")],
      })
      .result();

    expect(prepared).toBe(1);
    expect(requests[0]?.messages.filter((message) => message.role !== "system")).toEqual([
      { role: "user", content: "prepared request", timestamp: 2 },
    ]);
  });

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
      skillCatalog: { skills: [], fingerprint: "test" },
      nativeProviderToolNames: ["ToolSearch", AgentPiNativeToolBridgeName],
      toolAccessGrant: turnState.context.toolAccessGrant,
      toolExposure: turnState.context.toolExposure,
      selectedPromptTemplates: [],
      tokenBudget: turnState.context.tokenBudget,
      preflight: async () => undefined,
    });
    const requests: Context[] = [];
    const requestOptions: Array<StreamOptions | SimpleStreamOptions | undefined> = [];
    let requestCount = 0;
    const streams = nativeApiStreams((model, context, options) => {
      requests.push(context);
      requestOptions.push(options);
      requestCount += 1;
      return completedStream(
        model,
        requestCount === 1
          ? [
              { type: "text", text: "Finding the artifact." },
              { type: "toolCall", id: "call-search", name: "ToolSearch", arguments: { query: "artifact" } },
              { type: "text", text: "I will inspect the returned result next." },
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
      tools: [tool("ToolSearch"), tool("ArtifactRead"), tool(AgentPiNativeToolBridgeName)],
    };

    await provider.streamSimple(model, context).result();
    turnState.settleToolObservationBudget("call-search", { status: "success" });
    turnState.context.toolExposure.expose(["ArtifactRead"]);
    await provider.streamSimple(model, context).result();

    expect(model.api).toBe("openai-completions");
    expect(requests.map((request) => getCurrentTools(request.messages).map((entry) => entry.name))).toEqual([
      ["ToolSearch", AgentPiNativeToolBridgeName],
      ["ToolSearch", AgentPiNativeToolBridgeName],
    ]);
    expect(getCurrentSystemPrompt(requests[0]?.messages ?? [])).toBe(
      "<agent_system><native_tool_calling /></agent_system>",
    );
    expect(requests[0]?.messages.filter((message) => message.role !== "system")).toEqual(context.messages);
    expect(requestOptions.map((options) => options?.cacheRetention)).toEqual(["long", "long"]);
    expect(requestOptions.map((options) => options?.sessionId)).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/u),
      expect.stringMatching(/^[a-f0-9]{64}$/u),
    ]);
    expect(requestOptions[0]?.sessionId).toBe(requestOptions[1]?.sessionId);
    expect(turnState.toolBatchId("call-search")).toEqual(expect.stringMatching(/^toolbatch_/u));
    expect(events.map((event) => event.kind)).toEqual([
      AgentEventKinds.AssistantMessageCreated,
      AgentEventKinds.AssistantMessageCreated,
      AgentEventKinds.ToolCallsPlanned,
    ]);
    expect(events.slice(0, 2).map((event) => event.data)).toMatchObject([
      { kind: "tool_preface", content: "Finding the artifact.", modelMessageIndex: 0, modelContentIndex: 0 },
      {
        kind: "tool_preface",
        content: "I will inspect the returned result next.",
        modelMessageIndex: 0,
        modelContentIndex: 2,
      },
    ]);
    expect(events[2]?.data).toMatchObject({
      calls: [{ callId: "call-search", toolName: "ToolSearch" }],
    });
    expect(turnState.context.usageLedger.snapshot()).toEqual([
      expect.objectContaining({ stage: "pi.native.tool_calling" }),
      expect.objectContaining({ stage: "pi.native.tool_calling" }),
    ]);
  });

  test("does not reject a Pi request because of opaque thinking signatures and forwards them unchanged", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "ChatCompletions",
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model, 4_000, 3_000);
    const frame = createFrame(turnState, "signature-budget-session", "signature-budget-request");
    const signature = "encrypted-reasoning-payload".repeat(8_000);
    let forwardedContext: Context | undefined;
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model, context) => {
        forwardedContext = context;
        return completedStream(model, [{ type: "text", text: "The request reached the provider." }]);
      }),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    const result = await provider
      .streamSimple(model, {
        messages: [
          {
            role: "assistant",
            api: "openai-completions",
            provider: "test-endpoint",
            model: modelProvider.Model,
            content: [{ type: "thinking", thinking: "", thinkingSignature: signature }],
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            timestamp: 1,
          },
          { role: "user", content: "continue", timestamp: 2 },
        ],
        systemPrompt: "system",
        tools: [tool("ToolSearch")],
      })
      .result();

    expect(result.stopReason).toBe("stop");
    expect(forwardedContext?.messages.find((message) => message.role === "assistant")).toMatchObject({
      role: "assistant",
      content: [{ type: "thinking", thinkingSignature: signature }],
    });
  });

  test("forwards live native deltas with an active persona when rewrite switches are off", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model);
    const source = createAssistantMessageEventStream();
    const frame = new AgentPiMutableSessionFrame({
      sessionId: "native-roleplay-stream-session",
      requestId: "native-roleplay-stream-request",
      step: 1,
      turnState,
      personaActive: true,
      prefaceRewriteEnabled: false,
      finalResponseRewriteEnabled: false,
      skillCatalog: { skills: [], fingerprint: "test" },
      nativeProviderToolNames: ["ToolSearch"],
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
      apiStreams: nativeApiStreams(() => source),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    const output = provider.streamSimple(model, {
      messages: [{ role: "user", content: "Answer directly.", timestamp: 1 }],
      tools: [tool("ToolSearch")],
    });
    const iterator = output[Symbol.asyncIterator]();
    const message: AssistantMessage = {
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: [
        { type: "thinking", thinking: "Checking the request." },
        { type: "text", text: "Live answer." },
      ],
      usage: {
        input: 2,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 4,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 2,
    };
    const partial = (content: AssistantMessage["content"]): AssistantMessage => ({
      ...message,
      content,
      stopReason: "pending",
    });
    source.push({ type: "start", partial: partial([]) });
    source.push({
      type: "thinking_start",
      contentIndex: 0,
      partial: partial([{ type: "thinking", thinking: "" }]),
    });
    source.push({
      type: "thinking_delta",
      contentIndex: 0,
      delta: "Checking",
      partial: partial([{ type: "thinking", thinking: "Checking" }]),
    });

    expect((await iterator.next()).value?.type).toBe("start");
    expect((await iterator.next()).value?.type).toBe("thinking_start");
    expect((await iterator.next()).value).toMatchObject({ type: "thinking_delta", delta: "Checking" });

    source.push({
      type: "thinking_delta",
      contentIndex: 0,
      delta: " the request.",
      partial: partial([{ type: "thinking", thinking: "Checking the request." }]),
    });
    expect((await iterator.next()).value).toMatchObject({ type: "thinking_delta", delta: " the request." });
    source.push({
      type: "thinking_end",
      contentIndex: 0,
      content: "Checking the request.",
      partial: partial([{ type: "thinking", thinking: "Checking the request." }]),
    });
    expect((await iterator.next()).value?.type).toBe("thinking_end");

    source.push({
      type: "text_start",
      contentIndex: 1,
      partial: partial([
        { type: "thinking", thinking: "Checking the request." },
        { type: "text", text: "" },
      ]),
    });
    source.push({
      type: "text_delta",
      contentIndex: 1,
      delta: "Live",
      partial: partial([
        { type: "thinking", thinking: "Checking the request." },
        { type: "text", text: "Live" },
      ]),
    });

    expect((await iterator.next()).value?.type).toBe("text_start");
    expect((await iterator.next()).value).toMatchObject({ type: "text_delta", delta: "Live" });

    source.push({ type: "text_end", contentIndex: 1, content: "Live answer.", partial: message });
    source.push({ type: "done", reason: "stop", message });
    source.end(message);
    await expect(output.result()).resolves.toMatchObject({ content: message.content });
  });

  test("replaces an active roleplay tool-preface before registering the native tool batch", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model);
    const events: AgentDomainEvent[] = [];
    const delegatedOptions: Array<StreamOptions | SimpleStreamOptions | undefined> = [];
    const delegatedRoutes: string[] = [];
    let delegatedRequests = 0;
    const frame = new AgentPiMutableSessionFrame({
      sessionId: "native-roleplay-session",
      requestId: "native-roleplay-request",
      step: 1,
      turnState,
      personaActive: true,
      prefaceRewriteEnabled: true,
      onEvent: (event) => {
        events.push(event);
      },
      skillCatalog: { skills: [], fingerprint: "test" },
      nativeProviderToolNames: ["ToolSearch", AgentPiNativeToolBridgeName],
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
      residentSpeech: {
        project: async (input) => {
          const continuation = input.nativeContinuation;
          if (!continuation) throw new Error("Expected the owning native continuation.");
          const continuationResult = await continuation
            .stream({
              context: input.context,
              requiredToolName: AgentPiNativeToolBridgeName,
              signal: new AbortController().signal,
            })
            .result();
          expect(continuationResult.content).toEqual([
            {
              type: "toolCall",
              id: "call-resident-speech",
              name: AgentPiNativeToolBridgeName,
              arguments: { tool: "ResidentActionSpeak", arguments: { utterance: "我去翻一下呀。" } },
            },
          ]);
          return {
            ...input.message,
            content: [
              { type: "text", text: "我去翻一下呀。" },
              ...input.message.content.filter((block) => block.type !== "text"),
            ],
          };
        },
      },
      apiStreams: nativeApiStreams(
        (model, _context, options) => {
          delegatedOptions.push(options);
          delegatedRequests += 1;
          return completedStream(
            model,
            delegatedRequests === 1
              ? [
                  { type: "text", text: "Checking now." },
                  { type: "toolCall", id: "call-search", name: "ToolSearch", arguments: { query: "artifact" } },
                ]
              : [
                  {
                    type: "toolCall",
                    id: "call-resident-speech",
                    name: AgentPiNativeToolBridgeName,
                    arguments: { tool: "ResidentActionSpeak", arguments: { utterance: "我去翻一下呀。" } },
                  },
                ],
          );
        },
        (route) => delegatedRoutes.push(route),
      ),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    const result = await provider
      .streamSimple(
        model,
        {
          systemPrompt: "<persona>resident</persona>",
          messages: [{ role: "user", content: "找一下那个文件。", timestamp: 1 }],
          tools: [tool("ToolSearch"), tool(AgentPiNativeToolBridgeName)],
        },
        { reasoning: "high", metadata: { trace: "resident-continuation" } },
      )
      .result();

    expect(result.content).toEqual([
      { type: "text", text: "我去翻一下呀。" },
      { type: "toolCall", id: "call-search", name: "ToolSearch", arguments: { query: "artifact" } },
    ]);
    expect(events[0]).toMatchObject({
      kind: AgentEventKinds.AssistantMessageCreated,
      data: { kind: "tool_preface", content: "我去翻一下呀。" },
    });
    expect(turnState.toolBatchId("call-search")).toEqual(expect.stringMatching(/^toolbatch_/u));
    expect(delegatedRoutes).toEqual(["simple", "stream"]);
    expect(delegatedOptions).toHaveLength(2);
    expect(delegatedOptions.map((options) => options?.cacheRetention)).toEqual(["long", "long"]);
    expect(delegatedOptions.map((options) => options?.sessionId)).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/u),
      expect.stringMatching(/^[a-f0-9]{64}$/u),
    ]);
    expect(delegatedOptions[1]?.sessionId).not.toBe(delegatedOptions[0]?.sessionId);
    expect(
      delegatedOptions.map((options) => (options && "reasoning" in options ? options.reasoning : undefined)),
    ).toEqual(["high", "high"]);
    expect(delegatedOptions.map((options) => options?.metadata)).toEqual([
      { trace: "resident-continuation" },
      { trace: "resident-continuation" },
    ]);
    expect((delegatedOptions[1] as StreamOptions & { toolChoice?: unknown }).toolChoice).toEqual({
      type: "function",
      name: AgentPiNativeToolBridgeName,
    });
  });

  test("projects an opted-in final response only after this turn has registered tool work", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model);
    const projectionInputs: Array<
      Parameters<NonNullable<AgentPiNativeToolProviderOptions["residentSpeech"]>["project"]>[0]
    > = [];
    const frame = new AgentPiMutableSessionFrame({
      sessionId: "native-roleplay-final-session",
      requestId: "native-roleplay-final-request",
      step: 1,
      turnState,
      personaActive: true,
      finalResponseRewriteEnabled: true,
      skillCatalog: { skills: [], fingerprint: "test" },
      nativeProviderToolNames: ["ToolSearch", AgentPiNativeToolBridgeName],
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
      residentSpeech: {
        project: async (input) => {
          projectionInputs.push(input);
          return {
            ...input.message,
            content: [{ type: "text", text: "画完啦，手都酸了TvT" }],
          };
        },
      },
      apiStreams: nativeApiStreams((model) =>
        completedStream(model, [{ type: "text", text: "I finished the illustration today." }]),
      ),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    const context = {
      systemPrompt: "<persona>resident</persona>",
      messages: [{ role: "user" as const, content: "今天画完了吗？", timestamp: 1 }],
      tools: [tool("ToolSearch"), tool(AgentPiNativeToolBridgeName)],
    };
    const directResult = await provider.streamSimple(model, context).result();
    expect(directResult.content).toEqual([{ type: "text", text: "I finished the illustration today." }]);
    expect(projectionInputs).toHaveLength(0);

    turnState.registerToolBatch("prior-tool-batch", [
      { toolCallId: "prior-tool-call", toolName: "ToolSearch", input: { query: "illustration" } },
    ]);
    turnState.settleToolObservationBudget("prior-tool-call", { status: "success" });
    turnState.recordResidentSpeech({ mode: "action_preface", content: "我去看一眼呀。" });

    const result = await provider
      .streamSimple(model, {
        ...context,
        messages: [...context.messages, { role: "user", content: "结果呢？", timestamp: 2 }],
      })
      .result();

    expect(result.errorMessage).toBeUndefined();
    expect(result).toMatchObject({
      stopReason: "stop",
      content: [{ type: "text", text: "画完啦，手都酸了TvT" }],
    });
    expect(projectionInputs[0]).toMatchObject({
      focus: { mode: "final_response" },
      spokenUtterances: [{ mode: "action_preface", content: "我去看一眼呀。" }],
    });
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
      skillCatalog: { skills: [], fingerprint: "test" },
      nativeProviderToolNames: ["ToolSearch"],
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

  test("forwards an oversized request without a Senera preflight rejection", async () => {
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
      skillCatalog: { skills: [], fingerprint: "test" },
      nativeProviderToolNames: ["ToolSearch"],
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

    expect(result.stopReason).toBe("stop");
    expect(upstreamCalls).toBe(1);
  });

  test("forwards completed historical tool results without a second projection", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
      ContextWindowTokens: 1_200,
      MaxModelOutputTokens: 64,
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model, 1_200, 0);
    const frame = createFrame(turnState, "turn-projection-session", "turn-projection-request");
    let upstreamCalls = 0;
    let forwardedContext: Context | undefined;
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model, context) => {
        upstreamCalls += 1;
        forwardedContext = context;
        return completedStream(model, [{ type: "text", text: "Turn completed." }]);
      }),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");
    const observation = JSON.stringify({
      type: "senera.tool_observation.v5",
      status: "success",
      execution_status: "completed",
      output_availability: "complete",
      detail: {
        summary: "Historical evidence.",
        result: "large historical result ".repeat(1_500),
        evidence: [{ evidence_uri: "senera://evidence/turn", label: "history" }],
      },
    });

    const result = await provider
      .streamSimple(model, {
        messages: [
          { role: "user", content: "Earlier request", timestamp: 1 },
          {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "WorkspaceRead",
            content: [{ type: "text", text: observation }],
            isError: false,
            timestamp: 2,
          },
          { role: "user", content: "Current request", timestamp: 3 },
        ],
        tools: [tool("ToolSearch")],
      })
      .result();

    expect(result.stopReason).toBe("stop");
    expect(upstreamCalls).toBe(1);
    const forwardedText = JSON.stringify(forwardedContext);
    expect(forwardedText).toContain("senera://evidence/turn");
    expect(forwardedText).toContain("Historical evidence.");
    expect(forwardedText).toContain("large historical result ".repeat(100));
  });

  test("passes the native compaction context through unchanged", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
      ContextWindowTokens: 1_200,
      MaxModelOutputTokens: 64,
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model, 1_200, 0);
    const frame = createFrame(turnState, "compaction-projection-session", "compaction-projection-request");
    let upstreamCalls = 0;
    let forwardedContext: Context | undefined;
    let forwardedOptions: StreamOptions | SimpleStreamOptions | undefined;
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model, context, options) => {
        upstreamCalls += 1;
        forwardedContext = context;
        forwardedOptions = options;
        return completedStream(model, [{ type: "text", text: "Summary created." }]);
      }),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");
    const source = "large historical tool result ".repeat(1_500);

    const result = await provider
      .streamSimple(
        model,
        {
          systemPrompt: "You are a context summarization assistant.",
          messages: [
            {
              role: "user",
              content: `<conversation>\n[User]: inspect the project\n\n[Tool result]: ${source}\n</conversation>\n\nSummarize the history.`,
              timestamp: 1,
            },
          ],
        },
        { cacheRetention: "none" },
      )
      .result();

    expect(result.stopReason).toBe("stop");
    expect(upstreamCalls).toBe(1);
    expect(forwardedOptions?.cacheRetention).toBe("none");
    const forwardedText = JSON.stringify(forwardedContext);
    expect(forwardedText).toContain(source.slice(0, 100));
    expect(forwardedText).not.toContain('\\"status\\":\\"unknown\\"');
    expect(turnState.context.tokenBudget.snapshot().availableTokens).toBeGreaterThanOrEqual(0);
  });

  test("removes active tool declarations from native compaction requests", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
      ContextWindowTokens: 1_200,
      MaxModelOutputTokens: 64,
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model, 1_200, 0);
    const frame = createFrame(turnState, "compaction-tools-session", "compaction-tools-request");
    let forwardedContext: Context | undefined;
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model, context) => {
        forwardedContext = context;
        return completedStream(model, [{ type: "text", text: "Summary created." }]);
      }),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    await provider
      .streamSimple(
        model,
        {
          systemPrompt: "You are a context summarization assistant.",
          messages: [{ role: "user", content: "Summarize this history.", timestamp: 1 }],
          tools: [tool("ToolSearch")],
        },
        { cacheRetention: "none" },
      )
      .result();

    expect(getCurrentTools(forwardedContext?.messages ?? [])).toEqual([]);
  });

  test("keeps inline image bytes out of text token budgeting while forwarding the image", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true, Vision: true },
      Endpoint: "Responses",
      ContextWindowTokens: 211_616,
      MaxModelOutputTokens: 64,
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model, 211_616, 64);
    const frame = createFrame(turnState, "native-image-session", "native-image-request");
    let forwardedImage = false;
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model, context) => {
        const user = context.messages.find((message) => message.role === "user");
        forwardedImage =
          user?.role === "user" &&
          Array.isArray(user.content) &&
          user.content.some((part) => part.type === "image" && part.data.length === 1_800_000);
        return completedStream(model, [{ type: "text", text: "Image received." }]);
      }),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    const result = await provider
      .streamSimple(model, {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image." },
              { type: "image", mimeType: "image/png", data: "a".repeat(1_800_000) },
            ],
            timestamp: 1,
          },
        ],
        tools: [tool("ToolSearch")],
      })
      .result();
    expect(result.stopReason).toBe("stop");
    expect(forwardedImage).toBe(true);
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

  test("reports the provider request deadline as an error instead of caller cancellation", async () => {
    const modelProvider = createModelProvider({
      ToolPlanningMode: "native",
      Capabilities: { ToolCalling: true },
      Endpoint: "Responses",
      FirstTokenTimeoutMs: -1,
      MaxRequestMs: 10,
    });
    const projection = projectSeneraModelProviderToPi(modelProvider);
    const turnState = createTurnState(modelProvider.Model);
    const frame = createFrame(turnState, "provider-timeout-session", "provider-timeout-request");
    const provider = new AgentPiNativeToolProvider({
      projection,
      modelProvider,
      frame,
      apiStreams: nativeApiStreams((model, _context, options) => {
        const stream = createAssistantMessageEventStream();
        options?.signal?.addEventListener(
          "abort",
          () => {
            const failure = failureMessage(model, "upstream aborted after the provider deadline");
            stream.push({ type: "error", reason: "aborted", error: failure });
            stream.end(failure);
          },
          { once: true },
        );
        return stream;
      }),
    }).create();
    const model = provider.getModels()[0];
    if (!model) throw new Error("Expected the native Pi model.");

    const result = await provider
      .streamSimple(model, {
        messages: [{ role: "user", content: "Wait for the deadline.", timestamp: 1 }],
        tools: [tool("ToolSearch")],
      })
      .result();

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).not.toContain("upstream aborted after the provider deadline");
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
    systemPrompt: "Test agent system context.",
    userMessage: "Test native-provider request.",
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
    skillCatalog: { skills: [], fingerprint: "test" },
    nativeProviderToolNames: ["ToolSearch"],
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
  onRoute?: (route: "stream" | "simple") => void,
): AgentNativeToolApiStreams {
  const providerStreams: ProviderStreams = {
    stream: (model, context, options) => {
      onRoute?.("stream");
      return stream(model, context, options);
    },
    streamSimple: (model, context, options) => {
      onRoute?.("simple");
      return stream(model, context, options);
    },
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
