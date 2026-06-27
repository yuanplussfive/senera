import { AgentEventKinds } from "./AgentEventCatalog.js";
import type { AgentEventContext } from "./AgentEventBase.js";

export type AgentToolDomainEvent =
  | {
      kind: typeof AgentEventKinds.ToolCallsPlanned;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        toolCount: number;
        tools: string[];
        status?: "planned" | "discovery_escalated" | "blocked";
        reason?: string;
        issues?: string[];
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolCallStarted;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        index: number;
        toolName: string;
        callId: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolCallCompleted;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        index: number;
        toolName: string;
        callId: string;
        preview?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolCallFailed;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        index: number;
        toolName: string;
        callId: string;
        code?: string;
        message: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolResults;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        toolCount: number;
        detailId: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolResultsDetail;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        detailId: string;
        xml: string;
        value: unknown;
      };
    };
