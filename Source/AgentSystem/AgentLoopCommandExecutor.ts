import type { AgentEventSink } from "./AgentEvent.js";
import type { AgentLanguageModel } from "./AgentLanguageModel.js";
import { AgentLoopEventFactory } from "./AgentLoopEventFactory.js";
import { AgentDecisionErrorFactory } from "./AgentDecisionErrorFactory.js";
import type {
  AgentLoopCommand,
  AgentLoopCommandResult,
} from "./AgentLoopStateMachine.js";
import { matchByKind } from "./AgentMatch.js";
import { AgentRetryPlanner } from "./AgentRetryPlanner.js";
import type { AgentSystemRuntime } from "./AgentSystemRuntime.js";
import { AgentRetryableError } from "./AgentRetryableError.js";
import { AgentDecisionXmlCollectionRetryableError } from "./AgentDecisionXmlCollector.js";
import { AgentActionPlannerContextBuilder } from "./AgentActionPlannerContext.js";
import type { ResolvedAgentLoopConfig } from "./Types/AgentConfigTypes.js";
import { AgentToolCallPlanningCommandHandler } from "./AgentToolCallPlanningCommandHandler.js";
import { AgentDecisionExecutionCommandHandler } from "./AgentDecisionExecutionCommandHandler.js";
import { AgentPlanningCommandHandler } from "./AgentPlanningCommandHandler.js";

export interface AgentLoopCommandExecutorOptions {
  runtime: AgentSystemRuntime;
  model: AgentLanguageModel;
  agentLoopConfig?: ResolvedAgentLoopConfig;
}

export class AgentLoopCommandExecutor {
  private readonly retryPlanner: AgentRetryPlanner;
  private readonly eventFactory = new AgentLoopEventFactory();
  private readonly planning: AgentPlanningCommandHandler;
  private readonly toolCallPlanning: AgentToolCallPlanningCommandHandler;
  private readonly decisionExecution: AgentDecisionExecutionCommandHandler;
  private readonly decisionXmlCollector;
  private readonly actionPlannerContextBuilder;
  private readonly agentLoopConfig: ResolvedAgentLoopConfig;

  constructor(private readonly options: AgentLoopCommandExecutorOptions) {
    this.agentLoopConfig = options.agentLoopConfig ?? options.runtime.agentLoopConfig;
    const errorFactory = new AgentDecisionErrorFactory({
      registry: options.runtime.registry,
      promptRenderer: options.runtime.promptRenderer,
      workspaceRoot: options.runtime.workspaceRoot,
      protocol: options.runtime.xmlPolicy.protocol,
    });
    this.retryPlanner = new AgentRetryPlanner(errorFactory);
    this.decisionXmlCollector = options.runtime.createDecisionXmlCollector(options.model);
    this.actionPlannerContextBuilder = new AgentActionPlannerContextBuilder(
      options.runtime.workspaceRoot,
      options.runtime.artifactsConfig.RootDir,
      {
        stalledStepLag: options.runtime.actionPlannerConfig.Evidence.StalledStepLag,
      },
    );
    this.planning = new AgentPlanningCommandHandler({
      runtime: options.runtime,
      eventFactory: this.eventFactory,
      actionPlannerContextBuilder: this.actionPlannerContextBuilder,
      agentLoopConfig: this.agentLoopConfig,
    });
    this.toolCallPlanning = new AgentToolCallPlanningCommandHandler({
      runtime: options.runtime,
      eventFactory: this.eventFactory,
      actionPlannerContextBuilder: this.actionPlannerContextBuilder,
      agentLoopConfig: this.agentLoopConfig,
    });
    this.decisionExecution = new AgentDecisionExecutionCommandHandler({
      runtime: options.runtime,
      actionPlannerContextBuilder: this.actionPlannerContextBuilder,
      agentLoopConfig: this.agentLoopConfig,
    });
  }

  async execute(
    command: AgentLoopCommand,
    onEvent?: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    return matchByKind(command, {
      route_interaction: (entry) => this.planning.routeInteraction(entry, onEvent, signal),
      plan_action: (entry) => this.planning.planAction(entry, onEvent, signal),
      render_prompt: (entry) => this.renderPrompt(entry),
      collect_tool_call_plan: (entry) => this.toolCallPlanning.collect(entry, onEvent, signal),
      collect_decision_xml: (entry) => this.collectDecisionXml(entry, onEvent, signal),
      parse_decision: (entry) => this.parseDecision(entry),
      execute_decision: (entry) => this.decisionExecution.execute(entry, onEvent, signal),
      plan_retry: (entry) => this.planRetry(entry),
    });
  }

