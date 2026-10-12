import { isAgentUnknownRecord as isRecord } from "../Core/AgentUnknownValue.js";
import { removeRetiredVectorModelPool, removeRetiredVectorModels } from "./AgentConfigVectorMigration.js";
import { AgentConfigMigrationError } from "./AgentConfigMigrationError.js";

export interface AgentConfigRetirementMigrationOptions {
  readonly version: number;
  readonly config: Record<string, unknown>;
  readonly migratedPaths: string[];
  readonly removedPaths: string[];
}

/**
 * Applies the additive retirement sequence introduced after the foundational
 * config shape migrations. Returning undefined leaves earlier migrations to
 * the main dispatcher.
 */
export function migrateAgentConfigRetirementStep(options: AgentConfigRetirementMigrationOptions): number | undefined {
  const { config, migratedPaths, removedPaths } = options;
  switch (options.version) {
    case 11:
      removeRetiredRuntimeUpdateConfiguration(config, "", removedPaths);
      if (isRecord(config.Defaults))
        removeRetiredRuntimeUpdateConfiguration(config.Defaults, "Defaults.", removedPaths);
      return 12;
    case 12:
      migrateMemoryLearningToContinuityLearning(config, "", migratedPaths, removedPaths);
      if (isRecord(config.Defaults)) {
        migrateMemoryLearningToContinuityLearning(config.Defaults, "Defaults.", migratedPaths, removedPaths);
      }
      return 13;
    case 13:
      removeRetiredContinuityLearningOptions(config, "", removedPaths);
      if (isRecord(config.Defaults)) removeRetiredContinuityLearningOptions(config.Defaults, "Defaults.", removedPaths);
      return 14;
    case 14:
      removeCharacterThresholdLearningGate(config, "", removedPaths);
      if (isRecord(config.Defaults)) removeCharacterThresholdLearningGate(config.Defaults, "Defaults.", removedPaths);
      return 15;
    case 15:
      removeRoleRewriteConfiguration(config, "", removedPaths);
      if (isRecord(config.Defaults)) removeRoleRewriteConfiguration(config.Defaults, "Defaults.", removedPaths);
      return 16;
    case 16:
      removePhraseBasedTurnValueConfiguration(config, "", migratedPaths, removedPaths);
      if (isRecord(config.Defaults)) {
        removePhraseBasedTurnValueConfiguration(config.Defaults, "Defaults.", migratedPaths, removedPaths);
      }
      return 17;
    case 17:
      removeRetiredGoalControllerConfiguration(config, "", removedPaths);
      if (isRecord(config.Defaults))
        removeRetiredGoalControllerConfiguration(config.Defaults, "Defaults.", removedPaths);
      return 18;
    case 18:
      removeRetiredGoalConfiguration(config, "", removedPaths);
      if (isRecord(config.Defaults)) removeRetiredGoalConfiguration(config.Defaults, "Defaults.", removedPaths);
      return 19;
    case 19:
      removeRetiredContinuityRecallRewrite(config, "", migratedPaths, removedPaths);
      if (isRecord(config.Defaults)) {
        removeRetiredContinuityRecallRewrite(config.Defaults, "Defaults.", migratedPaths, removedPaths);
      }
      return 20;
    case 20:
      removeRetiredTemporalSegmentIdleBoundary(config, "", removedPaths);
      if (isRecord(config.Defaults))
        removeRetiredTemporalSegmentIdleBoundary(config.Defaults, "Defaults.", removedPaths);
      return 21;
    case 21:
      removeRetiredVectorModels(config, "", removedPaths);
      if (isRecord(config.Defaults)) removeRetiredVectorModels(config.Defaults, "Defaults.", removedPaths);
      return 22;
    case 22:
      removeRetiredVectorModelPool(config, "", removedPaths);
      if (isRecord(config.Defaults)) removeRetiredVectorModelPool(config.Defaults, "Defaults.", removedPaths);
      return 23;
    case 23:
      removeRetiredArtifactsSummaryMaxChars(config, "", removedPaths);
      if (isRecord(config.Defaults)) removeRetiredArtifactsSummaryMaxChars(config.Defaults, "Defaults.", removedPaths);
      return 24;
    case 24:
      removeRetiredToolSearchSemanticThresholds(config, "", removedPaths);
      if (isRecord(config.Defaults))
        removeRetiredToolSearchSemanticThresholds(config.Defaults, "Defaults.", removedPaths);
      return 25;
    case 25:
      removeRetiredToolSearchDiscoveryLimits(config, "", removedPaths);
      if (isRecord(config.Defaults)) removeRetiredToolSearchDiscoveryLimits(config.Defaults, "Defaults.", removedPaths);
      return 26;
    case 26:
      removeRetiredToolSearchEmbeddingMetadata(config, "", removedPaths);
      if (isRecord(config.Defaults))
        removeRetiredToolSearchEmbeddingMetadata(config.Defaults, "Defaults.", removedPaths);
      return 27;
    case 27:
      removeRetiredPluginConfiguration(config, "", migratedPaths, removedPaths);
      if (isRecord(config.Defaults))
        removeRetiredPluginConfiguration(config.Defaults, "Defaults.", migratedPaths, removedPaths);
      return 28;
    case 28:
      removeRetiredWorkspaceObservationConfiguration(config, "", removedPaths);
      if (isRecord(config.Defaults)) {
        removeRetiredWorkspaceObservationConfiguration(config.Defaults, "Defaults.", removedPaths);
      }
      return 29;
    case 29:
      removeRetiredToolObservationBudget(config, "", removedPaths);
      if (isRecord(config.Defaults)) {
        removeRetiredToolObservationBudget(config.Defaults, "Defaults.", removedPaths);
      }
      return 30;
    case 30:
      migrateBrowserNetworkConfiguration(config, "", migratedPaths, removedPaths);
      if (isRecord(config.Defaults)) {
        migrateBrowserNetworkConfiguration(config.Defaults, "Defaults.", migratedPaths, removedPaths);
      }
      return 31;
    case 31:
      removeRetiredToolLearningModelConfiguration(config, "", removedPaths);
      if (isRecord(config.Defaults)) {
        removeRetiredToolLearningModelConfiguration(config.Defaults, "Defaults.", removedPaths);
      }
      return 32;
    case 32:
      removeRetiredModelThinkingLevelMaps(config, "", removedPaths);
      if (isRecord(config.Defaults)) {
        removeRetiredModelThinkingLevelMaps(config.Defaults, "Defaults.", removedPaths);
      }
      return 33;
    case 33:
      removeRetiredTemporalMemoryConfiguration(config, "", removedPaths);
      if (isRecord(config.Defaults)) {
        removeRetiredTemporalMemoryConfiguration(config.Defaults, "Defaults.", removedPaths);
      }
      return 34;
    case 34:
      removeRetiredMemoryCountBudgets(config, "", removedPaths);
      if (isRecord(config.Defaults)) removeRetiredMemoryCountBudgets(config.Defaults, "Defaults.", removedPaths);
      return 35;
    default:
      return undefined;
  }
}

