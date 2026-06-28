import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentEventSink } from "../AgentEvent.js";
import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentLoopEventFactory } from "../Loop/AgentLoopEventFactory.js";
import type {
  AgentLoopCommand,
  AgentLoopCommandResult,
} from "../Loop/AgentLoopStateTypes.js";
import type { AgentSystemRuntime } from "../Runtime/AgentSystemRuntime.js";
import type { AgentActionPlannerContextBuilder } from "./AgentActionPlannerContext.js";
import {
  createPlannerJournalEntry,
  createPlannerStateSnapshotEntry,
} from "../Memory/AgentPlannerMemory.js";
import {
  agentActionCapabilityNeeds,
  agentActionPreferredTools,
  agentActionToolSearchQueries,
} from "./AgentActionPlanner.js";
import type { ResolvedAgentLoopConfig } from "../Types/AgentConfigTypes.js";
import type { AgentWorkflowSelectionResult } from "../AgentWorkflowSelector.js";
import type { AgentRootCommandWorkflowRecommendation } from "../AgentRootCommand.js";
import { AgentInteractionRunModes } from "./AgentInteractionRouter.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";

export interface AgentPlanningCommandHandlerOptions {
  runtime: AgentSystemRuntime;
  eventFactory: AgentLoopEventFactory;
  actionPlannerContextBuilder: AgentActionPlannerContextBuilder;
  agentLoopConfig: ResolvedAgentLoopConfig;
}

export class AgentPlanningCommandHandler {
  constructor(private readonly options: AgentPlanningCommandHandlerOptions) {}

