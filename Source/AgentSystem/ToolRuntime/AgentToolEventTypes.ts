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
