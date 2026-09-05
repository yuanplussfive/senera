import { Type, type Tool } from "@earendil-works/pi-ai";
import { AgentRequiredNativeToolCall } from "../ModelEndpoints/AgentRequiredNativeToolCall.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import {
  AgentConversationBoundaryToolName,
  createAgentConversationBoundaryPrompt,
} from "./AgentConversationBoundaryPrompt.js";
import { createAgentTemporalMemoryPromptCache } from "./AgentTemporalMemoryPromptCache.js";
import type { AgentConversationBoundaryPromptInput } from "./AgentTemporalMemoryTypes.js";

const NativeBoundaryTool = {
  name: AgentConversationBoundaryToolName,
  description: "Classify whether a completed turn continues the open conversation segment.",
  parameters: Type.Object(
    {
      relation: Type.Union([Type.Literal("continue"), Type.Literal("boundary")]),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
      focus: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
} satisfies Tool;

export class AgentConversationBoundaryNativeClient {
  private readonly call: AgentRequiredNativeToolCall;

  constructor(
    private readonly configuration: ResolvedAgentModelProviderConfig,
    private readonly cacheScopeKey: string,
  ) {
    this.call = new AgentRequiredNativeToolCall(configuration, "ConversationBoundary");
  }

  classify(input: AgentConversationBoundaryPromptInput): Promise<unknown> {
    const prompt = createAgentConversationBoundaryPrompt(input);
    return this.call.execute({
      tool: NativeBoundaryTool,
      ...prompt,
      cache: createAgentTemporalMemoryPromptCache({
        scopeKey: this.cacheScopeKey,
        phase: "conversation-boundary",
        model: this.configuration.Model,
        systemPrompt: prompt.systemPrompt,
        contract: NativeBoundaryTool,
      }),
    });
  }
}
