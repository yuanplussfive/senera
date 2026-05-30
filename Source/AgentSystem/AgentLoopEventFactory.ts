import {
  AgentEventKinds,
  createEventDetailId,
  summarizePrompt,
  summarizeXmlDocument,
  type AgentDomainEvent,
} from "./AgentEvent.js";
import type { AgentExecutionResult } from "./AgentDecisionExecutor.js";
import type { AgentProjectedTerminalResult } from "./AgentExecutionProjector.js";
import type { AgentRetryInstruction } from "./AgentRetryableError.js";
import type { SanitizedDecisionXml } from "./AgentDecisionXmlSanitizer.js";
import type { AgentDecision } from "./Types.js";
import type { AgentActionPlanResult } from "./AgentActionPlanner.js";
import { agentDecisionOutputContractForAction } from "./AgentDecisionOutputResolver.js";

export class AgentLoopEventFactory {
  runStarted(requestId: string, input: string): AgentDomainEvent {
    return {
      kind: AgentEventKinds.RunStarted,
      context: {
        requestId,
      },
      data: {
        input,
      },
    };
  }

  promptRendered(
    requestId: string,
    step: number,
    prompt: string,
    tokenCount: number,
  ): AgentDomainEvent[] {
    const summary = summarizePrompt(prompt, tokenCount);

    return [
      {
        kind: summary.kind,
        context: {
          requestId,
          step,
        },
        data: summary.data,
      },
      {
        kind: AgentEventKinds.PromptRendered,
        context: {
          requestId,
          step,
        },
        data: {
          prompt,
        },
      },
    ];
  }

  actionPlanned(
    requestId: string,
    step: number,
    plan: AgentActionPlanResult,
    loadedToolNames: "all" | string[],
  ): AgentDomainEvent[] {
    return [
      {
        kind: AgentEventKinds.ActionPlanned,
        context: {
          requestId,
          step,
        },
        data: plan.kind === "planned"
          ? {
              status: "planned",
              action: plan.decision.action,
              expectedOutputMode: agentDecisionOutputContractForAction(plan.decision.action),
              intent: plan.decision.intent,
              progressAssessment: plan.decision.progressAssessment,
              nextStepGoal: plan.decision.nextStepGoal,
              preferredTools: plan.decision.preferredTools,
              toolSearchQueries: plan.decision.toolSearchQueries,
              loadedTools: loadedToolNames,
              currentStep: plan.input.runtime.currentStep,
              executionState: {
                totalToolCalls: plan.input.executionState.progress.totalToolCalls,
                totalEvidence: plan.input.executionState.progress.totalEvidence,
                repeatedCallCount: plan.input.executionState.progress.repeatedCallCount,
                stalled: plan.input.executionState.progress.stalled,
                recentDeltaCount: plan.input.recentDeltas.length,
              },
              repaired: plan.repaired,
            }
          : {
              status: "fallback",
              preferredTools: [],
              toolSearchQueries: [],
              loadedTools: loadedToolNames,
              reason: plan.reason,
            },
      },
    ];
  }

  sanitizedDecisionXml(
    requestId: string,
    step: number,
    sanitized: SanitizedDecisionXml,
  ): AgentDomainEvent[] {
    if (!sanitized.changed) {
      return [];
    }

    const detailId = createEventDetailId(
      requestId,
      step,
      AgentEventKinds.DecisionXmlDetail,
      "sanitized",
    );
    const summary = summarizeXmlDocument(sanitized.xml, {
      sanitized: true,
      detailId,
    });

    return [
      {
        kind: summary.kind,
        context: {
          requestId,
          step,
        },
        data: summary.data,
      },
      {
        kind: AgentEventKinds.DecisionXmlDetail,
        context: {
          requestId,
          step,
        },
        data: {
          detailId,
          rawXml: sanitized.raw,
          xml: sanitized.xml,
          sanitized: true,
        },
      },
    ];
  }

  parsedDecision(requestId: string, step: number, decision: AgentDecision): AgentDomainEvent[] {
    const detailId = createEventDetailId(
      requestId,
      step,
      AgentEventKinds.DecisionParsedDetail,
      decision.kind.toLowerCase(),
    );

    return [
      {
        kind: AgentEventKinds.DecisionParsed,
        context: {
          requestId,
          step,
        },
        data: {
          root: decision.root,
          decisionKind: decision.kind,
          detailId,
        },
      },
      {
        kind: AgentEventKinds.DecisionParsedDetail,
        context: {
          requestId,
          step,
        },
        data: {
          detailId,
          root: decision.root,
          decisionKind: decision.kind,
          payload: decision.payload,
        },
      },
    ];
  }

  retryPlanned(
    requestId: string,
    step: number,
    attempt: number,
    instruction: AgentRetryInstruction,
  ): AgentDomainEvent[] {
    const detailId = createEventDetailId(
      requestId,
      step,
      AgentEventKinds.RetryDetail,
      String(attempt),
    );

    return [
      {
        kind: AgentEventKinds.RetryPlanned,
        context: {
          requestId,
          step,
        },
        data: {
          attempt,
          code: instruction.code,
          message: instruction.message,
          retryable: instruction.retryable,
          detailId,
        },
      },
      {
        kind: AgentEventKinds.RetryDetail,
        context: {
          requestId,
          step,
        },
        data: {
          detailId,
          instruction,
        },
      },
    ];
  }

  toolCallsPlanned(
    requestId: string,
    step: number,
    toolNames: string[],
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallsPlanned,
      context: {
        requestId,
        step,
      },
      data: {
        toolCount: toolNames.length,
        tools: toolNames,
      },
    };
  }

  toolCallStarted(
    requestId: string,
    step: number,
    index: number,
    toolName: string,
    callId: string,
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallStarted,
      context: {
        requestId,
        step,
      },
      data: {
        index,
        toolName,
        callId,
      },
    };
  }

  toolCallCompleted(
    requestId: string,
    step: number,
    index: number,
    toolName: string,
    callId: string,
    preview?: string,
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallCompleted,
      context: {
        requestId,
        step,
      },
      data: {
        index,
        toolName,
        callId,
        preview,
      },
    };
  }

  toolCallFailed(
    requestId: string,
    step: number,
    index: number,
    toolName: string,
    callId: string,
    message: string,
    code?: string,
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallFailed,
      context: {
        requestId,
        step,
      },
      data: {
        index,
        toolName,
        callId,
        message,
        code,
      },
    };
  }

  toolResults(
    requestId: string,
    step: number,
    execution: Extract<AgentExecutionResult, { kind: "ToolResults" }>,
    resultXml: string,
  ): AgentDomainEvent[] {
    const detailId = createEventDetailId(
      requestId,
      step,
      AgentEventKinds.ToolResultsDetail,
      "tool-results",
    );

    return [
      {
        kind: AgentEventKinds.ToolResults,
        context: {
          requestId,
          step,
        },
        data: {
          toolCount: Array.isArray(execution.value) ? execution.value.length : 0,
          detailId,
        },
      },
      {
        kind: AgentEventKinds.ToolResultsDetail,
        context: {
          requestId,
          step,
        },
        data: {
          detailId,
          xml: resultXml,
          value: execution.value,
        },
      },
    ];
  }

  terminal(projected: AgentProjectedTerminalResult, requestId: string): AgentDomainEvent[] {
    return [
      projected.event,
      {
        kind: AgentEventKinds.RunCompleted,
        context: {
          requestId,
        },
        data: {},
      },
    ];
  }
}
