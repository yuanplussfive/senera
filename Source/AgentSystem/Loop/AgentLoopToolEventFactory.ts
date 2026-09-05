import { AgentEventKinds, createEventDetailId, type AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentToolResultPresentation } from "../Types/ToolRuntimeTypes.js";
import type { AgentToolEventOrigin } from "../ToolRuntime/AgentToolEventOrigin.js";
import { projectAgentMessage } from "../I18n/AgentMessageProjection.js";

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
    metadata: {
      arguments?: unknown;
      purpose?: string;
      origin?: AgentToolEventOrigin;
      batchId?: string;
      startedAt?: string;
    } = {},
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallStarted,
      context: { requestId, step },
      data: {
        index,
        toolName,
        callId,
        purpose: metadata.purpose,
        ...(metadata.arguments === undefined ? {} : { arguments: metadata.arguments }),
        origin: metadata.origin,
        batchId: metadata.batchId,
        ...(metadata.startedAt === undefined ? {} : { startedAt: metadata.startedAt }),
      },
    };
  }

  toolCallCompleted(
    requestId: string,
    step: number,
    index: number,
    toolName: string,
    callId: string,
    presentation?: AgentToolResultPresentation,
    metadata: {
      purpose?: string;
      origin?: AgentToolEventOrigin;
      batchId?: string;
      startedAt?: string;
      durationMs?: number;
    } = {},
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallCompleted,
      context: { requestId, step },
      data: {
        index,
        toolName,
        callId,
        purpose: metadata.purpose,
        presentation,
        origin: metadata.origin,
        batchId: metadata.batchId,
        ...(metadata.startedAt === undefined ? {} : { startedAt: metadata.startedAt }),
        ...(metadata.durationMs === undefined ? {} : { durationMs: metadata.durationMs }),
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
    metadata: {
      purpose?: string;
      origin?: AgentToolEventOrigin;
      batchId?: string;
      startedAt?: string;
      durationMs?: number;
    } = {},
  ): AgentDomainEvent {
    return {
      kind: AgentEventKinds.ToolCallFailed,
      context: { requestId, step },
      data: {
        index,
        toolName,
        callId,
        purpose: metadata.purpose,
        ...projectAgentMessage("tool.callFailed"),
        message,
        code,
        origin: metadata.origin,
        batchId: metadata.batchId,
        ...(metadata.startedAt === undefined ? {} : { startedAt: metadata.startedAt }),
        ...(metadata.durationMs === undefined ? {} : { durationMs: metadata.durationMs }),
      },
    };
  }

  toolCallResultDetail(
    requestId: string,
    step: number,
    index: number,
    toolName: string,
    callId: string,
    value: unknown,
    metadata: {
      origin?: AgentToolEventOrigin;
      batchId?: string;
      presentation?: AgentToolResultPresentation;
    } = {},
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
        presentation: metadata.presentation,
        value,
        origin: metadata.origin,
      },
    };
  }
}
