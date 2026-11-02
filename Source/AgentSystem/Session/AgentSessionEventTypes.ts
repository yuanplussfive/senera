import { type AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext, AgentEventEnvelope } from "../Events/AgentEventBase.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type {
  AgentChannelMetadata,
  AgentEffectiveModelReceipt,
  AgentModelProviderMetadata,
  AgentSessionModelPreference,
} from "../ModelEndpoints/AgentModelMetadata.js";
import type { StepTrace } from "../Core/AgentStepTrace.js";
import type { AgentPiSessionRuntimeStatus } from "../Pi/AgentPiSessionManagement.js";
import type { AgentSessionOperation } from "./AgentSessionOperation.js";
import type { AgentLocalizedMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentSessionRecoveryMode } from "./AgentSessionRunRecovery.js";

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
        localizedMessage?: AgentLocalizedMessage;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionMessageQueued;
      context: Required<Pick<AgentEventContext, "sessionId" | "requestId">>;
      data: {
        sessionId: string;
        requestId: string;
        parentRequestId: string;
        mode: import("./AgentSessionMessageQueueMode.js").AgentSessionMessageQueueMode;
        status?: import("./AgentSessionQueuedInput.js").AgentSessionInputState;
        message?: string;
        entry?: Extract<
          import("../Conversation/AgentConversation.js").AgentConversationEntry,
          { kind: "user.message" }
        >;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionNotFound;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        operation: AgentSessionOperation;
        message: string;
        localizedMessage?: AgentLocalizedMessage;
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
          activeRequestId?: string;
          channel?: import("../ModelEndpoints/AgentModelMetadata.js").AgentChannelMetadata;
          modelProviderId?: string;
          effectiveModel?: AgentEffectiveModelReceipt;
          modelPreference?: AgentSessionModelPreference;
        }>;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionHistoryStarted;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        totalEntries: number;
        messageCount: number;
        refresh?: boolean;
        window?: import("./AgentSessionHistoryWindow.js").AgentSessionHistoryWindow;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionHistoryChunk;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        preview?: boolean;
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
      kind: typeof AgentEventKinds.SessionRunHistoryDetail;
      context: Required<Pick<AgentEventContext, "sessionId" | "requestId">>;
      data: {
        sessionId: string;
        requestId: string;
        events: AgentEventEnvelope[];
        complete: boolean;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionHistoryCompleted;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        refresh?: boolean;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionTruncated;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        fromRequestId: string;
        removedEntries: number;
        removedRequestIds?: string[];
        replacementRequestId?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionForked;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        sourceSessionId: string;
        throughRequestId: string;
        title: string;
        createdAt: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionCompacted;
      context: AgentEventContext & Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        tokensBefore: number;
        estimatedTokensAfter?: number;
        boundaryId?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionRuntimeStatus;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        available: boolean;
        runtime?: AgentPiSessionRuntimeStatus;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionExported;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        format: "jsonl" | "html";
        path: string;
      };
    };

interface AgentSessionSnapshotData {
  agentId?: string;
  sessionId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  entryCount: number;
  messageCount: number;
  turnCount: number;
  activeRequestId?: string;
  channel?: AgentChannelMetadata;
  modelProviderId?: string;
  effectiveModel?: AgentEffectiveModelReceipt;
  modelPreference?: AgentSessionModelPreference;
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
  status: "running" | "completed" | "failed" | "cancelled";
  recoveryModes?: AgentSessionRecoveryMode[];
  modelProvider?: AgentModelProviderMetadata;
  traces: StepTrace[];
}
