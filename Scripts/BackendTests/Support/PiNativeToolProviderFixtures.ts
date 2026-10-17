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
import { AgentModelUsageLedger } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import type { AgentNativeToolApiStreams } from "../../../Source/AgentSystem/ModelEndpoints/AgentNativeToolApiStreams.js";
import { AgentPiMutableSessionFrame } from "../../../Source/AgentSystem/Pi/AgentPiCodingAgentSessionFrame.js";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import { AgentPiToolPlanCoordinator } from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";

export function createTurnState(
  model: string,
  contextWindowTokens = 16_384,
  outputReserveTokens = 1_024,
): AgentPiTurnState {
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

export function createFrame(
  turnState: AgentPiTurnState,
  sessionId: string,
  requestId: string,
): AgentPiMutableSessionFrame {
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

export function failureMessage(model: Model<Api>, errorMessage: string): AssistantMessage {
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

export function nativeApiStreams(
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

export function completedStream(
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

export function tool(name: string): NonNullable<Context["tools"]>[number] {
  return {
    name,
    description: `${name} test tool`,
    parameters: { type: "object", properties: {}, additionalProperties: false } as never,
  };
}
