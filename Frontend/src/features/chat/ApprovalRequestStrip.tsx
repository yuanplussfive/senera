import { Check, CircleStop, ShieldCheck, X } from "lucide-react";
import type { ComponentType } from "react";
import type { ApprovalBatchReference, ApprovalDecision } from "../../api/approvalEventTypes";
import type { ApprovalRunRecord } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { MotionList, MotionListItem } from "../../shared/motion";
import { Button, MetaLabel, Spinner } from "../../shared/ui";

export interface ApprovalRequestStripProps {
  approvals: ApprovalRunRecord[];
  sessionId?: string;
  requestId?: string;
  disabled?: boolean;
  onResolve: (approvalId: string, decision: ApprovalDecision) => void;
  onResolveBatch?: (batch: ApprovalBatchReference, decision: ApprovalDecision) => void;
}

interface ApprovalDecisionPresentation {
  Icon: ComponentType<{ className?: string }>;
  variant: "default" | "ghost";
  className: string;
  singleLabel: (approval: ApprovalRunRecord) => string;
  batchLabel: Parameters<typeof frontendMessage>[0];
}

const DecisionPresentation = {
  approve_once: {
    Icon: Check,
    variant: "default",
    className: "bg-ink-900 text-paper-50 hover:bg-ink-800",
    singleLabel: (approval) =>
      frontendMessage(
        approval.availableDecisions.includes("approve_session") ? "approval.allowOnce" : "approval.allow",
      ),
    batchLabel: "approval.allowAllOnce",
  },
  approve_session: {
    Icon: ShieldCheck,
    variant: "default",
    className: "bg-ink-900 text-paper-50 hover:bg-ink-800",
    singleLabel: () => frontendMessage("approval.allowSession"),
    batchLabel: "approval.allowAllSession",
  },
  deny: {
    Icon: X,
    variant: "ghost",
    className: "text-ink-500 hover:bg-brick-50 hover:text-brick-700",
    singleLabel: () => frontendMessage("approval.deny"),
    batchLabel: "approval.denyAll",
  },
  deny_and_interrupt: {
    Icon: CircleStop,
    variant: "ghost",
    className: "text-brick-700 hover:bg-brick-50",
    singleLabel: () => frontendMessage("approval.denyAndInterrupt"),
    batchLabel: "approval.denyAllAndInterrupt",
  },
} satisfies Record<ApprovalDecision, ApprovalDecisionPresentation>;

interface ApprovalGroup {
  key: string;
  batchId?: string;
  approvals: ApprovalRunRecord[];
}

export function ApprovalRequestStrip({
  approvals,
  sessionId,
  requestId,
  disabled = false,
  onResolve,
  onResolveBatch,
}: ApprovalRequestStripProps): JSX.Element {
  const groups = groupApprovals(
    approvals.filter((approval) => approval.status === "pending"),
    Boolean(sessionId && requestId && onResolveBatch),
  );
  return (
    <MotionList className="flex flex-col gap-1.5">
      {groups.map((group) => (
        <MotionListItem key={group.key} layout="position" className="last:mb-3">
          <ApprovalGroupView
            group={group}
            batchReference={
              group.batchId && sessionId && requestId ? { sessionId, requestId, batchId: group.batchId } : undefined
            }
            disabled={disabled || group.approvals.some((approval) => approval.resolutionPending)}
            onResolve={onResolve}
            onResolveBatch={onResolveBatch}
          />
        </MotionListItem>
      ))}
    </MotionList>
  );
}

export default ApprovalRequestStrip;

