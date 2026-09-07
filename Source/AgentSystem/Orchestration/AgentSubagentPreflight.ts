import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentExtensionRegistryLike } from "../Types/ToolRuntimeTypes.js";
import type { AgentPinnedSkillReference } from "../Skills/AgentSkillActivation.js";
import type { AgentRunContextMode } from "./AgentRunDispatchPort.js";
import {
  AgentChildRunModelSelectionSources,
  type AgentChildRunModelSelectionSource,
  type AgentChildWorkspaceAccessMode,
} from "./AgentChildRunTypes.js";
import {
  AgentSubagentLaunchContractVersion,
  type AgentSubagentCapabilityCeiling,
  type AgentSubagentLaunchContract,
} from "./AgentSubagentContracts.js";
import { AgentSubagentToolGrantProjector } from "./AgentSubagentToolGrantProjector.js";
import { AgentSubagentContractCompiler, type AgentSubagentExecutionContract } from "./AgentSubagentContractCompiler.js";
import type { AgentSubagentResolvedModelPool } from "./AgentSubagentModelPool.js";
import {
  AgentSubagentRoleCatalog,
  type AgentSubagentRoleCatalogPort,
  type AgentSubagentRoleDefinition,
} from "./AgentSubagentRoleCatalog.js";

export interface AgentSubagentPreflightInput {
  readonly runId: string;
  readonly agent: string;
  readonly task: string;
  readonly context?: AgentRunContextMode;
  readonly workspaceRoot: string;
  readonly modelPool: AgentSubagentResolvedModelPool;
  readonly parentModelProviderId?: string;
  readonly parentThinkingLevel?: ModelThinkingLevel;
  readonly requestedModelProviderId?: string;
  readonly requestedModelSelectionSource?: AgentChildRunModelSelectionSource;
  readonly requestedThinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  readonly configuredSkillNames?: readonly string[];
  readonly configuredThinkingLevel?: ModelThinkingLevel;
  readonly requestedSkillNames?: readonly string[];
  readonly inheritedSkills?: readonly AgentPinnedSkillReference[];
  readonly authorizedToolNames: readonly string[];
  readonly inheritedCapabilityCeiling?: AgentSubagentCapabilityCeiling;
  readonly registry: AgentExtensionRegistryLike;
  readonly workspaceAccess: AgentChildWorkspaceAccessMode;
}

export type AgentSubagentLaunchPlan = AgentSubagentExecutionContract;

export interface AgentSubagentPreflightPort {
  resolve(input: AgentSubagentPreflightInput): Promise<AgentSubagentLaunchPlan>;
}

export interface AgentSubagentPreflightOptions {
  readonly toolGrants?: AgentSubagentToolGrantProjector;
  readonly compiler?: AgentSubagentContractCompiler;
  readonly roleCatalog?: AgentSubagentRoleCatalogPort;
}

export class AgentSubagentPreflight implements AgentSubagentPreflightPort {
  private readonly toolGrants: AgentSubagentToolGrantProjector;
  private readonly compiler: AgentSubagentContractCompiler;
  private readonly roleCatalog: AgentSubagentRoleCatalogPort;

  constructor(options: AgentSubagentPreflightOptions = {}) {
    this.toolGrants = options.toolGrants ?? new AgentSubagentToolGrantProjector();
    this.compiler = options.compiler ?? new AgentSubagentContractCompiler();
    this.roleCatalog = options.roleCatalog ?? new AgentSubagentRoleCatalog();
  }

