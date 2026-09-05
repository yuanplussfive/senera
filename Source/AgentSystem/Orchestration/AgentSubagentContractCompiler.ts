import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentPinnedSkillReference } from "../Skills/AgentSkillActivation.js";
import type { AgentExtensionRegistryLike } from "../Types/ToolRuntimeTypes.js";
import {
  AgentChildRunModelSelectionSources,
  type AgentChildRunModelSelectionSource,
  type AgentChildWorkspaceAccessMode,
} from "./AgentChildRunTypes.js";
import type {
  AgentSubagentCapabilityCeiling,
  AgentSubagentDiagnostic,
  AgentSubagentLaunchContract,
} from "./AgentSubagentContracts.js";
import type { AgentSystemPromptLayer } from "./AgentRunDispatchPort.js";
import type { AgentSubagentResolvedModelPool } from "./AgentSubagentModelPool.js";
import type { AgentSubagentRoleDefinition } from "./AgentSubagentRoleCatalog.js";

const TextCompletionInstruction = [
  "## Completion contract",
  "Finish the delegated run with a terminal assistant response addressed to your supervisor.",
  "Senera persists that text as the child result; do not construct a host-specific result envelope.",
].join("\n");

export interface AgentSubagentModelPlan {
  readonly requestedModelProviderId?: string;
  readonly selectedModelProviderId?: string;
  readonly candidateModelProviderIds: readonly string[];
  readonly selectionSource?: AgentChildRunModelSelectionSource;
  readonly thinkingLevel?: ModelThinkingLevel;
}

export interface AgentSubagentExecutionContract {
  readonly launchContract: AgentSubagentLaunchContract;
  readonly promptLayer: AgentSystemPromptLayer;
  readonly model: AgentSubagentModelPlan;
  readonly pinnedSkills: readonly AgentPinnedSkillReference[];
  readonly allowedToolNames: readonly string[];
  readonly workspaceAccess: AgentChildWorkspaceAccessMode;
  readonly inheritProjectContext: boolean;
  readonly capabilityCeiling: AgentSubagentCapabilityCeiling;
  readonly diagnostics: readonly AgentSubagentDiagnostic[];
}

export interface AgentSubagentContractCompilerInput {
  readonly launchContract: AgentSubagentLaunchContract;
  readonly role: AgentSubagentRoleDefinition;
  readonly modelPool: AgentSubagentResolvedModelPool;
  readonly registry: AgentExtensionRegistryLike;
  readonly requestedModelProviderId?: string;
  readonly requestedModelSelectionSource?: AgentChildRunModelSelectionSource;
  readonly parentThinkingLevel?: ModelThinkingLevel;
  readonly configuredSkillNames: readonly string[];
  readonly requestedSkillNames: readonly string[];
  readonly inheritedSkills: readonly AgentPinnedSkillReference[];
  readonly workspaceAccess: AgentChildWorkspaceAccessMode;
}

export class AgentSubagentContractCompiler {
  compile(input: AgentSubagentContractCompilerInput): AgentSubagentExecutionContract {
    const model = compileModelPlan(input);
    const pinnedSkills = compilePinnedSkills(input);
    return {
      launchContract: input.launchContract,
      promptLayer: compilePromptLayer(input),
      model,
      pinnedSkills,
      allowedToolNames: [...input.launchContract.tools.effectiveToolNames],
      workspaceAccess: input.workspaceAccess,
      inheritProjectContext: input.launchContract.inheritProjectContext,
      capabilityCeiling: input.launchContract.tools.capabilityCeiling,
      diagnostics: input.launchContract.diagnostics,
    };
  }
}

function compileModelPlan(input: AgentSubagentContractCompilerInput): AgentSubagentModelPlan {
  const selectedModelProviderId = input.launchContract.model ?? input.modelPool.fallbackModelProviderId;
  const selectionSource = resolveModelSelectionSource(input, selectedModelProviderId);
  return {
    ...(input.requestedModelProviderId ? { requestedModelProviderId: input.requestedModelProviderId } : {}),
    selectedModelProviderId,
    candidateModelProviderIds: [...input.launchContract.modelCandidates],
    ...(selectionSource ? { selectionSource } : {}),
    ...(input.launchContract.thinking ? { thinkingLevel: input.launchContract.thinking } : {}),
  };
}

function resolveModelSelectionSource(
  input: AgentSubagentContractCompilerInput,
  selectedModelProviderId: string,
): AgentChildRunModelSelectionSource | undefined {
  if (input.requestedModelProviderId === selectedModelProviderId && input.requestedModelSelectionSource) {
    return input.requestedModelSelectionSource;
  }
  if (input.role.model) return AgentChildRunModelSelectionSources.Role;
  if (input.modelPool.inheritedModelProviderId === selectedModelProviderId) {
    return input.modelPool.inheritedSelectionSource;
  }
  return AgentChildRunModelSelectionSources.ExtensionDefault;
}

function compilePinnedSkills(input: AgentSubagentContractCompilerInput): AgentPinnedSkillReference[] {
  const inherited = input.launchContract.inheritSkills ? input.inheritedSkills : [];
  const names = unique([
    ...input.configuredSkillNames,
    ...input.launchContract.skills.requested,
    ...input.requestedSkillNames,
    ...inherited.map((skill) => skill.name),
  ]);
  const inheritedByName = new Map(inherited.map((skill) => [skill.name, skill]));
  return names.map((name) => {
    const skill = input.registry.getSkill?.(name);
    if (!skill) throw new Error(`Delegated child Skill is not registered: ${name}.`);
    const revision = skill.revision ?? skill.source.id;
    const inheritedReference = inheritedByName.get(name);
    if (inheritedReference && inheritedReference.revision !== revision) {
      throw new Error(`Inherited Skill ${name} changed revision from ${inheritedReference.revision} to ${revision}.`);
    }
    return { name, revision };
  });
}

function compilePromptLayer(input: AgentSubagentContractCompilerInput): AgentSystemPromptLayer {
  const sections = [
    `You are running as the delegated Senera role '${input.role.id}'.`,
    "Senera host policy, approval, execution environment, Tool contracts, and the user's instructions remain authoritative.",
    input.role.systemPrompt,
    TextCompletionInstruction,
  ].filter((section): section is string => Boolean(section));
  return { mode: input.launchContract.systemPromptMode, content: sections.join("\n\n") };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
