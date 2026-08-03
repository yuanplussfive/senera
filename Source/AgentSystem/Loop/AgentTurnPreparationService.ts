import type { AgentRootCommand } from "../AgentRootCommand.js";
import { projectPiToolAgentRootCommand } from "../Pi/AgentPiRootCommand.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
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
    retrieval: Pick<AgentRetrievalService, "resolvePlannedLoadedTools" | "rememberAutoSearch">;
    promptContext: Pick<AgentPromptContextService, "activateSkills" | "recommendedSkillTools" | "buildRootCommand">;
  };
}

export class AgentTurnPreparationService {
  constructor(private readonly runtime: AgentTurnPreparationRuntime) {}

  async prepare(input: {
    requestId: string;
    userInput: string;
    loadedToolNames: readonly string[];
    signal?: AbortSignal;
  }): Promise<AgentPreparedTurn> {
    const activeSkills = await this.runtime.services.promptContext.activateSkills({
      input: input.userInput,
      signal: input.signal,
    });
    const preferredToolNames = this.runtime.services.promptContext.recommendedSkillTools(activeSkills);
    const loadedToolNames = await this.resolveLoadedTools({
      input: input.userInput,
      currentLoadedTools: [...input.loadedToolNames],
      currentSetPolicy: AgentToolSearchCurrentSetPolicies.Retain,
      preferredTools: preferredToolNames,
      discover: true,
    });
    this.runtime.services.retrieval.rememberAutoSearch(input.requestId, input.userInput, loadedToolNames);

    const rootCommand = projectPiToolAgentRootCommand(
      this.runtime.services.promptContext.buildRootCommand({
        decision: {
          action: "use_tools",
          useTools: {
            preferredTools: preferredToolNames,
            instruction: input.userInput,
            needs: [],
          },
        },
        loadedToolNames,
      }),
    );

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
  }): Promise<string[]> {
    return this.runtime.services.retrieval.resolvePlannedLoadedTools({
      ...options,
      queries: [],
      needs: [],
    });
  }
}
