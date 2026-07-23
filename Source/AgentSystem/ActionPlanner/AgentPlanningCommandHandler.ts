import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentLoopEventFactory } from "../Loop/AgentLoopEventFactory.js";
import type { AgentLoopCommand, AgentLoopCommandResult } from "../Loop/AgentLoopStateTypes.js";
import type {
  AgentPlanningService,
  AgentPromptContextService,
  AgentRetrievalService,
} from "../Runtime/AgentRuntimeServices.js";
import type { AgentActionPlannerContextBuilder } from "./AgentActionPlannerContext.js";
import { AgentInteractionRunModes } from "./AgentInteractionRouter.js";
import type { AgentInteractionRouteResult } from "./AgentInteractionRouter.js";
import type { ActionPlanInput, TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import { projectPiToolAgentRootCommand } from "../Pi/AgentPiRootCommand.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import type { AgentPiRuntimeService } from "../Pi/AgentPiSubstrate.js";
import type { ParsedPiControllerAction } from "../PiProxy/AgentPiAssistantMessageSchema.js";
import type { AgentActionDecision } from "./AgentActionPlannerTypes.js";
import {
  AgentToolSearchCurrentSetPolicies,
  type AgentToolSearchCurrentSetPolicy,
} from "../ToolSearch/AgentToolSearchRuntimeTypes.js";
import type { AgentPiToolCard } from "../PiProxy/AgentPiAssistantMessageTypes.js";
import { collectPlannerFailureToolNames } from "./AgentActionPlannerFailure.js";

export interface AgentPlanningCommandHandlerOptions {
  runtime: AgentPlanningCommandRuntime;
  eventFactory: Pick<AgentLoopEventFactory, "actionPlannerStage">;
  actionPlannerContextBuilder: Pick<AgentActionPlannerContextBuilder, "buildInput">;
}

export interface AgentPlanningCommandRuntime {
  services: {
    planning: AgentPlanningService;
    pi: Pick<AgentPiRuntimeService, "planningToolCards">;
    retrieval: Pick<AgentRetrievalService, "resolvePlannedLoadedTools" | "rememberAutoSearch">;
    promptContext: Pick<
      AgentPromptContextService,
      "activateSkills" | "recommendedSkillTools" | "buildRootCommand" | "plannerRoleplayPreset" | "toolCatalog"
    >;
  };
  conversationPolicy: Pick<AgentConversationPolicy, "materialize">;
}

export class AgentPlanningCommandHandler {
  constructor(private readonly options: AgentPlanningCommandHandlerOptions) {}

  async prepareInteraction(
    command: Extract<AgentLoopCommand, { kind: "prepare_interaction" }>,
    onEvent?: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    const timelineMessages = this.buildActionPlannerTimelineMessages(command);
    const roleplayPreset = await this.options.runtime.services.promptContext.plannerRoleplayPreset();
    const preRouteSkills = this.options.runtime.services.promptContext.activateSkills({
      input: command.input,
    });
    const preRouteRecommendedTools = this.options.runtime.services.promptContext.recommendedSkillTools(preRouteSkills);
    const planningLoadedToolNames =
      preRouteRecommendedTools.length > 0
        ? this.resolveRouteLoadedTools({
            input: command.input,
            currentLoadedTools: command.loadedToolNames,
            currentSetPolicy: AgentToolSearchCurrentSetPolicies.Retain,
            preferredTools: preRouteRecommendedTools,
            queries: [],
          })
        : command.loadedToolNames;
    const buildPlanningInput = (loadedToolNames: string[]) =>
      this.options.actionPlannerContextBuilder.buildInput({
        requestId: command.requestId,
        userMessage: command.input,
        currentStep: command.step,
        loadedToolNames,
        messages: timelineMessages,
        conversationEntries: command.conversationEntries,
        ledger: command.plannerLedger,
        toolCatalog: this.options.runtime.services.promptContext.toolCatalog(),
        activeSkills: preRouteSkills,
        roleplayPreset,
      });
    const prepared = await this.prepareWithRegisteredToolPromotion({
      requestId: command.requestId,
      step: command.step,
      input: command.input,
      planningLoadedToolNames,
      buildInput: buildPlanningInput,
      onEvent,
      signal,
    });
    const routed = prepared.routed;
    const availablePlanningToolNames = prepared.loadedToolNames;
    const route = routed.route;
    const initialAction = routed.initialAction;
    const turnUnderstanding = projectTurnUnderstanding(routed.input.turnUnderstanding);
    const standaloneInput = turnUnderstanding?.standaloneRequest ?? command.input;
    const preparedToolNames = initialActionToolNames(initialAction);

    const initialLoadedToolNames =
      route.mode === AgentInteractionRunModes.ToolAgentLoop
        ? this.resolveRouteLoadedTools({
            input: standaloneInput,
            currentLoadedTools: availablePlanningToolNames,
            currentSetPolicy: AgentToolSearchCurrentSetPolicies.Retain,
            preferredTools: uniqueText([...route.preferredTools, ...preparedToolNames]),
            queries: route.discoveryQueries,
          })
        : [];
    const initialPreferredTools = uniqueText([...route.preferredTools, ...preparedToolNames]);
    const initialRootCommand = this.buildRuntimeRootCommand(
      route,
      initialAction,
      initialLoadedToolNames,
      initialPreferredTools,
    );
    const activeSkills = mergeActivatedSkills([
      ...preRouteSkills,
      ...this.options.runtime.services.promptContext.activateSkills({
        input: standaloneInput,
        rootCommand: initialRootCommand,
      }),
    ]);
    const skillRecommendedTools = this.options.runtime.services.promptContext.recommendedSkillTools(activeSkills);
    const preferredTools = uniqueText([...initialPreferredTools, ...skillRecommendedTools]);
    const loadedToolNames =
      route.mode === AgentInteractionRunModes.ToolAgentLoop
        ? this.resolveRouteLoadedTools({
            input: standaloneInput,
            currentLoadedTools: initialLoadedToolNames,
            currentSetPolicy: AgentToolSearchCurrentSetPolicies.Retain,
            preferredTools,
            queries: route.discoveryQueries,
          })
        : [];
    if (route.mode === AgentInteractionRunModes.ToolAgentLoop) {
      this.options.runtime.services.retrieval.rememberAutoSearch(command.requestId, standaloneInput, loadedToolNames);
    }
    const runtimeRootCommand = this.buildRuntimeRootCommand(route, initialAction, loadedToolNames, preferredTools);
    const rootCommand =
      route.mode === AgentInteractionRunModes.ToolAgentLoop
        ? projectPiToolAgentRootCommand(runtimeRootCommand)
        : runtimeRootCommand;

    return {
      kind: "succeeded",
      output: {
        kind: "interaction_prepared",
        requestId: command.requestId,
        step: command.step,
        route,
        loadedToolNames,
        rootCommand,
        initialAction,
        turnUnderstanding,
        activeSkills,
      },
    };
  }

  private async prepareWithRegisteredToolPromotion(options: {
    requestId: string;
    step: number;
    input: string;
    planningLoadedToolNames: string[];
    buildInput: (loadedToolNames: string[]) => ActionPlanInput;
    onEvent?: AgentEventSink;
    signal?: AbortSignal;
  }): Promise<{
    routed: Awaited<ReturnType<AgentPlanningService["prepareInteraction"]>>;
    loadedToolNames: string[];
  }> {
    const prepare = (loadedToolNames: string[], candidateTools: readonly AgentPiToolCard[]) =>
      this.options.runtime.services.planning.prepareInteraction({
        input: options.buildInput(loadedToolNames),
        candidateTools,
        onStage: async (event) => {
          await options.onEvent?.(this.options.eventFactory.actionPlannerStage(options.requestId, options.step, event));
        },
        signal: options.signal,
      });
    const candidateTools = this.options.runtime.services.pi.planningToolCards({
      visibleToolNames: options.planningLoadedToolNames,
    });

    try {
      return {
        routed: await prepare(options.planningLoadedToolNames, candidateTools),
        loadedToolNames: options.planningLoadedToolNames,
      };
    } catch (error) {
      const allTools = this.options.runtime.services.pi.planningToolCards();
      const registeredTools = new Map(allTools.map((tool) => [tool.name, tool] as const));
      const promotedToolNames = collectPlannerFailureToolNames(error).filter(
        (toolName) => registeredTools.has(toolName) && !candidateTools.some((tool) => tool.name === toolName),
      );
      if (promotedToolNames.length === 0) throw error;

      const loadedToolNames = this.resolveRouteLoadedTools({
        input: options.input,
        currentLoadedTools: options.planningLoadedToolNames,
        currentSetPolicy: AgentToolSearchCurrentSetPolicies.Retain,
        preferredTools: promotedToolNames,
        queries: [],
      });
      const promotedCandidates = this.options.runtime.services.pi.planningToolCards({
        visibleToolNames: loadedToolNames,
      });
      if (promotedCandidates.every((tool) => candidateTools.some((candidate) => candidate.name === tool.name))) {
        throw error;
      }
      return {
        routed: await prepare(loadedToolNames, promotedCandidates),
        loadedToolNames,
      };
    }
  }

  private resolveRouteLoadedTools(options: {
    input: string;
    currentLoadedTools: string[];
    currentSetPolicy: AgentToolSearchCurrentSetPolicy;
    preferredTools: readonly string[];
    queries: readonly string[];
  }): string[] {
    return this.options.runtime.services.retrieval.resolvePlannedLoadedTools({
      input: options.input,
      currentLoadedTools: options.currentLoadedTools,
      currentSetPolicy: options.currentSetPolicy,
      preferredTools: options.preferredTools,
      queries: options.queries,
      needs: [],
      discover: false,
    });
  }

  private buildRuntimeRootCommand(
    route: AgentInteractionRouteResult,
    initialAction: ParsedPiControllerAction,
    loadedToolNames: string[],
    preferredTools: readonly string[],
  ) {
    const decision = projectInitialActionDecision(initialAction, route, preferredTools);
    return this.options.runtime.services.promptContext.buildRootCommand({
      decision,
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

    const messages = this.options.runtime.conversationPolicy.materialize(command.conversationEntries, {
      toolResultsScope: {
        kind: "request",
        requestId: command.requestId,
      },
      evidenceMemoryScope: {
        kind: "all",
      },
    });

    return messages.length > 0 ? messages : command.messages;
  }
}

function projectInitialActionDecision(
  action: ParsedPiControllerAction,
  route: AgentInteractionRouteResult,
  preferredTools: readonly string[],
): AgentActionDecision {
  const projectors = {
    FinalAnswer: (): AgentActionDecision => ({ action: "answer" }),
    AskUser: (): AgentActionDecision => ({
      action: "ask_user",
      askUser: {
        question: action.question ?? route.objective,
        reason: null,
      },
    }),
    CallTools: (): AgentActionDecision => ({
      action: "use_tools",
      useTools: {
        preferredTools: [...preferredTools],
        instruction: route.objective,
        needs: [],
      },
    }),
  } satisfies Record<ParsedPiControllerAction["kind"], () => AgentActionDecision>;
  return projectors[action.kind]();
}

function initialActionToolNames(action: ParsedPiControllerAction): string[] {
  return action.kind === "CallTools" ? uniqueText((action.calls ?? []).map((call) => call.toolName)) : [];
}

function projectTurnUnderstanding(value: TurnUnderstanding | null | undefined): TurnUnderstanding | undefined {
  return value ?? undefined;
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function mergeActivatedSkills(skills: readonly AgentActivatedSkill[]): AgentActivatedSkill[] {
  return [
    ...skills
      .reduce((byName, skill) => {
        const current = byName.get(skill.name);
        byName.set(skill.name, current && current.score >= skill.score ? current : skill);
        return byName;
      }, new Map<string, AgentActivatedSkill>())
      .values(),
  ];
}
