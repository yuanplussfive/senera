import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActivatedSkill, AgentPinnedSkillReference } from "../Skills/AgentSkillActivation.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { AgentToolSearchCurrentSetPolicy } from "../ToolSearch/AgentToolSearchRuntimeTypes.js";
import { AgentToolSearchCurrentSetPolicies } from "../ToolSearch/AgentToolSearchRuntimeTypes.js";
import type { AgentPromptContextService, AgentRetrievalService } from "../Runtime/AgentRuntimeServices.js";
import type { AgentToolCapabilityCacheEntry } from "../ToolSearch/AgentToolCapabilitySessionCache.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";

export interface AgentPreparedTurn {
  loadedToolNames: string[];
  toolAccessGrant: AgentToolAccessGrant;
  rootCommand: AgentRootCommand;
  activeSkills: AgentActivatedSkill[];
  reusableCapabilities: readonly AgentToolCapabilityCacheEntry[];
}

export interface AgentTurnPreparationRuntime {
  services: {
    retrieval: Pick<AgentRetrievalService, "resolvePlannedLoadedTools" | "reusableCapabilities">;
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
    userInput: string;
    sessionId?: string;
    logicalCacheScope?: string;
    loadedToolNames: readonly string[];
    allowedToolNames?: readonly string[];
    interaction?: AgentInteractionContext;
    pinnedSkills?: readonly AgentPinnedSkillReference[];
    signal?: AbortSignal;
  }): Promise<AgentPreparedTurn> {
    const activeSkills = await this.runtime.services.promptContext.activateSkills({
      input: input.userInput,
      pinnedSkills: input.pinnedSkills,
      signal: input.signal,
    });
    const recommendedToolRouting = this.runtime.services.promptContext.recommendedSkillToolRouting(activeSkills);
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
      // Dynamic capabilities are deliberately not guessed from the raw user
      // utterance here. Native planning has the fixed discovery bridge, and
      // BAML has ToolLoad, so both modes can disclose a contract only after
      // the model intentionally searches and describes it.
      discover: false,
      ...(input.interaction ? { interaction: input.interaction } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const loadedToolNames = intersectAllowedToolNames(resolvedToolNames, input.allowedToolNames);

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
      toolAccessGrant: rootCommand.toolAccessGrant,
      rootCommand,
      activeSkills,
      reusableCapabilities,
    };
  }

  private resolveLoadedTools(options: {
    input: string;
    currentLoadedTools: string[];
    currentSetPolicy: AgentToolSearchCurrentSetPolicy;
    preferredTools: readonly string[];
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
