import { AgentActionPlannerBamlPromptFactory } from "../ActionPlanner/AgentActionPlannerBamlPromptFactory.js";
import { AgentActionPlannerModelTransport } from "../ActionPlanner/AgentActionPlannerModelTransport.js";
import { resolvePlannerProvider } from "../ActionPlanner/AgentActionPlannerProviderResolver.js";
import type { AgentLanguageModelStream } from "../ModelEndpoints/AgentLanguageModel.js";
import type {
  ResolvedAgentActionPlannerClientConfig,
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";
import type { AgentPiFinalAnswerInput } from "./AgentPiAssistantMessageTypes.js";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";

export interface AgentPiFinalAnswerStreamOptions {
  requestId: string;
  step: number;
  signal?: AbortSignal;
}

export interface AgentPiFinalAnswerGeneratorPort {
  stream(input: AgentPiFinalAnswerInput, options: AgentPiFinalAnswerStreamOptions): Promise<AgentLanguageModelStream>;
}

export class AgentPiFinalAnswerGenerator implements AgentPiFinalAnswerGeneratorPort {
  private readonly prompts = new AgentActionPlannerBamlPromptFactory();
  private readonly transport: AgentActionPlannerModelTransport;

  constructor(
    model: ResolvedAgentModelProviderConfig,
    client: ResolvedAgentActionPlannerClientConfig,
    usageSink?: AgentModelUsageSink,
    timingSink?: AgentModelTimingSink,
  ) {
    this.transport = new AgentActionPlannerModelTransport(resolvePlannerProvider(model, client), usageSink, timingSink);
  }

  async stream(
    input: AgentPiFinalAnswerInput,
    options: AgentPiFinalAnswerStreamOptions,
  ): Promise<AgentLanguageModelStream> {
    const prompt = await this.prompts.buildPrompt({
      functionName: "GeneratePiFinalAnswer",
      input,
    });
    return this.transport.stream(
      {
        ...prompt,
        requestId: options.requestId,
        step: options.step,
      },
      options.signal,
      prompt.requestId.replace(/^action-planner:/, ""),
    );
  }
}
