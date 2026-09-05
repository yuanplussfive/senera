import { lazy, Suspense, useMemo } from "react";
import type { ApprovalBatchReference, ApprovalDecision } from "../../api/approvalEventTypes";
import type { RunRecord } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Spinner } from "../../shared/ui";
import { TodoProgressCard } from "./TodoProgressCard";

const ApprovalRequestStrip = lazy(() => import("./ApprovalRequestStrip"));

/**
 * Pinned activity surface above the composer: pending approvals and the live
 * task list always visible, never covered by the scrolling message stream.
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
  const activeRun = useMemo(() => {
    const byId = new Map(runs.map((run) => [run.requestId, run] as const));
    return (
      [...byId.values()].reverse().find((run) => run.status === "running" || run.status === "cancelling") ?? undefined
    );
  }, [runs]);

  if (!pendingRun && !activeRun) return null;

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
      {activeRun ? (
        <div className="flex min-w-0 justify-start">
          <TodoProgressCard run={activeRun} />
        </div>
      ) : null}
    </div>
  );
}

function findPendingApprovalRun(runs: readonly RunRecord[]): RunRecord | undefined {
  for (const run of [...runs].reverse()) {
    const pending = (run.approvals ?? []).some((approval) => approval.status === "pending");
    if (pending) return run;
  }
  return undefined;
}
