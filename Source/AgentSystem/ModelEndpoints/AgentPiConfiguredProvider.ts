import { createProvider, type Model, type Provider, type ProviderStreams } from "@earendil-works/pi-ai";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentNativeToolApi } from "./AgentModelEndpointContract.js";
import { AgentNativeToolApiStreams } from "./AgentNativeToolApiStreams.js";
import { projectAgentNativeToolModel } from "./AgentNativeToolModelProjector.js";

export interface AgentPiConfiguredProvider {
  readonly model: Model<AgentNativeToolApi>;
  readonly provider: Provider<AgentNativeToolApi>;
}

export function createAgentPiConfiguredProvider(
  configuration: ResolvedAgentModelProviderConfig,
  purpose: string,
  apiStreams: Readonly<Record<AgentNativeToolApi, ProviderStreams>> = AgentNativeToolApiStreams,
): AgentPiConfiguredProvider {
  const model = projectAgentNativeToolModel(configuration);
  const provider = createProvider<AgentNativeToolApi>({
    id: model.provider,
    name: `Senera ${purpose} (${configuration.ProviderId})`,
    baseUrl: model.baseUrl,
    headers: model.headers,
    auth: {
      apiKey: {
        name: `Senera ${configuration.ProviderId} API key`,
        resolve: async () => ({
          auth: configuration.ApiKey ? { apiKey: configuration.ApiKey } : {},
          source: "Senera model configuration",
        }),
      },
    },
    models: [model],
    api: apiStreams,
  });
  return { model, provider };
}
