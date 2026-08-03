import { CurrentAgentConfigVersion } from "./AgentConfigVersion.js";
import { isAgentUnknownRecord as isRecord } from "../Core/AgentUnknownValue.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";

export interface AgentConfigMigrationResult {
  config: unknown;
  sourceVersion: number;
  targetVersion: number;
  migratedPaths: string[];
  removedPaths: string[];
}

export class AgentConfigMigrationError extends AgentBaseError {
  constructor(message: string) {
    super(message);
  }
}

export function migrateAgentConfigPayload(config: unknown): AgentConfigMigrationResult | undefined {
  if (!isRecord(config)) {
    return undefined;
  }

  const sourceVersion = readAgentConfigVersion(config);
  if (sourceVersion === CurrentAgentConfigVersion) {
    return undefined;
  }

  const working = cloneJsonValue(config);
  if (!isRecord(working)) {
    throw new AgentConfigMigrationError("Configuration payload must be a JSON object.");
  }

  const migratedPaths: string[] = [];
  const removedPaths: string[] = [];
  let version = sourceVersion;
  while (version < CurrentAgentConfigVersion) {
    switch (version) {
      case 0:
        migrateVersionZeroToOne(working, migratedPaths, removedPaths);
        version = 1;
        break;
      case 1:
        migrateVersionOneToTwo(working, removedPaths);
        version = 2;
        break;
      case 2:
        migrateVersionTwoToThree(working, removedPaths);
        version = 3;
        break;
      case 3:
        migrateVersionThreeToFour(working, removedPaths);
        version = 4;
        break;
      case 4:
        migrateVersionFourToFive(working, migratedPaths, removedPaths);
        version = 5;
        break;
      case 5:
        migrateVersionFiveToSix(working, migratedPaths);
        version = 6;
        break;
      case 6:
        migrateVersionSixToSeven(working, removedPaths);
        version = 7;
        break;
      case 7:
        migrateVersionSevenToEight(working, removedPaths);
        version = 8;
        break;
      case 8:
        migrateVersionEightToNine(working, removedPaths);
        version = 9;
        break;
      default:
        throw new AgentConfigMigrationError(`No migration is registered for configuration version ${version}.`);
    }
  }

  working.ConfigVersion = CurrentAgentConfigVersion;
  migratedPaths.push("ConfigVersion");
  return {
    config: working,
    sourceVersion,
    targetVersion: CurrentAgentConfigVersion,
    migratedPaths,
    removedPaths,
  };
}

const RetiredToolSearchEmbeddingProperties = [
  "ModelProviderId",
  "Model",
  "Dimensions",
  "BatchSize",
  "InputMaxChars",
] as const;

function migrateVersionEightToNine(config: Record<string, unknown>, removedPaths: string[]): void {
  removeRetiredToolSearchEmbeddingProperties(config, "", removedPaths);
  const defaults = config.Defaults;
  if (isRecord(defaults)) removeRetiredToolSearchEmbeddingProperties(defaults, "Defaults.", removedPaths);
}

function removeRetiredToolSearchEmbeddingProperties(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const toolSearch = container.ToolSearch;
  if (!isRecord(toolSearch) || !isRecord(toolSearch.Embedding)) return;
  for (const property of RetiredToolSearchEmbeddingProperties) {
    if (removeProperty(toolSearch.Embedding, property)) {
      removedPaths.push(`${prefix}ToolSearch.Embedding.${property}`);
    }
  }
}

function migrateVersionSevenToEight(config: Record<string, unknown>, removedPaths: string[]): void {
  if (!Array.isArray(config.ModelProviders)) return;
  for (const [index, provider] of config.ModelProviders.entries()) {
    if (!isRecord(provider) || provider.ContextWindowTokens !== -1) continue;
    delete provider.ContextWindowTokens;
    removedPaths.push(`ModelProviders[${index}].ContextWindowTokens`);
  }
}

function migrateVersionSixToSeven(config: Record<string, unknown>, removedPaths: string[]): void {
  removeDatabasePathConfiguration(config, "", removedPaths);
  const defaults = config.Defaults;
  if (isRecord(defaults)) removeDatabasePathConfiguration(defaults, "Defaults.", removedPaths);
}

function removeDatabasePathConfiguration(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  removeNestedProperty(container, ["Persistence", "DatabasePath"], prefix, removedPaths);
  removeNestedProperty(container, ["ConfigStore", "DatabasePath"], prefix, removedPaths);
  removeNestedProperty(container, ["ToolSearch", "Memory", "DatabasePath"], prefix, removedPaths);
}

function removeNestedProperty(
  container: Record<string, unknown>,
  pathParts: readonly string[],
  prefix: string,
  removedPaths: string[],
): void {
  const parent = pathParts
    .slice(0, -1)
    .reduce<Record<string, unknown> | undefined>(
      (current, part) => (current && isRecord(current[part]) ? current[part] : undefined),
      container,
    );
  const property = pathParts.at(-1);
  if (parent && property && removeProperty(parent, property)) removedPaths.push(`${prefix}${pathParts.join(".")}`);
}

