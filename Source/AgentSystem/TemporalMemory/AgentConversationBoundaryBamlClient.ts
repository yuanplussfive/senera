import { AgentBamlStructuredOutputRunner } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import { b as baml } from "../BamlClient/baml_client/index.js";
import { AgentActionPlannerModelTransport } from "../ActionPlanner/AgentActionPlannerModelTransport.js";
import { projectPlainBamlRequestBody } from "../ActionPlanner/AgentActionPlannerPromptProjector.js";
import { createAgentBamlPromptBuilderRegistry } from "../ActionPlanner/AgentActionPlannerBamlPromptFactory.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { createAgentConversationBoundaryPrompt } from "./AgentConversationBoundaryPrompt.js";
import { createAgentTemporalMemoryPromptCache } from "./AgentTemporalMemoryPromptCache.js";
import type { AgentConversationBoundaryPromptInput } from "./AgentTemporalMemoryTypes.js";

export class AgentConversationBoundaryBamlClient {
  constructor(
    private readonly configuration: ResolvedAgentModelProviderConfig,
    private readonly cacheScopeKey: string,
  ) {}

  async classify(input: AgentConversationBoundaryPromptInput): Promise<unknown> {
    const transport = new AgentActionPlannerModelTransport(this.configuration, undefined, undefined, {
      omitOutputTokenLimit: true,
    });
    const runner = new AgentBamlStructuredOutputRunner({
      complete: (request, signal) => transport.complete(request, signal),
      maxRepairAttempts: 0,
    });
    const promptInput = createAgentConversationBoundaryPrompt(input);
    const request = await baml.request.ClassifyConversationBoundary(promptInput.userPrompt, {
      clientRegistry: createAgentBamlPromptBuilderRegistry(),
    });
    const prompt = projectPlainBamlRequestBody(request.body.json() as Record<string, unknown>);
    const systemPrompt = [promptInput.systemPrompt, prompt.systemPrompt].filter(Boolean).join("\n\n");
    const result = await runner.run({
      functionName: "ClassifyConversationBoundary",
      request: {
        requestId: `conversation-boundary:${input.candidate.episodeUri}`,
        step: 0,
        systemPrompt,
        messages: prompt.messages,
        cache: createAgentTemporalMemoryPromptCache({
          scopeKey: this.cacheScopeKey,
          phase: "conversation-boundary",
          model: this.configuration.Model,
          systemPrompt,
          contract: "ClassifyConversationBoundary",
        }),
      },
      parse: (rawOutput) => baml.parse.ClassifyConversationBoundary(rawOutput),
    });
    return result.value;
  }
}
