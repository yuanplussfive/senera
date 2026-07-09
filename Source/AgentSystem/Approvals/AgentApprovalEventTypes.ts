import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type {
  AgentApprovalKind,
  AgentApprovalStatus,
  AgentApprovalSubject,
} from "./AgentApprovalTypes.js";

export type AgentApprovalDomainEvent =
  | {
      kind: typeof AgentEventKinds.ApprovalRequested;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: AgentApprovalEventData & {
        status: "pending";
      };
    }
  | {
      kind: typeof AgentEventKinds.ApprovalResolved;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: AgentApprovalEventData & {
        status: Extract<AgentApprovalStatus, "approved" | "denied">;
        message?: string;
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
  subject: AgentApprovalSubject;
  createdAt: string;
}
