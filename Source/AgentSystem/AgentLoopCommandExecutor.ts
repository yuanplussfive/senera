import type { AgentDecisionExecutor } from "./AgentDecisionExecutor.js";
import type { AgentExecutionResult } from "./AgentDecisionExecutor.js";
import { AgentExecutionProjector } from "./AgentExecutionProjector.js";
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
import { AgentToolResultXmlRenderer } from "./AgentToolResultXmlRenderer.js";
import type { AgentConversationEntry } from "./AgentConversation.js";
import { AgentRetryableError } from "./AgentRetryableError.js";
import { AgentDecisionXmlCollectionRetryableError } from "./AgentDecisionXmlCollector.js";
import { AgentActionPlannerContextBuilder } from "./AgentActionPlannerContext.js";

export interface AgentLoopCommandExecutorOptions {
  runtime: AgentSystemRuntime;
  model: AgentLanguageModel;
}

export class AgentLoopCommandExecutor {
  private readonly retryPlanner: AgentRetryPlanner;
  private readonly executionProjector = new AgentExecutionProjector();
  private readonly resultRenderer: AgentToolResultXmlRenderer;
  private readonly decisionXmlCollector;
  private readonly actionPlannerContextBuilder;

  constructor(private readonly options: AgentLoopCommandExecutorOptions) {
    const errorFactory = new AgentDecisionErrorFactory({
      registry: options.runtime.registry,
      promptRenderer: options.runtime.promptRenderer,
      workspaceRoot: options.runtime.workspaceRoot,
      protocol: options.runtime.xmlPolicy.protocol,
    });
    this.retryPlanner = new AgentRetryPlanner(errorFactory);
    this.resultRenderer = new AgentToolResultXmlRenderer(options.runtime.xmlPolicy.protocol);
    this.decisionXmlCollector = options.runtime.createDecisionXmlCollector(options.model);
    this.actionPlannerContextBuilder = new AgentActionPlannerContextBuilder();
  }

  async execute(
    command: AgentLoopCommand,
    onEvent?: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    return matchByKind(command, {
      plan_action: (entry) => this.planAction(entry, signal),
      render_prompt: (entry) => this.renderPrompt(entry),
      collect_decision_xml: (entry) => this.collectDecisionXml(entry, onEvent, signal),
      parse_decision: (entry) => this.parseDecision(entry),
      execute_decision: (entry) => this.executeDecision(entry, onEvent),
      plan_retry: (entry) => this.planRetry(entry),
    });
  }

