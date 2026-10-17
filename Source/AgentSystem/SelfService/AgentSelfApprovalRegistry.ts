import { randomUUID } from "node:crypto";
import type { AgentSelfApprovalResolveOutcome } from "./AgentSelfApprovalTypes.js";
import type { AgentSelfCommand } from "./AgentSelfServiceTypes.js";

export const AgentSelfApprovalDeadlineMs = 5 * 60 * 1_000;

interface AgentSelfPendingApproval {
  readonly command: AgentSelfCommand;
  readonly expiresAt: number;
}

/**
 * One-shot pending-approval ledger for the CLI/HTTP handshake. An approval id
 * binds to the original command it was issued for, so a resolve can never
 * substitute a different command. Entries expire and are pruned lazily.
 */
export class AgentSelfApprovalRegistry {
  private readonly entries = new Map<string, AgentSelfPendingApproval>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  create(command: AgentSelfCommand): { readonly approvalId: string; readonly deadlineAt: string } {
    const approvalId = randomUUID();
    const deadlineAt = this.now() + AgentSelfApprovalDeadlineMs;
    this.entries.set(approvalId, { command, expiresAt: deadlineAt });
    return { approvalId, deadlineAt: new Date(deadlineAt).toISOString() };
  }

  resolve(approvalId: string, decision: "approve" | "deny"): AgentSelfApprovalResolveOutcome {
    const entry = this.entries.get(approvalId);
    if (!entry) return { status: "unknown" };
    this.entries.delete(approvalId);
    if (this.now() >= entry.expiresAt) return { status: "unknown" };
    if (decision === "deny") return { status: "resolved", decision: "deny" };
    return { status: "resolved", decision: "approve", command: entry.command };
  }
}