  async routeInteraction(
    command: Extract<AgentLoopCommand, { kind: "route_interaction" }>,
    onEvent?: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    const dynamicTools = this.options.agentLoopConfig.LoadedTools === "dynamic";
    const timelineMessages = this.buildActionPlannerTimelineMessages(command);
    const activeSkills = this.options.runtime.services.promptContext.activateSkills({
      input: command.input,
    });
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
      activeSkills,
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

    if (route.mode === AgentInteractionRunModes.DeliberateTaskLoop) {
      return {
        kind: "succeeded",
        output: {
          kind: "interaction_routed",
          requestId: command.requestId,
          step: command.step,
          route,
          loadedToolNames: command.loadedToolNames,
          turnUnderstanding,
          activeSkills,
        },
      };
    }

    const loadedToolNames = route.mode === AgentInteractionRunModes.ToolAgentLoop
      ? this.options.runtime.services.retrieval.resolvePlannedLoadedTools({
          input: standaloneInput,
          loadedTools: this.options.agentLoopConfig.LoadedTools,
          currentLoadedTools: command.loadedToolNames,
          preferredTools: route.preferredTools,
          queries: route.discoveryQueries,
          needs: [],
          discover: false,
        })
      : [];
    if (route.mode === AgentInteractionRunModes.ToolAgentLoop) {
      this.options.runtime.services.retrieval.rememberAutoSearch(
        command.requestId,
        standaloneInput,
        loadedToolNames,
      );
    }
    const rootCommand = this.options.runtime.services.promptContext.buildRootCommand({
      decision: route.mode === AgentInteractionRunModes.ToolAgentLoop
        ? {
            action: "use_tools",
            useTools: {
              preferredTools: route.preferredTools,
              instruction: route.objective,
              needs: [],
            },
          }
        : {
            action: "answer",
          },
      loadedToolNames,
    });

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

  async planAction(
    command: Extract<AgentLoopCommand, { kind: "plan_action" }>,
    onEvent?: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    const dynamicTools = this.options.agentLoopConfig.LoadedTools === "dynamic";
    const timelineMessages = this.buildActionPlannerTimelineMessages(command);
    const activeSkills = this.options.runtime.services.promptContext.activateSkills({
      input: command.input,
    });
    const roleplayPreset = await this.options.runtime.services.promptContext.plannerRoleplayPreset();
    const preliminaryStandaloneInput = command.turnUnderstanding?.standaloneRequest ?? command.input;
    const plannerLoadedToolNames = this.options.runtime.services.retrieval.resolvePlannedLoadedTools({
      input: preliminaryStandaloneInput,
      loadedTools: this.options.agentLoopConfig.LoadedTools,
      currentLoadedTools: command.loadedToolNames,
      preferredTools: [],
      queries: [],
      needs: [],
      discover: false,
    });
    const plan = await this.options.runtime.services.planning.plan({
      requestId: command.requestId,
      input: this.options.actionPlannerContextBuilder.buildInput({
        requestId: command.requestId,
        userMessage: command.input,
        currentStep: command.step,
        dynamicTools,
        loadedToolNames: plannerLoadedToolNames,
        messages: timelineMessages,
        conversationEntries: command.conversationEntries,
        ledger: command.plannerLedger,
        toolCatalog: this.options.runtime.services.promptContext.toolCatalog(),
        activeSkills,
        turnUnderstanding: command.turnUnderstanding,
        roleplayPreset,
      }),
      signal,
      onStage: async (event) => {
        await onEvent?.(
          this.options.eventFactory.actionPlannerStage(
            command.requestId,
            command.step,
            event,
          ),
        );
      },
    });
    const turnUnderstanding = projectTurnUnderstanding(plan.input.turnUnderstanding);
    const standaloneInput = turnUnderstanding?.standaloneRequest ?? command.input;
    const decision = plan.decision;
    const workflowRecommendations = decision.action === "answer"
      ? []
      : this.options.runtime.services.workflow.select({
        input: standaloneInput,
        activeSkills,
      }).map(projectWorkflowRecommendation);
    const workflowRecommendedTools: string[] = [];
    const loadedToolNames = this.options.runtime.services.retrieval.resolvePlannedLoadedTools({
      input: standaloneInput,
      loadedTools: this.options.agentLoopConfig.LoadedTools,
      currentLoadedTools: plannerLoadedToolNames,
      preferredTools: [
        ...agentActionPreferredTools(decision),
        ...workflowRecommendedTools,
      ],
      queries: agentActionToolSearchQueries(decision),
      needs: agentActionCapabilityNeeds(decision),
      discover: decision.action === "discover_tools",
    });
    const rootCommand = this.options.runtime.services.promptContext.buildRootCommand({
      decision,
      loadedToolNames,
      taskContract: plan.taskFrame,
      workflowRecommendedTools,
      workflowRecommendations,
    });

    this.options.runtime.services.retrieval.rememberAutoSearch(
      command.requestId,
      standaloneInput,
      loadedToolNames,
    );

    const plannerStateEntry = createPlannerStateSnapshotEntry({
      requestId: command.requestId,
      step: command.step,
      plan,
      ledger: command.plannerLedger,
      loadedToolNames,
    });
    const plannerStateEntries = plannerStateEntry ? [plannerStateEntry] : [];

    return {
      kind: "succeeded",
      output: {
        kind: "action_planned",
        requestId: command.requestId,
        step: command.step,
        plan,
        loadedToolNames,
        plannerLedger: command.plannerLedger,
        activeSkills,
        conversationEntries: [
          ...command.conversationEntries,
          createPlannerJournalEntry({
            requestId: command.requestId,
            step: command.step,
            plan,
            loadedToolNames,
          }),
          ...plannerStateEntries,
        ],
        rootCommand,
        turnUnderstanding,
      },
    };
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

function projectWorkflowRecommendation(
  result: AgentWorkflowSelectionResult,
): AgentRootCommandWorkflowRecommendation {
  return {
    name: result.workflow.name,
    title: result.workflow.title,
    description: result.workflow.description,
    sources: result.sources,
    matchedSkills: result.matchedSkills,
    matchedAgents: result.matchedAgents,
    matchedTerms: result.matchedTerms,
  };
}

function projectTurnUnderstanding(
  value: TurnUnderstanding | null | undefined,
): TurnUnderstanding | undefined {
  return value ?? undefined;
}