/** Count/character policies have no token equivalent; retire them at the config boundary. */
function removeRetiredMemoryCountBudgets(
  config: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const learning = config.ContinuityLearning;
  if (!isRecord(learning) || !isRecord(learning.Recall) || !isRecord(learning.Recall.PromptBudget)) return;
  const budget = learning.Recall.PromptBudget;
  for (const key of ["MaxDigestEntries", "MaxEventEntries", "MaxCharacters"]) {
    if (removeProperty(budget, key)) removedPaths.push(`${prefix}ContinuityLearning.Recall.PromptBudget.${key}`);
  }
}

function removeRetiredTemporalMemoryConfiguration(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const continuity = container.ContinuityLearning;
  if (isRecord(continuity) && removeProperty(continuity, "TemporalMemory")) {
    removedPaths.push(`${prefix}ContinuityLearning.TemporalMemory`);
  }
}

/** Tool routing is now trained from completed state-card scenarios in MemOS. */
function removeRetiredToolLearningModelConfiguration(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  if (removeProperty(container, "ToolLearning")) removedPaths.push(`${prefix}ToolLearning`);
}

function removeRetiredToolObservationBudget(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const artifacts = container.Artifacts;
  if (!isRecord(artifacts)) return;
  if (removeProperty(artifacts, "InlineResultMaxTokens")) {
    removedPaths.push(`${prefix}Artifacts.InlineResultMaxTokens`);
  }
  if (removeProperty(artifacts, "InlineResultMaxBytes")) {
    removedPaths.push(`${prefix}Artifacts.InlineResultMaxBytes`);
  }
}

