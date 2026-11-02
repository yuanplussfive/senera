import path from "node:path";
import { AgentExtensionRegistry } from "../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { listDefaultAgentHostCapabilityNames } from "../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import { listAgentSystemToolImplementationCapabilities } from "../Source/AgentSystem/SystemTools/AgentSystemTools.js";
import { AgentSystemExtensionCatalog } from "../Source/AgentSystem/SystemTools/AgentSystemToolSource.js";
import { discoverAgentSystemExtensionPackages } from "../Source/AgentSystem/SystemTools/AgentSystemExtensionDiscovery.js";
import { synchronizeSystemToolContracts } from "./SystemToolContractSource.js";

const extensionRoot = path.join(process.cwd(), "System", "Extensions");
await synchronizeSystemToolContracts({ extensionRoot, check: true });
const implementationCapabilities = [...listAgentSystemToolImplementationCapabilities({ ModelProviders: [] })];
const implementationSet = new Set(implementationCapabilities);
const defaultCapabilities = [...listDefaultAgentHostCapabilityNames()];

assertUnique(implementationCapabilities, "system implementation capability");
assertDisjoint(
  defaultCapabilities,
  implementationCapabilities,
  "default host capabilities",
  "system implementation capabilities",
);

const packages = discoverAgentSystemExtensionPackages(extensionRoot);
const hostContributions = packages.flatMap((source) =>
  (source.manifest.contributions ?? []).flatMap((contribution) =>
    contribution.kind === "hostTool"
      ? [{ extensionId: source.manifest.id, capability: contribution.capability, contract: contribution.contract }]
      : [],
  ),
);
const contributionCapabilities = hostContributions.map((contribution) => contribution.capability);
assertUnique(contributionCapabilities, "System extension HostCapability");
const sidecarContributions = packages.flatMap((source) =>
  (source.manifest.contributions ?? []).flatMap((contribution) =>
    contribution.kind === "sidecarTool"
      ? [{ extensionId: source.manifest.id, capability: contribution.capability, contract: contribution.contract }]
      : [],
  ),
);
const sidecarContributionCapabilities = sidecarContributions.map((contribution) => contribution.capability);
assertUnique(sidecarContributionCapabilities, "System extension sidecar capability");

const contributionsByCapability = new Map(
  hostContributions.map((contribution) => [contribution.capability, contribution]),
);
const registeredCapabilities = new Set([...defaultCapabilities, ...implementationSet]);
assertSameSet(
  registeredCapabilities,
  contributionsByCapability.keys(),
  "runtime host capabilities",
  "package-owned hostTool contributions",
);

// Catalog registration is the same read-only path used in production. It
// validates every manifest, JSON Schema, presentation binding, artifact policy,
// resource declaration, and capability reference without modifying package files.
const registry = new AgentExtensionRegistry();
new AgentSystemExtensionCatalog().registerRoot(registry, extensionRoot, {
  capabilities: registeredCapabilities,
  requiredHostCapabilities: registeredCapabilities,
});

const registeredHostCapabilities = new Set(
  registry.listTools().flatMap((tool) => (tool.handler.kind === "HostCapability" ? [tool.handler.capability] : [])),
);
assertSameSet(
  registeredCapabilities,
  registeredHostCapabilities,
  "runtime host capabilities",
  "registered package host tools",
);
assertSameSet(
  sidecarContributionCapabilities,
  registry.listSidecarTools().map((tool) => tool.capability),
  "package sidecar contributions",
  "registered package sidecars",
);

console.log(
  `Verified ${packages.length} System extension package(s), ${hostContributions.length} host contract(s), and ${implementationCapabilities.length} implementation binding(s).`,
);

function assertUnique(values: readonly string[], label: string): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length === 0) return;
  throw new Error(`Duplicate ${label}: ${[...new Set(duplicates)].sort().join(", ")}.`);
}

function assertDisjoint(
  left: readonly string[],
  right: readonly string[],
  leftLabel: string,
  rightLabel: string,
): void {
  const overlap = left.filter((value) => right.includes(value)).sort();
  if (overlap.length === 0) return;
  throw new Error(`${leftLabel} and ${rightLabel} overlap: ${overlap.join(", ")}.`);
}

function assertSameSet(
  expected: Iterable<string>,
  actual: Iterable<string>,
  expectedLabel: string,
  actualLabel: string,
): void {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = [...expectedSet].filter((value) => !actualSet.has(value)).sort();
  const unexpected = [...actualSet].filter((value) => !expectedSet.has(value)).sort();
  if (missing.length === 0 && unexpected.length === 0) return;
  const details = [
    ...(missing.length > 0 ? [`missing from ${actualLabel}: ${missing.join(", ")}`] : []),
    ...(unexpected.length > 0 ? [`unexpected in ${actualLabel}: ${unexpected.join(", ")}`] : []),
  ];
  throw new Error(`${expectedLabel} and ${actualLabel} diverge (${details.join("; ")}).`);
}
