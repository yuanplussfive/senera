import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActivatedSkill, AgentPinnedSkillReference } from "../Skills/AgentSkillActivation.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { AgentToolSearchCurrentSetPolicy } from "../ToolSearch/AgentToolSearchRuntimeTypes.js";
import { AgentToolSearchCurrentSetPolicies } from "../ToolSearch/AgentToolSearchRuntimeTypes.js";
import type { AgentPromptContextService, AgentRetrievalService } from "../Runtime/AgentRuntimeServices.js";
import type { AgentToolCapabilityCacheEntry } from "../ToolSearch/AgentToolCapabilitySessionCache.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import type { AgentStateCard } from "../StateCard/AgentStateCardTypes.js";
import type { AgentExplicitActivationReference } from "../Activation/AgentActivationTypes.js";

export interface AgentPreparedTurn {
  loadedToolNames: string[];
  nativeToolNames: string[];
  toolAccessGrant: AgentToolAccessGrant;
  rootCommand: AgentRootCommand;
  activeSkills: AgentActivatedSkill[];
  explicitActivations: AgentExplicitActivationReference[];
  stateCard: AgentStateCard;
  reusableCapabilities: readonly AgentToolCapabilityCacheEntry[];
}

export interface AgentTurnPreparationRuntime {
  services: {
    retrieval: Pick<AgentRetrievalService, "resolvePlannedLoadedTools" | "resolveStateCard" | "reusableCapabilities">;
    promptContext: Pick<
      AgentPromptContextService,
      "activateSkills" | "recommendedSkillToolRouting" | "buildRootCommand" | "interactionToolNames"
    >;
  };
}

export class AgentTurnPreparationService {
  constructor(private readonly runtime: AgentTurnPreparationRuntime) {}

  async prepare(input: {
    requestId: string;
    turnIndex?: number;
    userInput: string;
    sessionId?: string;
    logicalCacheScope?: string;
    loadedToolNames: readonly string[];
    allowedToolNames?: readonly string[];
    interaction?: AgentInteractionContext;
    pinnedSkills?: readonly AgentPinnedSkillReference[];
    explicitActivations?: readonly AgentExplicitActivationReference[];
    signal?: AbortSignal;
  }): Promise<AgentPreparedTurn> {
    const activeSkills = await this.runtime.services.promptContext.activateSkills({
      input: input.userInput,
      availableToolNames: uniqueToolNames([
        ...input.loadedToolNames,
        ...(this.runtime.services.promptContext.interactionToolNames?.(input.interaction) ?? []),
      ]),
      pinnedSkills: input.pinnedSkills,
      explicitActivations: input.explicitActivations,
      signal: input.signal,
    });
    const recommendedToolRouting = this.runtime.services.promptContext.recommendedSkillToolRouting(
      activeSkills,
      input.explicitActivations,
    );
    const stateCard = await this.runtime.services.retrieval.resolveStateCard({
      requestId: input.requestId,
      currentRequest: input.userInput,
      turnIndex: input.turnIndex,
      sessionId: input.sessionId,
      logicalCacheScope: input.logicalCacheScope,
      activeSkills,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const reusableCapabilities = input.sessionId
      ? (this.runtime.services.retrieval.reusableCapabilities?.({
          sessionId: input.sessionId,
          logicalCacheScope: input.logicalCacheScope,
          query: input.userInput,
          authorizedToolNames: input.allowedToolNames,
          ...(input.interaction ? { interaction: input.interaction } : {}),
        }) ?? [])
      : [];
    const reusableToolNames = reusableCapabilities.map((entry) => entry.toolName);
    const currentLoadedTools = uniqueToolNames([
      ...input.loadedToolNames,
      ...recommendedToolRouting.directToolNames,
      ...reusableToolNames,
      ...(this.runtime.services.promptContext.interactionToolNames?.(input.interaction) ?? []),
    ]);
    const resolvedToolNames = await this.resolveLoadedTools({
      input: input.userInput,
      currentLoadedTools,
      currentSetPolicy: AgentToolSearchCurrentSetPolicies.Retain,
      preferredTools: recommendedToolRouting.dynamicToolNames,
      requiredToolNames: recommendedToolRouting.requiredToolNames,
      // Dynamic capabilities are deliberately not guessed from the raw user
      // utterance here. Explicit activations are the deliberate exception:
      // their exact registry-owned tools are loaded without semantic search.
      discover: false,
      ...(input.interaction ? { interaction: input.interaction } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const loadedToolNames = intersectAllowedToolNames(resolvedToolNames, input.allowedToolNames);
    assertRequiredToolNamesAvailable(
      recommendedToolRouting.requiredToolNames,
      resolvedToolNames,
      loadedToolNames,
      input.allowedToolNames,
    );
    const nativeToolNames = intersectAllowedToolNames(recommendedToolRouting.nativeToolNames, loadedToolNames);
    const rootCommand = this.runtime.services.promptContext.buildRootCommand({
      decision: {
        action: "use_tools",
        useTools: {
          preferredTools: [...recommendedToolRouting.dynamicToolNames],
          instruction: "",
          needs: [],
        },
      },
      loadedToolNames,
      allowedToolNames: input.allowedToolNames,
    });

    return {
      loadedToolNames,
      nativeToolNames,
      toolAccessGrant: rootCommand.toolAccessGrant,
      rootCommand,
      activeSkills,
      explicitActivations: [...(input.explicitActivations ?? [])],
      stateCard,
      reusableCapabilities,
    };
  }

  private resolveLoadedTools(options: {
    input: string;
    currentLoadedTools: string[];
    currentSetPolicy: AgentToolSearchCurrentSetPolicy;
    preferredTools: readonly string[];
    requiredToolNames: readonly string[];
    discover: boolean;
    interaction?: AgentInteractionContext;
    signal?: AbortSignal;
  }): Promise<string[]> {
    return this.runtime.services.retrieval.resolvePlannedLoadedTools({
      ...options,
      queries: [],
      needs: [],
    });
  }
}

function uniqueToolNames(toolNames: readonly string[]): string[] {
  return [...new Set(toolNames.map((toolName) => toolName.trim()).filter(Boolean))];
}

function intersectAllowedToolNames(
  toolNames: readonly string[],
  allowedToolNames: readonly string[] | undefined,
): string[] {
  if (!allowedToolNames) return [...toolNames];
  const allowed = new Set(allowedToolNames);
  return toolNames.filter((toolName) => allowed.has(toolName));
}

function assertRequiredToolNamesAvailable(
  requiredToolNames: readonly string[],
  resolvedToolNames: readonly string[],
  loadedToolNames: readonly string[],
  allowedToolNames: readonly string[] | undefined,
): void {
  const required = uniqueToolNames(requiredToolNames);
  if (required.length === 0) return;

  const resolved = new Set(resolvedToolNames);
  const loaded = new Set(loadedToolNames);
  const missingFromRuntime = required.filter((toolName) => !resolved.has(toolName));
  const missingFromAuthorization = required.filter((toolName) => resolved.has(toolName) && !loaded.has(toolName));
  if (missingFromRuntime.length > 0) {
    throw new Error(
      `Explicit activation requires unavailable tool${missingFromRuntime.length === 1 ? "" : "s"}: ${missingFromRuntime.join(", ")}.`,
    );
  }
  if (missingFromAuthorization.length > 0) {
    const authorizationScope = allowedToolNames ? "outside this run's authorized tool scope" : "not authorized";
    throw new Error(
      `Explicit activation requires tool${missingFromAuthorization.length === 1 ? "" : "s"} ${authorizationScope}: ${missingFromAuthorization.join(", ")}.`,
    );
  }
}
