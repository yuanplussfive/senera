import { isAgentUnknownRecord as isRecord } from "../Core/AgentUnknownValue.js";
import { removeRetiredVectorModelPool, removeRetiredVectorModels } from "./AgentConfigVectorMigration.js";
import { AgentConfigMigrationError } from "./AgentConfigMigrationError.js";

export interface AgentConfigRetirementMigrationOptions {
  readonly version: number;
  readonly config: Record<string, unknown>;
  readonly migratedPaths: string[];
  readonly removedPaths: string[];
}

type ScopedMigration = (
  container: Record<string, unknown>,
  prefix: string,
  migratedPaths: string[],
  removedPaths: string[],
) => void;

type Retirement = (container: Record<string, unknown>, prefix: string, removedPaths: string[]) => void;

function retirement(apply: Retirement): ScopedMigration {
  return (container, prefix, _migratedPaths, removedPaths) => apply(container, prefix, removedPaths);
}

const retirementSteps = new Map<number, { readonly toVersion: number; readonly apply: ScopedMigration }>([
  [11, { toVersion: 12, apply: retirement(removeRetiredRuntimeUpdateConfiguration) }],
  [12, { toVersion: 13, apply: migrateMemoryLearningToContinuityLearning }],
  [13, { toVersion: 14, apply: retirement(removeRetiredContinuityLearningOptions) }],
  [14, { toVersion: 15, apply: retirement(removeCharacterThresholdLearningGate) }],
  [15, { toVersion: 16, apply: retirement(removeRoleRewriteConfiguration) }],
  [16, { toVersion: 17, apply: removePhraseBasedTurnValueConfiguration }],
  [17, { toVersion: 18, apply: retirement(removeRetiredGoalControllerConfiguration) }],
  [18, { toVersion: 19, apply: retirement(removeRetiredGoalConfiguration) }],
  [19, { toVersion: 20, apply: removeRetiredContinuityRecallRewrite }],
  [20, { toVersion: 21, apply: retirement(removeRetiredTemporalSegmentIdleBoundary) }],
  [21, { toVersion: 22, apply: retirement(removeRetiredVectorModels) }],
  [22, { toVersion: 23, apply: retirement(removeRetiredVectorModelPool) }],
  [23, { toVersion: 24, apply: retirement(removeRetiredArtifactsSummaryMaxChars) }],
  [24, { toVersion: 25, apply: retirement(removeRetiredToolSearchSemanticThresholds) }],
  [25, { toVersion: 26, apply: retirement(removeRetiredToolSearchDiscoveryLimits) }],
  [26, { toVersion: 27, apply: retirement(removeRetiredToolSearchEmbeddingMetadata) }],
  [27, { toVersion: 28, apply: removeRetiredPluginConfiguration }],
  [28, { toVersion: 29, apply: retirement(removeRetiredWorkspaceObservationConfiguration) }],
  [29, { toVersion: 30, apply: retirement(removeRetiredToolObservationBudget) }],
  [30, { toVersion: 31, apply: migrateBrowserNetworkConfiguration }],
  [31, { toVersion: 32, apply: retirement(removeRetiredToolLearningModelConfiguration) }],
  [32, { toVersion: 33, apply: retirement(removeRetiredModelThinkingLevelMaps) }],
  [33, { toVersion: 34, apply: retirement(removeRetiredTemporalMemoryConfiguration) }],
  [34, { toVersion: 35, apply: retirement(removeRetiredMemoryCountBudgets) }],
  [35, { toVersion: 36, apply: renameDigestSummaryTokenLimit }],
  [36, { toVersion: 38, apply: retirement(removeRetiredPersonaConfiguration) }],
  [38, { toVersion: 39, apply: retirement(removeRetiredPlannerModelSelection) }],
  [39, { toVersion: 40, apply: retirement(removeRetiredOneBotDisplayName) }],
  [40, { toVersion: 41, apply: retirement(removeRetiredResponseRewriting) }],
  [41, { toVersion: 42, apply: retirement(removeRetiredOneBotTransportConfiguration) }],
  [42, { toVersion: 43, apply: migrateFileDiaryConfiguration }],
  [43, { toVersion: 44, apply: retirement(removeRetiredToolSearchTokenize) }],
  [44, { toVersion: 45, apply: retirement(removeRetiredBrowserTimeoutLimits) }],
]);

function removeRetiredBrowserTimeoutLimits(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  if (!isRecord(container.Extensions)) return;
  const browser = container.Extensions["agent-browser"];
  if (!isRecord(browser) || !isRecord(browser.Configuration) || !isRecord(browser.Configuration.runtime)) return;
  for (const field of ["maxOperationTimeoutMs", "maxWaitMs"] as const) {
    if (removeProperty(browser.Configuration.runtime, field)) {
      removedPaths.push(`${prefix}Extensions.agent-browser.Configuration.runtime.${field}`);
    }
  }
}

/** Stopword curation moved into versioned lexicon resources; no configuration remains. */
function removeRetiredToolSearchTokenize(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const toolSearch = container.ToolSearch;
  if (!isRecord(toolSearch) || !removeProperty(toolSearch, "Tokenize")) return;
  removedPaths.push(`${prefix}ToolSearch.Tokenize`);
}

