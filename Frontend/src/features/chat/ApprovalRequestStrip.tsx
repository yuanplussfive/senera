import { Check, CircleStop, LoaderCircle, ShieldCheck, X } from "lucide-react";
import type { ComponentType } from "react";
import type { ApprovalDecision } from "../../api/approvalEventTypes";
import type { ApprovalRunRecord } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Button, MetaLabel } from "../../shared/ui";

export interface ApprovalRequestStripProps {
  approvals: ApprovalRunRecord[];
  disabled?: boolean;
  onResolve: (approvalId: string, decision: ApprovalDecision) => void;
}

interface ApprovalDecisionPresentation {
  Icon: ComponentType<{ className?: string }>;
  variant: "default" | "ghost";
  className: string;
  label: (approval: ApprovalRunRecord) => string;
}

const ApprovalDecisionPresentations = {
  approve_once: {
    Icon: Check,
    variant: "default",
    className: "h-7 bg-ink-900 px-2 text-paper-50 hover:bg-ink-800",
    label: (approval) =>
      frontendMessage(
        approval.availableDecisions.includes("approve_session") ? "approval.allowOnce" : "approval.allow",
      ),
  },
  approve_session: {
    Icon: ShieldCheck,
    variant: "default",
    className: "h-7 bg-ink-900 px-2 text-paper-50 hover:bg-ink-800",
    label: () => frontendMessage("approval.allowSession"),
  },
  deny: {
    Icon: X,
    variant: "ghost",
    className: "h-7 px-2 text-ink-500 hover:bg-brick-50 hover:text-brick-700",
    label: () => frontendMessage("approval.deny"),
  },
  deny_and_interrupt: {
    Icon: CircleStop,
    variant: "ghost",
    className: "h-7 px-2 text-brick-700 hover:bg-brick-50",
    label: () => frontendMessage("approval.denyAndInterrupt"),
  },
} satisfies Record<ApprovalDecision, ApprovalDecisionPresentation>;

export function ApprovalRequestStrip({
  approvals,
  disabled = false,
  onResolve,
}: ApprovalRequestStripProps): JSX.Element | null {
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  if (pendingApprovals.length === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-1.5">
      {pendingApprovals.map((approval) => (
        <ApprovalRequestItem
          key={approval.approvalId}
          approval={approval}
          disabled={disabled || approval.resolutionPending === true}
          onResolve={onResolve}
        />
      ))}
    </div>
  );
}

function ApprovalRequestItem({
  approval,
  disabled,
  onResolve,
}: {
  approval: ApprovalRunRecord;
  disabled: boolean;
  onResolve: ApprovalRequestStripProps["onResolve"];
}): JSX.Element {
  const riskLabels = approvalRiskLabels(approval);
  const isFallback = approval.subject.kind === "execution_fallback";
  const argumentSummary =
    approval.subject.kind === "tool_call" ? summarizeApprovalArguments(approval.subject.arguments) : "";
  const displayName =
    approval.subject.kind === "execution_fallback" ? approval.subject.pluginTitle : approval.subject.toolName;

  return (
    <section className="rounded-xl border border-line bg-surface-raised px-3 py-2.5 shadow-panel">
      <div className="flex min-w-0 flex-col gap-2.5 sm:flex-row sm:items-start">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-umber-700" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[12.5px] font-semibold text-content-primary">{displayName}</span>
            <MetaLabel size="sm" className="text-umber-700">
              {frontendMessage(isFallback ? "approval.fallback.pending" : "approval.tool.pending")}
            </MetaLabel>
            {approval.rule ? (
              <span className="rounded-[4px] bg-umber-50 px-1.5 py-0.5 font-mono text-[10px] text-umber-800">
                {approval.rule}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-content-secondary">{approval.reason}</p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
            {riskLabels.map((label) => (
              <span
                key={label}
                className="rounded-[4px] border border-line-subtle bg-surface-subtle px-1.5 py-0.5 font-mono text-[10px] text-content-secondary"
              >
                {label}
              </span>
            ))}
            {argumentSummary ? (
              <span className="min-w-0 truncate font-mono text-[10.5px] text-content-muted">{argumentSummary}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {approval.availableDecisions.map((decision) => (
            <ApprovalDecisionButton
              key={decision}
              approval={approval}
              decision={decision}
              disabled={disabled}
              onResolve={onResolve}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ApprovalDecisionButton({
  approval,
  decision,
  disabled,
  onResolve,
}: {
  approval: ApprovalRunRecord;
  decision: ApprovalDecision;
  disabled: boolean;
  onResolve: ApprovalRequestStripProps["onResolve"];
}): JSX.Element {
  const presentation = ApprovalDecisionPresentations[decision];
  const resolving = approval.resolutionPending === true && approval.pendingDecision === decision;
  const Icon = resolving ? LoaderCircle : presentation.Icon;
  const label = resolving ? frontendMessage("approval.resolving") : presentation.label(approval);

  return (
    <Button
      size="sm"
      variant={presentation.variant}
      disabled={disabled}
      onClick={() => onResolve(approval.approvalId, decision)}
      className={presentation.className}
      aria-label={label}
    >
      <Icon className={`h-3.5 w-3.5${resolving ? " animate-spin" : ""}`} />
      {label}
    </Button>
  );
}

function approvalRiskLabels(approval: ApprovalRunRecord): string[] {
  const signals = approval.riskSignals ?? [];
  if (approval.subject.kind === "execution_fallback") {
    const subject = approval.subject;
    return [
      frontendMessage("approval.fallback.localExecution"),
      frontendMessage(subject.network === "Allow" ? "approval.fallback.networkAllow" : "approval.fallback.networkDeny"),
      frontendMessage(
        subject.workspace === "ReadWrite"
          ? "approval.fallback.workspaceReadWrite"
          : "approval.fallback.workspaceReadOnly",
      ),
      ...signals,
    ].slice(0, 5);
  }
  return signals.length > 0 ? signals.slice(0, 4) : ["manual-review"];
}

function summarizeApprovalArguments(args: Record<string, unknown>): string {
  const entries = Object.entries(args).slice(0, 3);
  if (entries.length === 0) return "";
  return entries.map(([key, value]) => `${key}=${summarizeValue(value)}`).join(" · ");
}

function summarizeValue(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? `[${value.length}]`
        : value && typeof value === "object"
          ? "{...}"
          : String(value);
  return text.length > 42 ? `${text.slice(0, 39)}...` : text;
}