function migrateBrowserNetworkConfiguration(
  container: Record<string, unknown>,
  prefix: string,
  migratedPaths: string[],
  removedPaths: string[],
): void {
  if (!isRecord(container.Extensions) || !isRecord(container.Extensions["agent-browser"])) return;
  const browserExtension = container.Extensions["agent-browser"];
  if (!isRecord(browserExtension.Configuration) || !isRecord(browserExtension.Configuration.network)) return;
  const network = browserExtension.Configuration.network;
  const legacyFields = ["accessMode", "allowedDomains", "allowPrivateNetworks", "allowSyntheticProxyAddresses"];
  const presentLegacyFields = legacyFields.filter((field) => Object.hasOwn(network, field));
  if (presentLegacyFields.length === 0) return;

  const hadAllowlist =
    network.accessMode === "allowlist" ||
    (network.accessMode === undefined && Array.isArray(network.allowedDomains) && network.allowedDomains.length > 0);
  const blockedDomains = Array.isArray(network.blockedDomains) ? [...network.blockedDomains] : undefined;
  for (const field of presentLegacyFields) delete network[field];

  if (hadAllowlist) {
    const tightened = [...new Set([...(blockedDomains ?? []), "*"])];
    network.blockedDomains = tightened;
    migratedPaths.push(`${prefix}Extensions.agent-browser.Configuration.network.blockedDomains`);
  }
  removedPaths.push(
    ...presentLegacyFields.map((field) => `${prefix}Extensions.agent-browser.Configuration.network.${field}`),
  );
}

function removeRetiredWorkspaceObservationConfiguration(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const artifacts = container.Artifacts;
  if (!isRecord(artifacts) || !removeProperty(artifacts, "WorkspaceObserver")) return;
  removedPaths.push(`${prefix}Artifacts.WorkspaceObserver`);
}

function removeRetiredArtifactsSummaryMaxChars(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const artifacts = container.Artifacts;
  if (!isRecord(artifacts) || !removeProperty(artifacts, "SummaryMaxChars")) return;
  removedPaths.push(`${prefix}Artifacts.SummaryMaxChars`);
}

function removeRetiredToolSearchSemanticThresholds(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const toolSearch = container.ToolSearch;
  if (!isRecord(toolSearch) || !isRecord(toolSearch.Embedding)) return;
  for (const property of ["ScoreThreshold", "CandidateThreshold"] as const) {
    if (removeProperty(toolSearch.Embedding, property)) {
      removedPaths.push(`${prefix}ToolSearch.Embedding.${property}`);
    }
  }
}

function removeRetiredToolSearchDiscoveryLimits(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const toolSearch = container.ToolSearch;
  if (!isRecord(toolSearch)) return;
  removeRetiredNestedProperties(toolSearch.Fuzzy, ["CandidateLimit"], `${prefix}ToolSearch.Fuzzy`, removedPaths);
  removeRetiredNestedProperties(
    toolSearch.Ranking,
    ["MmrLambda", "MmrCandidateScoreRatio", "MinScore", "MemoryExpansion"],
    `${prefix}ToolSearch.Ranking`,
    removedPaths,
  );
  removeRetiredNestedProperties(toolSearch.Rerank, ["CandidateLimit"], `${prefix}ToolSearch.Rerank`, removedPaths);
}