function migrateVersionFiveToSix(config: Record<string, unknown>, migratedPaths: string[]): void {
  const configuredEndpoints = Array.isArray(config.ModelProviderEndpoints) ? config.ModelProviderEndpoints : [];
  const configuredIds = new Set<string>();
  for (const [index, candidate] of configuredEndpoints.entries()) {
    if (!isRecord(candidate)) continue;
    if (typeof candidate.Id === "string" && candidate.Id.trim()) configuredIds.add(candidate.Id);
    if (Object.hasOwn(candidate, "Enabled")) continue;
    candidate.Enabled = true;
    migratedPaths.push(`ModelProviderEndpoints[${index}].Enabled`);
  }

  const referencedEndpointIds = Array.isArray(config.ModelProviders)
    ? config.ModelProviders.flatMap((candidate) =>
        isRecord(candidate) && typeof candidate.ProviderId === "string" && candidate.ProviderId.trim()
          ? [candidate.ProviderId]
          : [],
      )
    : [];
  const missingEndpointOverrides = [...new Set(referencedEndpointIds)]
    .filter((providerId) => !configuredIds.has(providerId))
    .map((providerId) => ({ Id: providerId, Enabled: true }));
  if (missingEndpointOverrides.length === 0) return;

  config.ModelProviderEndpoints = [...configuredEndpoints, ...missingEndpointOverrides];
  migratedPaths.push("ModelProviderEndpoints");
}

function migrateVersionFourToFive(
  config: Record<string, unknown>,
  migratedPaths: string[],
  removedPaths: string[],
): void {
  migrateSandboxProvisioning(config, "", migratedPaths, removedPaths);
  const defaults = config.Defaults;
  if (isRecord(defaults)) migrateSandboxProvisioning(defaults, "Defaults.", migratedPaths, removedPaths);
}

function migrateSandboxProvisioning(
  container: Record<string, unknown>,
  prefix: string,
  migratedPaths: string[],
  removedPaths: string[],
): void {
  const sandboxRuntime = container.SandboxRuntime;
  if (!isRecord(sandboxRuntime) || !Object.hasOwn(sandboxRuntime, "Images")) return;
  if (Object.hasOwn(sandboxRuntime, "Provisioning")) {
    throw new AgentConfigMigrationError(
      `${prefix}SandboxRuntime cannot declare both legacy Images and Provisioning during v5 migration.`,
    );
  }
  const images = sandboxRuntime.Images;
  if (!Array.isArray(images) || images.some((image) => typeof image !== "string" || image.trim().length === 0)) {
    throw new AgentConfigMigrationError(`${prefix}SandboxRuntime.Images must be an array of non-empty strings.`);
  }
  delete sandboxRuntime.Images;
  removedPaths.push(`${prefix}SandboxRuntime.Images`);
  if (images.length > 0) {
    sandboxRuntime.Provisioning = { Kind: "Oci", Images: [...images] };
    migratedPaths.push(`${prefix}SandboxRuntime.Provisioning`);
  }
}

function migrateVersionThreeToFour(config: Record<string, unknown>, removedPaths: string[]): void {
  removeToolSearchMemoryKind(config, "", removedPaths);
  const defaults = config.Defaults;
  if (isRecord(defaults)) removeToolSearchMemoryKind(defaults, "Defaults.", removedPaths);
}

function removeToolSearchMemoryKind(container: Record<string, unknown>, prefix: string, removedPaths: string[]): void {
  const toolSearch = container.ToolSearch;
  if (!isRecord(toolSearch)) return;
  const memory = toolSearch.Memory;
  if (!isRecord(memory) || !removeProperty(memory, "Kind")) return;
  removedPaths.push(`${prefix}ToolSearch.Memory.Kind`);
}

function migrateVersionTwoToThree(config: Record<string, unknown>, removedPaths: string[]): void {
  removeLoadedToolsConfig(config, "", removedPaths);
  const defaults = config.Defaults;
  if (isRecord(defaults)) removeLoadedToolsConfig(defaults, "Defaults.", removedPaths);
}

function removeLoadedToolsConfig(container: Record<string, unknown>, prefix: string, removedPaths: string[]): void {
  const agentLoop = container.AgentLoop;
  if (!isRecord(agentLoop) || !removeProperty(agentLoop, "LoadedTools")) return;
  removedPaths.push(`${prefix}AgentLoop.LoadedTools`);
  if (Object.keys(agentLoop).length === 0) {
    delete container.AgentLoop;
    removedPaths.push(`${prefix}AgentLoop`);
  }
}

function migrateVersionOneToTwo(config: Record<string, unknown>, removedPaths: string[]): void {
  removeToolSearchIntentGate(config, "", removedPaths);
  const defaults = config.Defaults;
  if (isRecord(defaults)) removeToolSearchIntentGate(defaults, "Defaults.", removedPaths);
}

function removeToolSearchIntentGate(container: Record<string, unknown>, prefix: string, removedPaths: string[]): void {
  const toolSearch = container.ToolSearch;
  if (!isRecord(toolSearch)) return;
  const ranking = toolSearch.Ranking;
  if (!isRecord(ranking) || !removeProperty(ranking, "IntentGate")) return;
  removedPaths.push(`${prefix}ToolSearch.Ranking.IntentGate`);
}

