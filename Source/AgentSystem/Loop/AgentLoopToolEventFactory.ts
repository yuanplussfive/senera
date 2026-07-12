import { AgentEventKinds, createEventDetailId, type AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentToolResultPresentation } from "../Types/ToolRuntimeTypes.js";

export class AgentLoopToolEventFactory {
  toolCallsPlanned(
    requestId: string,
    step: number,
    toolNames: string[],
    metadata: {
      status?: "planned" | "discovery_escalated" | "blocked";
      executionMode?: "parallel" | "sequential";
      batchId?: string;
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
        executionMode: metadata.executionMode,
        batchId: metadata.batchId,
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
    metadata: { batchId?: string } = {},
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallStarted,
      context: { requestId, step },
      data: { index, toolName, callId, batchId: metadata.batchId },
    };
  }

  toolCallCompleted(
    requestId: string,
    step: number,
    index: number,
    toolName: string,
    callId: string,
    presentation?: AgentToolResultPresentation,
    metadata: { batchId?: string } = {},
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallCompleted,
      context: { requestId, step },
      data: { index, toolName, callId, presentation, batchId: metadata.batchId },
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
    metadata: { batchId?: string } = {},
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallFailed,
      context: { requestId, step },
      data: { index, toolName, callId, message, code, batchId: metadata.batchId },
    };
  }

  toolCallResultDetail(
    requestId: string,
    step: number,
    index: number,
    toolName: string,
    callId: string,
    value: unknown,
    metadata: { batchId?: string } = {},
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallResultDetail,
      context: { requestId, step },
      data: {
        detailId: createEventDetailId(requestId, step, AgentEventKinds.ToolCallResultDetail, callId),
        index,
        toolName,
        callId,
        batchId: metadata.batchId,
        value,
      },
    };
  }
}