function removeRetiredToolSearchEmbeddingMetadata(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const toolSearch = container.ToolSearch;
  if (!isRecord(toolSearch) || !isRecord(toolSearch.Embedding)) return;
  removeRetiredNestedProperties(
    toolSearch.Embedding,
    ["Provider", "Languages"],
    `${prefix}ToolSearch.Embedding`,
    removedPaths,
  );
}

function removeRetiredNestedProperties(
  value: unknown,
  properties: readonly string[],
  path: string,
  removedPaths: string[],
): void {
  if (!isRecord(value)) return;
  for (const property of properties) {
    if (removeProperty(value, property)) removedPaths.push(`${path}.${property}`);
  }
}

function removeRetiredTemporalSegmentIdleBoundary(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const continuity = container.ContinuityLearning;
  if (!isRecord(continuity) || !isRecord(continuity.TemporalMemory)) return;
  if (removeProperty(continuity.TemporalMemory, "SegmentIdleSeconds")) {
    removedPaths.push(`${prefix}ContinuityLearning.TemporalMemory.SegmentIdleSeconds`);
  }
}

function removeRetiredContinuityRecallRewrite(
  container: Record<string, unknown>,
  prefix: string,
  _migratedPaths: string[],
  removedPaths: string[],
): void {
  const continuity = container.ContinuityLearning;
  if (!isRecord(continuity) || !isRecord(continuity.Recall)) return;
  const recall = continuity.Recall;
  for (const property of ["Auxiliary", "Semantic", "Ranking", "Prefetch", "TurnValueClassifier"] as const) {
    if (removeProperty(recall, property)) {
      removedPaths.push(`${prefix}ContinuityLearning.Recall.${property}`);
    }
  }
}

function removeRetiredRuntimeUpdateConfiguration(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  if (removeProperty(container, "Updates")) removedPaths.push(`${prefix}Updates`);
}

function migrateMemoryLearningToContinuityLearning(
  container: Record<string, unknown>,
  prefix: string,
  migratedPaths: string[],
  removedPaths: string[],
): void {
  const legacy = container.MemoryLearning;
  if (legacy !== undefined) {
    if (!isRecord(legacy)) {
      throw new AgentConfigMigrationError(
        `${prefix}MemoryLearning must be an object to migrate to ContinuityLearning.`,
      );
    }
    const current = container.ContinuityLearning;
    if (current !== undefined && !isRecord(current)) {
      throw new AgentConfigMigrationError(`${prefix}ContinuityLearning must be an object.`);
    }
    const merged = { ...legacy, ...(isRecord(current) ? current : {}) };
    if (removeProperty(merged, "Promotion")) removedPaths.push(`${prefix}MemoryLearning.Promotion`);
    container.ContinuityLearning = merged;
    delete container.MemoryLearning;
    migratedPaths.push(`${prefix}ContinuityLearning`);
    removedPaths.push(`${prefix}MemoryLearning`);
    return;
  }

  const continuity = container.ContinuityLearning;
  if (isRecord(continuity) && removeProperty(continuity, "Promotion")) {
    removedPaths.push(`${prefix}ContinuityLearning.Promotion`);
  }
}

function removeRetiredContinuityLearningOptions(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const continuity = container.ContinuityLearning;
  if (!isRecord(continuity)) return;
  if (removeProperty(continuity, "MaxRepairAttempts")) {
    removedPaths.push(`${prefix}ContinuityLearning.MaxRepairAttempts`);
  }
  if (isRecord(continuity.Client) && removeProperty(continuity.Client, "MaxTokens")) {
    removedPaths.push(`${prefix}ContinuityLearning.Client.MaxTokens`);
  }
}

function removeCharacterThresholdLearningGate(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const continuity = container.ContinuityLearning;
  if (!isRecord(continuity)) return;
  if (removeProperty(continuity, "LearningGate")) {
    removedPaths.push(`${prefix}ContinuityLearning.LearningGate`);
  }
}

function removeRoleRewriteConfiguration(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const prompt = container.Prompt;
  if (isRecord(prompt) && removeProperty(prompt, "RoleRewrite")) {
    removedPaths.push(`${prefix}Prompt.RoleRewrite`);
  }

  if (!Array.isArray(container.ModelProviders)) return;
  for (const [index, provider] of container.ModelProviders.entries()) {
    if (isRecord(provider) && removeProperty(provider, "RoleRewrite")) {
      removedPaths.push(`${prefix}ModelProviders[${index}].RoleRewrite`);
    }
  }
}

