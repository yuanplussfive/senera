import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActivatedSkill, AgentPinnedSkillReference } from "../Skills/AgentSkillActivation.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { AgentToolSearchCurrentSetPolicy } from "../ToolSearch/AgentToolSearchRuntimeTypes.js";
import { AgentToolSearchCurrentSetPolicies } from "../ToolSearch/AgentToolSearchRuntimeTypes.js";
import type { AgentPromptContextService, AgentRetrievalService } from "../Runtime/AgentRuntimeServices.js";

export interface AgentPreparedTurn {
  loadedToolNames: string[];
  toolAccessGrant: AgentToolAccessGrant;
  rootCommand: AgentRootCommand;
  activeSkills: AgentActivatedSkill[];
}

export interface AgentTurnPreparationRuntime {
  services: {
    retrieval: Pick<AgentRetrievalService, "resolvePlannedLoadedTools" | "rememberAutoSearch" | "reusableCapabilities">;
    promptContext: Pick<AgentPromptContextService, "activateSkills" | "recommendedSkillTools" | "buildRootCommand">;
  };
}

export class AgentTurnPreparationService {
  constructor(private readonly runtime: AgentTurnPreparationRuntime) {}

  async prepare(input: {
    requestId: string;
    userInput: string;
    sessionId?: string;
    loadedToolNames: readonly string[];
    allowedToolNames?: readonly string[];
    pinnedSkills?: readonly AgentPinnedSkillReference[];
    signal?: AbortSignal;
  }): Promise<AgentPreparedTurn> {
    const activeSkills = await this.runtime.services.promptContext.activateSkills({
      input: input.userInput,
      pinnedSkills: input.pinnedSkills,
      signal: input.signal,
    });
    const preferredToolNames = this.runtime.services.promptContext.recommendedSkillTools(activeSkills);
    const reusableCapabilities = input.sessionId
      ? (this.runtime.services.retrieval.reusableCapabilities?.({
          sessionId: input.sessionId,
          query: input.userInput,
          authorizedToolNames: input.allowedToolNames,
          limit: 6,
        }) ?? [])
      : [];
    const reusableToolNames = reusableCapabilities.map((entry) => entry.toolName);
    const currentLoadedTools = uniqueToolNames([...input.loadedToolNames, ...reusableToolNames]);
    const discover =
      reusableCapabilities.length === 0 || preferredToolNames.some((toolName) => !reusableToolNames.includes(toolName));
    const resolvedToolNames = await this.resolveLoadedTools({
      input: input.userInput,
      currentLoadedTools,
      currentSetPolicy: AgentToolSearchCurrentSetPolicies.Retain,
      preferredTools: preferredToolNames,
      discover,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const loadedToolNames = intersectAllowedToolNames(resolvedToolNames, input.allowedToolNames);
    this.runtime.services.retrieval.rememberAutoSearch(input.requestId, input.userInput, loadedToolNames);

    const rootCommand = this.runtime.services.promptContext.buildRootCommand({
      decision: {
        action: "use_tools",
        useTools: {
          preferredTools: preferredToolNames,
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
    };
  }

  private resolveLoadedTools(options: {
    input: string;
    currentLoadedTools: string[];
    currentSetPolicy: AgentToolSearchCurrentSetPolicy;
    preferredTools: readonly string[];
    discover: boolean;
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
