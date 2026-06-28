import {
  AgentEventKinds,
  createEventDetailId,
  type AgentDomainEvent,
} from "../Events/AgentEvent.js";
import type { AgentExecutionResult } from "../Decision/AgentDecisionExecutor.js";

export class AgentLoopToolEventFactory {
  toolCallsPlanned(
    requestId: string,
    step: number,
    toolNames: string[],
    metadata: {
      status?: "planned" | "discovery_escalated" | "blocked";
      reason?: string;
      issues?: readonly string[];
    } = {},
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallsPlanned,
      context: { requestId, step },
      data: {
        toolCount: toolNames.length,
        tools: toolNames,
        status: metadata.status ?? "planned",
        reason: metadata.reason,
        issues: metadata.issues ? [...metadata.issues] : undefined,
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
      context: { requestId, step },
      data: { index, toolName, callId },
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
      context: { requestId, step },
      data: { index, toolName, callId, preview },
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
      context: { requestId, step },
      data: { index, toolName, callId, message, code },
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
        context: { requestId, step },
        data: {
          toolCount: Array.isArray(execution.value) ? execution.value.length : 0,
          detailId,
        },
      },
      {
        kind: AgentEventKinds.ToolResultsDetail,
        context: { requestId, step },
        data: {
          detailId,
          xml: resultXml,
          value: execution.value,
        },
      },
    ];
  }
}

