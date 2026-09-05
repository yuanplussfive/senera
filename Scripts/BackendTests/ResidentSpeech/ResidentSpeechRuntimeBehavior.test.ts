import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentResidentSpeechRuntime } from "../../../Source/AgentSystem/ResidentSpeech/AgentResidentSpeechRuntime.js";
import {
  AgentResidentActionSpeechCapability,
  AgentResidentFinalSpeechCapability,
  type AgentResidentSpeechFocus,
  type AgentResidentSpeechNativeContinuation,
} from "../../../Source/AgentSystem/ResidentSpeech/AgentResidentSpeechTypes.js";
import { AgentResidentSpeechNativeClient } from "../../../Source/AgentSystem/ResidentSpeech/AgentResidentSpeechNativeClient.js";
import { AgentResidentSpeechBamlClient } from "../../../Source/AgentSystem/ResidentSpeech/AgentResidentSpeechBamlClient.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import { AgentPiNativeToolBridgeName } from "../../../Source/AgentSystem/Pi/AgentPiNativeToolBridge.js";

type NativeProjectionRequest = Parameters<AgentResidentSpeechNativeClient["project"]>[0];
type BamlProjectionRequest = Parameters<AgentResidentSpeechBamlClient["project"]>[0];

describe("resident speech runtime", () => {
  test("projects one native roleplay tool-preface while preserving the pending tool call", async () => {
    const registry = createRegistry();
    let nativeRequest: NativeProjectionRequest | undefined;
    const nativeProject = vi.fn(async (request: NativeProjectionRequest) => {
      nativeRequest = request;
      return nativeInvocation("ResidentActionSpeak", "我先去看看呀。");
    });
    const bamlProject = vi.fn();
    const runtime = new AgentResidentSpeechRuntime({
      registry,
      modelProvider: createModelProvider({ ToolPlanningMode: "native", Capabilities: { ToolCalling: true } }),
      nativeClient: { project: nativeProject },
      bamlClient: { project: bamlProject },
    });
    const message = toolPrefaceMessage();
    const context = conversationContext();
    const nativeContinuation = createNativeContinuation();
    const focus = actionFocus(message, "确认明天的安排");

    const projected = await runtime.project({
      context,
      message,
      focus,
      spokenUtterances: [],
      enabled: true,
      sessionId: "resident-session",
      nativeContinuation,
    });

    expect(projected.content).toEqual([{ type: "text", text: "我先去看看呀。" }, message.content[1]]);
    expect(nativeProject).toHaveBeenCalledOnce();
    expect(bamlProject).not.toHaveBeenCalled();
    expect(nativeRequest?.context.messages.slice(0, context.messages.length)).toEqual(context.messages);
    expect(nativeRequest?.context.messages.at(-1)).toMatchObject({ role: "user" });
    expect(nativeRequest?.context.messages.at(-1)?.content).toContain("确认明天的安排");
    expect(nativeRequest?.context.messages.at(-1)?.content).toContain("Let me check tomorrow's schedule.");
    expect(nativeRequest?.context.systemPrompt).toBe(context.systemPrompt);
    expect(nativeRequest?.context.tools).toEqual(context.tools);
    expect(nativeRequest?.continuation).toBe(nativeContinuation);
  });

  test("uses the BAML projection path with attributed history and action focus", async () => {
    const registry = createRegistry();
    const nativeProject = vi.fn();
    let bamlRequest: BamlProjectionRequest | undefined;
    const bamlProject = vi.fn(async (request: BamlProjectionRequest) => {
      bamlRequest = request;
      return { utterance: "等我瞄一眼明天的课表。" };
    });
    const runtime = new AgentResidentSpeechRuntime({
      registry,
      modelProvider: createModelProvider({ ToolPlanningMode: "baml" }),
      nativeClient: { project: nativeProject },
      bamlClient: { project: bamlProject },
    });

    const projected = await runtime.project({
      context: conversationContext(),
      message: toolPrefaceMessage(),
      focus: actionFocus(toolPrefaceMessage(), "确认明天的安排"),
      spokenUtterances: [],
      enabled: true,
      sessionId: "resident-baml-session",
    });

    expect(readText(projected)).toBe("等我瞄一眼明天的课表。");
    expect(nativeProject).not.toHaveBeenCalled();
    expect(bamlRequest?.prompt.systemPrompt).toContain("<persona>失语症</persona>");
    expect(bamlRequest?.prompt.systemPrompt).toContain("<resident_speech_contract");
    expect(bamlRequest?.prompt.conversation.map((entry) => entry.role)).toEqual(["user"]);
    expect(bamlRequest?.prompt.conversation[0]?.content).toContain("action_preface");
    expect(bamlRequest?.prompt.conversation[0]?.content).toContain("确认明天的安排");
  });

  test("projects a completed final response through the dedicated final speech contract", async () => {
    const registry = createRegistry();
    let nativeRequest: NativeProjectionRequest | undefined;
    const runtime = new AgentResidentSpeechRuntime({
      registry,
      modelProvider: createModelProvider({ ToolPlanningMode: "native", Capabilities: { ToolCalling: true } }),
      nativeClient: {
        project: async (request) => {
          nativeRequest = request;
          return nativeInvocation("ResidentFinalSpeak", "明天有早读……今晚不熬啦TvT");
        },
      },
      bamlClient: { project: vi.fn() },
    });
    const message = assistantMessage(
      [{ type: "text", text: "You have morning study tomorrow, so I should not stay up late." }],
      "stop",
    );

    const projected = await runtime.project({
      context: conversationContext(),
      message,
      focus: finalFocus(message),
      spokenUtterances: [{ mode: "action_preface", content: "我先看看明天的安排呀。" }],
      enabled: true,
      sessionId: "resident-final-session",
      nativeContinuation: createNativeContinuation(),
    });

    expect(readText(projected)).toBe("明天有早读……今晚不熬啦TvT");
    expect(nativeRequest?.context.messages.at(-1)?.content).toContain("final_response");
    expect(nativeRequest?.context.messages.at(-1)?.content).toContain("我先看看明天的安排呀。");
    expect(nativeRequest?.context.messages.at(-1)?.content).toContain("do not restate");
    expect(nativeRequest?.context.messages.at(-1)?.content).not.toContain("pending_actions");
  });

  test("uses each owning conversation as the exact native prefix without a second resident transcript", async () => {
    const requests: NativeProjectionRequest[] = [];
    const utterances = ["我先看看明天的安排呀。", "明天有早读……今晚不熬啦TvT"];
    const runtime = new AgentResidentSpeechRuntime({
      registry: createRegistry(),
      modelProvider: createModelProvider({ ToolPlanningMode: "native", Capabilities: { ToolCalling: true } }),
      nativeClient: {
        project: async (request) => {
          requests.push(request);
          return nativeInvocation(
            requests.length === 1 ? "ResidentActionSpeak" : "ResidentFinalSpeak",
            utterances[requests.length - 1]!,
          );
        },
      },
      bamlClient: { project: vi.fn() },
    });
    const initialContext = conversationContext();
    const nativeContinuation = createNativeContinuation();
    const preface = await runtime.project({
      context: initialContext,
      message: toolPrefaceMessage(),
      focus: actionFocus(toolPrefaceMessage()),
      spokenUtterances: [],
      enabled: true,
      sessionId: "resident-append-session",
      nativeContinuation,
    });
    const result = {
      role: "toolResult" as const,
      toolCallId: "call-1",
      toolName: "CheckSchedule",
      content: [{ type: "text" as const, text: "明天 08:00 有早读" }],
      isError: false,
      timestamp: 5,
    };
    const finalDraft = assistantMessage([{ type: "text", text: "Morning study begins at eight tomorrow." }], "stop");

    await runtime.project({
      context: { ...initialContext, messages: [...initialContext.messages, preface, result] },
      message: finalDraft,
      focus: finalFocus(finalDraft),
      spokenUtterances: [{ mode: "action_preface", content: readText(preface) }],
      enabled: true,
      sessionId: "resident-append-session",
      nativeContinuation,
    });

    expect(requests).toHaveLength(2);
    const firstMessages = requests[0]?.context.messages ?? [];
    const secondMessages = requests[1]?.context.messages ?? [];
    expect(firstMessages.slice(0, initialContext.messages.length)).toEqual(initialContext.messages);
    expect(secondMessages.slice(0, initialContext.messages.length + 2)).toEqual([
      ...initialContext.messages,
      preface,
      result,
    ]);
    expect(secondMessages.at(-1)?.content).toContain("Morning study begins at eight tomorrow.");
    expect(requests[1]?.context.tools).toEqual(requests[0]?.context.tools);
    expect(requests[0]?.continuation).toBe(nativeContinuation);
    expect(requests[1]?.continuation).toBe(nativeContinuation);
  });

  test("does not invoke projection when the owning provider disables it", async () => {
    const nativeProject = vi.fn(async () => nativeInvocation("ResidentActionSpeak", "unused"));
    const runtime = new AgentResidentSpeechRuntime({
      registry: createRegistry(),
      modelProvider: createModelProvider({ ToolPlanningMode: "native", Capabilities: { ToolCalling: true } }),
      nativeClient: { project: nativeProject },
      bamlClient: { project: vi.fn() },
    });
    const context = conversationContext();
    const preface = toolPrefaceMessage();

    await expect(
      runtime.project({
        context,
        message: preface,
        focus: actionFocus(preface),
        spokenUtterances: [],
        enabled: false,
        sessionId: "resident-disabled-session",
      }),
    ).resolves.toBe(preface);
    expect(nativeProject).not.toHaveBeenCalled();
  });

  test("rejects an invalid projection instead of retaining the mechanical draft", async () => {
    const requests: NativeProjectionRequest[] = [];
    const runtime = new AgentResidentSpeechRuntime({
      registry: createRegistry(),
      modelProvider: createModelProvider({ ToolPlanningMode: "native", Capabilities: { ToolCalling: true } }),
      nativeClient: {
        project: async (request) => {
          requests.push(request);
          return requests.length === 1
            ? nativeInvocation("ResidentActionSpeak", "")
            : nativeInvocation("ResidentActionSpeak", "我去看看呀。");
        },
      },
      bamlClient: { project: vi.fn() },
    });

    await expect(
      runtime.project({
        context: conversationContext(),
        message: toolPrefaceMessage(),
        focus: actionFocus(toolPrefaceMessage()),
        spokenUtterances: [],
        enabled: true,
        sessionId: "resident-invalid-session",
        nativeContinuation: createNativeContinuation(),
      }),
    ).rejects.toThrow("ResidentActionSpeak");

    await expect(
      runtime.project({
        context: conversationContext(),
        message: toolPrefaceMessage(),
        focus: actionFocus(toolPrefaceMessage()),
        spokenUtterances: [],
        enabled: true,
        sessionId: "resident-invalid-session",
        nativeContinuation: createNativeContinuation(),
      }),
    ).resolves.toMatchObject({ content: [expect.objectContaining({ text: "我去看看呀。" }), expect.anything()] });
    expect(requests[1]?.context.messages).toEqual(requests[0]?.context.messages);
  });

  test("does not retain native projection history across calls or session resets", async () => {
    const requests: NativeProjectionRequest[] = [];
    const runtime = new AgentResidentSpeechRuntime({
      registry: createRegistry(),
      modelProvider: createModelProvider({ ToolPlanningMode: "native", Capabilities: { ToolCalling: true } }),
      nativeClient: {
        project: async (request) => {
          requests.push(request);
          return nativeInvocation("ResidentActionSpeak", "我去看看呀。");
        },
      },
      bamlClient: { project: vi.fn() },
    });

    await runtime.project({
      context: conversationContext(),
      message: toolPrefaceMessage(),
      focus: actionFocus(toolPrefaceMessage()),
      spokenUtterances: [],
      enabled: true,
      sessionId: "resident-reset-session",
      nativeContinuation: createNativeContinuation(),
    });
    runtime.resetSession("resident-reset-session");
    await runtime.project({
      context: conversationContext(),
      message: toolPrefaceMessage(),
      focus: actionFocus(toolPrefaceMessage()),
      spokenUtterances: [],
      enabled: true,
      sessionId: "resident-reset-session",
      nativeContinuation: createNativeContinuation(),
    });

    expect(requests[1]?.context.messages).toEqual(requests[0]?.context.messages);
  });
});

