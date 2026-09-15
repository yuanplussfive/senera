import type { AgentPresetActivationRuntime } from "../Presets/AgentPresetActivationRuntime.js";
import type { AgentPersonaPreset, AgentPresetWorldPackageDescriptor } from "../Presets/AgentPresetTypes.js";
import type { AgentWorldPackageLoader } from "./AgentWorldPackageLoader.js";

/** Applies only the declarative world packages explicitly bound to the active persona. */
export class AgentPresetWorldActivationRuntime implements AgentPresetActivationRuntime {
  private synchronizationTail: Promise<void> = Promise.resolve();

  constructor(private readonly packages: AgentWorldPackageLoader) {}

  catalog(): Promise<readonly AgentPresetWorldPackageDescriptor[]> {
    return this.packages.catalog();
  }

  synchronize(preset: AgentPersonaPreset | null): Promise<void> {
    const packageIds = [...(preset?.worldPackageIds ?? [])];
    const synchronization = this.synchronizationTail.then(async () => {
      await this.packages.synchronize(packageIds);
    });
    this.synchronizationTail = synchronization.then(
      () => undefined,
      () => undefined,
    );
    return synchronization;
  }
}
