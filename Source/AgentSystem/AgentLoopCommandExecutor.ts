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
import type { ExecutedToolCallResult } from "./Types.js";
import { AgentRetryableError } from "./AgentRetryableError.js";
import { AgentDecisionXmlCollectionRetryableError } from "./AgentDecisionXmlCollector.js";
import { AgentActionPlannerContextBuilder } from "./AgentActionPlannerContext.js";
import {
  createPlannerJournalEntry,
  createToolEvidenceMemoryEntries,
} from "./AgentPlannerMemory.js";
import {
  agentActionCapabilityNeeds,
  agentActionPreferredTools,
  agentActionToolSearchQueries,
} from "./AgentActionPlanner.js";
import { throwIfAborted } from "./AgentCancellation.js";
import type { ResolvedAgentLoopConfig } from "./Types.js";
import { AgentWorkflowSelector } from "./AgentWorkflowSelector.js";
import type { AgentRootCommandWorkflowRecommendation } from "./AgentRootCommand.js";

export interface AgentLoopCommandExecutorOptions {
  runtime: AgentSystemRuntime;
  model: AgentLanguageModel;
  agentLoopConfig?: ResolvedAgentLoopConfig;
}

export class AgentLoopCommandExecutor {
  private readonly retryPlanner: AgentRetryPlanner;
  private readonly executionProjector = new AgentExecutionProjector();
  private readonly eventFactory = new AgentLoopEventFactory();
  private readonly resultRenderer: AgentToolResultXmlRenderer;
  private readonly decisionXmlCollector;
  private readonly actionPlannerContextBuilder;
  private readonly agentLoopConfig: ResolvedAgentLoopConfig;
  private readonly workflowSelector: AgentWorkflowSelector;

  constructor(private readonly options: AgentLoopCommandExecutorOptions) {
    this.agentLoopConfig = options.agentLoopConfig ?? options.runtime.agentLoopConfig;
    const errorFactory = new AgentDecisionErrorFactory({
      registry: options.runtime.registry,
      promptRenderer: options.runtime.promptRenderer,
      workspaceRoot: options.runtime.workspaceRoot,
      protocol: options.runtime.xmlPolicy.protocol,
    });
    this.retryPlanner = new AgentRetryPlanner(errorFactory);
    this.resultRenderer = new AgentToolResultXmlRenderer(options.runtime.xmlPolicy.protocol);
    this.decisionXmlCollector = options.runtime.createDecisionXmlCollector(options.model);
    this.actionPlannerContextBuilder = new AgentActionPlannerContextBuilder(
      options.runtime.workspaceRoot,
      options.runtime.artifactsConfig.RootDir,
      {
        stalledStepLag: options.runtime.actionPlannerConfig.Evidence.StalledStepLag,
      },
    );
    this.workflowSelector = new AgentWorkflowSelector(options.runtime.registry);
  }

  async execute(
    command: AgentLoopCommand,
    onEvent?: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    return matchByKind(command, {
      plan_action: (entry) => this.planAction(entry, onEvent, signal),
      render_prompt: (entry) => this.renderPrompt(entry),
      collect_decision_xml: (entry) => this.collectDecisionXml(entry, onEvent, signal),
      parse_decision: (entry) => this.parseDecision(entry),
      execute_decision: (entry) => this.executeDecision(entry, onEvent, signal),
      plan_retry: (entry) => this.planRetry(entry),
    });
  }

