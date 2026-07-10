import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentLoopEventFactory } from "../Loop/AgentLoopEventFactory.js";
import type {
  AgentLoopCommand,
  AgentLoopCommandResult,
} from "../Loop/AgentLoopStateTypes.js";
import type {
  AgentPlanningService,
  AgentPromptContextService,
  AgentRetrievalService,
} from "../Runtime/AgentRuntimeServices.js";
import type { AgentActionPlannerContextBuilder } from "./AgentActionPlannerContext.js";
import type { ResolvedAgentLoopConfig } from "../Types/AgentConfigTypes.js";
import { AgentInteractionRunModes } from "./AgentInteractionRouter.js";
import type { AgentInteractionRouteResult } from "./AgentInteractionRouter.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import { projectPiToolAgentRootCommand } from "../Pi/AgentPiRootCommand.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";

export interface AgentPlanningCommandHandlerOptions {
  runtime: AgentPlanningCommandRuntime;
  eventFactory: Pick<AgentLoopEventFactory, "actionPlannerStage">;
  actionPlannerContextBuilder: Pick<AgentActionPlannerContextBuilder, "buildInput">;
  agentLoopConfig: ResolvedAgentLoopConfig;
}

export interface AgentPlanningCommandRuntime {
  services: {
    planning: AgentPlanningService;
    retrieval: Pick<
      AgentRetrievalService,
      "resolvePlannedLoadedTools" | "rememberAutoSearch"
    >;
    promptContext: Pick<
      AgentPromptContextService,
      | "activateSkills"
      | "recommendedSkillTools"
      | "buildRootCommand"
      | "plannerRoleplayPreset"
      | "toolCatalog"
    >;
  };
  conversationPolicy: Pick<AgentConversationPolicy, "materialize">;
}

export class AgentPlanningCommandHandler {
  constructor(private readonly options: AgentPlanningCommandHandlerOptions) {}

  async understandTurn(
    command: Extract<AgentLoopCommand, { kind: "understand_turn" }>,
    onEvent?: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    const dynamicTools = this.options.agentLoopConfig.LoadedTools === "dynamic";
    const timelineMessages = this.buildActionPlannerTimelineMessages(command);
    const roleplayPreset = await this.options.runtime.services.promptContext.plannerRoleplayPreset();
    const input = this.options.actionPlannerContextBuilder.buildInput({
      requestId: command.requestId,
      userMessage: command.input,
      currentStep: command.step,
      dynamicTools,
      loadedToolNames: command.loadedToolNames,
      messages: timelineMessages,
      conversationEntries: command.conversationEntries,
      ledger: command.plannerLedger,
      toolCatalog: this.options.runtime.services.promptContext.toolCatalog(),
      activeSkills: [],
      roleplayPreset,
    });
    const understood = await this.options.runtime.services.planning.understandTurn({
      input,
      onStage: async (event) => {
        await onEvent?.(
          this.options.eventFactory.actionPlannerStage(
            command.requestId,
            command.step,
            event,
          ),
        );
      },
      signal,
    });

    return {
      kind: "succeeded",
      output: {
        kind: "turn_understood",
        requestId: command.requestId,
        step: command.step,
        turnUnderstanding: projectTurnUnderstanding(understood.turnUnderstanding),
      },
    };
  }

