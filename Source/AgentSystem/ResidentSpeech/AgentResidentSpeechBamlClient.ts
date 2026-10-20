import { z } from "zod";
import { AgentStructuredModelClient } from "../ModelEndpoints/AgentStructuredModelClient.js";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentResidentSpeechBamlPromptInput } from "./AgentResidentSpeechPromptProjector.js";
import { createAgentPiPromptCacheOptions, projectAgentPiPromptCacheModel } from "../Pi/AgentPiPromptCache.js";

// BAML owns the wire decoder for ProjectResidentSpeech. The sidecar manifest
// remains the authoritative validation contract for the decoded value.
const ResidentSpeechBamlEnvelopeSchema = z.unknown();

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
        schema: ResidentSpeechBamlEnvelopeSchema,
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
