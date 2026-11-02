import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentPiMutableSessionFrame } from "./AgentPiCodingAgentSessionFrame.js";
import { AgentPiBamlToolProvider } from "./AgentPiBamlToolProvider.js";
import { AgentPiNativeToolProvider } from "./AgentPiNativeToolProvider.js";
import type { AgentPiPlanningCompilerFactory } from "./AgentPiPlanningCompiler.js";
import type { AgentPiProviderProjection } from "./AgentPiTypes.js";

export interface AgentPiModelRuntimeOwnerOptions {
  readonly provider: AgentPiProviderProjection;
  readonly modelProvider: ResolvedAgentModelProviderConfig;
  readonly compilerFactory: AgentPiPlanningCompilerFactory;
  readonly createRuntime?: () => Promise<ModelRuntime>;
}

export interface AgentPiRegisteredModelRuntime {
  readonly runtime: ModelRuntime;
  readonly model: NonNullable<ReturnType<ModelRuntime["getModel"]>>;
}

/** Owns the selected tool-planning provider and model runtime for one pooled Pi session. */
export class AgentPiModelRuntimeOwner {
  private pending?: Promise<AgentPiRegisteredModelRuntime>;

  constructor(
    private readonly options: AgentPiModelRuntimeOwnerOptions,
    private readonly frame: AgentPiMutableSessionFrame,
  ) {}

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
    const provider =
      this.options.provider.toolPlanningMode === "native"
        ? new AgentPiNativeToolProvider({
            projection: this.options.provider,
            modelProvider: this.options.modelProvider,
            frame: this.frame,
          }).create()
        : new AgentPiBamlToolProvider({
            projection: this.options.provider,
            frame: this.frame,
            compilerFactory: this.options.compilerFactory,
          }).create();
    runtime.registerNativeProvider(provider);
    const model = runtime.getModel(this.options.provider.providerId, this.options.provider.model.id);
    if (!model) throw new Error("Senera Pi model was not registered in Pi Coding Agent.");
    return { runtime, model };
  }
}

function defaultModelRuntimeFactory(): Promise<ModelRuntime> {
  return ModelRuntime.create({
    allowModelNetwork: false,
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
}