function createRegistry(): AgentExtensionRegistry {
  const registry = new AgentExtensionRegistry();
  const owner = {
    kind: "system" as const,
    name: "resident-speech",
    title: "Resident Speech",
    description: "Resident speech sidecar",
    rootPath: "System/Extensions/resident-speech",
    revision: "test",
    trusted: true,
    requiresApproval: false,
  };
  registry.registerSidecarToolExtension(owner, [
    {
      owner,
      name: "ResidentActionSpeak",
      capability: AgentResidentActionSpeechCapability,
      description: "Commit the resident's next action preface.",
      instructions: "Preserve intent and speak naturally before the pending action.",
      inputSchema: {
        type: "object",
        properties: { utterance: { type: "string", minLength: 1 } },
        required: ["utterance"],
        additionalProperties: false,
      },
    },
    {
      owner,
      name: "ResidentFinalSpeak",
      capability: AgentResidentFinalSpeechCapability,
      description: "Commit the resident's final response after actions complete.",
      instructions: "Deliver only new grounded results without repeating prior visible speech.",
      inputSchema: {
        type: "object",
        properties: { utterance: { type: "string", minLength: 1 } },
        required: ["utterance"],
        additionalProperties: false,
      },
    },
  ]);
  return registry;
}

function conversationContext(): Context {
  return {
    systemPrompt: "<persona>失语症</persona>",
    messages: [
      { role: "user", content: "今天画画了吗？", timestamp: 1 },
      assistantMessage([{ type: "text", text: "画了呀。" }], "stop"),
      {
        role: "toolResult",
        toolCallId: "earlier-call",
        toolName: "EarlierTool",
        content: [{ type: "text", text: "完成" }],
        isError: false,
        timestamp: 3,
      },
      { role: "user", content: "那明天有安排吗？", timestamp: 4 },
    ],
    tools: [
      {
        name: AgentPiNativeToolBridgeName,
        description: "Call one discovered tool.",
        parameters: {
          type: "object",
          properties: {
            tool: { type: "string" },
            arguments: { type: "object", additionalProperties: true },
          },
          required: ["tool", "arguments"],
          additionalProperties: false,
        },
      },
    ],
  };
}

