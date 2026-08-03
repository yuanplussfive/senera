import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentPiProviderProjection } from "./AgentPiTypes.js";

export interface AgentPiModelRuntimeOwnerOptions {
  readonly provider: AgentPiProviderProjection;
  readonly modelProvider: Pick<ResolvedAgentModelProviderConfig, "Id">;
  readonly createRuntime?: () => Promise<ModelRuntime>;
}

export interface AgentPiRegisteredModelRuntime {
  readonly runtime: ModelRuntime;
  readonly model: ReturnType<ModelRuntime["getModel"]>;
}

export class AgentPiModelRuntimeOwner {
  private pending?: Promise<AgentPiRegisteredModelRuntime>;

  constructor(private readonly options: AgentPiModelRuntimeOwnerOptions) {}

  get(): Promise<AgentPiRegisteredModelRuntime> {
    if (this.pending) return this.pending;
    const pending = this.create().catch((error) => {
      if (this.pending === pending) this.pending = undefined;
      throw error;
    });
    this.pending = pending;
    return pending;
  }

  private async create(): Promise<AgentPiRegisteredModelRuntime> {
    const runtime = await (this.options.createRuntime ?? defaultModelRuntimeFactory)();
    const model = this.options.provider.model;
    runtime.registerProvider(this.options.provider.providerId, {
      name: `Senera Pi Proxy (${this.options.modelProvider.Id})`,
      baseUrl: model.baseUrl,
      apiKey: "senera-local-proxy",
      api: model.api,
      authHeader: false,
      models: [
        {
          id: model.id,
          name: model.name,
          reasoning: model.reasoning,
          input: model.input,
          cost: model.cost,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
        },
      ],
    });
    return { runtime, model: runtime.getModel(this.options.provider.providerId, model.id) };
  }
}

function defaultModelRuntimeFactory(): Promise<ModelRuntime> {
  return ModelRuntime.create({ allowModelNetwork: false, modelsPath: null });
}
