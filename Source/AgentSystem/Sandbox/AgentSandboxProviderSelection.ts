import { accessSync, constants } from "node:fs";
import type { AgentSandboxProviderPreference } from "../Types/AgentRuntimeConfigTypes.js";
import { readAgentSandboxDistributionContract } from "./AgentSandboxDistributionContract.js";
import { AgentSandboxRuntimeProviders, type AgentSandboxRuntimeProvider } from "./AgentSandboxRuntimeTypes.js";
import {
  findAgentSandboxProviderCandidate,
  readAgentSandboxProviderRegistry,
  type AgentSandboxProviderCandidate,
  type AgentSandboxProviderRequirement,
} from "./ProviderRegistry/AgentSandboxProviderRegistry.js";

export interface AgentSandboxProviderCapabilities {
  microsandboxHost?: boolean;
  dockerEngine?: boolean;
  registeredDockerRuntimes?: readonly string[];
}

export interface AgentSandboxProviderSelectionInput {
  preference: AgentSandboxProviderPreference;
  platform?: NodeJS.Platform;
  capabilities?: AgentSandboxProviderCapabilities;
  microsandboxHostAvailable?: () => boolean;
}

/**
 * Chooses from the ordered registry. Callers that own a Docker Engine worker
 * provide its probe capabilities and retain the resulting provider for the
 * server lifetime.
 */
export function selectAgentSandboxProvider(input: AgentSandboxProviderSelectionInput): AgentSandboxRuntimeProvider {
  const platform = input.platform ?? process.platform;
  const capabilities = resolveCapabilities(input, platform);
  const registry = readAgentSandboxProviderRegistry();
  const candidates = registry.candidates.filter((candidate) => supportsPlatform(candidate, platform));

  if (input.preference !== "auto") {
    const candidate = findAgentSandboxProviderCandidate(input.preference);
    if (!supportsPlatform(candidate, platform)) {
      throw new Error(
        `${input.preference} sandbox provider requires ${candidate.platforms.join(" or ")}; current platform is ${platform}.`,
      );
    }
    assertRequirements(candidate, capabilities, input.preference);
    return candidate.provider;
  }

  const selected = candidates.find((candidate) => requirementsSatisfied(candidate, capabilities));
  if (selected) return selected.provider;

  // A startup owner may not have probed its isolated Docker Engine worker yet.
  // Keep the first viable engine candidate until that owner supplies facts;
  // execution remains unavailable until preparation confirms it.
  const deferred = candidates.find((candidate) => candidate.provider === AgentSandboxRuntimeProviders.Gvisor);
  if (deferred && capabilities.dockerEngine === undefined) return deferred.provider;
  throw new Error(`No sandbox provider satisfies the declared host capabilities on ${platform}.`);
}

function supportsPlatform(candidate: AgentSandboxProviderCandidate, platform: NodeJS.Platform): boolean {
  return candidate.platforms.some((supportedPlatform) => supportedPlatform === platform);
}

export function canAccessLinuxKvm(): boolean {
  const devices = readAgentSandboxDistributionContract().hostRequirements.microsandbox.linux.devices;
  return devices.every((device) => {
    const mode = device.access.reduce(
      (value, permission) => value | (permission === "read" ? constants.R_OK : constants.W_OK),
      0,
    );
    try {
      accessSync(device.path, mode);
      return true;
    } catch {
      return false;
    }
  });
}

function resolveCapabilities(
  input: AgentSandboxProviderSelectionInput,
  platform: NodeJS.Platform,
): AgentSandboxProviderCapabilities {
  return {
    microsandboxHost:
      input.capabilities?.microsandboxHost ??
      (platform === "linux" ? (input.microsandboxHostAvailable ?? canAccessLinuxKvm)() : true),
    dockerEngine: input.capabilities?.dockerEngine,
    registeredDockerRuntimes: input.capabilities?.registeredDockerRuntimes,
  };
}

function requirementsSatisfied(
  candidate: AgentSandboxProviderCandidate,
  capabilities: AgentSandboxProviderCapabilities,
): boolean {
  return candidate.requirements.every((requirement) => capabilityAvailable(requirement, capabilities));
}

function assertRequirements(
  candidate: AgentSandboxProviderCandidate,
  capabilities: AgentSandboxProviderCapabilities,
  provider: AgentSandboxRuntimeProvider,
): void {
  const missing = candidate.requirements.filter(
    (requirement) => capabilityKnown(requirement, capabilities) && !capabilityAvailable(requirement, capabilities),
  );
  if (missing.length > 0) {
    throw new Error(`${provider} sandbox provider is unavailable: missing ${missing.join(", ")}.`);
  }
}

function capabilityKnown(
  requirement: AgentSandboxProviderRequirement,
  capabilities: AgentSandboxProviderCapabilities,
): boolean {
  switch (requirement) {
    case "microsandbox-host":
      return capabilities.microsandboxHost !== undefined;
    case "docker-engine":
      return capabilities.dockerEngine !== undefined;
    case "registered-runsc":
      return capabilities.registeredDockerRuntimes !== undefined;
  }
}

function capabilityAvailable(
  requirement: AgentSandboxProviderRequirement,
  capabilities: AgentSandboxProviderCapabilities,
): boolean {
  switch (requirement) {
    case "microsandbox-host":
      return capabilities.microsandboxHost === true;
    case "docker-engine":
      return capabilities.dockerEngine === true;
    case "registered-runsc":
      return capabilities.registeredDockerRuntimes?.includes("runsc") === true;
  }
}
