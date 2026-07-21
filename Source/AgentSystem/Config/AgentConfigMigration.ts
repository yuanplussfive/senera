import { CurrentAgentConfigVersion } from "./AgentConfigVersion.js";

export interface AgentConfigMigrationResult {
  config: unknown;
  sourceVersion: number;
  targetVersion: number;
  migratedPaths: string[];
  removedPaths: string[];
}

export class AgentConfigMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentConfigMigrationError";
  }
}

export function migrateAgentConfigPayload(config: unknown): AgentConfigMigrationResult | undefined {
  if (!isRecord(config)) {
    return undefined;
  }

  const sourceVersion = readConfigVersion(config);
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

function readConfigVersion(config: Record<string, unknown>): number {
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

  const pluginDocumentation = config.PluginDocumentation;
  if (isRecord(pluginDocumentation) && removeProperty(pluginDocumentation, "DecisionActionDescription")) {
    removedPaths.push("PluginDocumentation.DecisionActionDescription");
    if (Object.keys(pluginDocumentation).length === 0) {
      delete config.PluginDocumentation;
      removedPaths.push("PluginDocumentation");
    }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
