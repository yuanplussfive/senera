import { useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import type { ApprovalRunRecord } from "../../store/sessionStore";
import { Button, MetaLabel } from "../../shared/ui";

export interface ApprovalRequestStripProps {
  approvals: ApprovalRunRecord[];
  disabled?: boolean;
  onResolve: (approvalId: string, status: "approved" | "denied") => void;
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
          onResolve={(approvalId, status) => {
            setResolvingIds((current) => ({ ...current, [approvalId]: true }));
            onResolve(approvalId, status);
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
  const argumentSummary = summarizeApprovalArguments(approval.arguments);

  return (
    <section className="border-l-2 border-umber-500 bg-paper-50 px-3 py-2 shadow-[inset_0_-1px_0_rgba(24,24,27,0.05),0_1px_2px_rgba(24,24,27,0.04)]">
      <div className="flex min-w-0 items-start gap-2.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-umber-700" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[12.5px] font-medium text-ink-900">{approval.toolName}</span>
            <MetaLabel size="sm" className="text-umber-700">等待审批</MetaLabel>
            {approval.rule ? (
              <span className="rounded-[3px] bg-umber-50 px-1.5 py-0.5 font-mono text-[10px] text-umber-800">
                {approval.rule}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-ink-500">
            {approval.reason}
          </p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
            {riskLabels.map((label) => (
              <span
                key={label}
                className="rounded-[3px] border border-ink-200/80 bg-ink-50 px-1.5 py-0.5 font-mono text-[10px] text-ink-500"
              >
                {label}
              </span>
            ))}
            {argumentSummary ? (
              <span className="min-w-0 truncate font-mono text-[10.5px] text-ink-400">
                {argumentSummary}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onResolve(approval.approvalId, "denied")}
            className="h-7 px-2 text-ink-500 hover:bg-brick-50 hover:text-brick-700"
            aria-label="拒绝工具调用"
          >
            <X className="h-3.5 w-3.5" />
            拒绝
          </Button>
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => onResolve(approval.approvalId, "approved")}
            className="h-7 bg-ink-900 px-2 text-paper-50 hover:bg-ink-800"
            aria-label="批准工具调用"
          >
            <Check className="h-3.5 w-3.5" />
            通过
          </Button>
        </div>
      </div>
    </section>
  );
}

function approvalRiskLabels(approval: ApprovalRunRecord): string[] {
  const signals = approval.riskSignals ?? [];
  return signals.length > 0
    ? signals.slice(0, 4)
    : ["manual-review"];
}

function summarizeApprovalArguments(args: Record<string, unknown>): string {
  const entries = Object.entries(args).slice(0, 3);
  if (entries.length === 0) return "";

  return entries
    .map(([key, value]) => `${key}=${summarizeValue(value)}`)
    .join(" · ");
}

function summarizeValue(value: unknown): string {
  const text = typeof value === "string"
    ? value
    : Array.isArray(value)
      ? `[${value.length}]`
      : value && typeof value === "object"
        ? "{...}"
        : String(value);

  return text.length > 42 ? `${text.slice(0, 39)}...` : text;
}
