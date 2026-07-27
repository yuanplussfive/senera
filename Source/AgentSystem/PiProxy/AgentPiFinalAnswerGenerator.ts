import type { AgentBamlModelRequest } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import type { AgentLanguageModelStream } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentPiFinalAnswerInput } from "./AgentPiAssistantMessageTypes.js";

export interface AgentPiFinalAnswerStreamOptions {
  requestId: string;
  step: number;
  signal?: AbortSignal;
}

export interface AgentPiFinalAnswerGeneratorPort {
  stream(input: AgentPiFinalAnswerInput, options: AgentPiFinalAnswerStreamOptions): Promise<AgentLanguageModelStream>;
}

export interface AgentPiFinalAnswerGeneratorOptions {
  promptBuilder: {
    build(input: AgentPiFinalAnswerInput): Promise<AgentBamlModelRequest>;
  };
  transport: {
    stream(
      request: AgentBamlModelRequest,
      signal?: AbortSignal,
      usageStage?: string,
    ): Promise<AgentLanguageModelStream>;
  };
}

export class AgentPiFinalAnswerGenerator implements AgentPiFinalAnswerGeneratorPort {
  constructor(private readonly options: AgentPiFinalAnswerGeneratorOptions) {}

  async stream(
    input: AgentPiFinalAnswerInput,
    options: AgentPiFinalAnswerStreamOptions,
  ): Promise<AgentLanguageModelStream> {
    const prompt = await this.options.promptBuilder.build(input);
    return this.options.transport.stream(
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
