import { type AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type {
  AgentApprovalDecision,
  AgentApprovalDisposition,
  AgentApprovalKind,
  AgentApprovalStatus,
  AgentApprovalSubject,
} from "./AgentApprovalTypes.js";

export type AgentApprovalDomainEvent =
  | {
      kind: typeof AgentEventKinds.ApprovalRequested;
      context: Required<Pick<AgentEventContext, "sessionId" | "requestId" | "step">>;
      data: AgentApprovalEventData & {
        status: "pending";
      };
    }
  | {
      kind: typeof AgentEventKinds.ApprovalResolved;
      context: Required<Pick<AgentEventContext, "sessionId" | "requestId" | "step">>;
      data: AgentApprovalEventData & {
        decision?: AgentApprovalDecision;
        status: Exclude<AgentApprovalStatus, "pending">;
        disposition: AgentApprovalDisposition;
        message?: string;
        scope?: "once" | "session";
        resolvedAt: string;
      };
    };

export interface AgentApprovalEventData {
  approvalId: string;
  approvalKind: AgentApprovalKind;
  title: string;
  reason: string;
  rule?: string;
  riskSignals?: readonly string[];
  toolCallId?: string;
  batchId?: string;
  availableDecisions: readonly AgentApprovalDecision[];
  subject: AgentApprovalSubject;
  createdAt: string;
}
