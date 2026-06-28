import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { AgentBamlModelRequest } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import { createModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import { createModelEndpoint } from "../ModelEndpoints/ModelEndpointTypes.js";
import type { TextGenerationEndpoint } from "../ModelEndpoints/ModelEndpointTypes.js";
import { ModelHttpClient } from "../ModelEndpoints/ModelHttpClient.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";

export class AgentActionPlannerModelTransport {
  private readonly endpoint: TextGenerationEndpoint;

  constructor(private readonly provider: ResolvedAgentModelProviderConfig) {
    this.endpoint = createModelEndpoint(provider.Endpoint, {
      config: provider,
      http: new ModelHttpClient(
        provider,
        createModelProviderMetadata(provider),
      ),
    });
  }

  async complete(request: AgentBamlModelRequest, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const stream = await this.endpoint.stream({
      ...request,
      signal,
    });
    let text = "";
    const abort = (): void => stream.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      for await (const chunk of stream) {
        throwIfAborted(signal);
        text = chunk.accumulatedText;
      }
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    throwIfAborted(signal);
    return text;
  }
}