function removeRetiredModelThinkingLevelMaps(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  if (!Array.isArray(container.ModelProviders)) return;
  for (const [index, provider] of container.ModelProviders.entries()) {
    if (!isRecord(provider) || !removeProperty(provider, "ThinkingLevelMap")) continue;
    removedPaths.push(`${prefix}ModelProviders[${index}].ThinkingLevelMap`);
  }
}

function removePhraseBasedTurnValueConfiguration(
  container: Record<string, unknown>,
  prefix: string,
  _migratedPaths: string[],
  removedPaths: string[],
): void {
  const continuity = container.ContinuityLearning;
  if (!isRecord(continuity)) return;
  const recall = continuity.Recall;
  if (!isRecord(recall)) return;
  for (const property of ["TrivialPromptGate", "TurnValueClassifier"] as const) {
    if (removeProperty(recall, property)) {
      removedPaths.push(`${prefix}ContinuityLearning.Recall.${property}`);
    }
  }
}

function removeRetiredGoalControllerConfiguration(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const goals = container.Goals;
  if (!isRecord(goals)) return;
  for (const key of ["TurnBudget", "JudgeFailureLimit", "QualityGates", "Wake"] as const) {
    if (removeProperty(goals, key)) removedPaths.push(`${prefix}Goals.${key}`);
  }
  const automatic = goals.Automatic;
  if (isRecord(automatic) && removeProperty(automatic, "MinimumObservedBatches")) {
    removedPaths.push(`${prefix}Goals.Automatic.MinimumObservedBatches`);
  }
  if (isRecord(automatic) && Object.keys(automatic).length === 0) {
    delete goals.Automatic;
    removedPaths.push(`${prefix}Goals.Automatic`);
  }
  if (Object.keys(goals).length === 0) {
    delete container.Goals;
    removedPaths.push(`${prefix}Goals`);
  }
}

function removeRetiredGoalConfiguration(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  if (removeProperty(container, "Goals")) removedPaths.push(`${prefix}Goals`);
}

function removeRetiredPluginConfiguration(
  container: Record<string, unknown>,
  prefix: string,
  migratedPaths: string[],
  removedPaths: string[],
): void {
  if (removeProperty(container, "PluginRoots")) removedPaths.push(`${prefix}PluginRoots`);
  if (removeProperty(container, "PluginDiscovery")) removedPaths.push(`${prefix}PluginDiscovery`);

  // PluginDocumentation was renamed when plugin configuration moved into system extensions.
  if (prefix !== "") return;
  const currentDocumentation = container.ToolDocumentation;
  if (currentDocumentation !== undefined && !isRecord(currentDocumentation)) {
    throw new AgentConfigMigrationError("ToolDocumentation must be an object.");
  }
  if (isRecord(currentDocumentation) && removeProperty(currentDocumentation, "PromptXml")) {
    removedPaths.push("ToolDocumentation.PromptXml");
  }
  if (!Object.hasOwn(container, "PluginDocumentation")) return;
  const legacyDocumentation = container.PluginDocumentation;
  if (!isRecord(legacyDocumentation)) {
    throw new AgentConfigMigrationError("PluginDocumentation must be an object to migrate to ToolDocumentation.");
  }

  const merged = { ...legacyDocumentation, ...(isRecord(currentDocumentation) ? currentDocumentation : {}) };
  if (removeProperty(merged, "PromptXml")) {
    removedPaths.push("PluginDocumentation.PromptXml");
  }
  container.ToolDocumentation = merged;
  delete container.PluginDocumentation;
  migratedPaths.push("ToolDocumentation");
  removedPaths.push("PluginDocumentation");
}

function removeProperty(container: Record<string, unknown>, key: string): boolean {
  if (!Object.hasOwn(container, key)) return false;
  delete container[key];
  return true;
}
