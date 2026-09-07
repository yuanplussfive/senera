import {
  AgentBamlStructuredOutputRunner,
  type AgentBamlModelRequest,
} from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import { b as baml } from "../BamlClient/baml_client/index.js";
import { AgentActionPlannerModelTransport } from "../ActionPlanner/AgentActionPlannerModelTransport.js";
import { projectPlainBamlRequestBody } from "../ActionPlanner/AgentActionPlannerPromptProjector.js";
import { createAgentBamlPromptBuilderRegistry } from "../ActionPlanner/AgentActionPlannerBamlPromptFactory.js";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentResidentSpeechBamlPromptInput } from "./AgentResidentSpeechPromptProjector.js";
import { createAgentPiPromptCacheOptions, projectAgentPiPromptCacheModel } from "../Pi/AgentPiPromptCache.js";

export class AgentResidentSpeechBamlClient {
  constructor(private readonly configuration: ResolvedAgentModelProviderConfig) {}

  async project(input: {
    readonly prompt: AgentResidentSpeechBamlPromptInput;
    readonly sessionId: string;
    readonly mode: "action_preface" | "final_response";
    readonly signal?: AbortSignal;
    readonly usageSink?: AgentModelUsageSink;
    readonly timingSink?: AgentModelTimingSink;
  }): Promise<unknown> {
    const transport = new AgentActionPlannerModelTransport(this.configuration, input.usageSink, input.timingSink, {
      omitOutputTokenLimit: true,
    });
    const runner = new AgentBamlStructuredOutputRunner({
      complete: (request, signal) => transport.complete(request, signal),
      maxRepairAttempts: 0,
    });
    const result = await runner.run({
      functionName: "ProjectResidentSpeech",
      request: await buildRequest(input.prompt, input.sessionId, input.mode, this.configuration),
      signal: input.signal,
      parse: (rawOutput) => baml.parse.ProjectResidentSpeech(rawOutput),
    });
    return result.value;
  }
}

async function buildRequest(
  input: AgentResidentSpeechBamlPromptInput,
  sessionId: string,
  mode: "action_preface" | "final_response",
  configuration: ResolvedAgentModelProviderConfig,
): Promise<AgentBamlModelRequest> {
  const request = await baml.request.ProjectResidentSpeech("{}", {
    clientRegistry: createAgentBamlPromptBuilderRegistry(),
  });
  const prompt = projectPlainBamlRequestBody(request.body.json() as Record<string, unknown>);
  return {
    requestId: "action-planner:pi.resident_speech.baml",
    step: 0,
    systemPrompt: [input.systemPrompt, prompt.systemPrompt].filter((value) => value.trim().length > 0).join("\n\n"),
    messages: input.conversation.map((message) => ({ ...message })),
    cache: createAgentPiPromptCacheOptions({
      phase: mode === "action_preface" ? "resident-speech-action-preface" : "resident-speech-final-response",
      sessionId,
      model: projectAgentPiPromptCacheModel(configuration),
      stablePrefix: { systemPrompt: [input.systemPrompt, prompt.systemPrompt].filter(Boolean).join("\n\n") },
    }),
  };
}
