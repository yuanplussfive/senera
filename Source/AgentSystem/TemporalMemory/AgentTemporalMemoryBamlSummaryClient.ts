import { AgentBamlStructuredOutputRunner } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import { b as baml } from "../BamlClient/baml_client/index.js";
import { AgentActionPlannerModelTransport } from "../ActionPlanner/AgentActionPlannerModelTransport.js";
import { projectPlainBamlRequestBody } from "../ActionPlanner/AgentActionPlannerPromptProjector.js";
import { createAgentBamlPromptBuilderRegistry } from "../ActionPlanner/AgentActionPlannerBamlPromptFactory.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { createAgentTemporalMemorySummaryPrompt } from "./AgentTemporalMemorySummaryPrompt.js";
import { createAgentTemporalMemoryPromptCache } from "./AgentTemporalMemoryPromptCache.js";
import type { AgentTemporalMemorySummaryPromptInput } from "./AgentTemporalMemoryTypes.js";

export class AgentTemporalMemoryBamlSummaryClient {
  constructor(
    private readonly configuration: ResolvedAgentModelProviderConfig,
    private readonly cacheScopeKey: string,
  ) {}

  async summarize(input: AgentTemporalMemorySummaryPromptInput): Promise<unknown> {
    const transport = new AgentActionPlannerModelTransport(this.configuration, undefined, undefined, {
      omitOutputTokenLimit: true,
    });
    const runner = new AgentBamlStructuredOutputRunner({
      complete: (request, signal) => transport.complete(request, signal),
      maxRepairAttempts: 0,
    });
    const promptInput = createAgentTemporalMemorySummaryPrompt(input);
    const request = await baml.request.SummarizeTemporalMemory(promptInput.userPrompt, {
      clientRegistry: createAgentBamlPromptBuilderRegistry(),
    });
    const prompt = projectPlainBamlRequestBody(request.body.json() as Record<string, unknown>);
    const systemPrompt = [promptInput.systemPrompt, prompt.systemPrompt].filter(Boolean).join("\n\n");
    const result = await runner.run({
      functionName: "SummarizeTemporalMemory",
      request: {
        requestId: "temporal-memory:summary",
        step: 0,
        systemPrompt,
        messages: prompt.messages,
        cache: createAgentTemporalMemoryPromptCache({
          scopeKey: this.cacheScopeKey,
          phase: "digest-summary",
          model: this.configuration.Model,
          systemPrompt,
          contract: "SummarizeTemporalMemory",
        }),
      },
      parse: (rawOutput) => baml.parse.SummarizeTemporalMemory(rawOutput),
    });
    return result.value;
  }
}