function migrateFileDiaryConfiguration(
  container: Record<string, unknown>,
  prefix: string,
  migratedPaths: string[],
  removedPaths: string[],
): void {
  if (!isRecord(container.ContinuityLearning) || !isRecord(container.ContinuityLearning.MemOS)) return;
  const memos = container.ContinuityLearning.MemOS;
  for (const [previous, current] of [
    ["DigestInputTokenBudget", "RelevanceInputTokenBudget"],
    ["DigestSummaryTokenLimit", "FragmentSummaryTokenLimit"],
  ] as const) {
    if (!Object.hasOwn(memos, previous)) continue;
    if (!Object.hasOwn(memos, current)) {
      memos[current] = memos[previous];
      migratedPaths.push(`${prefix}ContinuityLearning.MemOS.${current}`);
    }
    delete memos[previous];
    removedPaths.push(`${prefix}ContinuityLearning.MemOS.${previous}`);
  }
}

/** Returns undefined for versions owned by the foundational migration dispatcher. */
export function migrateAgentConfigRetirementStep(options: AgentConfigRetirementMigrationOptions): number | undefined {
  const step = retirementSteps.get(options.version);
  if (!step) return undefined;
  const { config, migratedPaths, removedPaths } = options;
  step.apply(config, "", migratedPaths, removedPaths);
  if (isRecord(config.Defaults)) step.apply(config.Defaults, "Defaults.", migratedPaths, removedPaths);
  return step.toVersion;
}

function removeRetiredOneBotTransportConfiguration(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  if (!isRecord(container.Extensions)) return;
  const extension = container.Extensions["agent-channels"];
  if (!isRecord(extension) || !isRecord(extension.Configuration)) return;
  const onebot = extension.Configuration.onebot11;
  if (!isRecord(onebot)) return;
  for (const key of ["port", "accessToken", "selfId", "operatorId", "heartbeatIntervalMs"] as const) {
    if (removeProperty(onebot, key)) {
      removedPaths.push(`${prefix}Extensions.agent-channels.Configuration.onebot11.${key}`);
    }
  }
}

function removeRetiredResponseRewriting(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  if (isRecord(container.Prompt)) {
    for (const key of ["PrefaceRewrite", "FinalResponseRewrite"] as const) {
      if (removeProperty(container.Prompt, key)) removedPaths.push(`${prefix}Prompt.${key}`);
    }
  }
  if (!isRecord(container.Extensions)) return;
  if (removeProperty(container.Extensions, "resident-speech")) {
    removedPaths.push(`${prefix}Extensions.resident-speech`);
  }
  const channels = container.Extensions["agent-channels"];
  if (isRecord(channels) && isRecord(channels.Configuration)) {
    if (removeProperty(channels.Configuration, "finalResponseRewrite")) {
      removedPaths.push(`${prefix}Extensions.agent-channels.Configuration.finalResponseRewrite`);
    }
  }
}

function removeRetiredOneBotDisplayName(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  if (!isRecord(container.Extensions)) return;
  const extension = container.Extensions["agent-channels"];
  if (!isRecord(extension) || !isRecord(extension.Configuration)) return;
  const onebot = extension.Configuration.onebot11;
  if (isRecord(onebot) && removeProperty(onebot, "displayName")) {
    removedPaths.push(`${prefix}Extensions.agent-channels.Configuration.onebot11.displayName`);
  }
}

function removeRetiredPlannerModelSelection(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const actionPlanner = container.ActionPlanner;
  if (!isRecord(actionPlanner)) return;

  const client = actionPlanner.Client;
  if (isRecord(client)) {
    for (const property of ["ModelProviderId", "Provider"] as const) {
      if (removeProperty(client, property)) {
        removedPaths.push(`${prefix}ActionPlanner.Client.${property}`);
      }
    }
    if (Object.keys(client).length === 0) {
      delete actionPlanner.Client;
      removedPaths.push(`${prefix}ActionPlanner.Client`);
    }
  }

  if (removeProperty(actionPlanner, "PlanningClient")) {
    removedPaths.push(`${prefix}ActionPlanner.PlanningClient`);
  }
}

function removeRetiredPersonaConfiguration(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  const prompt = container.Prompt;
  if (!isRecord(prompt)) return;
  for (const property of ["CorePersona", "LanguageStyle"] as const) {
    if (removeProperty(prompt, property)) removedPaths.push(`${prefix}Prompt.${property}`);
  }
  if (Object.keys(prompt).length === 0) {
    delete container.Prompt;
    removedPaths.push(`${prefix}Prompt`);
  }
}

/** The summary contract now measures the configured model's tokens, not UTF-16 characters. */
function renameDigestSummaryTokenLimit(
  container: Record<string, unknown>,
  prefix: string,
  migratedPaths: string[],
  removedPaths: string[],
): void {
  const continuity = container.ContinuityLearning;
  if (!isRecord(continuity) || !isRecord(continuity.MemOS)) return;
  const memos = continuity.MemOS;
  if (!Object.hasOwn(memos, "DigestSummaryCharacterLimit")) return;
  if (!Object.hasOwn(memos, "DigestSummaryTokenLimit")) {
    memos.DigestSummaryTokenLimit = memos.DigestSummaryCharacterLimit;
    migratedPaths.push(`${prefix}ContinuityLearning.MemOS.DigestSummaryTokenLimit`);
  }
  delete memos.DigestSummaryCharacterLimit;
  removedPaths.push(`${prefix}ContinuityLearning.MemOS.DigestSummaryCharacterLimit`);
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