  private async planAction(
    command: Extract<AgentLoopCommand, { kind: "plan_action" }>,
    onEvent?: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    const dynamicTools = this.agentLoopConfig.LoadedTools === "dynamic";
    const timelineMessages = this.buildActionPlannerTimelineMessages(command);
    const activeSkills = this.options.runtime.skillActivation.activate({
      input: command.input,
    });
    const plannerLoadedToolNames = this.options.runtime.toolSearch.resolvePlannedLoadedTools({
      input: command.input,
      loadedTools: this.agentLoopConfig.LoadedTools,
      currentLoadedTools: command.loadedToolNames,
      preferredTools: [],
      queries: [],
      needs: [],
      discover: false,
    });
    const plan = await this.options.runtime.actionPlanner.plan({
      requestId: command.requestId,
      input: this.actionPlannerContextBuilder.buildInput({
        requestId: command.requestId,
        userMessage: command.input,
        currentStep: command.step,
        dynamicTools,
        loadedToolNames: plannerLoadedToolNames,
        messages: timelineMessages,
        conversationEntries: command.conversationEntries,
        ledger: command.plannerLedger,
        toolCatalog: this.options.runtime.toolCatalog.list(),
        activeSkills,
      }),
      signal,
      onStage: async (event) => {
        await onEvent?.(
          this.eventFactory.actionPlannerStage(
            command.requestId,
            command.step,
            event,
          ),
        );
      },
    });
    const decision = plan.decision;
    const workflowRecommendations = decision.action === "answer"
      ? []
      : this.workflowSelector.select({
        input: command.input,
        activeSkills,
      }).map(projectWorkflowRecommendation);
    const workflowRecommendedTools: string[] = [];
    const loadedToolNames = this.options.runtime.toolSearch.resolvePlannedLoadedTools({
      input: command.input,
      loadedTools: this.agentLoopConfig.LoadedTools,
      currentLoadedTools: plannerLoadedToolNames,
      preferredTools: [
        ...agentActionPreferredTools(decision),
        ...workflowRecommendedTools,
      ],
      queries: agentActionToolSearchQueries(decision),
      needs: agentActionCapabilityNeeds(decision),
      discover: decision.action === "discover_tools",
    });
    const rootCommand = this.options.runtime.promptContextBuilder.buildRootCommand({
      decision,
      loadedToolNames,
      taskContract: plan.taskFrame,
      workflowRecommendedTools,
      workflowRecommendations,
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
        activeSkills,
        conversationEntries: [
          ...command.conversationEntries,
          createPlannerJournalEntry({
            requestId: command.requestId,
            step: command.step,
            plan,
            loadedToolNames,
          }),
        ],
        rootCommand,
      },
    };
  }

  private buildActionPlannerTimelineMessages(
    command: Extract<AgentLoopCommand, { kind: "plan_action" }>,
  ) {
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
      },
    );

    return messages.length > 0 ? messages : command.messages;
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
        rootCommand: command.rootCommand,
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

  private async executeDecision(
    command: Extract<AgentLoopCommand, { kind: "execute_decision" }>,
    onEvent?: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    try {
      throwIfAborted(signal);
      const execution = await this.options.runtime.decisionExecutor.execute(command.decision, {
        requestId: command.requestId,
        step: command.step,
        onEvent,
        loadedToolNames: command.loadedToolNames,
        signal,
      });
      throwIfAborted(signal);

      if (execution.kind !== "ToolResults") {
        return this.projectTerminal(command.requestId, command.step, execution);
      }
      const recordedResults = await this.options.runtime.artifactRecorder.record({
        requestId: command.requestId,
        step: command.step,
        results: execution.value,
      });
      const recordedExecution = {
        ...execution,
        value: recordedResults,
      };
      const resultXml = this.resultRenderer.render(recordedExecution);

      const loadedToolNames = this.options.runtime.toolSearch.afterToolResults({
        requestId: command.requestId,
        loadedTools: command.loadedToolNames,
        dynamicTools: this.agentLoopConfig.LoadedTools === "dynamic",
        execution: recordedExecution,
      });
      const plannerLedger = this.actionPlannerContextBuilder.advanceAfterToolResults({
        requestId: command.requestId,
        ledger: command.plannerLedger,
        step: command.step,
        results: recordedExecution.value,
      });

      return {
        kind: "succeeded",
        output: {
          kind: "tool_results_generated",
          requestId: command.requestId,
          step: command.step,
          responseText: command.responseText,
          execution: recordedExecution,
          resultXml,
          messages: [
            ...command.messages,
            {
              role: "assistant",
              content: command.responseText,
            },
            {
              role: "user",
              content: this.options.runtime.conversationPolicy.renderContextToolResultsXml(resultXml),
            },
          ],
          conversationEntries: this.buildToolResultConversationEntries(
            command.requestId,
            command.step,
            command.responseText,
            resultXml,
            recordedExecution.value,
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
    step: number,
    decisionXml: string,
    resultXml: string,
    results: readonly ExecutedToolCallResult[],
  ): AgentConversationEntry[] {
    const timestamp = new Date().toISOString();
    return [
      this.options.runtime.conversationProjector.projectAssistantDecision(
        requestId,
        decisionXml,
        timestamp,
        undefined,
        step,
      ),
      this.options.runtime.conversationProjector.projectContextToolResults(
        requestId,
        resultXml,
        timestamp,
        undefined,
        step,
      ),
      ...createToolEvidenceMemoryEntries({
        requestId,
        step,
        results,
        timestamp,
      }),
    ];
  }
}

function projectWorkflowRecommendation(
  result: ReturnType<AgentWorkflowSelector["select"]>[number],
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
