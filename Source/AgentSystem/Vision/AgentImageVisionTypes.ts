import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";

export interface AgentImageVisionRequest {
  provider: ResolvedAgentModelProviderConfig;
  systemPrompt: string;
  prompt: string;
  mime: string;
  base64: string;
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