function ApprovalGroupView({
  group,
  batchReference,
  disabled,
  onResolve,
  onResolveBatch,
}: {
  group: ApprovalGroup;
  batchReference?: ApprovalBatchReference;
  disabled: boolean;
  onResolve: ApprovalRequestStripProps["onResolve"];
  onResolveBatch?: ApprovalRequestStripProps["onResolveBatch"];
}): JSX.Element {
  const batch = group.approvals.length > 1;
  const primary = group.approvals[0]!;
  const decisions = sharedDecisions(group.approvals);
  const resolve = (decision: ApprovalDecision): void => {
    if (batchReference && onResolveBatch) onResolveBatch(batchReference, decision);
    else onResolve(primary.approvalId, decision);
  };

  return (
    <section className="rounded-lg border border-line bg-surface-raised px-3 py-2.5 shadow-panel">
      <div className="flex min-w-0 items-center gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0 text-umber-600" />
        <span className="min-w-0 truncate text-[12.5px] font-semibold text-content-primary">
          {batch
            ? frontendMessage("approval.batch.pending", { count: group.approvals.length })
            : primary.subject.toolName}
        </span>
        <MetaLabel size="sm" className="shrink-0 text-umber-600">
          {frontendMessage("approval.tool.pending")}
        </MetaLabel>
      </div>

      <div className={batch ? "mt-2 divide-y divide-line-subtle border-y border-line-subtle" : "mt-1"}>
        {group.approvals.map((approval) => (
          <ApprovalSummary key={approval.approvalId} approval={approval} showName={batch} />
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1">
        {decisions.map((decision) => (
          <ApprovalDecisionButton
            key={decision}
            approval={primary}
            decision={decision}
            batch={batch}
            disabled={disabled}
            resolving={group.approvals.some(
              (approval) => approval.resolutionPending && approval.pendingDecision === decision,
            )}
            onResolve={resolve}
          />
        ))}
      </div>
    </section>
  );
}

function ApprovalSummary({ approval, showName }: { approval: ApprovalRunRecord; showName: boolean }): JSX.Element {
  const risks = approvalRiskLabels(approval);
  const argumentsText = summarizeApprovalArguments(approval.subject.arguments);
  const resources = approval.subject.resources ?? [];
  return (
    <div className={showName ? "py-2 first:pt-1.5 last:pb-1.5" : undefined}>
      {showName ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-[11.5px] font-medium text-content-primary">{approval.subject.toolName}</span>
          {approval.rule ? <RuleLabel value={approval.rule} /> : null}
        </div>
      ) : approval.rule ? (
        <RuleLabel value={approval.rule} />
      ) : null}
      <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-content-secondary">{approval.reason}</p>
      {resources.length ? (
        <div className="mt-1 space-y-0.5">
          {resources.map((resource) => (
            <div
              key={`${resource.intent}:${resource.canonicalPath}`}
              className="flex min-w-0 items-baseline gap-1.5 font-mono text-[10.5px] leading-4"
              title={resource.canonicalPath}
            >
              <span className="shrink-0 text-umber-600">{resourceIntentLabel(resource.intent)}</span>
              <span className="min-w-0 break-all text-content-secondary">{resource.canonicalPath}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
        {risks.map((label) => (
          <span
            key={label}
            className="rounded-[4px] border border-line-subtle bg-surface-subtle px-1.5 py-0.5 font-mono text-[10px] text-content-secondary"
          >
            {label}
          </span>
        ))}
        {argumentsText && !resources.length ? (
          <span className="min-w-0 truncate font-mono text-[10.5px] text-content-muted">{argumentsText}</span>
        ) : null}
      </div>
    </div>
  );
}

function resourceIntentLabel(intent: NonNullable<ApprovalRunRecord["subject"]["resources"]>[number]["intent"]): string {
  return frontendMessage(`approval.resource.${intent}`);
}

function RuleLabel({ value }: { value: string }): JSX.Element {
  return <span className="rounded-[4px] bg-umber-50 px-1.5 py-0.5 font-mono text-[10px] text-umber-600">{value}</span>;
}

function ApprovalDecisionButton({
  approval,
  decision,
  batch,
  disabled,
  resolving,
  onResolve,
}: {
  approval: ApprovalRunRecord;
  decision: ApprovalDecision;
  batch: boolean;
  disabled: boolean;
  resolving: boolean;
  onResolve: (decision: ApprovalDecision) => void;
}): JSX.Element {
  const presentation = DecisionPresentation[decision];
  const label = resolving
    ? frontendMessage("approval.resolving")
    : batch
      ? frontendMessage(presentation.batchLabel)
      : presentation.singleLabel(approval);
  const Icon = presentation.Icon;
  return (
    <Button
      size="sm"
      variant={presentation.variant}
      disabled={disabled}
      onClick={() => onResolve(decision)}
      className={`h-8 px-2.5 ${presentation.className}`}
      aria-label={label}
    >
      {resolving ? <Spinner size="sm" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

function groupApprovals(approvals: ApprovalRunRecord[], batches: boolean): ApprovalGroup[] {
  const groups = new Map<string, ApprovalGroup>();
  for (const approval of approvals) {
    const batchId = batches ? approval.batchId : undefined;
    const key = batchId ? `batch:${batchId}` : `approval:${approval.approvalId}`;
    const group = groups.get(key) ?? { key, batchId, approvals: [] };
    group.approvals.push(approval);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function sharedDecisions([first, ...rest]: ApprovalRunRecord[]): ApprovalDecision[] {
  return first
    ? first.availableDecisions.filter((decision) =>
        rest.every((approval) => approval.availableDecisions.includes(decision)),
      )
    : [];
}

function approvalRiskLabels(approval: ApprovalRunRecord): string[] {
  const execution = approval.subject.execution;
  const labels = execution
    ? [
        frontendMessage(execution.target === "Sandbox" ? "approval.execution.sandbox" : "approval.execution.local"),
        frontendMessage(
          execution.network === "default" ? "approval.execution.networkDefault" : "approval.execution.networkDisabled",
        ),
        frontendMessage(
          execution.workspaceMount === "writable"
            ? "approval.execution.workspaceWritable"
            : "approval.execution.workspaceReadonly",
        ),
      ]
    : [];
  return [
    ...labels,
    ...(approval.riskSignals?.length ? approval.riskSignals : [frontendMessage("approval.manualReview")]),
  ].slice(0, 5);
}

function summarizeApprovalArguments(args: Record<string, unknown>): string {
  return Object.entries(args)
    .slice(0, 3)
    .map(([key, value]) => {
      const text =
        typeof value === "string"
          ? value
          : Array.isArray(value)
            ? `[${value.length}]`
            : (JSON.stringify(value) ?? String(value));
      return `${key}=${text.length > 42 ? `${text.slice(0, 39)}...` : text}`;
    })
    .join(" · ");
}
