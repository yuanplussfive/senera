import type {
  AgentDelegationRuntimeProfileConfig,
  AgentSystemConfig,
  ResolvedAgentDelegationConfig,
  ResolvedAgentDelegationRuntimeProfileConfig,
  ResolvedAgentLoopConfig,
} from "../Types/AgentConfigTypes.js";
import { AgentDefaults } from "./AgentDefaultValues.js";
import { readOptionalConfiguredString } from "./AgentDefaultHelpers.js";

export function resolveAgentDelegationDefaults(
  configured: AgentSystemConfig["AgentDelegation"] | undefined,
  baseLoop: ResolvedAgentLoopConfig,
): ResolvedAgentDelegationConfig {
  const runtimeProfileDefaults = resolveRuntimeProfileDefaults(
    baseLoop,
    undefined,
    configured?.RuntimeProfileDefaults,
  );
  const runtimeProfiles = Object.fromEntries(
    Object.entries(configured?.RuntimeProfiles ?? {}).map(([name, profile]) => [
      name,
      resolveRuntimeProfile(name, baseLoop, runtimeProfileDefaults, profile),
    ]),
  );

  return {
    RuntimeProfileDefaults: runtimeProfileDefaults,
    RuntimeProfiles: runtimeProfiles,
    Templates: {
      ...AgentDefaults.AgentDelegation.Templates,
      ...configured?.Templates,
    },
    Merge: {
      ...configured?.Merge,
    },
  };
}

export function resolveRuntimeProfileDefaults(
  baseLoop: ResolvedAgentLoopConfig,
  base: Omit<ResolvedAgentDelegationRuntimeProfileConfig, "Name"> | undefined,
  configured: AgentDelegationRuntimeProfileConfig | undefined,
) {
  if (!base && !configured) {
    return undefined;
  }

  return {
    Mode: configured?.Mode ?? base?.Mode ?? "directModel",
    ModelProviderId: readOptionalConfiguredString(
      configured?.ModelProviderId,
      base?.ModelProviderId,
    ),
    AgentLoop: {
      ...baseLoop,
      ...base?.AgentLoop,
      ...configured?.AgentLoop,
    },
  };
}

export function resolveRuntimeProfile(
  name: string,
  baseLoop: ResolvedAgentLoopConfig,
  defaults: Omit<ResolvedAgentDelegationRuntimeProfileConfig, "Name"> | undefined,
  configured: AgentDelegationRuntimeProfileConfig,
): ResolvedAgentDelegationRuntimeProfileConfig {
  return {
    Name: name,
    Mode: configured.Mode ?? defaults?.Mode ?? "directModel",
    ModelProviderId: readOptionalConfiguredString(
      configured.ModelProviderId,
      defaults?.ModelProviderId,
    ),
    AgentLoop: {
      ...baseLoop,
      ...defaults?.AgentLoop,
      ...configured.AgentLoop,
    },
  };
}
