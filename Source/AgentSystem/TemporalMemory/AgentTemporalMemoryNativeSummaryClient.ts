import { Type, type Tool } from "@earendil-works/pi-ai";
import { AgentRequiredNativeToolCall } from "../ModelEndpoints/AgentRequiredNativeToolCall.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import {
  createAgentTemporalMemorySummaryPrompt,
  AgentTemporalMemorySummaryToolName,
} from "./AgentTemporalMemorySummaryPrompt.js";
import { createAgentTemporalMemoryPromptCache } from "./AgentTemporalMemoryPromptCache.js";
import type { AgentTemporalMemorySummaryPromptInput } from "./AgentTemporalMemoryTypes.js";

const NativeSummaryTool = {
  name: AgentTemporalMemorySummaryToolName,
  description: "Commit one source-faithful conversation segment, day, or month memory digest.",
  parameters: Type.Object(
    {
      summary: Type.String({ minLength: 1 }),
      topics: Type.Array(Type.String({ minLength: 1 })),
      openLoops: Type.Array(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
} satisfies Tool;

export class AgentTemporalMemoryNativeSummaryClient {
  private readonly call: AgentRequiredNativeToolCall;

  constructor(
    private readonly configuration: ResolvedAgentModelProviderConfig,
    private readonly cacheScopeKey: string,
  ) {
    this.call = new AgentRequiredNativeToolCall(configuration, "TemporalMemory");
  }

  summarize(input: AgentTemporalMemorySummaryPromptInput): Promise<unknown> {
    const prompt = createAgentTemporalMemorySummaryPrompt(input);
    return this.call.execute({
      tool: NativeSummaryTool,
      ...prompt,
      cache: createAgentTemporalMemoryPromptCache({
        scopeKey: this.cacheScopeKey,
        phase: "digest-summary",
        model: this.configuration.Model,
        systemPrompt: prompt.systemPrompt,
        contract: NativeSummaryTool,
      }),
    });
  }
}
