import { lazy, Suspense, useMemo } from "react";
import type { ApprovalBatchReference, ApprovalDecision } from "../../api/approvalEventTypes";
import type { RunRecord } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Spinner } from "../../shared/ui";

const ApprovalRequestStrip = lazy(() => import("./ApprovalRequestStrip"));

/**
 * Pinned activity surface above the composer: pending approvals stay visible
 * and are never covered by the scrolling message stream. The live task list
 * lives at the top of the execution dock instead.
 */
export function ChatActivityDock({
  sessionId,
  runs,
  approvalDisabled,
  onResolveApproval,
  onResolveApprovalBatch,
}: {
  sessionId?: string;
  runs: readonly RunRecord[];
  approvalDisabled: boolean;
  onResolveApproval?: (approvalId: string, decision: ApprovalDecision) => void;
  onResolveApprovalBatch?: (batch: ApprovalBatchReference, decision: ApprovalDecision) => void;
}): JSX.Element | null {
  const pendingRun = useMemo(() => findPendingApprovalRun(runs), [runs]);
  if (!pendingRun) return null;

  return (
    <div className="mx-4 mb-2 shrink-0 space-y-2" data-chat-activity-dock data-testid="chat-activity-dock">
      {pendingRun ? (
        <Suspense
          fallback={
            <div className="flex h-11 items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 text-[12px] text-content-secondary">
              <Spinner size="sm" />
              {frontendMessage("approval.waiting")}
            </div>
          }
        >
          <ApprovalRequestStrip
            sessionId={sessionId}
            requestId={pendingRun.requestId}
            approvals={pendingRun.approvals ?? []}
            disabled={approvalDisabled || (!onResolveApproval && !onResolveApprovalBatch)}
            onResolve={(approvalId, decision) => onResolveApproval?.(approvalId, decision)}
            onResolveBatch={(batch, decision) => onResolveApprovalBatch?.(batch, decision)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function findPendingApprovalRun(runs: readonly RunRecord[]): RunRecord | undefined {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    const pending = (run.approvals ?? []).some((approval) => approval.status === "pending");
    if (pending) return run;
  }
  return undefined;
}
