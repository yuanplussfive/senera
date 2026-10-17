import { z } from "zod";
import { AgentStructuredModelClient } from "../ModelEndpoints/AgentStructuredModelClient.js";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentResidentSpeechBamlPromptInput } from "./AgentResidentSpeechPromptProjector.js";
import { createAgentPiPromptCacheOptions, projectAgentPiPromptCacheModel } from "../Pi/AgentPiPromptCache.js";

const SpeechSchema = z.object({ utterance: z.string() }).strict();

export class AgentResidentSpeechBamlClient {
  constructor(private readonly configuration: ResolvedAgentModelProviderConfig) {}
  project(input: {
    readonly prompt: AgentResidentSpeechBamlPromptInput;
    readonly sessionId: string;
    readonly logicalCacheScope?: string;
    readonly mode: "action_preface" | "final_response";
    readonly signal?: AbortSignal;
    readonly usageSink?: AgentModelUsageSink;
    readonly timingSink?: AgentModelTimingSink;
  }): Promise<unknown> {
    const client = new AgentStructuredModelClient(this.configuration, "ResidentSpeech", {
      usageSink: input.usageSink,
      timingSink: input.timingSink,
    });
    return client.execute({
      contract: {
        name: "ProjectResidentSpeech",
        description: "Project the resident utterance for the current conversation.",
        schema: SpeechSchema,
        bamlFunction: "ProjectResidentSpeech",
      },
      systemPrompt: input.prompt.systemPrompt,
      userPrompt: "{}",
      messages: input.prompt.conversation,
      requestId: `${input.sessionId}:pi.resident_speech.baml`,
      signal: input.signal,
      cache: createAgentPiPromptCacheOptions({
        phase: input.mode === "action_preface" ? "resident-speech-action-preface" : "resident-speech-final-response",
        sessionId: input.sessionId,
        logicalCacheScope: input.logicalCacheScope,
        model: projectAgentPiPromptCacheModel(this.configuration),
      }),
    });
  }
}
