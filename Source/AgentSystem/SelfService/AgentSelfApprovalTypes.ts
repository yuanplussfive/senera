import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentSelfConfigPathRule } from "./AgentSelfSensitivePath.js";
import type { AgentSelfCommand } from "./AgentSelfServiceTypes.js";

/**
 * One approval decision requested for a host-owned mutation. The same
 * vocabulary drives the model-facing channel (frontend approval card) and the
 * CLI-facing channel (deferred two-step handshake), so the executor stays
 * single-path while presentation is channel-specific.
 */
export type AgentSelfApprovalRequest =
  | {
      readonly kind?: "config";
      readonly command: Extract<AgentSelfCommand, { readonly command: "config" }>;
      readonly path: string;
      readonly value: unknown;
      readonly rule: AgentSelfConfigPathRule;
      /** Model-session execution approval mode; absent for human CLI usage. */
      readonly mode?: AgentExecutionApprovalMode;
    }
  | {
      readonly kind: "skill";
      readonly command: Extract<AgentSelfCommand, { readonly command: "skills" }>;
      readonly skillName: string;
      readonly operation: "create" | "update" | "archive" | "restore";
      readonly reason: string;
      /** Model-session execution approval mode; absent for human CLI usage. */
      readonly mode?: AgentExecutionApprovalMode;
    };

export type AgentSelfApprovalVerdict =
  | { readonly status: "approved" }
  | { readonly status: "denied"; readonly message: string }
  | { readonly status: "deferred"; readonly approvalId: string; readonly deadlineAt: string };

export type AgentSelfApprovalResolveOutcome =
  | { readonly status: "resolved"; readonly decision: "approve"; readonly command: AgentSelfCommand }
  | { readonly status: "resolved"; readonly decision: "deny" }
  | { readonly status: "unknown" };

export interface AgentSelfApprovalChannel {
  request(input: AgentSelfApprovalRequest): Promise<AgentSelfApprovalVerdict>;
  resolve?(approvalId: string, decision: "approve" | "deny"): Promise<AgentSelfApprovalResolveOutcome>;
}

/** Executor-side adjudication result for a sensitive config mutation. Carries
 * the triggering rule reason so the caller renders one consistent prompt for
 * both `config update` and `config rollback`. */
export type AgentSelfConfigAdjudication =
  | { readonly status: "approved" }
  | { readonly status: "denied"; readonly message: string }
  | {
      readonly status: "deferred";
      readonly approvalId: string;
      readonly deadlineAt: string;
      readonly reason: string;
    };

export interface AgentSelfCommandExecutionOptions {
  readonly approvals?: AgentSelfApprovalChannel;
  readonly approvalMode?: AgentExecutionApprovalMode;
}
