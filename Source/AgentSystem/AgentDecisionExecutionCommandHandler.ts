import type { AgentExecutionResult } from "./AgentDecisionExecutor.js";
import { AgentExecutionProjector } from "./AgentExecutionProjector.js";
import type { AgentEventSink } from "./AgentEvent.js";
import type {
  AgentLoopCommand,
  AgentLoopCommandResult,
} from "./AgentLoopStateMachine.js";
import type { AgentSystemRuntime } from "./AgentSystemRuntime.js";
import { AgentToolResultXmlRenderer } from "./AgentToolResultXmlRenderer.js";
import type { AgentConversationEntry } from "./AgentConversation.js";
import type { ResolvedAgentLoopConfig } from "./Types/AgentConfigTypes.js";
import type { ExecutedToolCallResult } from "./Types/ToolRuntimeTypes.js";
import { throwIfAborted } from "./AgentCancellation.js";
import { createToolEvidenceMemoryEntries } from "./AgentPlannerMemory.js";
import type { AgentActionPlannerContextBuilder } from "./AgentActionPlannerContext.js";

export interface AgentDecisionExecutionCommandHandlerOptions {
  runtime: AgentSystemRuntime;
  actionPlannerContextBuilder: AgentActionPlannerContextBuilder;
  agentLoopConfig: ResolvedAgentLoopConfig;
}

export class AgentDecisionExecutionCommandHandler {
  private readonly executionProjector = new AgentExecutionProjector();
  private readonly resultRenderer: AgentToolResultXmlRenderer;

  constructor(private readonly options: AgentDecisionExecutionCommandHandlerOptions) {
    this.resultRenderer = new AgentToolResultXmlRenderer(options.runtime.xmlPolicy.protocol);
  }

  async execute(
    command: Extract<AgentLoopCommand, { kind: "execute_decision" }>,
    onEvent?: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    try {
      throwIfAborted(signal);
      const execution = await this.options.runtime.services.execution.executeDecision(command.decision, {
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
      const recordedResults = await this.options.runtime.services.execution.recordToolArtifacts({
        requestId: command.requestId,
        step: command.step,
        results: execution.value,
      });
      const recordedExecution = {
        ...execution,
        value: recordedResults,
      };
      const resultXml = this.resultRenderer.render(recordedExecution);

      const loadedToolNames = this.options.runtime.services.retrieval.afterToolResults({
        requestId: command.requestId,
        loadedTools: command.loadedToolNames,
        dynamicTools: this.options.agentLoopConfig.LoadedTools === "dynamic",
        execution: recordedExecution,
        turnUnderstanding: command.turnUnderstanding,
      });
      const plannerLedger = this.options.actionPlannerContextBuilder.advanceAfterToolResults({
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
      return retryableFailure(command.requestId, command.step, command.responseText, error);
    }
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

function retryableFailure(
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