  private async renderPrompt(
    command: Extract<AgentLoopCommand, { kind: "render_prompt" }>,
  ): Promise<AgentLoopCommandResult> {
    const template = this.options.runtime.registry.getTemplate("BaseSystemPrompt");
    if (!template) {
      throw new Error("BaseSystemPrompt 模板没有注册。");
    }

    const toolDescription = this.options.runtime.config.PluginDocumentation?.ToolDescription;
    const actionDescription =
      this.options.runtime.config.PluginDocumentation?.DecisionActionDescription;
    const roleplayPreset = await this.options.runtime.services.promptContext.promptRoleplayPreset();

    const prompt = await this.options.runtime.promptRenderer.renderFile(template.path, {
      ...this.options.runtime.services.promptContext.buildBaseContext({
        loadedToolNames: command.loadedToolNames,
        rootCommand: command.rootCommand,
        roleplayPreset,
        skillQuery: command.input,
        activeSkills: command.activeSkills,
        toolSections: {
          summary: toolDescription?.SummarySection,
          trigger: toolDescription?.TriggerSection,
          avoid: toolDescription?.AvoidSection,
        },
        actionSections: {
          summary: actionDescription?.SummarySection,
          trigger: actionDescription?.TriggerSection,
          avoid: actionDescription?.AvoidSection,
        },
      }),
    });
    const renderedPrompt = command.systemPromptPreamble
      ? `${command.systemPromptPreamble}\n\n${prompt}`
      : prompt;

    return {
      kind: "succeeded",
      output: {
        kind: "prompt_rendered",
        requestId: command.requestId,
        step: command.step,
        prompt: renderedPrompt,
        promptTokenCount: this.options.runtime.tokenEstimator.estimate(renderedPrompt).tokenCount,
      },
    };
  }

  private async collectDecisionXml(
    command: Extract<AgentLoopCommand, { kind: "collect_decision_xml" }>,
    onEvent?: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    let collection;
    try {
      collection = await this.decisionXmlCollector.collect({
        requestId: command.requestId,
        step: command.step,
        systemPrompt: command.prompt,
        messages: command.messages,
        rootCommand: command.rootCommand,
        onEvent,
        signal,
      });
    } catch (error) {
      if (error instanceof AgentRetryableError) {
        return {
          kind: "retryable_failed",
          requestId: command.requestId,
          step: command.step,
          error,
          responseText: error instanceof AgentDecisionXmlCollectionRetryableError
            ? error.responseText
            : "",
        };
      }
      throw error;
    }

    return collection.kind === "token_limit"
      ? {
          kind: "retryable_failed",
          requestId: command.requestId,
          step: command.step,
          error: this.retryPlanner.buildDecisionXmlTokenLimitError(collection.budget),
          responseText: collection.text,
        }
      : collection.kind === "tool_calls"
        ? {
          kind: "succeeded",
          output: {
            kind: "tool_calls_collected",
            requestId: command.requestId,
            step: command.step,
            responseText: collection.text,
            toolCallsXml: collection.toolCallsXml,
            modelProvider: collection.modelProvider,
            usage: collection.usage,
          },
        }
        : {
          kind: "succeeded",
          output: {
            kind: "final_text_collected",
            requestId: command.requestId,
            step: command.step,
            responseText: collection.text,
            modelProvider: collection.modelProvider,
            usage: collection.usage,
          },
        };
  }

  private async parseDecision(
    command: Extract<AgentLoopCommand, { kind: "parse_decision" }>,
  ): Promise<AgentLoopCommandResult> {
    try {
      const parsed = await this.options.runtime.decisionParser.parseSanitized(command.responseText);
      return {
        kind: "succeeded",
        output: {
          kind: "decision_parsed",
          requestId: command.requestId,
          step: command.step,
          responseText: parsed.decision.source.xml,
          decision: parsed.decision,
          sanitized: parsed.sanitized,
        },
      };
    } catch (error) {
      return this.retryableFailure(command.requestId, command.step, command.responseText, error);
    }
  }

  private async planRetry(
    command: Extract<AgentLoopCommand, { kind: "plan_retry" }>,
  ): Promise<AgentLoopCommandResult> {
    return {
      kind: "succeeded",
      output: {
        kind: "retry_planned",
        requestId: command.requestId,
        step: command.step,
        attempt: command.attempt,
        instruction: command.error.instruction,
        responseText: command.responseText,
        repairedMessages: this.retryPlanner.buildRepairConversation(
          command.messages,
          command.responseText,
          command.error,
        ),
      },
    };
  }

  private retryableFailure(
    requestId: string,
    step: number,
    responseText: string,
    error: unknown,
  ): AgentLoopCommandResult {
    if (error instanceof Error && "instruction" in error) {
      return {
        kind: "retryable_failed",
        requestId,
        step,
        error: error as import("./AgentRetryableError.js").AgentRetryableError,
        responseText,
      };
    }

    throw error;
  }

}
