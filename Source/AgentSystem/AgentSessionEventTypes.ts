import { AgentEventKinds } from "./AgentEventCatalog.js";
import type { AgentEventContext, AgentEventEnvelope } from "./AgentEventBase.js";
import type { AgentConversationEntry } from "./AgentConversation.js";
import type { AgentModelProviderMetadata } from "./AgentModelMetadata.js";
import type { StepTrace } from "./AgentStepTrace.js";

export type AgentSessionDomainEvent =
  | {
      kind: typeof AgentEventKinds.SessionCreated;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: AgentSessionSnapshotData;
    }
  | {
      kind: typeof AgentEventKinds.SessionSnapshot;
      context: Required<Pick<AgentEventContext, "sessionId">> & Partial<Pick<AgentEventContext, "requestId">>;
      data: AgentSessionSnapshotData;
    }
  | {
      kind: typeof AgentEventKinds.SessionClosed;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: AgentSessionSnapshotData;
    }
  | {
      kind: typeof AgentEventKinds.SessionBusy;
      context: Required<Pick<AgentEventContext, "sessionId">> & Partial<Pick<AgentEventContext, "requestId">>;
      data: {
        sessionId: string;
        activeRequestId: string;
        rejectedRequestId?: string;
        operation: "session.message" | "session.close";
        message: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionNotFound;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        operation: "session.message" | "session.close" | "session.history";
        message: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionListSnapshot;
      context: AgentEventContext;
      data: {
        sessions: Array<{
          sessionId: string;
          title: string;
          status: string;
          createdAt: string;
          updatedAt: string;
          entryCount: number;
          messageCount: number;
        }>;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionHistorySnapshot;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        totalEntries: number;
        messageCount: number;
        entries: AgentSessionHistoryEntry[];
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionHistoryStarted;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        totalEntries: number;
        messageCount: number;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionHistoryChunk;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        entries: AgentSessionHistoryEntry[];
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionHistorySteps;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        runs: AgentHistoryStepRun[];
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionRunHistoryChunk;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        events: AgentEventEnvelope[];
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionHistoryCompleted;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionTruncated;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        fromRequestId: string;
        removedEntries: number;
      };
    };

interface AgentSessionSnapshotData {
  sessionId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  entryCount: number;
  messageCount: number;
  turnCount: number;
  activeRequestId?: string;
}

interface AgentSessionHistoryEntry {
  entry: AgentConversationEntry;
  visible?: {
    kind: string;
    text: string;
  };
}

export interface AgentHistoryStepRun {
  requestId: string;
  input: string;
  startedAt: string;
  endedAt?: string;
  status: "completed" | "failed" | "cancelled";
  modelProvider?: AgentModelProviderMetadata;
  traces: StepTrace[];
}
