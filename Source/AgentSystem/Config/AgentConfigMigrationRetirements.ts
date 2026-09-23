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
    default:
      return undefined;
  }
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
  migratedPaths: string[],
  removedPaths: string[],
): void {
  const continuity = container.ContinuityLearning;
  if (!isRecord(continuity) || !isRecord(continuity.Recall)) return;
  const recall = continuity.Recall;
  const auxiliary = recall.Auxiliary;
  if (!isRecord(auxiliary)) return;

  if (typeof auxiliary.TimeoutMs === "number") {
    const semantic = isRecord(recall.Semantic) ? recall.Semantic : {};
    if (semantic.TimeoutMs === undefined) {
      semantic.TimeoutMs = auxiliary.TimeoutMs;
      recall.Semantic = semantic;
      migratedPaths.push(`${prefix}ContinuityLearning.Recall.Semantic.TimeoutMs`);
    }
  }
  delete recall.Auxiliary;
  removedPaths.push(`${prefix}ContinuityLearning.Recall.Auxiliary`);
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
  if (!isRecord(continuity) || !isRecord(continuity.LearningGate)) return;
  if (removeProperty(continuity.LearningGate, "MinimumUserCharacters")) {
    removedPaths.push(`${prefix}ContinuityLearning.LearningGate.MinimumUserCharacters`);
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

function removePhraseBasedTurnValueConfiguration(
  container: Record<string, unknown>,
  prefix: string,
  migratedPaths: string[],
  removedPaths: string[],
): void {
  const continuity = container.ContinuityLearning;
  if (!isRecord(continuity)) return;
  const recall = continuity.Recall;
  if (!isRecord(recall)) return;
  const legacyGate = recall.TrivialPromptGate;
  if (!isRecord(legacyGate)) return;
  const currentGate = isRecord(recall.TurnValueClassifier) ? recall.TurnValueClassifier : {};
  if (typeof legacyGate.Enabled === "boolean" && currentGate.Enabled === undefined) {
    recall.TurnValueClassifier = { ...currentGate, Enabled: legacyGate.Enabled };
    migratedPaths.push(`${prefix}ContinuityLearning.Recall.TurnValueClassifier.Enabled`);
  }
  if (removeProperty(recall, "TrivialPromptGate")) {
    removedPaths.push(`${prefix}ContinuityLearning.Recall.TrivialPromptGate`);
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

function removeProperty(container: Record<string, unknown>, key: string): boolean {
  if (!Object.hasOwn(container, key)) return false;
  delete container[key];
  return true;
}
