import type {
  AgentSystemConfig,
  ResolvedAgentDelegationConfig,
  ResolvedAgentDelegationRuntimeProfileConfig,
} from "../Types/AgentConfigTypes.js";
import { resolveAgentDefaults } from "./AgentDefaultResolver.js";
import { resolveRuntimeProfile, resolveRuntimeProfileDefaults } from "./AgentDelegationProfileCore.js";
import { resolveAgentLoopConfig } from "./AgentRuntimeDefaults.js";

export function resolveAgentDelegationConfig(
  config: AgentSystemConfig,
): ResolvedAgentDelegationConfig {
  const baseLoop = resolveAgentLoopConfig(config);
  const defaults = resolveAgentDefaults(config).AgentDelegation;
  const configured = config.AgentDelegation;
  const runtimeProfileDefaults = resolveRuntimeProfileDefaults(
    baseLoop,
    defaults.RuntimeProfileDefaults,
    configured?.RuntimeProfileDefaults,
  );
  const profileEntries = Object.entries({
    ...defaults.RuntimeProfiles,
    ...(configured?.RuntimeProfiles ?? {}),
  });

  return {
    RuntimeProfileDefaults: runtimeProfileDefaults,
    RuntimeProfiles: Object.fromEntries(profileEntries.map(([name, profile]) => [
      name,
      resolveRuntimeProfile(name, baseLoop, runtimeProfileDefaults, profile),
    ])),
    Templates: {
      ...defaults.Templates,
      ...configured?.Templates,
    },
    Merge: {
      ...defaults.Merge,
      ...configured?.Merge,
    },
  };
}

export function resolveAgentDelegationRuntimeProfile(
  config: AgentSystemConfig,
  profileName: string,
): ResolvedAgentDelegationRuntimeProfileConfig {
  const delegation = resolveAgentDelegationConfig(config);
  const profile = delegation.RuntimeProfiles[profileName];
  if (profile) {
    return profile;
  }

  if (delegation.RuntimeProfileDefaults) {
    return {
      Name: profileName,
      ...delegation.RuntimeProfileDefaults,
    };
  }

  throw new Error(`子代理 RuntimeProfile 没有配置：${profileName}`);
}
