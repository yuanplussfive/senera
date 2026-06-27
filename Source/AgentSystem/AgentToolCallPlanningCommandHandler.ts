import type { AgentEventSink } from "./AgentEvent.js";
import type { AgentLoopEventFactory } from "./AgentLoopEventFactory.js";
import type {
  AgentLoopCommand,
  AgentLoopCommandResult,
} from "./AgentLoopStateMachine.js";
import { AgentRetryableError } from "./AgentRetryableError.js";
import type { AgentSystemRuntime } from "./AgentSystemRuntime.js";
import type {
  AgentActionDecision,
  AgentToolCallPlanningOutcome,
} from "./AgentActionPlanner.js";
import type { ResolvedAgentLoopConfig } from "./Types/AgentConfigTypes.js";
import type { AgentActionPlannerContextBuilder } from "./AgentActionPlannerContext.js";
import { AgentToolCallPlanXmlRenderer } from "./AgentToolCallPlanXmlRenderer.js";

export interface AgentToolCallPlanningCommandHandlerOptions {
  runtime: AgentSystemRuntime;
  eventFactory: AgentLoopEventFactory;
  actionPlannerContextBuilder: AgentActionPlannerContextBuilder;
  agentLoopConfig: ResolvedAgentLoopConfig;
}

export class AgentToolCallPlanningCommandHandler {
  private readonly toolCallPlanRenderer: AgentToolCallPlanXmlRenderer;

  constructor(private readonly options: AgentToolCallPlanningCommandHandlerOptions) {
    this.toolCallPlanRenderer = new AgentToolCallPlanXmlRenderer(
      options.runtime.xmlPolicy.protocol,
    );
  }

  async collect(
    command: Extract<AgentLoopCommand, { kind: "collect_tool_call_plan" }>,
    onEvent?: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    try {
      const dynamicTools = this.options.agentLoopConfig.LoadedTools === "dynamic";
      const roleplayPreset = await this.options.runtime.services.promptContext.plannerRoleplayPreset();
      const plannerInput = this.options.actionPlannerContextBuilder.buildInput({
        requestId: command.requestId,
        userMessage: command.input,
        currentStep: command.step,
        dynamicTools,
        loadedToolNames: command.loadedToolNames,
        messages: command.messages,
        conversationEntries: command.conversationEntries,
        ledger: command.plannerLedger,
        toolCatalog: this.options.runtime.services.promptContext.toolCatalog(),
        activeSkills: command.activeSkills,
        turnUnderstanding: command.turnUnderstanding,
        roleplayPreset,
      });
      const promptContext = this.options.runtime.services.promptContext.buildBaseContext({
        loadedToolNames: command.loadedToolNames,
        rootCommand: command.rootCommand,
        skillQuery: command.input,
        activeSkills: command.activeSkills,
      });
      const toolUsePatterns = this.options.runtime.services.retrieval.toolUsePatterns({
        input: command.turnUnderstanding?.standaloneRequest ?? command.input,
        allowedTools: command.rootCommand.allowedTools,
      });
      const outcome = await this.options.runtime.services.planning.planToolCallOutcome({
        input: {
          actionInput: plannerInput,
          rootCommand: command.rootCommand,
          toolContracts: promptContext.ToolCards,
          toolUsePatterns,
        },
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

      if (outcome.kind === "needsDiscovery") {
        return this.planToolDiscoveryEscalation(command, outcome);
      }

      if (outcome.kind === "blocked") {
        return this.projectToolPlanningBlocked(command, outcome);
      }

      const toolCallsXml = this.toolCallPlanRenderer.render(outcome.calls);

      return {
        kind: "succeeded",
        output: {
          kind: "tool_calls_collected",
          requestId: command.requestId,
          step: command.step,
          responseText: toolCallsXml,
          toolCallsXml,
        },
      };
    } catch (error) {
      if (error instanceof AgentRetryableError) {
        return {
          kind: "retryable_failed",
          requestId: command.requestId,
          step: command.step,
          error,
          responseText: "",
        };
      }
      throw error;
    }
  }

  private planToolDiscoveryEscalation(
    command: Extract<AgentLoopCommand, { kind: "collect_tool_call_plan" }>,
    outcome: Extract<AgentToolCallPlanningOutcome, { kind: "needsDiscovery" }>,
  ): AgentLoopCommandResult {
    if (command.toolPlanDiscoveryEscalated) {
      return this.projectToolPlanningBlocked(command, {
        kind: "blocked",
        reason: outcome.reason,
        issues: outcome.issues,
        repaired: outcome.repaired,
      });
    }

    const decision: AgentActionDecision = {
      action: "discover_tools",
      discoverTools: {
        queries: outcome.queries,
        needs: outcome.needs,
      },
    };
    const loadedToolNames = this.options.runtime.services.retrieval.resolvePlannedLoadedTools({
      input: command.turnUnderstanding?.standaloneRequest ?? command.input,
      loadedTools: this.options.agentLoopConfig.LoadedTools,
      currentLoadedTools: command.loadedToolNames,
      queries: outcome.queries,
      needs: outcome.needs,
      discover: true,
    });
    const rootCommand = this.options.runtime.services.promptContext.buildRootCommand({
      decision,
      loadedToolNames,
    });

    if (rootCommand.allowedTools.length === 0) {
      return this.projectToolPlanningBlocked(command, {
        kind: "blocked",
        reason: "工具调用计划为空，且当前没有可用的工具发现能力。",
        issues: outcome.issues,
        repaired: outcome.repaired,
      });
    }

    this.options.runtime.services.retrieval.rememberAutoSearch(
      command.requestId,
      command.turnUnderstanding?.standaloneRequest ?? command.input,
      loadedToolNames,
    );

    return {
      kind: "succeeded",
      output: {
        kind: "tool_call_discovery_planned",
        requestId: command.requestId,
        step: command.step,
        reason: outcome.reason,
        issues: outcome.issues,
        loadedToolNames,
        rootCommand,
        activeSkills: command.activeSkills,
      },
    };
  }

  private projectToolPlanningBlocked(
    command: Extract<AgentLoopCommand, { kind: "collect_tool_call_plan" }>,
    outcome: Extract<AgentToolCallPlanningOutcome, { kind: "blocked" }>,
  ): AgentLoopCommandResult {
    const rootCommand = this.options.runtime.services.promptContext.buildRootCommand({
      decision: {
        action: "answer",
      },
      loadedToolNames: command.loadedToolNames,
    });

    return {
      kind: "succeeded",
      output: {
        kind: "tool_call_planning_blocked",
        requestId: command.requestId,
        step: command.step,
        reason: outcome.reason,
        issues: outcome.issues,
        rootCommand,
        systemPromptPreamble: toolPlanningBlockedPreamble(outcome),
      },
    };
  }
}

function toolPlanningBlockedPreamble(
  outcome: Extract<AgentToolCallPlanningOutcome, { kind: "blocked" }>,
): string {
  return JSON.stringify({
    seneraRuntimeObservation: {
      kind: "tool_call_planning_blocked",
      reason: outcome.reason,
      issues: outcome.issues,
      instruction: "Answer from the available conversation context. If required evidence is unavailable, say what cannot be confirmed.",
    },
  }, null, 2);
}