export function readAgentConfigVersion(config: unknown): number {
  if (!isRecord(config)) return 0;
  if (!Object.hasOwn(config, "ConfigVersion")) {
    return 0;
  }

  const version = config.ConfigVersion;
  if (!Number.isInteger(version) || typeof version !== "number" || version < 0) {
    throw new AgentConfigMigrationError("ConfigVersion must be a non-negative integer.");
  }
  if (version > CurrentAgentConfigVersion) {
    throw new AgentConfigMigrationError(
      `Configuration version ${version} is newer than this Senera runtime supports (${CurrentAgentConfigVersion}).`,
    );
  }
  return version;
}

function migrateVersionZeroToOne(
  config: Record<string, unknown>,
  migratedPaths: string[],
  removedPaths: string[],
): void {
  const modelProviderIds = readModelProviderIds(config);
  migrateLegacyContainer(config, "", modelProviderIds, migratedPaths, removedPaths);

  const defaults = config.Defaults;
  if (isRecord(defaults)) {
    migrateLegacyContainer(defaults, "Defaults.", modelProviderIds, migratedPaths, removedPaths);
  }
}

function migrateLegacyContainer(
  container: Record<string, unknown>,
  prefix: string,
  modelProviderIds: ReadonlySet<string>,
  migratedPaths: string[],
  removedPaths: string[],
): void {
  migrateAgentLoopRepairAttempts(container, prefix, migratedPaths);
  removeLegacyProperty(container, "Cli", prefix, removedPaths);
  removeLegacyProperty(container, "AgentDelegation", prefix, removedPaths);

  const toolExecution = container.ToolExecution;
  if (isRecord(toolExecution) && removeProperty(toolExecution, "Mode")) {
    removedPaths.push(`${prefix}ToolExecution.Mode`);
  }

  const agentLoop = container.AgentLoop;
  if (isRecord(agentLoop) && removeProperty(agentLoop, "MaxSteps")) {
    removedPaths.push(`${prefix}AgentLoop.MaxSteps`);
  }

  const actionPlanner = container.ActionPlanner;
  if (!isRecord(actionPlanner)) {
    return;
  }
  for (const clientKey of ["Client", "PlanningClient", "FinalAnswerClient"] as const) {
    const client = actionPlanner[clientKey];
    if (isRecord(client)) {
      migratePlannerClientProvider(
        client,
        `${prefix}ActionPlanner.${clientKey}`,
        modelProviderIds,
        migratedPaths,
        removedPaths,
      );
    }
  }
}

function migrateAgentLoopRepairAttempts(
  container: Record<string, unknown>,
  prefix: string,
  migratedPaths: string[],
): void {
  const agentLoop = container.AgentLoop;
  if (!isRecord(agentLoop) || !Object.hasOwn(agentLoop, "MaxRepairAttempts")) {
    return;
  }

  const actionPlanner = ensureRecord(container, "ActionPlanner");
  if (!Object.hasOwn(actionPlanner, "MaxRepairAttempts")) {
    actionPlanner.MaxRepairAttempts = agentLoop.MaxRepairAttempts;
  }
  delete agentLoop.MaxRepairAttempts;
  migratedPaths.push(`${prefix}AgentLoop.MaxRepairAttempts`);
}

function migratePlannerClientProvider(
  client: Record<string, unknown>,
  path: string,
  modelProviderIds: ReadonlySet<string>,
  migratedPaths: string[],
  removedPaths: string[],
): void {
  const provider = client.Provider;
  if (!Object.hasOwn(client, "Provider")) {
    return;
  }

  if (!Object.hasOwn(client, "ModelProviderId") && typeof provider === "string" && modelProviderIds.has(provider)) {
    client.ModelProviderId = provider;
    migratedPaths.push(`${path}.Provider`);
  } else {
    removedPaths.push(`${path}.Provider`);
  }
  delete client.Provider;
}

function readModelProviderIds(config: Record<string, unknown>): ReadonlySet<string> {
  if (!Array.isArray(config.ModelProviders)) {
    return new Set<string>();
  }
  return new Set(
    config.ModelProviders.flatMap((provider) =>
      isRecord(provider) && typeof provider.Id === "string" ? [provider.Id] : [],
    ),
  );
}

function removeLegacyProperty(
  container: Record<string, unknown>,
  key: string,
  prefix: string,
  removedPaths: string[],
): void {
  if (removeProperty(container, key)) {
    removedPaths.push(`${prefix}${key}`);
  }
}

function removeProperty(container: Record<string, unknown>, key: string): boolean {
  if (!Object.hasOwn(container, key)) {
    return false;
  }
  delete container[key];
  return true;
}

function ensureRecord(container: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = container[key];
  if (isRecord(current)) {
    return current;
  }
  const next: Record<string, unknown> = {};
  container[key] = next;
  return next;
}

function cloneJsonValue(value: unknown): unknown {
  return structuredClone(value);
}
