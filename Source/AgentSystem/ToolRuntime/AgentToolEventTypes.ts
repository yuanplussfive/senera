import { type AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type { AgentToolResultPresentation } from "../Types/ToolRuntimeTypes.js";

type AgentToolEventContext = Required<Pick<AgentEventContext, "requestId" | "step">> &
  Partial<Pick<AgentEventContext, "sessionId">>;

export type AgentToolDomainEvent =
  | {
      kind: typeof AgentEventKinds.ToolCallsPlanned;
      context: AgentToolEventContext;
      data: {
        toolCount: number;
        tools: string[];
        status?: "planned" | "discovery_escalated" | "blocked";
        executionMode?: "parallel" | "sequential";
        batchId?: string;
        reason?: string;
        issues?: string[];
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolCallStarted;
      context: AgentToolEventContext;
      data: {
        index: number;
        toolName: string;
        callId: string;
        batchId?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolCallOutput;
      context: AgentToolEventContext;
      data: {
        toolName: string;
        callId: string;
        stream: "stdout" | "stderr";
        outputSequence: number;
        text: string;
        byteLength: number;
        totalBytes: number;
        batchId?: string;
        resourceId?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolCallProgress;
      context: AgentToolEventContext;
      data: {
        toolName: string;
        callId: string;
        progressSequence: number;
        message?: string;
        completed?: number;
        total?: number;
        unit?: string;
        taskId?: string;
        state?: string;
        terminal?: boolean;
        pollIntervalMs?: number;
        batchId?: string;
        resourceId?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolCallCompleted;
      context: AgentToolEventContext;
      data: {
        index: number;
        toolName: string;
        callId: string;
        batchId?: string;
        presentation?: AgentToolResultPresentation;
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolCallFailed;
      context: AgentToolEventContext;
      data: {
        index: number;
        toolName: string;
        callId: string;
        batchId?: string;
        code?: string;
        message: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolCallResultDetail;
      context: AgentToolEventContext;
      data: {
        detailId: string;
        index: number;
        toolName: string;
        callId: string;
        batchId?: string;
        value: unknown;
      };
    };