  async routeInteraction(
    command: Extract<AgentLoopCommand, { kind: "route_interaction" }>,
    onEvent?: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    const dynamicTools = this.options.agentLoopConfig.LoadedTools === "dynamic";
    const timelineMessages = this.buildActionPlannerTimelineMessages(command);
    const roleplayPreset = await this.options.runtime.services.promptContext.plannerRoleplayPreset();
    const preliminaryInput = command.turnUnderstanding?.standaloneRequest ?? command.input;
    const preRouteSkills = command.activeSkills.length > 0
      ? command.activeSkills
      : this.options.runtime.services.promptContext.activateSkills({
          input: preliminaryInput,
        });
    const input = this.options.actionPlannerContextBuilder.buildInput({
      requestId: command.requestId,
      userMessage: command.input,
      currentStep: command.step,
      dynamicTools,
      loadedToolNames: command.loadedToolNames,
      messages: timelineMessages,
      conversationEntries: command.conversationEntries,
      ledger: command.plannerLedger,
      toolCatalog: this.options.runtime.services.promptContext.toolCatalog(),
      activeSkills: preRouteSkills,
      turnUnderstanding: command.turnUnderstanding,
      roleplayPreset,
    });
    const routed = await this.options.runtime.services.planning.routeWithInput({
      input,
      onStage: async (event) => {
        await onEvent?.(
          this.options.eventFactory.actionPlannerStage(
            command.requestId,
            command.step,
            event,
          ),
        );
      },
      signal,
    });
    const route = routed.route;
    const turnUnderstanding = projectTurnUnderstanding(routed.input.turnUnderstanding);
    const standaloneInput = turnUnderstanding?.standaloneRequest ?? command.input;

    const initialLoadedToolNames = route.mode === AgentInteractionRunModes.ToolAgentLoop
      ? this.resolveRouteLoadedTools({
          input: standaloneInput,
          currentLoadedTools: command.loadedToolNames,
          preferredTools: route.preferredTools,
          queries: route.discoveryQueries,
        })
      : [];
    const initialRootCommand = this.buildRuntimeRootCommand(route, initialLoadedToolNames, route.preferredTools);
    const activeSkills = mergeActivatedSkills([
      ...preRouteSkills,
      ...this.options.runtime.services.promptContext.activateSkills({
        input: standaloneInput,
        rootCommand: initialRootCommand,
      }),
    ]);
    const skillRecommendedTools = this.options.runtime.services.promptContext
      .recommendedSkillTools(activeSkills);
    const preferredTools = uniqueText([
      ...route.preferredTools,
      ...skillRecommendedTools,
    ]);
    const loadedToolNames = route.mode === AgentInteractionRunModes.ToolAgentLoop
      ? this.resolveRouteLoadedTools({
          input: standaloneInput,
          currentLoadedTools: initialLoadedToolNames,
          preferredTools,
          queries: route.discoveryQueries,
        })
      : [];
    if (route.mode === AgentInteractionRunModes.ToolAgentLoop) {
      this.options.runtime.services.retrieval.rememberAutoSearch(
        command.requestId,
        standaloneInput,
        loadedToolNames,
      );
    }
    const runtimeRootCommand = this.buildRuntimeRootCommand(route, loadedToolNames, preferredTools);
    const rootCommand = route.mode === AgentInteractionRunModes.ToolAgentLoop
      ? projectPiToolAgentRootCommand(runtimeRootCommand)
      : runtimeRootCommand;

    return {
      kind: "succeeded",
      output: {
        kind: "interaction_routed",
        requestId: command.requestId,
        step: command.step,
        route,
        loadedToolNames,
        rootCommand,
        turnUnderstanding,
        activeSkills,
      },
    };
  }

  private resolveRouteLoadedTools(options: {
    input: string;
    currentLoadedTools: "all" | string[];
    preferredTools: readonly string[];
    queries: readonly string[];
  }): "all" | string[] {
    return this.options.runtime.services.retrieval.resolvePlannedLoadedTools({
      input: options.input,
      loadedTools: this.options.agentLoopConfig.LoadedTools,
      currentLoadedTools: options.currentLoadedTools,
      preferredTools: options.preferredTools,
      queries: options.queries,
      needs: [],
      discover: false,
    });
  }

  private buildRuntimeRootCommand(
    route: AgentInteractionRouteResult,
    loadedToolNames: "all" | string[],
    preferredTools: readonly string[],
  ) {
    return this.options.runtime.services.promptContext.buildRootCommand({
      decision: route.mode === AgentInteractionRunModes.ToolAgentLoop
        ? {
            action: "use_tools",
            useTools: {
              preferredTools: [...preferredTools],
              instruction: route.objective,
              needs: [],
            },
          }
        : {
            action: "answer",
          },
      loadedToolNames,
    });
  }

  private buildActionPlannerTimelineMessages(command: {
    messages: readonly AgentLanguageModelMessage[];
    conversationEntries: readonly AgentConversationEntry[];
    requestId: string;
  }) {
    if (command.conversationEntries.length === 0) {
      return command.messages;
    }

    const messages = this.options.runtime.conversationPolicy.materialize(
      command.conversationEntries,
      {
        toolResultsScope: {
          kind: "request",
          requestId: command.requestId,
        },
        evidenceMemoryScope: {
          kind: "all",
        },
      },
    );

    return messages.length > 0 ? messages : command.messages;
  }
}

function projectTurnUnderstanding(
  value: TurnUnderstanding | null | undefined,
): TurnUnderstanding | undefined {
  return value ?? undefined;
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function mergeActivatedSkills(
  skills: readonly AgentActivatedSkill[],
): AgentActivatedSkill[] {
  return [
    ...skills.reduce((byName, skill) => {
      const current = byName.get(skill.name);
      byName.set(skill.name, current && current.score >= skill.score ? current : skill);
      return byName;
    }, new Map<string, AgentActivatedSkill>()).values(),
  ];
}
