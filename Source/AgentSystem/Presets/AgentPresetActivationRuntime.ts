import type { AgentPersonaPreset, AgentPresetWorldPackageDescriptor } from "./AgentPresetTypes.js";

/** Bridges persona activation to an independently owned resident-world runtime. */
export interface AgentPresetActivationRuntime {
  catalog(): Promise<readonly AgentPresetWorldPackageDescriptor[]>;
  synchronize(preset: AgentPersonaPreset | null): Promise<void>;
}
