import { Type, type Tool } from "@earendil-works/pi-ai";
import { AgentRequiredNativeToolCall } from "../ModelEndpoints/AgentRequiredNativeToolCall.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import {
  createAgentTemporalMemorySummaryPrompt,
  AgentTemporalMemorySummaryToolName,
} from "./AgentTemporalMemorySummaryPrompt.js";
import { createAgentTemporalMemoryPromptCache } from "./AgentTemporalMemoryPromptCache.js";
import type { AgentTemporalMemorySummaryPromptInput } from "./AgentTemporalMemoryTypes.js";

const TextPart = Type.Union([
  Type.Object({ kind: Type.Literal("text"), text: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  Type.Object(
    {
      kind: Type.Literal("identity"),
      role: Type.Union([Type.Literal("user"), Type.Literal("resident")]),
    },
    { additionalProperties: false },
  ),
]);
const TextParts = Type.Array(TextPart, { minItems: 1 });

const NativeSummaryTool = {
  name: AgentTemporalMemorySummaryToolName,
  description: "Commit one source-faithful conversation segment, day, or month memory digest.",
  parameters: Type.Object(
    {
      summary: TextParts,
      topics: Type.Array(TextParts),
      openLoops: Type.Array(TextParts),
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
