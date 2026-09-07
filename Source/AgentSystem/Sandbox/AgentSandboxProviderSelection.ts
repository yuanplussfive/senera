import type { AgentSandboxProviderPreference } from "../Types/AgentRuntimeConfigTypes.js";
import type { AgentSandboxRuntimeProvider } from "./AgentSandboxRuntimeTypes.js";
import {
  findAgentSandboxProviderCandidate,
  readAgentSandboxProviderRegistry,
  type AgentSandboxProviderCandidate,
  type AgentSandboxProviderRequirement,
} from "./ProviderRegistry/AgentSandboxProviderRegistry.js";

export interface AgentSandboxProviderCapabilities {
  dockerEngine?: boolean;
  registeredDockerRuntimes?: readonly string[];
}

export interface AgentSandboxProviderSelectionInput {
  preference: AgentSandboxProviderPreference;
  platform?: NodeJS.Platform;
  capabilities?: AgentSandboxProviderCapabilities;
}

/** Selects an Engine-backed provider after host capabilities have been probed. */
export function selectAgentSandboxProvider(
  input: AgentSandboxProviderSelectionInput,
): AgentSandboxRuntimeProvider | undefined {
  const platform = input.platform ?? process.platform;
  const capabilities = input.capabilities ?? {};
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

  return undefined;
}

function supportsPlatform(candidate: AgentSandboxProviderCandidate, platform: NodeJS.Platform): boolean {
  return candidate.platforms.some((supportedPlatform) => supportedPlatform === platform);
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
    case "docker-engine":
      return capabilities.dockerEngine === true;
    case "registered-runsc":
      return capabilities.registeredDockerRuntimes?.includes("runsc") === true;
  }
}