  private async planAction(
    command: Extract<AgentLoopCommand, { kind: "plan_action" }>,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    const dynamicTools = this.options.runtime.agentLoopConfig.LoadedTools === "dynamic";
    const plan = await this.options.runtime.actionPlanner.plan({
      requestId: command.requestId,
      input: this.actionPlannerContextBuilder.buildInput({
        userMessage: command.input,
        currentStep: command.step,
        dynamicTools,
        loadedToolNames: command.loadedToolNames,
        messages: command.messages,
        ledger: command.plannerLedger,
        toolCatalog: this.options.runtime.toolCatalog
          .list()
          .slice(0, this.options.runtime.actionPlannerConfig.MaxCatalogTools),
      }),
      signal,
    });
    const decision = plan.kind === "planned" ? plan.decision : undefined;
    const loadedToolNames = decision
      ? this.options.runtime.toolSearch.resolvePlannedLoadedTools({
          input: command.input,
          loadedTools: this.options.runtime.agentLoopConfig.LoadedTools,
          currentLoadedTools: command.loadedToolNames,
          tags: decision.tags,
          plannerText: [
            decision.intent,
            decision.nextStepGoal,
            decision.progressAssessment,
            decision.instructionToMainModel,
          ],
          preferredTools: decision.preferredTools,
          toolSearchQueries: decision.toolSearchQueries,
          discover: decision.action === "discover_tools",
        })
      : this.options.runtime.toolSearch.resolvePlannedLoadedTools({
          input: command.input,
          loadedTools: this.options.runtime.agentLoopConfig.LoadedTools,
          currentLoadedTools: command.loadedToolNames,
        });

    this.options.runtime.toolSearch.rememberAutoSearch(
      command.requestId,
      command.input,
      loadedToolNames,
    );

    return {
      kind: "succeeded",
      output: {
        kind: "action_planned",
        requestId: command.requestId,
        step: command.step,
        plan,
        loadedToolNames,
        plannerLedger: command.plannerLedger,
        actionDirective: decision,
      },
    };
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

    const prompt = await this.options.runtime.promptRenderer.renderFile(template.path, {
      ...this.options.runtime.promptContextBuilder.buildBaseContext({
        loadedToolNames: command.loadedToolNames,
        actionDirective: command.actionDirective,
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

    return {
      kind: "succeeded",
      output: {
        kind: "prompt_rendered",
        requestId: command.requestId,
        step: command.step,
        prompt,
        promptTokenCount: this.options.runtime.tokenEstimator.estimate(prompt).tokenCount,
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
        actionDirective: command.actionDirective,
        loadedToolNames: command.loadedToolNames,
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

  private async executeDecision(
    command: Extract<AgentLoopCommand, { kind: "execute_decision" }>,
    onEvent?: AgentEventSink,
  ): Promise<AgentLoopCommandResult> {
    try {
      const execution = await this.options.runtime.decisionExecutor.execute(command.decision, {
        requestId: command.requestId,
        step: command.step,
        onEvent,
        loadedToolNames: command.loadedToolNames,
      });
      const resultXml = execution.kind === "ToolResults"
        ? this.resultRenderer.render(execution)
        : undefined;

      if (execution.kind !== "ToolResults") {
        return this.projectTerminal(command.requestId, command.step, execution);
      }

      const loadedToolNames = this.options.runtime.toolSearch.afterToolResults({
        requestId: command.requestId,
        loadedTools: command.loadedToolNames,
        dynamicTools: this.options.runtime.agentLoopConfig.LoadedTools === "dynamic",
        execution,
      });
      const plannerLedger = this.actionPlannerContextBuilder.advanceAfterToolResults({
        ledger: command.plannerLedger,
        step: command.step,
        results: execution.value,
      });

      return {
        kind: "succeeded",
        output: {
          kind: "tool_results_generated",
          requestId: command.requestId,
          step: command.step,
          responseText: command.responseText,
          execution,
          resultXml: resultXml ?? "",
          messages: [
            ...command.messages,
            {
              role: "assistant",
              content: command.responseText,
            },
            {
              role: "user",
              content: this.options.runtime.conversationPolicy.renderContextToolResultsXml(resultXml ?? ""),
            },
          ],
          conversationEntries: this.buildToolResultConversationEntries(
            command.requestId,
            command.responseText,
            resultXml ?? "",
          ),
          loadedToolNames,
          plannerLedger,
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

  private projectTerminal(
    requestId: string,
    step: number,
    execution: Extract<AgentExecutionResult, { kind: "AskUser" }>,
  ): AgentLoopCommandResult {
    const projected = this.executionProjector.projectTerminal(requestId, execution);
    return {
      kind: "succeeded",
      output: {
        kind: "terminal_projected",
        requestId,
        step,
        projected,
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

  private buildToolResultConversationEntries(
    requestId: string,
    decisionXml: string,
    resultXml: string,
  ): AgentConversationEntry[] {
    const timestamp = new Date().toISOString();
    return [
      this.options.runtime.conversationProjector.projectAssistantDecision(
        requestId,
        decisionXml,
        timestamp,
      ),
      this.options.runtime.conversationProjector.projectContextToolResults(
        requestId,
        resultXml,
        timestamp,
      ),
    ];
  }
}
