import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";

export interface AgentImageVisionInput {
  readonly mime: string;
  readonly base64: string;
}

export interface AgentImageVisionRequest {
  provider: ResolvedAgentModelProviderConfig;
  systemPrompt: string;
  prompt: string;
  images: readonly AgentImageVisionInput[];
  signal?: AbortSignal;
}

export interface AgentImageVisionResponse {
  text: string;
  provider: {
    id: string;
    endpoint: string;
    model: string;
  };
}
