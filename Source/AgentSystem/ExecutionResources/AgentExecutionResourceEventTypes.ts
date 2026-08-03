import type { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type { AgentExecutionResourceState } from "./AgentExecutionResourceTypes.js";
import type { AgentExecutionResourceSnapshot } from "./AgentExecutionResourceTypes.js";

export type AgentExecutionResourceDomainEvent =
  | {
      kind: typeof AgentEventKinds.ExecutionResourceCreated;
      context: AgentEventContext;
      data: {
        resource: AgentExecutionResourceSnapshot;
      };
    }
  | {
      kind: typeof AgentEventKinds.ExecutionResourceOutput;
      context: AgentEventContext;
      data: {
        resourceId: string;
        toolCallId?: string;
        toolName?: string;
        cursor: number;
        stream: "stdout" | "stderr";
        text: string;
        byteLength: number;
        totalBytes: number;
        truncated?: boolean;
      };
    }
  | {
      kind: typeof AgentEventKinds.ExecutionResourceState;
      context: AgentEventContext;
      data: {
        resourceId: string;
        toolCallId?: string;
        toolName?: string;
        cursor: number;
        state: AgentExecutionResourceState;
        pid?: number;
        exitCode?: number | null;
        signal?: NodeJS.Signals | number | null;
        reason?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ExecutionResourceResized;
      context: AgentEventContext;
      data: {
        resourceId: string;
        columns: number;
        rows: number;
      };
    }
  | {
      kind: typeof AgentEventKinds.ExecutionResourceRemoved;
      context: AgentEventContext;
      data: {
        resourceId: string;
        reason: "released" | "expired" | "stop_all" | "broker_closed";
      };
    }
  | {
      kind: typeof AgentEventKinds.ExecutionResourceSnapshot;
      context: AgentEventContext;
      data: {
        operation: "list" | "inspect" | "write" | "resize" | "signal" | "stop_all";
        resources: AgentExecutionResourceSnapshot[];
      };
    };