function createNativeContinuation(): AgentResidentSpeechNativeContinuation {
  return {
    stream: () => {
      throw new Error("The mocked native client owns projection in this test.");
    },
  };
}

function nativeInvocation(tool: "ResidentActionSpeak" | "ResidentFinalSpeak", utterance: string) {
  return {
    tool,
    arguments: { utterance },
  };
}

function actionFocus(message: AssistantMessage, purpose?: string): AgentResidentSpeechFocus {
  const call = message.content.find(
    (block): block is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => block.type === "toolCall",
  );
  if (!call) throw new Error("Action focus requires a tool call.");
  return {
    mode: "action_preface",
    draft: readText(message),
    actions: [
      {
        callId: call.id,
        name: call.name,
        arguments: call.arguments,
        ...(purpose ? { purpose } : {}),
      },
    ],
  };
}

function finalFocus(message: AssistantMessage): AgentResidentSpeechFocus {
  return { mode: "final_response", draft: readText(message), actions: [] };
}

function toolPrefaceMessage(): AssistantMessage {
  return assistantMessage(
    [
      { type: "text", text: "Let me check tomorrow's schedule." },
      { type: "toolCall", id: "call-1", name: "CheckSchedule", arguments: { date: "tomorrow" } },
    ],
    "toolUse",
  );
}

function assistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-responses",
    provider: "test",
    model: "test-model",
    content,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 2,
  };
}

function readText(message: AssistantMessage): string {
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}