  async resolve(input: AgentSubagentPreflightInput): Promise<AgentSubagentLaunchPlan> {
    const role = this.roleCatalog.resolve(input.workspaceRoot, input.agent);
    assertRoleAllowed(role, input.inheritedCapabilityCeiling);
    const model = resolveModel(role, input);
    const thinking =
      input.requestedThinking ?? role.thinking ?? input.configuredThinkingLevel ?? input.parentThinkingLevel;
    const allowedAgentNames = intersectAllowedAgentNames(
      this.roleCatalog.snapshot(input.workspaceRoot).roles.map((candidate) => candidate.id),
      input.inheritedCapabilityCeiling?.allowedAgents,
    );
    const tools = this.toolGrants.project(input.authorizedToolNames, input.registry, {
      workspaceAccess: input.workspaceAccess,
      canDelegate: role.canDelegate,
      allowedAgentNames,
      inheritedCeiling: input.inheritedCapabilityCeiling,
    });
    const contractBase = {
      version: AgentSubagentLaunchContractVersion,
      runId: input.runId,
      role: {
        id: role.id,
        description: role.description,
        source: role.source,
        filePath: role.filePath,
        revision: role.revision,
        canDelegate: role.canDelegate,
      },
      context: input.context ?? role.defaultContext,
      ...(model.selectedModelProviderId ? { model: model.selectedModelProviderId } : {}),
      modelCandidates: model.candidateModelProviderIds,
      ...(thinking ? { thinking } : {}),
      systemPromptMode: role.systemPromptMode,
      inheritProjectContext: role.inheritProjectContext,
      inheritSkills: role.inheritSkills,
      skills: { requested: [...role.skills] },
      tools: {
        effectiveToolNames: [...tools.effectiveToolNames],
        capabilityCeiling: tools.capabilityCeiling,
      },
      diagnostics: [],
    } satisfies Omit<AgentSubagentLaunchContract, "launchContractDigest">;
    const launchContract: AgentSubagentLaunchContract = {
      ...contractBase,
      launchContractDigest: sha256HexOfCanonicalJson({
        ...contractBase,
        task: input.task,
        requestedSkills: input.requestedSkillNames ?? [],
      }),
    };

    return this.compiler.compile({
      launchContract,
      role,
      modelPool: input.modelPool,
      registry: input.registry,
      requestedModelProviderId: input.requestedModelProviderId,
      requestedModelSelectionSource: input.requestedModelSelectionSource,
      parentThinkingLevel: input.parentThinkingLevel,
      configuredSkillNames: input.configuredSkillNames ?? [],
      requestedSkillNames: input.requestedSkillNames ?? [],
      inheritedSkills: input.inheritedSkills ?? [],
      workspaceAccess: input.workspaceAccess,
    });
  }
}

function intersectAllowedAgentNames(
  catalogAgentNames: readonly string[],
  inheritedAllowedAgentNames: readonly string[] | undefined,
): string[] {
  const inherited = inheritedAllowedAgentNames ? new Set(inheritedAllowedAgentNames) : undefined;
  return [...new Set(catalogAgentNames)]
    .filter((agentName) => !inherited || inherited.has(agentName))
    .sort((left, right) => left.localeCompare(right));
}

export class AgentSubagentPreflightError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentSubagentPreflightError";
  }
}

function assertRoleAllowed(
  role: AgentSubagentRoleDefinition,
  inherited: AgentSubagentCapabilityCeiling | undefined,
): void {
  if (!inherited?.allowedAgents || inherited.allowedAgents.includes(role.id)) return;
  throw new AgentSubagentPreflightError(
    "agent_not_allowed",
    `Subagent role '${role.id}' is outside the inherited capability ceiling.`,
  );
}

function resolveModel(
  role: AgentSubagentRoleDefinition,
  input: AgentSubagentPreflightInput,
): {
  readonly selectedModelProviderId?: string;
  readonly candidateModelProviderIds: string[];
} {
  const requested = input.requestedModelProviderId
    ? requireModelProviderId(input.requestedModelProviderId, input.modelPool)
    : undefined;
  const roleModel = role.model ? requireModelProviderId(role.model, input.modelPool) : undefined;
  const selectedModelProviderId = requested ?? roleModel ?? input.modelPool.fallbackModelProviderId;
  const roleFallbacks = role.fallbackModels.map((model) => requireModelProviderId(model, input.modelPool));
  return {
    selectedModelProviderId,
    candidateModelProviderIds: [
      ...new Set([selectedModelProviderId, ...roleFallbacks, ...input.modelPool.modelProviderIds]),
    ],
  };
}

function requireModelProviderId(model: string, pool: AgentSubagentResolvedModelPool): string {
  const matches = pool.providers.filter(
    (candidate) => candidate.Id === model || `${candidate.ProviderId}/${candidate.Model}` === model,
  );
  if (matches.length === 1) return matches[0]!.Id;
  if (matches.length > 1)
    throw new AgentSubagentPreflightError("ambiguous_model", `Subagent model '${model}' is ambiguous.`);
  throw new AgentSubagentPreflightError(
    "model_not_allowed",
    `Subagent model '${model}' is outside the configured model pool.`,
  );
}

export function resolveAgentSubagentModelSelectionSource(
  input: AgentSubagentPreflightInput,
  role: AgentSubagentRoleDefinition,
  selectedModelProviderId: string,
): AgentChildRunModelSelectionSource {
  if (input.requestedModelProviderId === selectedModelProviderId && input.requestedModelSelectionSource) {
    return input.requestedModelSelectionSource;
  }
  if (role.model) return AgentChildRunModelSelectionSources.Role;
  if (
    input.modelPool.inheritedModelProviderId === selectedModelProviderId &&
    input.modelPool.inheritedSelectionSource
  ) {
    return input.modelPool.inheritedSelectionSource;
  }
  return AgentChildRunModelSelectionSources.ExtensionDefault;
}
