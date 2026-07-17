import { useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import type { ApprovalRunRecord } from "../../store/sessionStore";
import type { ApprovalResolutionScope } from "../../api/approvalEventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Button, MetaLabel } from "../../shared/ui";

export interface ApprovalRequestStripProps {
  approvals: ApprovalRunRecord[];
  disabled?: boolean;
  onResolve: (approvalId: string, status: "approved" | "denied", scope?: ApprovalResolutionScope) => void;
}

export function ApprovalRequestStrip({
  approvals,
  disabled = false,
  onResolve,
}: ApprovalRequestStripProps): JSX.Element | null {
  const [resolvingIds, setResolvingIds] = useState<Record<string, boolean>>({});
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  if (pendingApprovals.length === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-1.5">
      {pendingApprovals.map((approval) => (
        <ApprovalRequestItem
          key={approval.approvalId}
          approval={approval}
          disabled={disabled || resolvingIds[approval.approvalId]}
          onResolve={(approvalId, status, scope) => {
            setResolvingIds((current) => ({ ...current, [approvalId]: true }));
            if (scope) {
              onResolve(approvalId, status, scope);
            } else {
              onResolve(approvalId, status);
            }
          }}
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
        <div className="flex shrink-0 items-center justify-end gap-1 self-end sm:self-start">
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onResolve(approval.approvalId, "denied")}
            className="h-7 px-2 text-content-secondary hover:bg-brick-50 hover:text-brick-700"
            aria-label={frontendMessage(isFallback ? "approval.fallback.deny" : "approval.tool.deny")}
          >
            <X className="h-3.5 w-3.5" />
            {frontendMessage("approval.deny")}
          </Button>
          {isFallback ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => onResolve(approval.approvalId, "approved", "once")}
                className="h-7 px-2 text-content-primary hover:bg-surface-hover"
                aria-label={frontendMessage("approval.fallback.allowOnce")}
              >
                <Check className="h-3.5 w-3.5" />
                {frontendMessage("approval.allowOnce")}
              </Button>
              <Button
                size="sm"
                disabled={disabled}
                onClick={() => onResolve(approval.approvalId, "approved", "session")}
                className="h-7 bg-content-strong px-2 text-content-inverse hover:bg-accent-solid hover:text-accent-on-solid"
                aria-label={frontendMessage("approval.fallback.allowSession")}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {frontendMessage("approval.allowSession")}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => onResolve(approval.approvalId, "approved")}
              className="h-7 bg-content-strong px-2 text-content-inverse hover:bg-accent-solid hover:text-accent-on-solid"
              aria-label={frontendMessage("approval.tool.allow")}
            >
              <Check className="h-3.5 w-3.5" />
              {frontendMessage("approval.allow")}
            </Button>
          )}
        </div>
      </div>
    </section>
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
